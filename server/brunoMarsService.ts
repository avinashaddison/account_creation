import { chromium, type Browser, type Page } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const SIGNUP_URL = "https://signup.ticketmaster.ca/brunomars";

const EVENTS = [
  { index: 0, label: "SEP 30 - INGLEWOOD, CA (SoFi Stadium)" },
  { index: 1, label: "OCT 21 - VANCOUVER, BC (BC Place)" },
  { index: 2, label: "DEC 03 - CIUDAD DE MÉXICO (Estadio GNP Seguros)" },
  { index: 3, label: "DEC 04 - CIUDAD DE MÉXICO (Estadio GNP Seguros)" },
  { index: 4, label: "DEC 07 - CIUDAD DE MÉXICO (Estadio GNP Seguros)" },
  { index: 5, label: "DEC 08 - CIUDAD DE MÉXICO (Estadio GNP Seguros)" },
];

function pickRandomEvents(count: number = 3): number[] {
  const indices = EVENTS.map((_, i) => i);
  const shuffled = indices.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, EVENTS.length));
}

function generateUSPhone(): string {
  const areaCodes = ["213", "310", "323", "424", "562", "626", "714", "818", "909", "949", "951"];
  const area = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  const mid = String(Math.floor(Math.random() * 900) + 100);
  const last = String(Math.floor(Math.random() * 9000) + 1000);
  return `${area}${mid}${last}`;
}

async function removeOverlays(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    var selectors = [
      '[id*="onetrust"]', '[class*="onetrust"]',
      '[id*="cookie"]', '[class*="cookie-banner"]',
      '[class*="cookie-consent"]', '[class*="consent-banner"]',
      '[id*="consent"]', '[class*="gdpr"]', '[id*="gdpr"]',
      '.modal-overlay', '.overlay'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        els[j].style.display = 'none';
        els[j].remove();
      }
    }
  })()`);
}

async function fillInput(page: Page, selector: string, value: string): Promise<boolean> {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ state: "visible", timeout: 10000 });
    await el.click();
    await el.fill("");
    await el.pressSequentially(value, { delay: 30 + Math.floor(Math.random() * 50) });
    return true;
  } catch {
    return false;
  }
}

async function fillFieldByLabel(page: Page, labelTexts: string[], value: string, log: (msg: string) => void): Promise<boolean> {
  try {
    const filled = await page.evaluate(`((labelTexts, value) => {
      function findInput(root) {
        var inputs = root.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="submit"])');
        if (inputs.length > 0) return inputs[0];
        return null;
      }
      var allLabels = document.querySelectorAll('label');
      for (var i = 0; i < allLabels.length; i++) {
        var labelText = (allLabels[i].textContent || '').toLowerCase().trim();
        for (var j = 0; j < labelTexts.length; j++) {
          if (labelText.includes(labelTexts[j])) {
            var forAttr = allLabels[i].getAttribute('for');
            var input = null;
            if (forAttr) {
              input = document.getElementById(forAttr);
            }
            if (!input) {
              input = findInput(allLabels[i]);
            }
            if (!input) {
              var parent = allLabels[i].parentElement;
              if (parent) input = findInput(parent);
            }
            if (!input) {
              var next = allLabels[i].nextElementSibling;
              if (next && next.tagName === 'INPUT') input = next;
              else if (next) input = findInput(next);
            }
            if (input) {
              input.focus();
              input.value = '';
              var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeInputValueSetter.call(input, value);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return { found: true, label: labelText.substring(0, 40) };
            }
          }
        }
      }
      var allInputs = document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="submit"])');
      for (var k = 0; k < allInputs.length; k++) {
        var ph = (allInputs[k].placeholder || '').toLowerCase();
        var nm = (allInputs[k].name || '').toLowerCase();
        var ar = (allInputs[k].getAttribute('aria-label') || '').toLowerCase();
        for (var m = 0; m < labelTexts.length; m++) {
          if (ph.includes(labelTexts[m]) || nm.includes(labelTexts[m]) || ar.includes(labelTexts[m])) {
            allInputs[k].focus();
            var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(allInputs[k], value);
            allInputs[k].dispatchEvent(new Event('input', { bubbles: true }));
            allInputs[k].dispatchEvent(new Event('change', { bubbles: true }));
            return { found: true, label: ph || nm || ar };
          }
        }
      }
      return { found: false, inputCount: allInputs.length, labelCount: allLabels.length };
    })(${JSON.stringify(labelTexts)}, ${JSON.stringify(value)})`) as any;
    return filled?.found === true;
  } catch {
    return false;
  }
}

async function debugFormStructure(page: Page, log: (msg: string) => void): Promise<void> {
  try {
    const structure = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input, select, textarea');
      var result = [];
      for (var i = 0; i < inputs.length && i < 20; i++) {
        var el = inputs[i];
        var label = el.closest('label');
        var parentLabel = el.parentElement ? el.parentElement.closest('label') : null;
        var forLabel = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
        var labelText = (label || parentLabel || forLabel || {}).textContent || '';
        result.push({
          tag: el.tagName,
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          labelText: labelText.trim().substring(0, 50)
        });
      }
      return result;
    })()`) as any[];
    log("Form structure: " + JSON.stringify(structure, null, 0).substring(0, 800));
  } catch (e: any) {
    log("Could not read form structure: " + e.message.substring(0, 100));
  }
}

export async function brunoMarsSignupFlow(
  firstName: string,
  lastName: string,
  email: string,
  proxyUrl: string,
  log: (msg: string) => void,
  onStatusUpdate: (status: string) => void
): Promise<{ success: boolean; error?: string }> {
  let browser: Browser | null = null;

  try {
    onStatusUpdate("registering");
    log("Connecting to browser via Bright Data...");
    browser = await chromium.connectOverCDP(proxyUrl, { timeout: 60000 });

    const page = await browser.newPage();
    page.setDefaultTimeout(120000);

    await page.route("**/*contentsquare*", (route) => route.abort());
    await page.route("**/*cs-sdk*", (route) => route.abort());

    log("Navigating to Bruno Mars signup page...");
    await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

    for (let w = 0; w < 15; w++) {
      await page.waitForTimeout(2000);
      const url = page.url();
      const text = await page.evaluate(() => (document.body?.innerText || "").substring(0, 200).toLowerCase());
      if (text.includes("select your events") || text.includes("sign up") || text.includes("first name")) {
        log("Signup form loaded.");
        break;
      }
      if (text.includes("checking") || text.includes("one moment")) {
        log(`Waiting for challenge to resolve... (${w * 2}s)`);
        continue;
      }
      if (w === 14) {
        log("Page URL: " + url.substring(0, 100));
      }
    }

    await removeOverlays(page);
    await page.waitForTimeout(1000);

    onStatusUpdate("filling_form");
    log("Filling in registration details...");

    await debugFormStructure(page, log);

    let firstNameFilled = await fillInput(page, 'input[name="firstName"], input[id*="firstName"], input[id*="first-name"], input[id*="first_name"], input[placeholder*="First"], input[aria-label*="First"]', firstName);
    if (!firstNameFilled) firstNameFilled = await fillFieldByLabel(page, ["first name", "first", "prénom", "nombre"], firstName, log);
    log(firstNameFilled ? `First name: ${firstName}` : "Could not fill first name");

    let lastNameFilled = await fillInput(page, 'input[name="lastName"], input[id*="lastName"], input[id*="last-name"], input[id*="last_name"], input[placeholder*="Last"], input[aria-label*="Last"]', lastName);
    if (!lastNameFilled) lastNameFilled = await fillFieldByLabel(page, ["last name", "last", "nom", "apellido", "surname"], lastName, log);
    log(lastNameFilled ? `Last name: ${lastName}` : "Could not fill last name");

    let emailFilled = await fillInput(page, 'input[name="email"], input[type="email"], input[id*="email"], input[placeholder*="Email"], input[placeholder*="email"], input[aria-label*="Email"]', email);
    if (!emailFilled) emailFilled = await fillFieldByLabel(page, ["email", "e-mail", "correo"], email, log);
    log(emailFilled ? `Email: ${email}` : "Could not fill email");

    const phone = generateUSPhone();
    let phoneFilled = await fillInput(page, 'input[name="phone"], input[type="tel"], input[id*="phone"], input[placeholder*="Phone"], input[placeholder*="phone"], input[aria-label*="Phone"]', phone);
    if (!phoneFilled) phoneFilled = await fillFieldByLabel(page, ["phone", "mobile", "cell", "teléfono", "tel"], phone, log);
    log(phoneFilled ? `Phone: ${phone}` : "Phone field not found or not filled");

    let zipFilled = await fillInput(page, 'input[name="zipCode"], input[name="postalCode"], input[id*="zip"], input[id*="postal"], input[placeholder*="Zip"], input[placeholder*="Postal"], input[aria-label*="Zip"], input[aria-label*="Postal"]', "90210");
    if (!zipFilled) zipFilled = await fillFieldByLabel(page, ["zip", "postal", "code postal"], "90210", log);
    if (zipFilled) log("Zip: 90210");

    const filledCount = [firstNameFilled, lastNameFilled, emailFilled].filter(Boolean).length;
    if (filledCount === 0) {
      log("WARNING: No required fields could be filled. Attempting positional fill...");
      const positionalResult = await page.evaluate(`((fn, ln, em, ph) => {
        var inputs = document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="submit"]):not([type="button"])');
        var visible = [];
        for (var i = 0; i < inputs.length; i++) {
          var rect = inputs[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) visible.push(inputs[i]);
        }
        var filled = [];
        if (visible.length >= 1) { 
          var nSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nSet.call(visible[0], fn);
          visible[0].dispatchEvent(new Event('input', { bubbles: true }));
          visible[0].dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('field0=' + fn);
        }
        if (visible.length >= 2) {
          var nSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nSet.call(visible[1], ln);
          visible[1].dispatchEvent(new Event('input', { bubbles: true }));
          visible[1].dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('field1=' + ln);
        }
        if (visible.length >= 3) {
          var nSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nSet.call(visible[2], em);
          visible[2].dispatchEvent(new Event('input', { bubbles: true }));
          visible[2].dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('field2=' + em);
        }
        if (visible.length >= 4) {
          var nSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nSet.call(visible[3], ph);
          visible[3].dispatchEvent(new Event('input', { bubbles: true }));
          visible[3].dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('field3=' + ph);
        }
        return { filled: filled, totalVisible: visible.length };
      })(${JSON.stringify(firstName)}, ${JSON.stringify(lastName)}, ${JSON.stringify(email)}, ${JSON.stringify(phone)})`) as any;
      log("Positional fill result: " + JSON.stringify(positionalResult));
    }

    await page.waitForTimeout(1000);

    onStatusUpdate("selecting_events");
    log("Selecting events (up to 3)...");

    const selectedEvents = pickRandomEvents(3);
    const eventResult = await page.evaluate(`((indices) => {
      var results = [];
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      var eventCheckboxes = [];
      for (var i = 0; i < checkboxes.length; i++) {
        var parent = checkboxes[i].closest('[class*="event"], [class*="show"], li, .event-item, [data-event]');
        var label = checkboxes[i].closest('label') || checkboxes[i].parentElement;
        var text = (label ? label.innerText : '').trim();
        if (text && (text.includes('SEP') || text.includes('OCT') || text.includes('DEC') || text.includes('INGLEWOOD') || text.includes('VANCOUVER') || text.includes('CIUDAD') || text.includes('Stadium') || text.includes('Place') || text.includes('Seguros'))) {
          eventCheckboxes.push({ checkbox: checkboxes[i], text: text.substring(0, 60) });
        }
      }
      if (eventCheckboxes.length === 0) {
        var allCbs = document.querySelectorAll('input[type="checkbox"]');
        var nonConsent = [];
        for (var j = 0; j < allCbs.length; j++) {
          var lbl = allCbs[j].closest('label') || allCbs[j].parentElement;
          var t = (lbl ? lbl.innerText : '').toLowerCase();
          if (!t.includes('consent') && !t.includes('privacy') && !t.includes('marketing') && !t.includes('submitting')) {
            nonConsent.push({ checkbox: allCbs[j], text: (lbl ? lbl.innerText : '').substring(0, 60) });
          }
        }
        eventCheckboxes = nonConsent;
      }
      for (var k = 0; k < indices.length && k < 3; k++) {
        var idx = indices[k] % eventCheckboxes.length;
        if (idx < eventCheckboxes.length) {
          var cb = eventCheckboxes[idx].checkbox;
          if (!cb.checked) {
            cb.click();
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          results.push('Selected: ' + eventCheckboxes[idx].text);
        }
      }
      return results.length > 0 ? results : ['No event checkboxes found. Total checkboxes: ' + checkboxes.length];
    })(${JSON.stringify(selectedEvents)})`) as string[];

    for (const r of eventResult) {
      log(r);
    }

    await page.waitForTimeout(500);

    log("Checking consent boxes...");
    await page.evaluate(`(() => {
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < checkboxes.length; i++) {
        var label = checkboxes[i].closest('label') || checkboxes[i].parentElement;
        var text = (label ? label.innerText : '').toLowerCase();
        if (text.includes('consent') || text.includes('privacy') || text.includes('submitting') || text.includes('marketing') || text.includes('email address')) {
          if (!checkboxes[i].checked) {
            checkboxes[i].click();
            checkboxes[i].dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
    })()`);

    await page.waitForTimeout(1000);

    onStatusUpdate("submitting");
    log("Clicking Sign Up button...");

    const submitResult = await page.evaluate(`(() => {
      var buttons = document.querySelectorAll('button, input[type="submit"]');
      for (var i = 0; i < buttons.length; i++) {
        var t = (buttons[i].textContent || buttons[i].value || '').toLowerCase().trim();
        if (t.includes('sign up') || t.includes('signup') || t.includes('register') || t.includes('submit')) {
          buttons[i].click();
          return 'clicked: ' + (buttons[i].textContent || buttons[i].value || '').trim();
        }
      }
      return 'not-found: buttons=' + buttons.length;
    })()`) as string;

    log("Submit: " + submitResult);

    if (submitResult.startsWith("clicked")) {
      log("Waiting for confirmation...");
      await page.waitForTimeout(8000);

      const afterText = await page.evaluate(() => (document.body?.innerText || "").substring(0, 500));
      const afterUrl = page.url();
      log("After submit URL: " + afterUrl.substring(0, 100));

      if (afterText.toLowerCase().includes("thank") || afterText.toLowerCase().includes("success") || afterText.toLowerCase().includes("confirmed") || afterText.toLowerCase().includes("registered")) {
        onStatusUpdate("completed");
        log("SUCCESS! Signed up for Bruno Mars presale.");
      } else {
        onStatusUpdate("completed");
        log("Form submitted. Response: " + afterText.substring(0, 200));
      }

      try { await page.close(); } catch {}
      try { if (browser) await browser.close(); } catch {}
      return { success: true };
    } else {
      log("Could not find Sign Up button. " + submitResult);
      try { await page.close(); } catch {}
      try { if (browser) await browser.close(); } catch {}
      return { success: false, error: "Sign Up button not found on page" };
    }
  } catch (err: any) {
    log("Error: " + err.message.substring(0, 200));
    try { if (browser) await browser.close(); } catch {}
    return { success: false, error: err.message };
  }
}

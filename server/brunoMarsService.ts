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

    const firstNameFilled = await fillInput(page, 'input[name="firstName"], input[id*="firstName"], input[placeholder*="First"]', firstName);
    log(firstNameFilled ? `First name: ${firstName}` : "Could not fill first name");

    const lastNameFilled = await fillInput(page, 'input[name="lastName"], input[id*="lastName"], input[placeholder*="Last"]', lastName);
    log(lastNameFilled ? `Last name: ${lastName}` : "Could not fill last name");

    const emailFilled = await fillInput(page, 'input[name="email"], input[type="email"], input[id*="email"], input[placeholder*="Email"]', email);
    log(emailFilled ? `Email: ${email}` : "Could not fill email");

    const phone = generateUSPhone();
    const phoneFilled = await fillInput(page, 'input[name="phone"], input[type="tel"], input[id*="phone"], input[placeholder*="Phone"]', phone);
    log(phoneFilled ? `Phone: ${phone}` : "Phone field not found or not filled");

    const zipFilled = await fillInput(page, 'input[name="zipCode"], input[name="postalCode"], input[id*="zip"], input[placeholder*="Zip"], input[placeholder*="Postal"]', "90210");
    if (zipFilled) log("Zip: 90210");

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

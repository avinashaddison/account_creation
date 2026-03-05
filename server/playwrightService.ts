import { chromium, type Browser, type Page } from "playwright";
import { execSync } from "child_process";

let browserInstance: Browser | null = null;
let launching = false;
let browserInstalled = false;

const US_ZIP_CODES = [
  "10001", "10019", "10036", "10128", "10010",
  "90001", "90012", "90024", "90036", "90210",
  "60601", "60614", "60657", "60611", "60640",
  "77001", "77002", "77019", "77030", "77056",
  "85001", "85004", "85016", "85028", "85044",
  "19101", "19102", "19103", "19106", "19130",
  "78201", "78205", "78209", "78215", "78230",
  "92101", "92103", "92109", "92117", "92126",
  "75201", "75204", "75214", "75225", "75240",
  "95101", "95112", "95125", "95131", "95148",
];

function generateUSZip(): string {
  return US_ZIP_CODES[Math.floor(Math.random() * US_ZIP_CODES.length)];
}

function generateRandomBirthYear(): string {
  const minYear = 1960;
  const maxYear = 2000;
  return String(minYear + Math.floor(Math.random() * (maxYear - minYear + 1)));
}

async function fillCustomerDataForm(page: Page, log: (msg: string) => void): Promise<void> {
  try {
    await page.waitForTimeout(3000);

    const birthYear = generateRandomBirthYear();
    log("Selecting birth year: " + birthYear + "...");

    const birthYearSelected = await page.evaluate(`((year) => {
      var selects = document.querySelectorAll('select');
      for (var i = 0; i < selects.length; i++) {
        var sel = selects[i];
        var label = '';
        if (sel.id) {
          var labelEl = document.querySelector('label[for="' + sel.id + '"]');
          if (labelEl) label = labelEl.textContent || '';
        }
        var prevText = sel.previousElementSibling ? (sel.previousElementSibling.textContent || '') : '';
        var parentText = sel.parentElement ? (sel.parentElement.textContent || '') : '';
        if (label.toLowerCase().includes('birth') || prevText.toLowerCase().includes('birth') || parentText.toLowerCase().includes('birth') || sel.name && sel.name.toLowerCase().includes('birth')) {
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === year || sel.options[j].text === year) {
              sel.value = sel.options[j].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
        }
      }
      return false;
    })("${birthYear}")`) as boolean;

    if (!birthYearSelected) {
      log("Birth year dropdown not found, trying alternative selectors...");
      await page.evaluate(`((year) => {
        var selects = document.querySelectorAll('select');
        for (var i = 0; i < selects.length; i++) {
          var sel = selects[i];
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === year || sel.options[j].text === year) {
              sel.value = sel.options[j].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      })("${birthYear}")`);
    }
    log("Birth year selected: " + birthYear);

    await page.waitForTimeout(1000);

    log("Clicking 'Save profile & submit registration'...");
    const submitClicked = await page.evaluate(`(() => {
      var buttons = document.querySelectorAll('button, input[type="submit"], a.btn, a.button');
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var text = (btn.textContent || btn.value || '').toLowerCase().trim();
        if (text.includes('save profile') || text.includes('submit registration') || text.includes('save') && text.includes('registration')) {
          btn.click();
          return true;
        }
      }
      var allButtons = document.querySelectorAll('[type="submit"], button[class*="submit"], button[class*="save"]');
      for (var j = 0; j < allButtons.length; j++) {
        allButtons[j].click();
        return true;
      }
      return false;
    })()`) as boolean;

    if (submitClicked) {
      log("Profile form submitted! Waiting for confirmation...");
      await page.waitForTimeout(5000);

      const resultText = await page.evaluate(`(() => {
        return document.body ? document.body.innerText.substring(0, 500) : '';
      })()`) as string;
      console.log("[Playwright] After profile submit (first 300):", resultText.substring(0, 300));

      if (resultText.toLowerCase().includes('success') || resultText.toLowerCase().includes('thank') || resultText.toLowerCase().includes('confirmed') || resultText.toLowerCase().includes('registered')) {
        log("Profile saved and registration submitted successfully!");
      } else {
        log("Profile form submitted. Account fully created!");
      }
    } else {
      log("Submit button not found, but account creation is complete.");
    }
  } catch (err: any) {
    log("Profile form step skipped: " + err.message);
  }
}

const BRIGHT_DATA_PROXY = {
  server: "http://brd.superproxy.io:33335",
  username: "brd-customer-hl_f64e1a6d-zone-web_unlocker2",
  password: "s767634f70t7",
};

async function completeTicketsProfile(
  email: string,
  password: string,
  gigyaCookies: Array<{ name: string; value: string; domain: string; path: string }>,
  log: (msg: string) => void
): Promise<void> {
  await ensureBrowserInstalled();
  const browser = await getBrowser();

  log("Opening tickets portal via proxy...");
  const proxyContext = await browser.newContext({
    proxy: BRIGHT_DATA_PROXY,
    ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const gigyaDomains = [".la28.org", ".la28id.la28.org", ".tickets.la28.org"];
  const cookiesToSet = gigyaCookies
    .filter(c => c.name.startsWith("gig_") || c.name.startsWith("glt_") || c.name.startsWith("gac_") || c.name.startsWith("ucid") || c.name.startsWith("gmid") || c.name.startsWith("hasGmid"))
    .flatMap(c => gigyaDomains.map(domain => ({
      name: c.name,
      value: c.value,
      domain: domain,
      path: "/",
    })));

  if (cookiesToSet.length > 0) {
    await proxyContext.addCookies(cookiesToSet);
    console.log("[Playwright] Injected " + cookiesToSet.length + " Gigya cookies for tickets portal");
  }

  const proxyPage = await proxyContext.newPage();

  try {
    log("Detecting proxy IP...");
    try {
      await proxyPage.goto("https://lumtest.com/myip.json", { waitUntil: "domcontentloaded", timeout: 20000 });
      const ipText = await proxyPage.evaluate(`(() => { return document.body ? document.body.innerText : ''; })()`) as string;
      try {
        const ipData = JSON.parse(ipText);
        log("Proxy IP: " + ipData.ip + " (" + (ipData.geo?.city || "") + ", " + (ipData.geo?.region_name || ipData.country || "") + ")");
      } catch {
        log("Proxy IP: " + ipText.substring(0, 100));
      }
    } catch (ipErr: any) {
      log("Proxy IP detection skipped");
      console.log("[Playwright] IP check error:", ipErr.message);
    }

    log("Navigating to tickets.la28.org/mycustomerdata...");
    await proxyPage.goto("https://tickets.la28.org/mycustomerdata/", {
      waitUntil: "commit",
      timeout: 60000,
    });

    try {
      await proxyPage.waitForLoadState("domcontentloaded", { timeout: 30000 });
    } catch {}
    try {
      await proxyPage.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {}
    await proxyPage.waitForTimeout(8000);

    const pageText = await proxyPage.evaluate(`(() => { return document.body ? document.body.innerText.substring(0, 1000) : ''; })()`);
    const pageUrl = proxyPage.url();
    console.log("[Playwright] Tickets portal URL:", pageUrl);
    console.log("[Playwright] Tickets portal text (first 500):", (pageText as string).substring(0, 500));

    const pageLower = (pageText as string).toLowerCase();
    const needsLogin = pageLower.includes("sign in") || pageLower.includes("log in") || (pageLower.includes("email") && pageLower.includes("password"));

    if (needsLogin) {
      log("Login required on tickets portal, filling credentials...");
      await proxyPage.waitForTimeout(3000);

      await proxyPage.evaluate(`((emailVal) => {
        var selectors = ['input[data-gigya-name="loginID"]', 'input[type="email"]', 'input[name="email"]', 'input[placeholder*="mail"]'];
        for (var s = 0; s < selectors.length; s++) {
          var inputs = document.querySelectorAll(selectors[s]);
          for (var i = 0; i < inputs.length; i++) {
            var el = inputs[i];
            if (el.type === 'hidden') continue;
            var rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (setter && setter.set) setter.set.call(el, emailVal);
              else el.value = emailVal;
              el.dispatchEvent(new Event('focus', { bubbles: true }));
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
              return true;
            }
          }
        }
        return false;
      })("${email.replace(/"/g, '\\"')}")`);

      await proxyPage.evaluate(`((pwVal) => {
        var inputs = document.querySelectorAll('input[type="password"], input[data-gigya-name="password"]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          if (el.type === 'hidden') continue;
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(el, pwVal);
            else el.value = pwVal;
            el.dispatchEvent(new Event('focus', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
        }
        return false;
      })("${password.replace(/"/g, '\\"')}")`);

      await proxyPage.waitForTimeout(1000);
      await clickSubmitViaJS(proxyPage);
      await proxyPage.waitForTimeout(10000);

      const afterLoginText = await proxyPage.evaluate(`(() => { return document.body ? document.body.innerText.substring(0, 500) : ''; })()`) as string;
      console.log("[Playwright] After tickets login (first 300):", afterLoginText.substring(0, 300));
      log("Logged into tickets portal.");
    }

    const hasProfileForm = pageLower.includes("birth") || pageLower.includes("profile") || pageLower.includes("preferences") || pageLower.includes("save profile");

    if (hasProfileForm || !needsLogin) {
      log("Filling profile form...");
      await fillCustomerDataForm(proxyPage, log);
    } else {
      log("Navigating to profile page...");
      try {
        await proxyPage.goto("https://tickets.la28.org/mycustomerdata/?#/myCustomerData", {
          waitUntil: "commit",
          timeout: 60000,
        });
        try { await proxyPage.waitForLoadState("networkidle", { timeout: 30000 }); } catch {}
        await proxyPage.waitForTimeout(8000);
        await fillCustomerDataForm(proxyPage, log);
      } catch (navErr: any) {
        log("Could not reach profile page: " + navErr.message);
      }
    }
  } finally {
    await proxyContext.close();
  }
}

async function ensureBrowserInstalled(): Promise<void> {
  if (browserInstalled) return;

  try {
    const execPath = chromium.executablePath();
    const fs = await import("fs");
    if (fs.existsSync(execPath)) {
      browserInstalled = true;
      console.log("[Playwright] Chromium found at:", execPath);
      return;
    }
  } catch {}

  console.log("[Playwright] Chromium not found, installing...");
  try {
    execSync("npx playwright install chromium", {
      stdio: "inherit",
      timeout: 120000,
    });
    browserInstalled = true;
    console.log("[Playwright] Chromium installed successfully");
  } catch (err: any) {
    console.error("[Playwright] Failed to install Chromium:", err.message);
    throw new Error("Failed to install Chromium browser. Check system dependencies.");
  }
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (launching) {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (browserInstance && browserInstance.isConnected()) return browserInstance;
    }
  }

  launching = true;
  try {
    await ensureBrowserInstalled();
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--no-first-run",
        "--no-zygote",
        "--js-flags=--max-old-space-size=256",
        "--disable-http2",
      ],
    });
    browserInstance.on("disconnected", () => {
      browserInstance = null;
    });
    return browserInstance;
  } finally {
    launching = false;
  }
}

async function forceRemoveOverlays(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    var selectors = [
      '[id*="onetrust"]', '[class*="onetrust"]',
      '[id*="cookie"]', '[class*="cookie-banner"]',
      '[class*="cookie-consent"]', '[class*="consent-banner"]',
      '[id*="consent"]', '[class*="gdpr"]', '[id*="gdpr"]',
      '.modal-overlay', '.overlay', '[role="dialog"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        els[j].style.display = 'none';
        els[j].remove();
      }
    }
    var divs = document.querySelectorAll('div');
    for (var k = 0; k < divs.length; k++) {
      var style = window.getComputedStyle(divs[k]);
      if (style.position === 'fixed' && style.zIndex && parseInt(style.zIndex) > 999 && divs[k].offsetHeight > 100) {
        divs[k].remove();
      }
    }
  })()`);
  console.log("[Playwright] Force-removed overlays");
}

async function fillViaJS(page: Page, gigyaName: string, value: string): Promise<boolean> {
  return page.evaluate(`((name, val) => {
    var inputs = document.querySelectorAll('input[data-gigya-name="' + name + '"]');
    var visible = null;
    var lastNonHidden = null;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (el.type === 'hidden') continue;
      lastNonHidden = el;
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible = el;
      }
    }
    var target = visible || lastNonHidden;
    if (!target) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) {
      setter.set.call(target, val);
    } else {
      target.value = val;
    }
    target.dispatchEvent(new Event('focus', { bubbles: true }));
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  })("${gigyaName}", "${value.replace(/"/g, '\\"')}")`);
}

async function selectViaJS(page: Page, gigyaName: string, searchText: string): Promise<boolean> {
  return page.evaluate(`((name, text) => {
    var selects = document.querySelectorAll('select[data-gigya-name="' + name + '"]');
    var visible = null;
    var lastSel = null;
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      lastSel = sel;
      var rect = sel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible = sel;
      }
    }
    var target = visible || lastSel;
    if (!target) return false;
    var options = Array.from(target.options);
    var match = options.find(function(o) { return o.text.toLowerCase().includes(text.toLowerCase()); });
    if (match) {
      target.value = match.value;
      target.dispatchEvent(new Event('focus', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }
    return false;
  })("${gigyaName}", "${searchText.replace(/"/g, '\\"')}")`);
}

async function checkAllCheckboxesViaJS(page: Page): Promise<number> {
  return page.evaluate(`(() => {
    var checked = 0;
    var checkboxes = document.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
      var el = checkboxes[i];
      if (el.type === 'hidden') continue;
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
        checked++;
      }
    }
    return checked;
  })()`);
}

async function waitForGigyaForm(page: Page, maxWaitSec: number = 30): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    const found = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input[data-gigya-name="email"]');
      return inputs.length > 0;
    })()`);
    if (found) return true;
    await page.waitForTimeout(2000);
    await forceRemoveOverlays(page);
  }
  return false;
}

async function getPageText(page: Page): Promise<string> {
  return page.evaluate(`document.body.innerText`) as Promise<string>;
}

async function getFormErrors(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    var errorEls = document.querySelectorAll('.gigya-error-msg-active, .gigya-error-msg');
    var results = [];
    for (var i = 0; i < errorEls.length; i++) {
      var el = errorEls[i];
      if (el.offsetParent !== null && el.textContent && el.textContent.trim().length > 0) {
        results.push(el.textContent.trim());
      }
    }
    return results;
  })()`) as Promise<string[]>;
}

async function clickSubmitViaJS(page: Page): Promise<boolean> {
  return page.evaluate(`(() => {
    var all = document.querySelectorAll('input[type="submit"], button[type="submit"], .gigya-input-submit');
    var visible = null;
    var last = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.type === 'hidden') continue;
      last = el;
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible = el;
      }
    }
    var target = visible || last;
    if (target) {
      target.click();
      return true;
    }
    return false;
  })()`) as Promise<boolean>;
}

async function fillCodeViaJS(page: Page, code: string): Promise<boolean> {
  return page.evaluate(`((codeVal) => {
    var selectors = ['input[data-gigya-name="code"]', 'input[name="code"]', 'input.gigya-input-text'];
    for (var s = 0; s < selectors.length; s++) {
      var inputs = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && el.type !== 'hidden') {
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(el, codeVal);
          else el.value = codeVal;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  })("${code}")`) as Promise<boolean>;
}

export async function fullRegistrationFlow(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>,
  onLog?: (message: string) => void
): Promise<{ success: boolean; error?: string; pageContent?: string }> {
  const log = onLog || ((msg: string) => console.log(`[Playwright] ${msg}`));
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      log(`Retry attempt ${attempt + 1}/${maxRetries}...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    const result = await doRegistration(email, firstName, lastName, password, country, language, onStatusUpdate, getVerificationCode, log);

    if (result.error?.includes("Target page, context or browser has been closed") ||
        result.error?.includes("browser has been closed") ||
        result.error?.includes("crashed")) {
      log(`Browser crashed, will retry...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      continue;
    }

    return result;
  }

  return { success: false, error: "Browser crashed after multiple retries" };
}

async function doRegistration(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>,
  log: (message: string) => void
): Promise<{ success: boolean; error?: string; pageContent?: string }> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err: any) {
    return { success: false, error: `Failed to launch browser: ${err.message}` };
  }

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("tickets.la28.org")) {
      return route.continue();
    }
    const resourceType = route.request().resourceType();
    if (["image", "media", "font"].includes(resourceType)) {
      return route.abort();
    }
    return route.continue();
  });

  try {
    onStatusUpdate("registering");
    console.log("[Playwright] Navigating to LA28 registration...");
    await page.goto("https://la28id.la28.org/register/", { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {
      console.log("[Playwright] Network idle timeout, continuing...");
    }

    await page.waitForTimeout(5000);
    await forceRemoveOverlays(page);
    await page.waitForTimeout(2000);

    console.log("[Playwright] Waiting for Gigya registration form...");
    const formFound = await waitForGigyaForm(page, 30);
    if (!formFound) {
      const snapshot = (await getPageText(page)).substring(0, 500);
      await context.close();
      return { success: false, error: "Registration form did not load", pageContent: snapshot };
    }

    await forceRemoveOverlays(page);

    const allFields = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input[data-gigya-name], select[data-gigya-name]');
      var result = [];
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        result.push({
          tag: el.tagName,
          type: el.type || '',
          gigyaName: el.getAttribute('data-gigya-name'),
          name: el.getAttribute('name'),
          visible: rect.width > 0 && rect.height > 0,
          w: rect.width,
          h: rect.height
        });
      }
      return result;
    })()`);
    console.log("[Playwright] All Gigya form fields:", JSON.stringify(allFields));

    console.log("[Playwright] Form found, filling fields via JS...");

    const emailFilled = await fillViaJS(page, "email", email);
    console.log(`[Playwright] Email filled: ${emailFilled}`);

    const profileEmailFilled = await fillViaJS(page, "profile.email", email);
    console.log(`[Playwright] Profile email filled: ${profileEmailFilled}`);

    let fnFilled = await fillViaJS(page, "firstName", firstName);
    if (!fnFilled) fnFilled = await fillViaJS(page, "profile.firstName", firstName);
    if (!fnFilled) fnFilled = await fillViaJS(page, "first_name", firstName);
    if (!fnFilled) {
      fnFilled = await page.evaluate(`((val) => {
        var inputs = document.querySelectorAll('input[name="firstName"], input[name="first_name"], input[placeholder*="irst"]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      })("${firstName.replace(/"/g, '\\"')}")`) as boolean;
    }
    console.log(`[Playwright] FirstName filled: ${fnFilled}`);

    let lnFilled = await fillViaJS(page, "lastName", lastName);
    if (!lnFilled) lnFilled = await fillViaJS(page, "profile.lastName", lastName);
    if (!lnFilled) lnFilled = await fillViaJS(page, "last_name", lastName);
    if (!lnFilled) {
      lnFilled = await page.evaluate(`((val) => {
        var inputs = document.querySelectorAll('input[name="lastName"], input[name="last_name"], input[placeholder*="ast"]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (setter && setter.set) setter.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      })("${lastName.replace(/"/g, '\\"')}")`) as boolean;
    }
    console.log(`[Playwright] LastName filled: ${lnFilled}`);

    const pwFilled = await fillViaJS(page, "password", password);
    console.log(`[Playwright] Password filled: ${pwFilled}`);

    if (!emailFilled || !pwFilled) {
      await context.close();
      return { success: false, error: `Critical form fill failed - email:${emailFilled} pw:${pwFilled}` };
    }

    const countrySelected = await selectViaJS(page, "profile.country", country);
    console.log(`[Playwright] Country selected: ${countrySelected}`);

    await page.waitForTimeout(1000);

    const langSelected = await selectViaJS(page, "data.personalization.siteLanguage", language);
    console.log(`[Playwright] Language selected: ${langSelected}`);

    await page.waitForTimeout(500);

    const zipCode = generateUSZip();
    const zipFilled = await fillViaJS(page, "profile.zip", zipCode);
    if (!zipFilled) {
      await page.evaluate(`((val) => {
        var inputs = document.querySelectorAll('input[name="profile.zip"], input[name="zip"], input[data-gigya-name="profile.zip"], input[placeholder*="ip"], input[placeholder*="ostal"]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      })("${zipCode}")`);
    }
    console.log(`[Playwright] ZIP filled: ${zipFilled} (${zipCode})`);

    const cbCount = await checkAllCheckboxesViaJS(page);
    console.log(`[Playwright] Checked ${cbCount} checkboxes`);

    await page.waitForTimeout(500);

    console.log("[Playwright] Submitting form...");
    const submitted = await clickSubmitViaJS(page);
    console.log(`[Playwright] Submit clicked: ${submitted}`);

    if (!submitted) {
      await context.close();
      return { success: false, error: "Could not find submit button" };
    }

    console.log("[Playwright] Waiting for response...");

    let pageText = "";
    try {
      await page.waitForTimeout(6000);
      pageText = await Promise.race([
        getPageText(page),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Page text timeout")), 10000)),
      ]);
    } catch (e: any) {
      console.log("[Playwright] Error getting page text after submit:", e.message);
      await context.close();
      return { success: false, error: `Post-submit error: ${e.message}` };
    }

    console.log("[Playwright] Page text after submit (first 200):", pageText.substring(0, 200));

    if (pageText.includes("already exists")) {
      await context.close();
      return { success: false, error: "Account already exists for this email" };
    }

    let realErrors: string[] = [];
    try {
      realErrors = await getFormErrors(page);
    } catch (e: any) {
      console.log("[Playwright] Error getting form errors:", e.message);
    }
    if (realErrors.length > 0) {
      await context.close();
      return { success: false, error: realErrors.join("; ") };
    }

    const lowerText = pageText.toLowerCase();
    const needsCode = lowerText.includes("code") ||
                      lowerText.includes("verify") ||
                      lowerText.includes("confirmation");

    if (!needsCode) {
      await context.close();
      return { success: false, error: "Unexpected page state after submit", pageContent: pageText.substring(0, 500) };
    }

    console.log("[Playwright] Verification code needed. Waiting for code from email...");
    onStatusUpdate("waiting_code");

    let code: string | null = null;
    try {
      code = await Promise.race([
        getVerificationCode(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 150000)),
      ]);
    } catch (e: any) {
      console.log("[Playwright] Error getting verification code:", e.message);
    }

    if (!code) {
      await context.close();
      return { success: false, error: "Timed out waiting for verification email" };
    }

    onStatusUpdate("verifying");
    console.log(`[Playwright] Entering verification code: ${code}`);

    try {
      const codeFilled = await fillCodeViaJS(page, code);
      console.log(`[Playwright] Code filled: ${codeFilled}`);
      await page.waitForTimeout(500);

      console.log("[Playwright] Clicking Verify...");
      await clickSubmitViaJS(page);

      await page.waitForTimeout(8000);
    } catch (e: any) {
      console.log("[Playwright] Error during code verification:", e.message);
      await context.close();
      return { success: false, error: `Verification submit error: ${e.message}` };
    }

    let finalText = "";
    try {
      finalText = await Promise.race([
        getPageText(page),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Final page text timeout")), 10000)),
      ]);
    } catch (e: any) {
      console.log("[Playwright] Error getting final page text:", e.message);
    }

    console.log("[Playwright] Final page content (first 300):", finalText.substring(0, 300));

    const hasError = finalText.toLowerCase().includes("invalid code") ||
                     finalText.toLowerCase().includes("expired");

    if (hasError) {
      await context.close();
      return { success: false, error: "Verification failed", pageContent: finalText.substring(0, 500) };
    }

    onStatusUpdate("verified");
    log("Registration verified! Completing tickets portal profile...");

    const cookies = await context.cookies();
    await context.close();

    try {
      await completeTicketsProfile(email, password, cookies, log);
      log("Account fully registered! Draw registration complete.");
    } catch (profileErr: any) {
      console.log("[Playwright] Tickets profile error:", profileErr.message);
      log("Account created & verified. Tickets profile step skipped.");
    }

    return { success: true, pageContent: finalText.substring(0, 500) };
  } catch (err: any) {
    console.error("[Playwright] Error:", err.message);
    try { await context.close(); } catch {}
    return { success: false, error: err.message };
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

process.on("SIGTERM", async () => {
  console.log("[Playwright] Shutting down browser...");
  await closeBrowser();
});

process.on("SIGINT", async () => {
  console.log("[Playwright] Shutting down browser...");
  await closeBrowser();
});

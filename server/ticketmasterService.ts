import { chromium, type Browser, type Page } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

let browserInstance: Browser | null = null;
let launching = false;

async function getTMBrowser(): Promise<Browser> {
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
        "--disable-blink-features=AutomationControlled",
        "--js-flags=--max-old-space-size=256",
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
    var divs = document.querySelectorAll('div');
    for (var k = 0; k < divs.length; k++) {
      var style = window.getComputedStyle(divs[k]);
      if (style.position === 'fixed' && style.zIndex && parseInt(style.zIndex) > 999 && divs[k].offsetHeight > 100) {
        divs[k].remove();
      }
    }
  })()`);
}

async function getPageText(page: Page): Promise<string> {
  try {
    return await page.evaluate(`(document.body ? document.body.innerText : '')`) as string;
  } catch {
    return '';
  }
}

async function fillInput(page: Page, selectors: string[], value: string, useType = false): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(200);
        if (useType) {
          await el.pressSequentially(value, { delay: 30 + Math.random() * 50 });
        } else {
          try {
            await el.fill(value, { timeout: 3000 });
          } catch {
            await el.pressSequentially(value, { delay: 30 + Math.random() * 50 });
          }
        }
        return true;
      }
    } catch {}
  }
  return false;
}

async function clickButton(page: Page, textMatch?: string): Promise<boolean> {
  if (textMatch) {
    return page.evaluate(`((text) => {
      var buttons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var el = buttons[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          var content = (el.textContent || el.value || '').toLowerCase();
          if (content.includes(text.toLowerCase())) {
            el.click();
            return true;
          }
        }
      }
      return false;
    })("${textMatch.replace(/"/g, '\\"')}")`) as Promise<boolean>;
  }
  return page.evaluate(`(() => {
    var all = document.querySelectorAll('input[type="submit"], button[type="submit"]');
    var visible = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visible = el;
      }
    }
    if (visible) { visible.click(); return true; }
    return false;
  })()`) as Promise<boolean>;
}

export async function tmFullRegistrationFlow(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>,
  proxyUrl?: string
): Promise<{ success: boolean; error?: string; pageContent?: string }> {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[TM-Playwright] Retry attempt ${attempt + 1}/${maxRetries}...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    }

    const result = await doTMRegistration(email, firstName, lastName, password, onStatusUpdate, getVerificationCode, proxyUrl);

    if (result.error?.includes("browser has been closed") || result.error?.includes("crashed")) {
      console.log(`[TM-Playwright] Browser crashed, will retry...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      continue;
    }

    if (result.error?.includes("bot detection") || result.error?.includes("blocked") || result.error?.includes("Access blocked") || result.error?.includes("server error") || result.error?.includes("form did not load") || result.error?.includes("cooldown") || result.error?.includes("no_peers")) {
      console.log(`[TM-Playwright] Retryable error on attempt ${attempt + 1}: ${result.error?.substring(0, 80)}`);
      continue;
    }

    return result;
  }

  return { success: false, error: "Failed after multiple retries (bot detection or crashes)" };
}

async function doTMRegistration(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>,
  proxyUrl?: string
): Promise<{ success: boolean; error?: string; pageContent?: string }> {
  console.log(`[TM-Playwright] proxyUrl received: ${proxyUrl ? proxyUrl.substring(0, 60) + '...' : 'NONE'}`);
  const isBrowserAPI = proxyUrl && proxyUrl.startsWith('wss://');
  console.log(`[TM-Playwright] isBrowserAPI: ${isBrowserAPI}`);
  let remoteBrowser: Browser | null = null;
  let page: Page;
  let context: any;

  try {
    if (isBrowserAPI) {
      console.log("[TM-Playwright] Connecting via Bright Data Browser API...");
      remoteBrowser = await chromium.connectOverCDP(proxyUrl!, { timeout: 60000 });
      const defaultContext = remoteBrowser.contexts()[0];
      if (defaultContext) {
        const pages = defaultContext.pages();
        page = pages.length > 0 ? pages[0] : await defaultContext.newPage();
      } else {
        page = await remoteBrowser.newPage();
      }
      page.setDefaultTimeout(60000);
      console.log("[TM-Playwright] Connected to remote browser.");
    } else {
      let browser: Browser;
      try {
        browser = await getTMBrowser();
      } catch (err: any) {
        return { success: false, error: `Failed to launch browser: ${err.message}` };
      }

      context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 },
        locale: "en-US",
        timezoneId: "America/New_York",
      });

      page = await context.newPage();
      page.setDefaultTimeout(30000);

      await page.addInitScript(`
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
        delete navigator.__proto__.webdriver;
        var origQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = function(parameters) {
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return origQuery.call(this, parameters);
        };
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', description: '', filename: 'internal-nacl-plugin' }
          ]
        });
        var getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine';
          return getParameter.call(this, parameter);
        };
      `);
    }
  } catch (err: any) {
    return { success: false, error: `Failed to connect browser: ${err.message}` };
  }

  try {
    onStatusUpdate("registering");
    console.log("[TM-Playwright] Navigating to Ticketmaster...");

    try {
      await page.route('**/*contentsquare*', (route: any) => route.abort());
      await page.route('**/*cs-sdk*', (route: any) => route.abort());
      console.log("[TM-Playwright] Blocked ContentSquare scripts");
    } catch (e: any) {
      console.log("[TM-Playwright] Could not block ContentSquare:", e.message);
    }

    console.log("[TM-Playwright] Navigating to TM create_account...");
    await page.goto("https://www.ticketmaster.com/member/create_account", { waitUntil: "domcontentloaded", timeout: 120000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {
      console.log("[TM-Playwright] Network idle timeout, continuing...");
    }

    await page.waitForTimeout(5000);
    console.log("[TM-Playwright] After navigation URL:", page.url().substring(0, 200));

    let pageText = await getPageText(page);
    let pageLower = pageText.toLowerCase();
    console.log("[TM-Playwright] Initial page text:", pageText.substring(0, 300));
    console.log("[TM-Playwright] Current URL:", page.url());

    const challengePatterns = ["almost there", "don't refresh", "one moment", "please wait", "checking your browser", "verifying"];
    const errorPatterns = ["unexpected error", "we're sorry"];
    const blockPatterns = ["browsing activity", "has been paused", "unusual behavior", "access denied"];

    const isChallenge = (text: string) => challengePatterns.some(p => text.includes(p));
    const isError = (text: string) => errorPatterns.some(p => text.includes(p));
    const isBlocked = (text: string) => blockPatterns.some(p => text.includes(p));

    if (isChallenge(pageLower)) {
      console.log("[TM-Playwright] Captcha/challenge detected. Waiting for Browser API captcha solver (up to 120s)...");
      for (let cw = 0; cw < 40; cw++) {
        await page.waitForTimeout(3000);
        try {
          pageText = await getPageText(page);
          pageLower = pageText.toLowerCase();
          const currentUrl = page.url();
          if (cw % 5 === 0) {
            console.log(`[TM-Playwright] Challenge wait [${cw * 3}s]: ${pageText.substring(0, 150).replace(/\n/g, ' ')}`);
            console.log(`[TM-Playwright] URL: ${currentUrl.substring(0, 120)}`);
          }
          if (!isChallenge(pageLower)) {
            console.log("[TM-Playwright] Challenge resolved!");
            break;
          }
        } catch {
          console.log("[TM-Playwright] Page navigating during challenge solve...");
        }
      }
    }

    const signupUrl = "https://www.ticketmaster.com/member/create_account";
    if (isError(pageLower)) {
      console.log("[TM-Playwright] TM server error, reloading...");
      for (let reload = 0; reload < 3; reload++) {
        await page.waitForTimeout(3000 + Math.random() * 2000);
        await page.goto(signupUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
        try { await page.waitForLoadState("networkidle", { timeout: 30000 }); } catch {}
        await page.waitForTimeout(5000);
        pageText = await getPageText(page);
        pageLower = pageText.toLowerCase();
        console.log(`[TM-Playwright] Reload ${reload + 1}:`, pageText.substring(0, 200).replace(/\n/g, ' '));
        if (isChallenge(pageLower)) {
          console.log("[TM-Playwright] Challenge on reload, waiting for solver...");
          for (let cw = 0; cw < 40; cw++) {
            await page.waitForTimeout(3000);
            try {
              pageText = await getPageText(page);
              pageLower = pageText.toLowerCase();
              if (cw % 5 === 0) console.log(`[TM-Playwright] Reload challenge [${cw * 3}s]: ${pageText.substring(0, 100).replace(/\n/g, ' ')}`);
              if (!isChallenge(pageLower)) { console.log("[TM-Playwright] Challenge resolved!"); break; }
            } catch {}
          }
        }
        if (!isError(pageLower) && !isChallenge(pageLower)) break;
      }
      if (isError(pageLower)) {
        return { success: false, error: "TM server error - unexpected error page persists", pageContent: pageText.substring(0, 500) };
      }
    }

    if (isBlocked(pageLower)) {
      return {
        success: false,
        error: "Ticketmaster bot detection triggered. The Browser API proxy may need a different zone or retry.",
        pageContent: pageText.substring(0, 500),
      };
    }

    await removeOverlays(page);

    console.log("[TM-Playwright] Waiting for sign-up form...");
    let formFound = false;
    let formPage: Page = page;
    for (let w = 0; w < 40; w++) {
      let hasForm = await page.evaluate(`(() => {
        var inputs = document.querySelectorAll('input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="mail"]');
        return inputs.length > 0;
      })()`);
      if (hasForm) { formFound = true; formPage = page; break; }

      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        try {
          const frameHasForm = await frame.evaluate(`(() => {
            var inputs = document.querySelectorAll('input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="mail"]');
            return inputs.length > 0;
          })()`);
          if (frameHasForm) {
            console.log("[TM-Playwright] Form found in iframe:", frame.url().substring(0, 80));
            hasForm = true;
            break;
          }
        } catch {}
      }
      if (hasForm) { formFound = true; break; }

      await page.waitForTimeout(3000);
      await removeOverlays(page);
      pageText = await getPageText(page);
      pageLower = pageText.toLowerCase();
      if (isChallenge(pageLower)) {
        if (w % 5 === 0) console.log(`[TM-Playwright] Still in challenge [${w * 3}s], captcha solver working...`);
        continue;
      }
      if (isBlocked(pageLower)) {
        return { success: false, error: "Ticketmaster bot detection triggered during form wait.", pageContent: pageText.substring(0, 500) };
      }
      if (w % 3 === 2) {
        const htmlSnippet = await page.evaluate(`document.documentElement.outerHTML.substring(0, 500)`);
        const iframeCount = await page.evaluate(`document.querySelectorAll('iframe').length`);
        console.log("[TM-Playwright] Form wait:", pageText.substring(0, 200).replace(/\n/g, ' '));
        console.log(`[TM-Playwright] Iframes: ${iframeCount}, HTML: ${(htmlSnippet as string).substring(0, 300).replace(/\n/g, ' ')}`);
      }
    }

    if (!formFound) {
      const snapshot = (await getPageText(page)).substring(0, 500);
      const htmlSnippet = await page.evaluate(`document.documentElement.outerHTML.substring(0, 1000)`);
      console.log("[TM-Playwright] Final page HTML:", (htmlSnippet as string).substring(0, 500));
      return { success: false, error: "Sign-up form did not load after extended wait", pageContent: snapshot };
    }

    await removeOverlays(page);
    await page.waitForTimeout(1000);

    const allFields = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input, select');
      var result = [];
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          result.push({
            tag: el.tagName,
            type: el.type || '',
            name: el.name || '',
            id: el.id || '',
            placeholder: el.placeholder || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            dataTestId: el.getAttribute('data-testid') || ''
          });
        }
      }
      return result;
    })()`);
    console.log("[TM-Playwright] Visible form fields:", JSON.stringify(allFields));

    console.log("[TM-Playwright] Step 1: Filling email...");

    const emailFilled = await fillInput(page, [
      'input[type="email"]', 'input[name="email"]', 'input[id*="email"]',
      'input[placeholder*="mail"]', 'input[data-testid*="email"]',
      'input[autocomplete="email"]',
    ], email);
    console.log(`[TM-Playwright] Email filled: ${emailFilled}`);

    if (!emailFilled) {
      return { success: false, error: "Could not fill email field" };
    }

    await page.waitForTimeout(1000);

    console.log("[TM-Playwright] Clicking Continue...");
    let continueClicked = await clickButton(page, "continue");
    if (!continueClicked) continueClicked = await clickButton(page, "next");
    if (!continueClicked) continueClicked = await clickButton(page, "submit");
    if (!continueClicked) {
      continueClicked = await page.evaluate(`(() => {
        var btns = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
        for (var i = 0; i < btns.length; i++) {
          var el = btns[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            el.click();
            return true;
          }
        }
        return false;
      })()`) as boolean;
    }
    console.log(`[TM-Playwright] Continue clicked: ${continueClicked}`);

    console.log("[TM-Playwright] Step 2: Waiting for registration form...");
    await page.waitForTimeout(5000);

    let step2Text = await getPageText(page);
    console.log("[TM-Playwright] After Continue (first 500):", step2Text.substring(0, 500));
    console.log("[TM-Playwright] URL after Continue:", page.url().substring(0, 200));

    const step2Fields = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input, select');
      var result = [];
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          result.push({
            tag: el.tagName,
            type: el.type || '',
            name: el.name || '',
            id: el.id || '',
            placeholder: el.placeholder || '',
            ariaLabel: el.getAttribute('aria-label') || '',
          });
        }
      }
      return result;
    })()`);
    console.log("[TM-Playwright] Step 2 fields:", JSON.stringify(step2Fields));

    let pwVisible = false;
    for (let wait = 0; wait < 20; wait++) {
      pwVisible = await page.evaluate(`(() => {
        var pw = document.querySelector('input[type="password"]');
        if (pw) { var r = pw.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
        return false;
      })()`) as boolean;
      if (pwVisible) break;

      const hasChallenge = isChallenge((await getPageText(page)).toLowerCase());
      if (hasChallenge) {
        if (wait % 5 === 0) console.log(`[TM-Playwright] Challenge during step 2 [${wait * 3}s]...`);
      }
      await page.waitForTimeout(3000);
      if (wait % 5 === 0 && wait > 0) {
        const curText = await getPageText(page);
        console.log(`[TM-Playwright] Step 2 wait [${wait * 3}s]:`, curText.substring(0, 200).replace(/\n/g, ' '));
      }
    }

    if (!pwVisible) {
      step2Text = await getPageText(page);
      console.log("[TM-Playwright] No password field found. Page:", step2Text.substring(0, 500));
      const step2Lower = step2Text.toLowerCase();
      if (step2Lower.includes("already") || step2Lower.includes("sign in")) {
        return { success: false, error: "Email may already have an account (TM shows sign-in instead of sign-up)" };
      }
      return { success: false, error: "Registration form did not load after email step", pageContent: step2Text.substring(0, 500) };
    }

    console.log("[TM-Playwright] Password field visible, filling registration form...");

    const fnFilled = await fillInput(page, [
      'input[name="firstName"]', 'input[name="first_name"]', 'input[id*="first"]',
      'input[placeholder*="irst"]', 'input[data-testid*="first"]',
      'input[autocomplete="given-name"]',
    ], firstName);
    console.log(`[TM-Playwright] FirstName filled: ${fnFilled}`);

    const lnFilled = await fillInput(page, [
      'input[name="lastName"]', 'input[name="last_name"]', 'input[id*="last"]',
      'input[placeholder*="ast"]', 'input[data-testid*="last"]',
      'input[autocomplete="family-name"]',
    ], lastName);
    console.log(`[TM-Playwright] LastName filled: ${lnFilled}`);

    let pwFilled = false;
    const escapedPw = password.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`');
    try {
      pwFilled = await page.evaluate(`((pwd) => {
        var el = document.querySelector('#password-input') || document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
        if (!el) return false;
        try {
          var iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          document.body.appendChild(iframe);
          var cleanSetter = Object.getOwnPropertyDescriptor(iframe.contentWindow.HTMLInputElement.prototype, 'value').set;
          document.body.removeChild(iframe);
          cleanSetter.call(el, pwd);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return el.value.length > 0;
        } catch (e1) {
          try {
            el.setAttribute('type', 'text');
            el.value = pwd;
            el.setAttribute('type', 'password');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return el.value.length > 0;
          } catch (e2) {
            return false;
          }
        }
      })("${escapedPw}")`) as boolean;
    } catch (e: any) {
      console.log(`[TM-Playwright] Password fill failed: ${e.message}`);
    }
    console.log(`[TM-Playwright] Password filled: ${pwFilled}`);

    if (!pwFilled) {
      return { success: false, error: "Could not fill password field" };
    }

    const usZips = ["90001","90012","90024","90034","90045","90056","90067","90210","90291","90301","90401","91001","91101","91201","91301","91401","91501","91601","91701","91801","92101","92201"];
    const randomZip = usZips[Math.floor(Math.random() * usZips.length)];
    const zipFilled = await fillInput(page, [
      'input[name="postalCode"]', 'input[id*="postalCode"]', 'input[id*="postal"]',
      'input[id*="zip"]', 'input[name="zipCode"]', 'input[placeholder*="zip" i]',
      'input[placeholder*="postal" i]',
    ], randomZip);
    console.log(`[TM-Playwright] PostalCode filled: ${zipFilled} (${randomZip})`);

    const cbChecked = await page.evaluate(`(() => {
      var checked = 0;
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < checkboxes.length; i++) {
        var el = checkboxes[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && !el.checked) {
          el.click();
          checked++;
        }
      }
      return checked;
    })()`);
    console.log(`[TM-Playwright] Checked ${cbChecked} checkboxes`);

    await page.waitForTimeout(1000);

    console.log("[TM-Playwright] Submitting registration...");
    let submitted = await clickButton(page, "create account");
    if (!submitted) submitted = await clickButton(page, "sign up");
    if (!submitted) submitted = await clickButton(page, "register");
    if (!submitted) submitted = await clickButton(page, "continue");
    if (!submitted) submitted = await clickButton(page);
    console.log(`[TM-Playwright] Submit clicked: ${submitted}`);

    if (!submitted) {
      return { success: false, error: "Could not find submit button" };
    }

    console.log("[TM-Playwright] Waiting for response...");
    await page.waitForTimeout(10000);

    pageText = await getPageText(page);
    console.log("[TM-Playwright] After submit (first 500):", pageText.substring(0, 500));
    console.log("[TM-Playwright] URL after submit:", page.url().substring(0, 200));

    if (pageText.toLowerCase().includes("already") && pageText.toLowerCase().includes("exist")) {
      return { success: false, error: "Account already exists for this email" };
    }

    const needsCode = pageText.toLowerCase().includes("code") ||
                      pageText.toLowerCase().includes("verify") ||
                      pageText.toLowerCase().includes("confirmation") ||
                      pageText.toLowerCase().includes("check your email");

    if (needsCode) {
      console.log("[TM-Playwright] Verification page detected, clicking 'Verify My Email'...");

      let verifyEmailClicked = await clickButton(page, "verify my email");
      if (!verifyEmailClicked) verifyEmailClicked = await clickButton(page, "verify email");
      if (!verifyEmailClicked) verifyEmailClicked = await clickButton(page, "send code");
      if (!verifyEmailClicked) verifyEmailClicked = await clickButton(page, "verify");
      console.log(`[TM-Playwright] Verify My Email clicked: ${verifyEmailClicked}`);

      await page.waitForTimeout(5000);
      pageText = await getPageText(page);
      console.log("[TM-Playwright] After verify email click (first 300):", pageText.substring(0, 300));

      onStatusUpdate("waiting_code");

      let code: string | null = null;
      try {
        code = await Promise.race([
          getVerificationCode(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 150000)),
        ]);
      } catch (e: any) {
        console.log("[TM-Playwright] Error getting verification code:", e.message);
      }

      if (!code) {
        return { success: false, error: "Timed out waiting for verification email" };
      }

      onStatusUpdate("verifying");
      console.log(`[TM-Playwright] Entering verification code: ${code}`);

      const codeFilled = await fillInput(page, [
        'input[name="code"]', 'input[id*="code"]', 'input[placeholder*="code"]',
        'input[data-testid*="code"]', 'input[type="text"]', 'input[inputmode="numeric"]',
      ], code);
      console.log(`[TM-Playwright] Code filled: ${codeFilled}`);

      await page.waitForTimeout(500);

      let verifyClicked = await clickButton(page, "verify");
      if (!verifyClicked) verifyClicked = await clickButton(page, "confirm");
      if (!verifyClicked) verifyClicked = await clickButton(page, "submit");
      if (!verifyClicked) verifyClicked = await clickButton(page, "continue");
      if (!verifyClicked) verifyClicked = await clickButton(page);
      console.log(`[TM-Playwright] Verify code clicked: ${verifyClicked}`);

      await page.waitForTimeout(8000);

      pageText = await getPageText(page);
      console.log("[TM-Playwright] After verification (first 500):", pageText.substring(0, 500));
    }

    const currentUrl = page.url();
    const finalText = await getPageText(page);
    const finalLower = finalText.toLowerCase();

    console.log("[TM-Playwright] Final URL:", currentUrl);
    console.log("[TM-Playwright] Final text (first 300):", finalText.substring(0, 300));

    const isSuccess = currentUrl.includes("ticketmaster.com") &&
                      !currentUrl.includes("authorization.oauth2") ||
                      finalLower.includes("account created") ||
                      finalLower.includes("success") ||
                      finalLower.includes("my account") ||
                      finalLower.includes("you're in") ||
                      finalLower.includes("profile") ||
                      finalLower.includes("almost there") ||
                      finalLower.includes("verify your account") ||
                      finalLower.includes("verified");

    if (isSuccess) {
      return { success: true, pageContent: finalText.substring(0, 500) };
    }

    if (finalLower.includes("error") || finalLower.includes("failed") || finalLower.includes("invalid")) {
      return { success: false, error: "Registration failed: " + finalText.substring(0, 200), pageContent: finalText.substring(0, 500) };
    }

    return { success: true, pageContent: finalText.substring(0, 500) };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    try {
      if (remoteBrowser) {
        await remoteBrowser.close();
      } else if (context) {
        await context.close();
      }
    } catch {}
  }
}

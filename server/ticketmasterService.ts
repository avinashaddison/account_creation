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
  return page.evaluate(`document.body.innerText`) as Promise<string>;
}

async function fillInput(page: Page, selectors: string[], value: string): Promise<boolean> {
  const selectorList = selectors.map(s => `'${s}'`).join(",");
  return page.evaluate(`((selectorsArr, val) => {
    var selectors = [${selectorList}];
    for (var s = 0; s < selectors.length; s++) {
      var inputs = document.querySelectorAll(selectors[s]);
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (el.type === 'hidden') continue;
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('focus', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  })(null, "${value.replace(/"/g, '\\"')}")`) as Promise<boolean>;
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
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[TM-Playwright] Retry attempt ${attempt + 1}/${maxRetries}...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      await new Promise(r => setTimeout(r, 2000));
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

    return result;
  }

  return { success: false, error: "Browser crashed after multiple retries" };
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
  const isBrowserAPI = proxyUrl && proxyUrl.startsWith('wss://');
  let remoteBrowser: Browser | null = null;
  let page: Page;
  let context: any;

  try {
    if (isBrowserAPI) {
      console.log("[TM-Playwright] Connecting via Bright Data Browser API...");
      remoteBrowser = await chromium.connectOverCDP(proxyUrl!, { timeout: 60000 });
      page = await remoteBrowser.newPage();
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
    console.log("[TM-Playwright] Navigating to Ticketmaster sign-up...");

    const signupUrl = "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf2fc29c040a10a21be&response_type=code&scope=openid+profile+phone+email&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=en-us&placeholderType=tm&hideLeftPanel=false&integratorId=prd1741.iccp&intSiteToken=tm-us&TMUO=%23signupDesktop";
    await page.goto(signupUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: 30000 });
    } catch {
      console.log("[TM-Playwright] Network idle timeout, continuing...");
    }

    await page.waitForTimeout(8000);
    await removeOverlays(page);

    let pageText = await getPageText(page);
    let pageLower = pageText.toLowerCase();
    console.log("[TM-Playwright] Page text (first 500):", pageText.substring(0, 500));
    console.log("[TM-Playwright] Current URL:", page.url());

    if (pageLower.includes("one moment") || pageLower.includes("please wait") || pageLower.includes("loading")) {
      console.log("[TM-Playwright] JS challenge detected, waiting longer...");
      await page.waitForTimeout(15000);
      pageText = await getPageText(page);
      pageLower = pageText.toLowerCase();
      console.log("[TM-Playwright] Page text after wait (first 500):", pageText.substring(0, 500));
    }

    if (pageLower.includes("browsing activity") || pageLower.includes("has been paused") || pageLower.includes("unusual behavior")) {
      return {
        success: false,
        error: "Ticketmaster bot detection triggered. The Browser API proxy may need a different zone or retry.",
        pageContent: pageText.substring(0, 500),
      };
    }

    if (pageLower.includes("access denied") || (pageLower.includes("blocked") && !pageLower.includes("sign"))) {
      return {
        success: false,
        error: "Access blocked by Ticketmaster. Try again or use a different proxy zone.",
        pageContent: pageText.substring(0, 500),
      };
    }

    console.log("[TM-Playwright] Waiting for sign-up form...");
    let formFound = false;
    for (let w = 0; w < 25; w++) {
      const hasForm = await page.evaluate(`(() => {
        var inputs = document.querySelectorAll('input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="mail"]');
        return inputs.length > 0;
      })()`);
      if (hasForm) { formFound = true; break; }
      await page.waitForTimeout(3000);
      await removeOverlays(page);
      if (w % 5 === 4) {
        var snapshot = await getPageText(page);
        console.log("[TM-Playwright] Still waiting, page text:", snapshot.substring(0, 200));
      }
    }

    if (!formFound) {
      const snapshot = (await getPageText(page)).substring(0, 500);
      return { success: false, error: "Sign-up form did not load", pageContent: snapshot };
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

    console.log("[TM-Playwright] Filling form fields...");

    const emailFilled = await fillInput(page, [
      'input[type="email"]', 'input[name="email"]', 'input[id*="email"]',
      'input[placeholder*="mail"]', 'input[data-testid*="email"]',
      'input[autocomplete="email"]',
    ], email);
    console.log(`[TM-Playwright] Email filled: ${emailFilled}`);

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

    const pwFilled = await fillInput(page, [
      'input[type="password"]', 'input[name="password"]', 'input[id*="password"]',
      'input[data-testid*="password"]', 'input[autocomplete="new-password"]',
    ], password);
    console.log(`[TM-Playwright] Password filled: ${pwFilled}`);

    if (!emailFilled || !pwFilled) {
      return { success: false, error: `Critical fields not found - email:${emailFilled} pw:${pwFilled}` };
    }

    const cbChecked = await page.evaluate(`(() => {
      var checked = 0;
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < checkboxes.length; i++) {
        var el = checkboxes[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && !el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('click', { bubbles: true }));
          checked++;
        }
      }
      return checked;
    })()`);
    console.log(`[TM-Playwright] Checked ${cbChecked} checkboxes`);

    await page.waitForTimeout(500);

    console.log("[TM-Playwright] Submitting form...");
    let submitted = await clickButton(page, "sign up");
    if (!submitted) submitted = await clickButton(page, "create account");
    if (!submitted) submitted = await clickButton(page, "register");
    if (!submitted) submitted = await clickButton(page);
    console.log(`[TM-Playwright] Submit clicked: ${submitted}`);

    if (!submitted) {
      return { success: false, error: "Could not find submit button" };
    }

    console.log("[TM-Playwright] Waiting for response...");
    await page.waitForTimeout(8000);

    pageText = await getPageText(page);
    console.log("[TM-Playwright] After submit (first 500):", pageText.substring(0, 500));

    if (pageText.toLowerCase().includes("already") && pageText.toLowerCase().includes("exist")) {
      return { success: false, error: "Account already exists for this email" };
    }

    const needsCode = pageText.toLowerCase().includes("code") ||
                      pageText.toLowerCase().includes("verify") ||
                      pageText.toLowerCase().includes("confirmation") ||
                      pageText.toLowerCase().includes("check your email");

    if (needsCode) {
      console.log("[TM-Playwright] Verification code needed...");
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
      if (!verifyClicked) verifyClicked = await clickButton(page, "continue");
      if (!verifyClicked) verifyClicked = await clickButton(page);
      console.log(`[TM-Playwright] Verify clicked: ${verifyClicked}`);

      await page.waitForTimeout(8000);

      pageText = await getPageText(page);
      console.log("[TM-Playwright] After verification (first 500):", pageText.substring(0, 500));
    }

    const currentUrl = page.url();
    const finalText = await getPageText(page);
    const finalLower = finalText.toLowerCase();

    console.log("[TM-Playwright] Final URL:", currentUrl);
    console.log("[TM-Playwright] Final text (first 300):", finalText.substring(0, 300));

    const isSuccess = currentUrl.includes("ticketmaster.com") ||
                      finalLower.includes("welcome") ||
                      finalLower.includes("account created") ||
                      finalLower.includes("success") ||
                      finalLower.includes("my account") ||
                      finalLower.includes("you're in") ||
                      finalLower.includes("profile");

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

import { chromium, type Browser, type Page } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { orderSMSNumber, pollForSMSCode, cancelSMSOrder } from "./smspoolService";
import { orderFivesimNumber, pollFivesimSMS, cancelFivesimOrder, isFivesimConfigured } from "./fivesimService";
import { solveRecaptchaV2, solveHCaptcha, injectRecaptchaToken } from "./capsolverService";
import { doShakiraPresaleStep } from "./shakiraService";

chromium.use(StealthPlugin());

function tmIsChallenge(text: string): boolean {
  if (text.includes("don't refresh") || text.includes("one moment") || text.includes("please wait") || text.includes("checking your browser")) return true;
  if (text.includes("almost there") && !text.includes("verify your account") && !text.includes("verify my email") && !text.includes("one more step")) return true;
  return false;
}

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
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--no-first-run",
        "--no-zygote",
        "--disable-blink-features=AutomationControlled",
        "--js-flags=--max-old-space-size=256",
        "--window-size=1366,768",
        "--lang=en-US,en",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-features=IsolateOrigins",
        "--disable-ipc-flooding-protection",
        `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
        "--accept-language=en-US,en;q=0.9",
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
        await page.waitForTimeout(300);
        if (useType) {
          await el.pressSequentially(value, { delay: 30 + Math.random() * 50 });
        } else {
          try {
            await el.fill(value, { timeout: 3000 });
          } catch {
            await el.pressSequentially(value, { delay: 30 + Math.random() * 50 });
          }
        }
        await page.waitForTimeout(200);
        const currentVal = await el.inputValue().catch(() => '');
        if (currentVal && currentVal.length > 0) return true;
        console.log(`[TM-Playwright] fillInput: ${selector} fill attempt returned empty, trying native setter + React trigger...`);
        const nativeResult = await page.evaluate(`((sel, val) => {
          var el = document.querySelector(sel);
          if (!el) return false;
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (nativeSet && nativeSet.set) nativeSet.set.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          var reactPropsKey = Object.keys(el).find(function(k) { return k.startsWith('__reactProps') || k.startsWith('__reactEvents'); });
          if (reactPropsKey && el[reactPropsKey] && typeof el[reactPropsKey].onChange === 'function') {
            el[reactPropsKey].onChange({ target: el, currentTarget: el, type: 'change' });
          }
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return el.value.length > 0;
        })` + `(${JSON.stringify(selector)}, ${JSON.stringify(value)})`) as boolean;
        if (nativeResult) return true;
        console.log(`[TM-Playwright] fillInput: native setter also failed for ${selector}`);
        continue;
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
  onLog?: (message: string) => void,
  proxyUrl?: string,
  keepBrowserOpen?: boolean,
  shakiraPresale?: boolean,
  presaleProxyUrl?: string
): Promise<{ success: boolean; error?: string; pageContent?: string; smsCost?: number; browser?: any; page?: any }> {
  const log = onLog || ((msg: string) => console.log(`[TM] ${msg}`));
  const maxRetries = 4;
  let totalSmsCost = 0;
  const MAX_SMS_SPEND = 0.72;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      if (totalSmsCost >= MAX_SMS_SPEND) {
        log(`⚠️ SMS spend cap reached ($${totalSmsCost.toFixed(2)}), stopping retries`);
        console.log(`[TM-Playwright] SMS spend cap reached ($${totalSmsCost.toFixed(2)} / $${MAX_SMS_SPEND}), stopping retries`);
        break;
      }
      log(`🔄 Retry attempt ${attempt + 1}/${maxRetries}...`);
      console.log(`[TM-Playwright] Retry attempt ${attempt + 1}/${maxRetries} (SMS spent so far: $${totalSmsCost.toFixed(2)})...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    }

    const result = await doTMRegistration(email, firstName, lastName, password, onStatusUpdate, getVerificationCode, log, proxyUrl, keepBrowserOpen, shakiraPresale, presaleProxyUrl);
    totalSmsCost += result.smsCost || 0;

    const closeBrowserIfKept = () => {
      if (keepBrowserOpen && result.browser) {
        try { result.browser.close(); } catch {}
      }
    };

    if (result.error?.includes("browser has been closed") || result.error?.includes("crashed")) {
      if (result.pageContent?.includes("passkey") || result.pageContent?.includes("Email verified") || result.pageContent?.includes("Phone verified") || result.pageContent?.includes("confirm your account")) {
        console.log("[TM-Playwright] Browser crashed but account appears verified. Treating as success.");
        return { success: true, pageContent: result.pageContent, smsCost: totalSmsCost };
      }
      console.log(`[TM-Playwright] Browser crashed, will retry...`);
      closeBrowserIfKept();
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      continue;
    }

    if (result.error?.includes("bot detection") || result.error?.includes("blocked") || result.error?.includes("Access blocked") || result.error?.includes("server error") || result.error?.includes("form did not load") || result.error?.includes("cooldown") || result.error?.includes("no_peers") || result.error?.includes("Could not fill password") || result.error?.includes("Could not fill first name") || result.error?.includes("Could not fill last name") || result.error?.includes("Password validation failed") || result.error?.includes("Still on sign-up form") || result.error?.includes("Form validation errors") || result.error?.includes("Forbidden action") || result.error?.includes("robots.txt") || result.error?.includes("phone verification incomplete") || result.error?.includes("email verification incomplete") || result.error?.includes("status unclear") || result.error?.includes("Verification page present") || result.error?.includes("Proxy connection failed") || result.error?.includes("proxy_error") || result.error?.includes("Proxy Error")) {
      console.log(`[TM-Playwright] Retryable error on attempt ${attempt + 1}: ${result.error?.substring(0, 120)}`);
      closeBrowserIfKept();
      continue;
    }

    if (!result.success) {
      closeBrowserIfKept();
    }

    return { ...result, smsCost: totalSmsCost };
  }

  return { success: false, error: "Failed after multiple retries (bot detection or crashes)", smsCost: totalSmsCost };
}

async function handlePhoneVerification(
  page: Page,
  onStatusUpdate: (status: string) => void,
  log: (message: string) => void
): Promise<{ success: boolean; error?: string; smsCost: number }> {
  const MAX_PHONE_RETRIES = 3;
  let totalSmsCost = 0;
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_PHONE_RETRIES; attempt++) {
    log(`📱 Phone verification attempt ${attempt}/${MAX_PHONE_RETRIES}`);
    console.log(`[TM-Playwright] Phone verification attempt ${attempt}/${MAX_PHONE_RETRIES}`);
    const result = await attemptPhoneVerification(page, onStatusUpdate, attempt, log);
    totalSmsCost += result.smsCost;

    if (result.success) {
      log(`✅ Phone verified successfully!`);
      return { success: true, smsCost: totalSmsCost };
    }

    lastError = result.error || "Unknown phone verification error";
    log(`⚠️ Phone attempt ${attempt} failed: ${lastError.substring(0, 80)}`);
    console.log(`[TM-Playwright] Phone attempt ${attempt}/${MAX_PHONE_RETRIES} failed: ${lastError}`);

    if (attempt < MAX_PHONE_RETRIES) {
      const isNonRetryable = lastError.includes("Phone input field not found") || lastError.includes("Challenge") || lastError.includes("browser closed");
      if (isNonRetryable) {
        log(`❌ Non-retryable phone error, stopping`);
        console.log("[TM-Playwright] Non-retryable phone error, stopping retries");
        break;
      }

      log(`🔄 Retrying with new phone number...`);
      onStatusUpdate("verifying");
      console.log("[TM-Playwright] Dismissing phone OTP dialog before retry...");
      await dismissPhoneDialog(page);
      await page.waitForTimeout(2000);
    }
  }

  return { success: false, error: `Phone verification failed after ${MAX_PHONE_RETRIES} attempts: ${lastError}`, smsCost: totalSmsCost };
}

async function dismissPhoneDialog(page: Page): Promise<void> {
  try {
    const dismissed = await page.evaluate(`(() => {
      var cancelBtns = document.querySelectorAll('button, a');
      for (var i = 0; i < cancelBtns.length; i++) {
        var text = (cancelBtns[i].textContent || '').toLowerCase().trim();
        var rect = cancelBtns[i].getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (text === 'cancel' || text === 'close' || text === 'back' || text === 'x')) {
          cancelBtns[i].click();
          return 'dismissed:' + text;
        }
      }
      var closeBtn = document.querySelector('[aria-label="close"], [aria-label="Close"], button.close, .modal-close, [data-dismiss]');
      if (closeBtn) { closeBtn.click(); return 'dismissed:aria-close'; }
      return 'no-dismiss';
    })()`);
    console.log("[TM-Playwright] Phone dialog dismiss result:", dismissed);
    await page.waitForTimeout(2000);

    const stillHasOTP = await page.evaluate(`(() => {
      return !!document.querySelector('#otp-input-input, input[maxlength="6"][aria-label*="Code"]');
    })()`);
    if (stillHasOTP) {
      console.log("[TM-Playwright] OTP dialog still present, trying cancel again...");
      await page.evaluate(`(() => {
        var btns = document.querySelectorAll('button, a');
        for (var i = 0; i < btns.length; i++) {
          var text = (btns[i].textContent || '').toLowerCase().trim();
          var rect = btns[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && (text.includes('cancel') || text.includes('resend') || text.includes('change'))) {
            btns[i].click();
            return;
          }
        }
      })()`);
      await page.waitForTimeout(2000);
    }
  } catch (e: any) {
    console.log("[TM-Playwright] Error dismissing phone dialog:", e.message?.substring(0, 100));
  }
}

async function attemptPhoneVerification(
  page: Page,
  onStatusUpdate: (status: string) => void,
  attemptNum: number,
  log: (message: string) => void
): Promise<{ success: boolean; error?: string; smsCost: number }> {
  let smsCost = 0;
  // Provider-agnostic cancel / poll helpers — set below based on which service wins
  let cancelOrder: () => Promise<void> = async () => {};
  let pollCode: () => Promise<string | null> = async () => null;
  let phoneNumber = "";

  try {
    // --- Acquire phone number: try 5sim first, fall back to SMSPool ---
    const fivesimAvailable = await isFivesimConfigured();

    if (fivesimAvailable) {
      log(`📲 Ordering SMS number from 5sim...`);
      const order = await orderFivesimNumber("usa", "ticketmaster", "any");
      if (order.success && order.id && order.phone) {
        const orderId = order.id;
        phoneNumber = order.phone;
        smsCost = order.price ? order.price / 100 : 0.18;
        log(`📱 Got 5sim number: ${phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')} (id: ${orderId})`);
        console.log(`[TM-Playwright] 5sim ordered (attempt ${attemptNum}): id=${orderId} phone=${phoneNumber}`);
        cancelOrder = async () => { await cancelFivesimOrder(orderId); };
        pollCode = async () => { return await pollFivesimSMS(orderId, 60, 3000); };
      } else {
        log(`⚠️ 5sim failed (${order.error}), falling back to SMSPool...`);
        console.log(`[TM-Playwright] 5sim failed: ${order.error} — falling back to SMSPool`);
      }
    }

    // Fall back to SMSPool if 5sim not used
    if (!phoneNumber) {
      log(`📲 Ordering SMS number from SMSPool...`);
      const smsOrder = await orderSMSNumber(1, "Ticketmaster");
      if (!smsOrder.success || !smsOrder.number || !smsOrder.orderId) {
        log(`❌ SMSPool order failed: ${smsOrder.error}`);
        return { success: false, error: `SMS order failed: ${smsOrder.error}`, smsCost: 0 };
      }
      const orderId = smsOrder.orderId;
      smsCost = 0.36;
      phoneNumber = String(smsOrder.number);
      if (!phoneNumber.startsWith("+")) {
        phoneNumber = phoneNumber.startsWith("1") ? `+${phoneNumber}` : `+1${phoneNumber}`;
      }
      log(`📱 Got SMSPool number: ${phoneNumber.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')}`);
      console.log(`[TM-Playwright] SMSPool ordered (attempt ${attemptNum}): $${smsCost} (order: ${orderId})`);
      cancelOrder = async () => { await cancelSMSOrder(orderId); };
      pollCode = async () => { return await pollForSMSCode(orderId, 60, 3000); };
    }

    const phoneClickResult = await page.evaluate(`(() => {
      function findAndClick(text) {
        var all = document.querySelectorAll('button, a, a[role="button"], input[type="submit"], span[role="button"], div[role="button"]');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var content = (el.textContent || el.value || '').toLowerCase().trim();
            if (content.includes(text)) {
              el.click();
              return 'clicked:' + el.tagName + ':' + content.substring(0, 50);
            }
          }
        }
        return null;
      }
      var result = findAndClick('add my phone');
      if (!result) result = findAndClick('verify phone');
      if (!result) result = findAndClick('add phone');
      if (!result) {
        var links = document.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
          var el = links[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var text = (el.textContent || '').toLowerCase().trim();
            if (text.includes('phone')) {
              el.click();
              return 'link-clicked:' + text.substring(0, 50);
            }
          }
        }
      }
      if (!result) {
        var allEls = document.querySelectorAll('*');
        var candidates = [];
        for (var i = 0; i < allEls.length; i++) {
          var el = allEls[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && el.childElementCount === 0) {
            var text = (el.textContent || '').toLowerCase().trim();
            if (text === 'add my phone') {
              candidates.push({ tag: el.tagName, text: text, parent: el.parentElement ? el.parentElement.tagName : 'none' });
              el.click();
              if (el.parentElement) el.parentElement.click();
              return 'leaf-clicked:' + el.tagName + ':' + (el.parentElement ? el.parentElement.tagName : 'none');
            }
          }
        }
      }
      return result || 'not-found';
    })()`);
    console.log(`[TM-Playwright] Phone button click result: ${phoneClickResult}`);
    let addPhoneClicked = phoneClickResult !== 'not-found';

    await page.waitForTimeout(3000);

    const htmlSnapshot = await page.evaluate(`(() => {
      var sections = document.querySelectorAll('section, div[class*="phone"], div[class*="verify"], form');
      var html = [];
      for (var i = 0; i < Math.min(sections.length, 10); i++) {
        html.push(sections[i].outerHTML.substring(0, 500));
      }
      return html;
    })()`);
    console.log("[TM-Playwright] HTML sections after phone click:", JSON.stringify(htmlSnapshot).substring(0, 2000));

    const allInputsDump = await page.evaluate(`(() => {
      var all = document.querySelectorAll('input, select, textarea');
      var result = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var rect = el.getBoundingClientRect();
        result.push({ tag: el.tagName, type: el.type, name: el.name, id: el.id, placeholder: el.placeholder || '', maxLength: el.maxLength, ariaLabel: el.getAttribute('aria-label') || '', visible: rect.width > 0 && rect.height > 0, w: rect.width, h: rect.height });
      }
      return result;
    })()`);
    console.log("[TM-Playwright] ALL inputs after phone click:", JSON.stringify(allInputsDump));

    for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
      await page.waitForTimeout(2000);
      const hasPhoneInput = await page.evaluate(`(() => {
        var selectors = ['input[type="tel"]', 'input[name*="phone"]', 'input[id*="phone"]', 'input[placeholder*="phone" i]', 'input[aria-label*="phone" i]', 'input[name*="mobile"]', 'input[id*="mobile"]'];
        for (var s = 0; s < selectors.length; s++) {
          var els = document.querySelectorAll(selectors[s]);
          for (var i = 0; i < els.length; i++) {
            var rect = els[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return true;
          }
        }
        return false;
      })()`);
      if (hasPhoneInput) {
        console.log(`[TM-Playwright] Phone input appeared after ${(waitAttempt + 1) * 2}s`);
        break;
      }
      let checkText = "";
      try { checkText = await getPageText(page); } catch {}
      if (tmIsChallenge(checkText.toLowerCase())) {
        console.log("[TM-Playwright] Challenge detected while waiting for phone input...");
        continue;
      }
      if (waitAttempt === 9) {
        console.log("[TM-Playwright] Phone input did not appear after 20s");
      }
    }

    let pageText = await getPageText(page);
    console.log("[TM-Playwright] Phone page (first 500):", pageText.substring(0, 500));

    const phoneInputs = await page.evaluate(`(() => {
      var inputs = document.querySelectorAll('input');
      var result = [];
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          result.push({
            tag: el.tagName, type: el.type, name: el.name, id: el.id,
            placeholder: el.placeholder, maxLength: el.maxLength,
            ariaLabel: el.getAttribute('aria-label') || ''
          });
        }
      }
      return result;
    })()`);
    console.log("[TM-Playwright] Phone page inputs:", JSON.stringify(phoneInputs));

    const rawDigits = phoneNumber.replace(/\D/g, '');
    const localNumber = rawDigits.startsWith("1") ? rawDigits.substring(1) : rawDigits;

    const phoneSelectors = [
      'input[type="tel"]',
      'input[name*="phone"]',
      'input[id*="phone"]',
      'input[placeholder*="phone" i]',
      'input[placeholder*="Phone"]',
      'input[aria-label*="phone" i]',
      'input[aria-label*="Phone"]',
      'input[name*="mobile"]',
      'input[id*="mobile"]',
    ];

    let phoneFilled = false;
    for (const sel of phoneSelectors) {
      try {
        const exists = await page.$(sel);
        if (exists) {
          const visible = await exists.isVisible().catch(() => false);
          if (visible) {
            await exists.click();
            await page.waitForTimeout(300);
            await exists.fill(localNumber);
            console.log(`[TM-Playwright] Phone filled via ${sel}: ${localNumber}`);
            phoneFilled = true;
            break;
          }
        }
      } catch {}
    }

    if (!phoneFilled) {
      const filledViaJS = await page.evaluate(`((number) => {
        var selectors = ['input[type="tel"]', 'input[name*="phone"]', 'input[id*="phone"]', 'input[aria-label*="phone" i]'];
        for (var s = 0; s < selectors.length; s++) {
          var els = document.querySelectorAll(selectors[s]);
          for (var i = 0; i < els.length; i++) {
            var rect = els[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              els[i].focus();
              var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
              if (nativeSet && nativeSet.set) nativeSet.set.call(els[i], number);
              else els[i].value = number;
              els[i].dispatchEvent(new Event('input', { bubbles: true }));
              els[i].dispatchEvent(new Event('change', { bubbles: true }));
              var rp = Object.keys(els[i]).find(function(k) { return k.startsWith('__reactProps'); });
              if (rp && els[i][rp] && typeof els[i][rp].onChange === 'function') {
                els[i][rp].onChange({ target: els[i], currentTarget: els[i], type: 'change' });
              }
              els[i].dispatchEvent(new Event('blur', { bubbles: true }));
              return 'filled:' + selectors[s];
            }
          }
        }
        var genericInputs = document.querySelectorAll('input[type="text"]:not([id="otp-input-input"]):not([name="email"]):not([name="firstName"]):not([name="lastName"]):not([name="postalCode"])');
        for (var i = 0; i < genericInputs.length; i++) {
          var rect = genericInputs[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && genericInputs[i].maxLength !== 6) {
            var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet && nativeSet.set) nativeSet.set.call(genericInputs[i], number);
            else genericInputs[i].value = number;
            genericInputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            genericInputs[i].dispatchEvent(new Event('change', { bubbles: true }));
            return 'filled-generic:' + (genericInputs[i].id || genericInputs[i].name || 'unnamed');
          }
        }
        return 'not-found';
      })("${localNumber}")`);
      console.log(`[TM-Playwright] Phone JS fill result: ${filledViaJS}`);
      phoneFilled = filledViaJS !== 'not-found';
    }

    if (!phoneFilled) {
      log(`❌ Could not find phone input field`);
      console.log("[TM-Playwright] Could not find phone input field");
      await cancelOrder();
      return { success: false, error: "Phone input field not found on page", smsCost };
    }

    log(`✏️ Phone number entered, clicking send code...`);
    await page.waitForTimeout(1000);

    let sendCodeClicked = await clickButton(page, "add number");
    if (!sendCodeClicked) sendCodeClicked = await clickButton(page, "send code");
    if (!sendCodeClicked) sendCodeClicked = await clickButton(page, "send verification");
    if (!sendCodeClicked) {
      const dialogBtn = await page.evaluate(`(() => {
        var dialog = document.querySelector('[id*="phoneDialog"], [class*="phone"], [data-bdd*="phone"], form:has(input[type="tel"])');
        if (!dialog) return 'no-dialog-found';
        var btns = dialog.querySelectorAll('button, input[type="submit"], a[role="button"], span[role="button"]');
        for (var i = 0; i < btns.length; i++) {
          var rect = btns[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btns[i].click();
            return 'dialog-btn-clicked:' + (btns[i].innerText || btns[i].textContent || '').trim().substring(0, 60);
          }
        }
        return 'no-dialog-btn';
      })()`);
      console.log("[TM-Playwright] Dialog button fallback:", dialogBtn);
      sendCodeClicked = dialogBtn.startsWith('dialog-btn-clicked');
    }
    console.log(`[TM-Playwright] Send phone code clicked: ${sendCodeClicked}`);

    await page.waitForTimeout(3000);

    const afterSendState = await page.evaluate(`(() => {
      var hasPhoneOTP = !!document.querySelector('#otp-input-input, input[maxlength="6"]');
      var lower = (document.body ? document.body.innerText : '').toLowerCase();
      var hasPhoneDialog = lower.includes('add your phone') || lower.includes('verify your phone');
      return {hasPhoneOTP: hasPhoneOTP, hasPhoneDialog: hasPhoneDialog};
    })()`);
    console.log("[TM-Playwright] After send code - OTP visible:", afterSendState.hasPhoneOTP, "dialog open:", afterSendState.hasPhoneDialog);

    if (!afterSendState.hasPhoneOTP && afterSendState.hasPhoneDialog) {
      console.log("[TM-Playwright] Phone dialog open but no OTP yet, waiting...");
      await page.waitForTimeout(5000);
    } else if (!afterSendState.hasPhoneOTP && !afterSendState.hasPhoneDialog) {
      console.log("[TM-Playwright] Phone dialog closed without OTP, retrying add number flow...");
      const reClickPhone = await clickButton(page, "add my phone");
      if (reClickPhone) {
        await page.waitForTimeout(3000);
        await page.evaluate(`(() => {
          var tel = document.querySelector('input[type="tel"]');
          if (tel) {
            var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet && nativeSet.set) nativeSet.set.call(tel, '${localNumber}');
            else tel.value = '${localNumber}';
            tel.dispatchEvent(new Event('input', { bubbles: true }));
            tel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()`);
        await page.waitForTimeout(1000);
        let retrySend = await clickButton(page, "add number");
        if (!retrySend) retrySend = await clickButton(page, "send code");
        console.log("[TM-Playwright] Retry add number clicked:", retrySend);
        await page.waitForTimeout(5000);
      }
    } else {
      await page.waitForTimeout(2000);
    }

    pageText = await getPageText(page);
    let pageLower = pageText.toLowerCase();

    if (tmIsChallenge(pageLower)) {
      console.log("[TM-Playwright] Challenge after phone code send, waiting...");
      for (let cw = 0; cw < 30; cw++) {
        await page.waitForTimeout(3000);
        try {
          pageText = await getPageText(page);
          pageLower = pageText.toLowerCase();
          if (!tmIsChallenge(pageLower)) break;
        } catch {}
      }
    }

    console.log("[TM-Playwright] After phone code send (first 500):", pageText.substring(0, 500));

    onStatusUpdate("verifying");
    log(`⏳ Waiting for SMS verification code...`);
    console.log("[TM-Playwright] Polling for phone verification code...");
    const smsCode = await pollCode();

    if (!smsCode) {
      log(`⏰ SMS code timeout - no code received`);
      console.log("[TM-Playwright] No SMS code received");
      await cancelOrder();
      return { success: false, error: "Timed out waiting for SMS verification code", smsCost };
    }

    log(`📩 Got SMS code: ${smsCode}`);
    console.log(`[TM-Playwright] Got phone verification code: ${smsCode}`);

    const codeDigits = smsCode.split('');
    const phoneCodeEntered = await page.evaluate(`((code, digits) => {
      var inputs = document.querySelectorAll('input[maxlength="1"], input[data-index]');
      var visibleDigitInputs = [];
      for (var i = 0; i < inputs.length; i++) {
        var rect = inputs[i].getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) visibleDigitInputs.push(inputs[i]);
      }

      if (visibleDigitInputs.length >= digits.length) {
        for (var j = 0; j < digits.length; j++) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (nativeSet && nativeSet.set) nativeSet.set.call(visibleDigitInputs[j], digits[j]);
          else visibleDigitInputs[j].value = digits[j];
          visibleDigitInputs[j].dispatchEvent(new Event('input', { bubbles: true }));
          visibleDigitInputs[j].dispatchEvent(new Event('change', { bubbles: true }));
          var rp = Object.keys(visibleDigitInputs[j]).find(function(k) { return k.startsWith('__reactProps'); });
          if (rp && visibleDigitInputs[j][rp] && typeof visibleDigitInputs[j][rp].onChange === 'function') {
            visibleDigitInputs[j][rp].onChange({ target: visibleDigitInputs[j], currentTarget: visibleDigitInputs[j], type: 'change' });
          }
        }
        return 'individual-digits:' + visibleDigitInputs.length;
      }

      var singleSelectors = [
        'input[id*="otp"]', 'input[name*="otp"]', 'input[name*="code"]',
        'input[id*="code"]', 'input[placeholder*="code"]',
        'input[inputmode="numeric"]',
        'input[type="text"]:not([name="email"]):not([name="firstName"]):not([name="lastName"]):not([name="postalCode"]):not([type="tel"])',
        'input[type="number"]', 'input[type="tel"]'
      ];
      for (var s = 0; s < singleSelectors.length; s++) {
        var els = document.querySelectorAll(singleSelectors[s]);
        for (var k = 0; k < els.length; k++) {
          var r = els[k].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            els[k].focus();
            var nativeSet2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet2 && nativeSet2.set) nativeSet2.set.call(els[k], code);
            else els[k].value = code;
            els[k].dispatchEvent(new Event('input', { bubbles: true }));
            els[k].dispatchEvent(new Event('change', { bubbles: true }));
            var rp2 = Object.keys(els[k]).find(function(kk) { return kk.startsWith('__reactProps'); });
            if (rp2 && els[k][rp2] && typeof els[k][rp2].onChange === 'function') {
              els[k][rp2].onChange({ target: els[k], currentTarget: els[k], type: 'change' });
            }
            els[k].dispatchEvent(new Event('blur', { bubbles: true }));
            return 'single-input:' + singleSelectors[s];
          }
        }
      }
      return 'no-input-found';
    })("${smsCode}", ${JSON.stringify(codeDigits)})`);
    log(`✏️ Entering SMS code on TM page...`);
    console.log(`[TM-Playwright] Phone code entry result: ${phoneCodeEntered}`);

    await page.waitForTimeout(1000);

    log(`🔘 Clicking confirm code button...`);
    let verifyPhoneClicked = await page.evaluate(`(() => {
      var form = document.querySelector('form:has(input[id*="otp"])');
      if (form) {
        var btns = form.querySelectorAll('button, input[type="submit"]');
        for (var i = 0; i < btns.length; i++) {
          var rect = btns[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            var text = (btns[i].innerText || btns[i].textContent || '').trim().toLowerCase();
            if (text.includes('verify') || text.includes('submit') || text.includes('confirm') || text.includes('continue')) {
              btns[i].click();
              return 'form-btn:' + text.substring(0, 40);
            }
          }
        }
        for (var j = 0; j < btns.length; j++) {
          var rect2 = btns[j].getBoundingClientRect();
          if (rect2.width > 0 && rect2.height > 0) {
            btns[j].click();
            return 'form-btn-any:' + (btns[j].innerText || '').trim().substring(0, 40);
          }
        }
      }

      var dialogs = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="overlay"], [class*="Dialog"]');
      for (var d = 0; d < dialogs.length; d++) {
        var dBtns = dialogs[d].querySelectorAll('button');
        for (var k = 0; k < dBtns.length; k++) {
          var rect3 = dBtns[k].getBoundingClientRect();
          var txt = (dBtns[k].innerText || '').trim().toLowerCase();
          if (rect3.width > 0 && rect3.height > 0 && (txt.includes('verify') || txt.includes('submit') || txt.includes('confirm'))) {
            dBtns[k].click();
            return 'dialog-btn:' + txt.substring(0, 40);
          }
        }
      }

      return false;
    })()`);
    console.log(`[TM-Playwright] Phone OTP form verify result: ${verifyPhoneClicked}`);

    if (!verifyPhoneClicked) {
      verifyPhoneClicked = await clickButton(page, "verify number");
      if (!verifyPhoneClicked) verifyPhoneClicked = await clickButton(page, "verify phone");
      if (!verifyPhoneClicked) verifyPhoneClicked = await clickButton(page, "confirm");
      if (!verifyPhoneClicked) verifyPhoneClicked = await clickButton(page, "submit");
      if (!verifyPhoneClicked) verifyPhoneClicked = await clickButton(page);
      console.log(`[TM-Playwright] Verify phone fallback clicked: ${verifyPhoneClicked}`);
    }

    await page.waitForTimeout(5000);

    pageText = await getPageText(page);
    pageLower = pageText.toLowerCase();

    if (tmIsChallenge(pageLower)) {
      console.log("[TM-Playwright] Challenge after phone verify, waiting...");
      for (let cw = 0; cw < 30; cw++) {
        await page.waitForTimeout(3000);
        try {
          pageText = await getPageText(page);
          pageLower = pageText.toLowerCase();
          if (!tmIsChallenge(pageLower)) break;
        } catch {}
      }
    }

    console.log("[TM-Playwright] After phone verification (first 500):", pageText.substring(0, 500));

    const phoneVerifyState = await page.evaluate(`(() => {
      var body = document.body ? document.body.innerText.toLowerCase() : '';
      return {
        hasPhone: body.includes('phone') && (body.includes('✓') || body.includes('verified') || body.includes('complete')),
        stillNeedsPhone: body.includes('add my phone') || body.includes('verify your phone'),
        bodyPreview: (document.body ? document.body.innerText : '').substring(0, 300)
      };
    })()`);
    console.log("[TM-Playwright] Phone verify state:", JSON.stringify(phoneVerifyState));

    if (phoneVerifyState.stillNeedsPhone) {
      await cancelOrder();
      log(`❌ Phone verification not confirmed after code entry`);
      return { success: false, error: "Phone verification not confirmed after OTP submission", smsCost };
    }
    log(`✅ Phone code accepted!`);
    return { success: true, smsCost };
  } catch (err: any) {
    log(`❌ Phone error: ${err.message?.substring(0, 80)}`);
    console.log("[TM-Playwright] Phone verification error:", err.message);
    await cancelOrder();
    return { success: false, error: err.message, smsCost };
  }
}

async function doTMRegistration(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>,
  log: (message: string) => void,
  proxyUrl?: string,
  keepBrowserOpen?: boolean,
  shakiraPresale?: boolean,
  presaleProxyUrl?: string
): Promise<{ success: boolean; error?: string; pageContent?: string; smsCost?: number; browser?: any; page?: any }> {
  console.log(`[TM-Playwright] proxyUrl received: ${proxyUrl ? proxyUrl.substring(0, 60) + '...' : 'NONE'}`);
  console.log(`[TM-Playwright] presaleProxyUrl: ${presaleProxyUrl ? presaleProxyUrl.substring(0, 60) + '...' : 'NONE'}`);

  // --- Split-session hybrid: ZenRows WSS for presale, SOAX for TM account ---
  // When presaleProxyUrl (ZenRows WSS) is provided AND shakiraPresale is enabled,
  // run the presale form in a separate ZenRows browser then close it before opening
  // the SOAX-proxied local browser for TM account creation.
  const useHybridProxy = !!(shakiraPresale && presaleProxyUrl && presaleProxyUrl.startsWith('wss://'));
  let hybridPresaleDone = false;

  if (useHybridProxy) {
    log(`🌐 Opening ZenRows browser for Shakira presale...`);
    console.log(`[TM-Playwright] Hybrid mode: ZenRows WSS for presale, SOAX for TM account`);
    let presaleRemote: Browser | null = null;
    try {
      presaleRemote = await chromium.connectOverCDP(presaleProxyUrl!, { timeout: 60000 });
      const presaleCtx = presaleRemote.contexts()[0];
      const presalePage: Page = presaleCtx
        ? (presaleCtx.pages()[0] || await presaleCtx.newPage())
        : await presaleRemote.newPage();
      presalePage.setDefaultTimeout(60000);

      // Bandwidth optimization on the presale browser too
      try {
        const blockedTypes = new Set(["image", "media", "font", "texttrack", "manifest"]);
        await presalePage.route("**/*", (route: any) => {
          if (blockedTypes.has(route.request().resourceType())) return route.abort();
          return route.continue();
        });
      } catch {}

      log(`✅ ZenRows browser connected for presale`);
      const presaleResult = await doShakiraPresaleStep(presalePage, log);
      if (!presaleResult.success) {
        log(`⚠️ Shakira presale step failed — ${presaleResult.error}`);
      }
      hybridPresaleDone = true;
    } catch (err: any) {
      log(`⚠️ Presale ZenRows browser error: ${err.message?.substring(0, 80)} — continuing with TM account...`);
      console.log(`[TM-Playwright] Presale ZenRows error:`, err.message);
    } finally {
      if (presaleRemote) {
        try { await presaleRemote.close(); } catch {}
        presaleRemote = null;
      }
      log(`🔒 ZenRows presale browser closed. Opening SOAX browser for TM account...`);
    }
  }

  const isBrowserAPI = !useHybridProxy && proxyUrl && proxyUrl.startsWith('wss://');
  console.log(`[TM-Playwright] isBrowserAPI: ${isBrowserAPI}`);
  let remoteBrowser: Browser | null = null;
  let page: Page;
  let context: any;
  let totalSmsCost = 0;

  try {
    if (isBrowserAPI) {
      log(`🌐 Connecting to Bright Data browser...`);
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
      log(`✅ Connected to remote browser`);
      console.log("[TM-Playwright] Connected to remote browser.");
    } else {
      let browser: Browser;
      try {
        browser = await getTMBrowser();
      } catch (err: any) {
        return { success: false, error: `Failed to launch browser: ${err.message}` };
      }

      const contextOptions: any = {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1366, height: 768 },
        locale: "en-US",
        timezoneId: "America/New_York",
      };
      if (proxyUrl && proxyUrl.startsWith("http")) {
        try {
          const parsed = new URL(proxyUrl);
          contextOptions.proxy = {
            server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
            username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
            password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
          };
          // ZenRows superproxy (and some residential proxies) do SSL interception;
          // ignore certificate errors so HTTPS sites load through the proxy tunnel
          contextOptions.ignoreHTTPSErrors = true;
          console.log(`[TM-Playwright] Using proxy server: ${parsed.hostname}:${parsed.port}`);
        } catch (e: any) {
          console.log(`[TM-Playwright] Could not parse proxy URL: ${e.message}`);
        }
      }
      context = await browser.newContext(contextOptions);

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
      const blockedTypes = new Set(["image", "media", "font", "texttrack", "manifest"]);
      const blockedPatterns = [
        "contentsquare", "cs-sdk", "uxa.js", "google-analytics", "googletagmanager",
        "facebook.net", "fbevents", "doubleclick", "hotjar", "segment.io", "segment.com",
        "newrelic", "nr-data", "sentry.io", "clarity.ms", "adsbygoogle",
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
        ".woff", ".woff2", ".ttf", ".eot", ".otf",
        ".mp4", ".webm", ".ogg", ".mp3",
      ];
      await page.route("**/*", (route: any) => {
        const resourceType = route.request().resourceType();
        const url = route.request().url().toLowerCase();
        if (blockedTypes.has(resourceType)) return route.abort();
        for (const p of blockedPatterns) { if (url.includes(p)) return route.abort(); }
        return route.continue();
      });
      console.log("[TM-Playwright] Bandwidth optimization enabled (blocked images/fonts/media/trackers)");
    } catch (e: any) {
      console.log("[TM-Playwright] Could not set bandwidth optimization:", e.message);
    }

    // --- Shakira presale step (runs before TM sign-up when enabled) ---
    let skipDirectTMNav = false;
    if (shakiraPresale && !hybridPresaleDone) {
      // Single-session mode: presale and TM account in same browser
      const presaleResult = await doShakiraPresaleStep(page, log);
      if (!presaleResult.success) {
        console.log("[TM-Playwright] Shakira presale step failed:", presaleResult.error);
        log(`⚠️ Shakira presale step failed — continuing to TM sign-up directly`);
      }
      // Only skip direct TM navigation if we actually landed on TM's auth or create-account page
      // (NOT the presale page itself which contains "ticketmaster" + "signup" in its URL)
      const postPresaleUrl = page.url();
      console.log("[TM-Playwright] URL after Shakira presale:", postPresaleUrl);
      if (
        postPresaleUrl.includes("auth.ticketmaster.com") ||
        postPresaleUrl.includes("identity.ticketmaster") ||
        postPresaleUrl.includes("ticketmaster.com/member/") ||
        postPresaleUrl.includes("ticketmaster.es/member/")
      ) {
        log(`🔗 Already on TM auth/create page after presale — skipping direct navigation`);
        skipDirectTMNav = true;
      }
    } else if (shakiraPresale && hybridPresaleDone) {
      // Hybrid mode: presale was already done in ZenRows browser, proceed directly to TM
      log(`🎤 Presale already completed via ZenRows — navigating to TM account creation...`);
      console.log("[TM-Playwright] Hybrid: presale done, skipping presale step in SOAX browser");
    }

    if (!skipDirectTMNav) {
      log(`🔗 Navigating to Ticketmaster sign-up page...`);
      console.log("[TM-Playwright] Navigating to TM create_account...");
      try {
        await page.goto("https://www.ticketmaster.com/member/create_account", { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch (navErr: any) {
        if (navErr.message && (navErr.message.includes("robots.txt") || navErr.message.includes("brob") || navErr.message.includes("restricted"))) {
          console.log("[TM-Playwright] robots.txt restriction, navigating directly to auth URL...");
          try {
            await page.goto("https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=en-us&placementId=tmolMyAccount&showHeader=true&hideLeftPanel=false&integratorId=prd116.tmol&intSiteToken=tm-us", { waitUntil: "domcontentloaded", timeout: 60000 });
          } catch (authNavErr: any) {
            console.log("[TM-Playwright] Auth URL navigation failed:", authNavErr.message?.substring(0, 150));
            throw new Error("Proxy connection failed - could not navigate to Ticketmaster auth page");
          }
        } else if (navErr.message && (navErr.message.includes("Proxy Error") || navErr.message.includes("proxy_error") || navErr.message.includes("ERR_PROXY") || navErr.message.includes("net::ERR"))) {
          console.log("[TM-Playwright] Proxy error during navigation:", navErr.message?.substring(0, 150));
          throw new Error("Proxy connection failed - Bright Data proxy error during navigation");
        } else {
          throw navErr;
        }
      }
      try {
        await page.waitForLoadState("networkidle", { timeout: 30000 });
      } catch {
        console.log("[TM-Playwright] Network idle timeout, continuing...");
      }
      await page.waitForTimeout(5000);
    } else {
      // Came from presale — give page a moment to settle
      await page.waitForTimeout(3000);
    }

    console.log("[TM-Playwright] After navigation URL:", page.url().substring(0, 200));

    let pageText = await getPageText(page);
    let pageLower = pageText.toLowerCase();
    console.log("[TM-Playwright] Initial page text:", pageText.substring(0, 300));
    console.log("[TM-Playwright] Current URL:", page.url());

    const errorPatterns = ["unexpected error", "we're sorry"];
    const blockPatterns = ["browsing activity", "has been paused", "unusual behavior", "access denied"];

    const isChallenge = tmIsChallenge;
    const isError = (text: string) => errorPatterns.some(p => text.includes(p));
    const isBlocked = (text: string) => blockPatterns.some(p => text.includes(p));

    if (isChallenge(pageLower)) {
      log(`🛡️ CAPTCHA detected, waiting for auto-solver...`);
      console.log("[TM-Playwright] Captcha/challenge detected. Waiting for Browser API captcha solver (up to 60s)...");
      let challengeResolved = false;
      for (let cw = 0; cw < 20; cw++) {
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
            log(`✅ CAPTCHA solved!`);
            console.log("[TM-Playwright] Challenge resolved!");
            challengeResolved = true;
            break;
          }
        } catch {
          console.log("[TM-Playwright] Page navigating during challenge solve...");
        }
      }

      if (!challengeResolved && isChallenge(pageLower)) {
        log(`🔧 Auto-solver timed out, trying CapSolver...`);
        console.log("[TM-Playwright] Browser solver failed, attempting CapSolver...");
        try {
          const siteKey = await page.evaluate(() => {
            const el = document.querySelector('.g-recaptcha, [data-sitekey]');
            if (el) return el.getAttribute('data-sitekey');
            const iframe = document.querySelector('iframe[src*="recaptcha"]');
            if (iframe) {
              const src = iframe.getAttribute('src') || '';
              const match = src.match(/[?&]k=([^&]+)/);
              if (match) return match[1];
            }
            const hcap = document.querySelector('[data-hcaptcha-widget-id], .h-captcha');
            if (hcap) return hcap.getAttribute('data-sitekey');
            return null;
          });
          const currentUrl = page.url();

          if (siteKey) {
            console.log(`[TM-Playwright] Found CAPTCHA site key: ${siteKey}`);
            log(`Found CAPTCHA key, solving via CapSolver...`);

            const isHCaptcha = await page.evaluate(() => !!document.querySelector('.h-captcha, [data-hcaptcha-widget-id]'));
            const capResult = isHCaptcha
              ? await solveHCaptcha(currentUrl, siteKey)
              : await solveRecaptchaV2(currentUrl, siteKey);

            if (capResult.success && capResult.token) {
              console.log(`[TM-Playwright] CapSolver token received (${capResult.token.length} chars)`);
              log(`✅ CapSolver solved! Injecting token...`);
              await injectRecaptchaToken(page, capResult.token);
              await page.waitForTimeout(3000);

              pageText = await getPageText(page);
              pageLower = pageText.toLowerCase();
              if (!isChallenge(pageLower)) {
                console.log("[TM-Playwright] Challenge resolved after CapSolver!");
              }
            } else {
              console.log(`[TM-Playwright] CapSolver failed: ${capResult.error}`);
              log(`CapSolver failed: ${capResult.error || 'unknown'}`);
            }
          } else {
            console.log("[TM-Playwright] No CAPTCHA site key found on page");
          }
        } catch (capErr: any) {
          console.log(`[TM-Playwright] CapSolver error: ${capErr.message?.substring(0, 100)}`);
        }
      }
    }

    const signupUrl = "https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=en-us&placementId=tmolMyAccount&showHeader=true&hideLeftPanel=false&integratorId=prd116.tmol&intSiteToken=tm-us";
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

    log(`📄 Page loaded, looking for sign-up form...`);
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

    log(`✏️ Step 1: Entering email address...`);
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

    log(`🔘 Clicking Continue...`);
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

    log(`⏳ Step 2: Waiting for registration form...`);
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

    log(`✏️ Step 3: Filling name and password...`);
    console.log("[TM-Playwright] Password field visible, filling registration form...");

    const fnFilled = await fillInput(page, [
      'input[name="firstName"]', 'input[name="first_name"]', 'input[id*="first"]',
      'input[placeholder*="irst"]', 'input[data-testid*="first"]',
      'input[autocomplete="given-name"]',
    ], firstName);
    console.log(`[TM-Playwright] FirstName filled: ${fnFilled}`);

    if (!fnFilled) {
      const fnFilledJS = await page.evaluate(`((val) => {
        var selectors = ['input[name="firstName"]', 'input[name="first_name"]', 'input[id*="first"]', 'input[autocomplete="given-name"]'];
        for (var s = 0; s < selectors.length; s++) {
          var el = document.querySelector(selectors[s]);
          if (el) {
            var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet && nativeSet.set) nativeSet.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
        }
        return false;
      })` + `(${JSON.stringify(firstName)})`) as boolean;
      console.log(`[TM-Playwright] FirstName JS fallback: ${fnFilledJS}`);
      if (!fnFilledJS) {
        return { success: false, error: "Could not fill first name field" };
      }
    }

    const lnFilled = await fillInput(page, [
      'input[name="lastName"]', 'input[name="last_name"]', 'input[id*="last"]',
      'input[placeholder*="ast"]', 'input[data-testid*="last"]',
      'input[autocomplete="family-name"]',
    ], lastName);
    console.log(`[TM-Playwright] LastName filled: ${lnFilled}`);

    if (!lnFilled) {
      const lnFilledJS = await page.evaluate(`((val) => {
        var selectors = ['input[name="lastName"]', 'input[name="last_name"]', 'input[id*="last"]', 'input[autocomplete="family-name"]'];
        for (var s = 0; s < selectors.length; s++) {
          var el = document.querySelector(selectors[s]);
          if (el) {
            var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet && nativeSet.set) nativeSet.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
        }
        return false;
      })` + `(${JSON.stringify(lastName)})`) as boolean;
      console.log(`[TM-Playwright] LastName JS fallback: ${lnFilledJS}`);
      if (!lnFilledJS) {
        return { success: false, error: "Could not fill last name field" };
      }
    }

    let pwFilled = false;
    console.log("[TM-Playwright] Attempting password fill with keyboard method...");

    try {
      const pwSelector = '#password-input, input[type="password"], input[name="password"]';
      const pwEl = page.locator(pwSelector).first();
      if (await pwEl.isVisible({ timeout: 5000 })) {
        await pwEl.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        await pwEl.fill('');
        await page.waitForTimeout(200);
        await pwEl.pressSequentially(password, { delay: 30 + Math.floor(Math.random() * 50) });
        await page.waitForTimeout(500);
        const val = await pwEl.inputValue();
        if (val && val.length > 0) {
          pwFilled = true;
          console.log("[TM-Playwright] Password filled via keyboard pressSequentially");
        } else {
          console.log("[TM-Playwright] pressSequentially typed but inputValue is empty, checking via JS...");
          const jsVal = await page.evaluate(`(() => {
            var el = document.querySelector('#password-input') || document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
            return el ? el.value.length : 0;
          })()`) as number;
          if (jsVal > 0) {
            pwFilled = true;
            console.log("[TM-Playwright] Password confirmed via JS value check");
          }
        }
      }
    } catch (e: any) {
      console.log(`[TM-Playwright] Keyboard password method failed: ${e.message.substring(0, 100)}`);
    }

    if (!pwFilled) {
      console.log("[TM-Playwright] Trying keyboard dispatch method...");
      try {
        const focused = await page.evaluate(`(() => {
          var el = document.querySelector('#password-input') || document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
          if (!el) return false;
          el.focus();
          el.click();
          return true;
        })()`);
        if (focused) {
          await page.waitForTimeout(300);
          await page.keyboard.type(password, { delay: 35 + Math.floor(Math.random() * 50) });
          await page.waitForTimeout(300);
          const pwVal = await page.evaluate(`(() => {
            var el = document.querySelector('#password-input') || document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
            return el ? el.value.length : 0;
          })()`) as number;
          if (pwVal > 0) {
            pwFilled = true;
            console.log("[TM-Playwright] Password filled via keyboard.type");
          }
        }
      } catch (e: any) {
        console.log(`[TM-Playwright] Keyboard dispatch failed: ${e.message.substring(0, 100)}`);
      }
    }

    if (!pwFilled) {
      console.log("[TM-Playwright] Trying clean iframe setter + React trigger method...");
      try {
        pwFilled = await page.evaluate(
          `((pwd) => {
          var el = document.querySelector('#password-input') || document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
          if (!el) return false;

          function triggerReactChange(element, value) {
            var nativeSetter;
            try {
              var iframe = document.createElement('iframe');
              iframe.style.display = 'none';
              document.body.appendChild(iframe);
              nativeSetter = Object.getOwnPropertyDescriptor(iframe.contentWindow.HTMLInputElement.prototype, 'value').set;
              document.body.removeChild(iframe);
            } catch (e) {
              nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            }
            nativeSetter.call(element, value);

            var reactPropsKey = Object.keys(element).find(function(k) {
              return k.startsWith('__reactProps') || k.startsWith('__reactEvents');
            });
            var reactFiberKey = Object.keys(element).find(function(k) {
              return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
            });

            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));

            if (reactPropsKey && element[reactPropsKey]) {
              var props = element[reactPropsKey];
              if (typeof props.onChange === 'function') {
                props.onChange({ target: element, currentTarget: element, type: 'change' });
              }
              if (typeof props.onInput === 'function') {
                props.onInput({ target: element, currentTarget: element, type: 'input' });
              }
            }

            if (reactFiberKey) {
              var fiber = element[reactFiberKey];
              while (fiber) {
                if (fiber.memoizedProps) {
                  if (typeof fiber.memoizedProps.onChange === 'function') {
                    fiber.memoizedProps.onChange({ target: element, currentTarget: element, type: 'change' });
                    break;
                  }
                }
                fiber = fiber.return;
              }
            }

            element.dispatchEvent(new Event('blur', { bubbles: true }));
            return element.value.length > 0;
          }

          el.focus();
          el.click();
          return triggerReactChange(el, pwd);
        })` + `(${JSON.stringify(password)})`) as boolean;
        if (pwFilled) console.log("[TM-Playwright] Password filled via iframe setter + React trigger");
      } catch (e: any) {
        console.log(`[TM-Playwright] Iframe setter + React trigger failed: ${e.message.substring(0, 100)}`);
      }
    }

    if (!pwFilled) {
      console.log("[TM-Playwright] Trying direct value setter as last resort...");
      try {
        pwFilled = await page.evaluate(
          `((pwd) => {
          var el = document.querySelector('#password-input') || document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
          if (!el) return false;
          el.focus();
          el.setAttribute('type', 'text');
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (nativeSet && nativeSet.set) nativeSet.set.call(el, pwd);
          else el.value = pwd;
          el.setAttribute('type', 'password');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return el.value.length > 0;
        })` + `(${JSON.stringify(password)})`) as boolean;
        if (pwFilled) console.log("[TM-Playwright] Password filled via direct setter");
      } catch (e: any) {
        console.log(`[TM-Playwright] Direct setter failed: ${e.message.substring(0, 100)}`);
      }
    }

    console.log(`[TM-Playwright] Password filled: ${pwFilled}`);

    if (!pwFilled) {
      return { success: false, error: "Could not fill password field" };
    }

    await page.waitForTimeout(500);

    const formFieldsVerify = await page.evaluate(`(() => {
      var pw = document.querySelector('#password-input') || document.querySelector('input[type="password"]') || document.querySelector('input[name="password"]');
      var fn = document.querySelector('input[name="firstName"]') || document.querySelector('input[autocomplete="given-name"]');
      var ln = document.querySelector('input[name="lastName"]') || document.querySelector('input[autocomplete="family-name"]');
      return {
        pwLen: pw ? pw.value.length : -1,
        fnLen: fn ? fn.value.length : -1,
        lnLen: ln ? ln.value.length : -1
      };
    })()`);
    console.log(`[TM-Playwright] Field verification - PW:${(formFieldsVerify as any).pwLen} FN:${(formFieldsVerify as any).fnLen} LN:${(formFieldsVerify as any).lnLen}`);

    if ((formFieldsVerify as any).fnLen === 0) {
      console.log("[TM-Playwright] WARNING: FirstName empty after fill, retrying...");
      try {
        await page.evaluate(`((val) => {
          var el = document.querySelector('input[name="firstName"]') || document.querySelector('input[autocomplete="given-name"]');
          if (!el) return;
          el.focus();
          var ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (ns && ns.set) ns.set.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        })` + `(${JSON.stringify(firstName)})`);
      } catch {}
    }

    if ((formFieldsVerify as any).lnLen === 0) {
      console.log("[TM-Playwright] WARNING: LastName empty after fill, retrying...");
      try {
        await page.evaluate(`((val) => {
          var el = document.querySelector('input[name="lastName"]') || document.querySelector('input[autocomplete="family-name"]');
          if (!el) return;
          el.focus();
          var ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (ns && ns.set) ns.set.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        })` + `(${JSON.stringify(lastName)})`);
      } catch {}
    }

    if ((formFieldsVerify as any).pwLen === 0) {
      console.log("[TM-Playwright] WARNING: Password field appears empty after fill, retrying with keyboard...");
      try {
        const pwEl = page.locator('#password-input, input[type="password"], input[name="password"]').first();
        await pwEl.click({ timeout: 3000 });
        await page.waitForTimeout(300);
        await page.keyboard.press('Control+a');
        await page.waitForTimeout(100);
        await page.keyboard.type(password, { delay: 40 + Math.floor(Math.random() * 30) });
        await page.waitForTimeout(500);
      } catch (retryErr: any) {
        console.log(`[TM-Playwright] Password retry failed: ${retryErr.message.substring(0, 80)}`);
      }
    }

    const usZips = ["90001","90012","90024","90034","90045","90056","90067","90210","90291","90301","90401","91001","91101","91201","91301","91401","91501","91601","91701","91801","92101","92201"];
    const randomZip = usZips[Math.floor(Math.random() * usZips.length)];
    const zipFilled = await fillInput(page, [
      'input[name="postalCode"]', 'input[id*="postalCode"]', 'input[id*="postal"]',
      'input[id*="zip"]', 'input[name="zipCode"]', 'input[placeholder*="zip" i]',
      'input[placeholder*="postal" i]',
    ], randomZip);
    console.log(`[TM-Playwright] PostalCode filled: ${zipFilled} (${randomZip})`);

    if (!zipFilled) {
      const zipFilledJS = await page.evaluate(`((val) => {
        var selectors = ['input[name="postalCode"]', 'input[id*="postalCode"]', 'input[id*="postal"]', 'input[id*="zip"]', 'input[name="zipCode"]'];
        for (var s = 0; s < selectors.length; s++) {
          var el = document.querySelector(selectors[s]);
          if (el) {
            var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet && nativeSet.set) nativeSet.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          }
        }
        return false;
      })` + `(${JSON.stringify(randomZip)})`) as boolean;
      console.log(`[TM-Playwright] PostalCode JS fallback: ${zipFilledJS}`);
    }

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
      if (checked === 0) {
        var labels = document.querySelectorAll('label, span[role="checkbox"], div[role="checkbox"]');
        for (var j = 0; j < labels.length; j++) {
          var el = labels[j];
          var text = (el.textContent || '').toLowerCase();
          if (text.includes('privacy') || text.includes('terms') || text.includes('agree') || text.includes('acknowledge')) {
            el.click();
            checked++;
          }
        }
      }
      return checked;
    })()`);
    console.log(`[TM-Playwright] Checked ${cbChecked} checkboxes`);

    await page.waitForTimeout(1000);

    log(`🔘 Step 4: Submitting registration form...`);
    console.log("[TM-Playwright] Submitting registration...");
    let submitted = await clickButton(page, "next");
    if (!submitted) submitted = await clickButton(page, "create account");
    if (!submitted) submitted = await clickButton(page, "sign up");
    if (!submitted) submitted = await clickButton(page, "register");
    if (!submitted) submitted = await clickButton(page, "continue");
    if (!submitted) submitted = await clickButton(page);
    console.log(`[TM-Playwright] Submit clicked: ${submitted}`);

    if (!submitted) {
      return { success: false, error: "Could not find submit button" };
    }

    console.log("[TM-Playwright] Waiting for response...");
    await page.waitForTimeout(3000);

    const postSubmitText = await getPageText(page);
    const postSubmitLower = postSubmitText.toLowerCase();
    if (postSubmitLower.includes("please enter a valid password") ||
        postSubmitLower.includes("password is required") ||
        postSubmitLower.includes("first name is required") ||
        postSubmitLower.includes("last name is required")) {
      console.log("[TM-Playwright] Form validation errors after submit:", postSubmitText.substring(0, 300));
      return { success: false, error: "Form validation errors: " + postSubmitText.substring(0, 200), pageContent: postSubmitText.substring(0, 500), smsCost: totalSmsCost };
    }

    await page.waitForTimeout(5000);

    pageText = await getPageText(page);
    pageLower = pageText.toLowerCase();

    if (isChallenge(pageLower)) {
      console.log("[TM-Playwright] Challenge after submit, waiting for solver...");
      for (let cw = 0; cw < 40; cw++) {
        await page.waitForTimeout(3000);
        try {
          pageText = await getPageText(page);
          pageLower = pageText.toLowerCase();
          if (cw % 5 === 0) {
            console.log(`[TM-Playwright] Submit challenge wait [${cw * 3}s]: ${pageText.substring(0, 150).replace(/\n/g, ' ')}`);
          }
          if (!isChallenge(pageLower)) {
            console.log("[TM-Playwright] Submit challenge resolved!");
            break;
          }
        } catch {}
      }
    }

    console.log("[TM-Playwright] After submit (first 500):", pageText.substring(0, 500));
    console.log("[TM-Playwright] URL after submit:", page.url().substring(0, 200));

    if (pageText.toLowerCase().includes("already") && pageText.toLowerCase().includes("exist")) {
      return { success: false, error: "Account already exists for this email" };
    }

    const stillOnSignUpForm = pageLower.includes("sign up") && pageLower.includes("password") && pageLower.includes("first name");
    if (stillOnSignUpForm) {
      console.log("[TM-Playwright] Still on sign-up form after submit, re-verifying fields and retrying...");

      const fieldCheck = await page.evaluate(`(() => {
        var pw = document.querySelector('#password-input');
        var fn = document.querySelector('#firstName-input');
        var ln = document.querySelector('#lastName-input');
        return {
          pw: pw ? pw.value.length : -1,
          fn: fn ? fn.value.length : -1,
          ln: ln ? ln.value.length : -1
        };
      })()`) as any;
      console.log("[TM-Playwright] Field values after failed submit:", JSON.stringify(fieldCheck));

      if (fieldCheck.pw === 0 || fieldCheck.fn === 0 || fieldCheck.ln === 0) {
        console.log("[TM-Playwright] Empty fields detected, re-filling with React triggers...");
        if (fieldCheck.pw === 0) {
          await page.evaluate(`((pwd) => {
            var el = document.querySelector('#password-input');
            if (!el) return;
            var nativeSetter;
            try {
              var iframe = document.createElement('iframe');
              iframe.style.display = 'none';
              document.body.appendChild(iframe);
              nativeSetter = Object.getOwnPropertyDescriptor(iframe.contentWindow.HTMLInputElement.prototype, 'value').set;
              document.body.removeChild(iframe);
            } catch(e) { nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; }
            nativeSetter.call(el, pwd);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            var rp = Object.keys(el).find(function(k) { return k.startsWith('__reactProps'); });
            if (rp && el[rp] && typeof el[rp].onChange === 'function') el[rp].onChange({ target: el, currentTarget: el, type: 'change' });
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          })` + `(${JSON.stringify(password)})`);
        }
        if (fieldCheck.fn === 0) {
          await page.evaluate(`((val) => {
            var el = document.querySelector('#firstName-input');
            if (!el) return;
            var ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (ns && ns.set) ns.set.call(el, val); else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            var rp = Object.keys(el).find(function(k) { return k.startsWith('__reactProps'); });
            if (rp && el[rp] && typeof el[rp].onChange === 'function') el[rp].onChange({ target: el, currentTarget: el, type: 'change' });
          })` + `(${JSON.stringify(firstName)})`);
        }
        if (fieldCheck.ln === 0) {
          await page.evaluate(`((val) => {
            var el = document.querySelector('#lastName-input');
            if (!el) return;
            var ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (ns && ns.set) ns.set.call(el, val); else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            var rp = Object.keys(el).find(function(k) { return k.startsWith('__reactProps'); });
            if (rp && el[rp] && typeof el[rp].onChange === 'function') el[rp].onChange({ target: el, currentTarget: el, type: 'change' });
          })` + `(${JSON.stringify(lastName)})`);
        }
        await page.waitForTimeout(1000);

        console.log("[TM-Playwright] Re-submitting after field re-fill...");
        let resubmitted = await clickButton(page, "create account");
        if (!resubmitted) resubmitted = await clickButton(page, "sign up");
        if (!resubmitted) resubmitted = await clickButton(page, "register");
        if (!resubmitted) resubmitted = await clickButton(page, "continue");
        if (!resubmitted) resubmitted = await clickButton(page);
        console.log(`[TM-Playwright] Re-submit clicked: ${resubmitted}`);
        await page.waitForTimeout(5000);
        pageText = await getPageText(page);
        pageLower = pageText.toLowerCase();
      }

      for (let waitIdx = 0; waitIdx < 10; waitIdx++) {
        if (!pageLower.includes("sign up") || pageLower.includes("almost there") || pageLower.includes("verify your account")) {
          console.log(`[TM-Playwright] Page transitioned after extended wait`);
          break;
        }
        if (pageLower.includes("please enter a valid password") || pageLower.includes("password is required") ||
            pageLower.includes("first name is required") || pageLower.includes("last name is required")) {
          console.log("[TM-Playwright] Form validation errors detected during wait");
          return { success: false, error: "Form validation errors after delayed submit: " + pageText.substring(0, 200), pageContent: pageText.substring(0, 500), smsCost: totalSmsCost };
        }
        await page.waitForTimeout(3000);
        pageText = await getPageText(page);
        pageLower = pageText.toLowerCase();
        if (waitIdx % 3 === 0) console.log(`[TM-Playwright] Still waiting for page transition [${(waitIdx + 1) * 3}s]...`);
      }
      console.log("[TM-Playwright] After extended wait (first 500):", pageText.substring(0, 500));
    }

    const needsCode = pageLower.includes("almost there") ||
                      pageLower.includes("verify your account") ||
                      pageLower.includes("verify my email") ||
                      pageLower.includes("check your email") ||
                      (pageLower.includes("verify") && pageLower.includes("email") && !stillOnSignUpForm);

    if (needsCode) {
      log(`📧 Step 5: Email verification required, clicking "Verify My Email"...`);
      console.log("[TM-Playwright] Verification page detected, clicking 'Verify My Email'...");

      let verifyEmailClicked = await clickButton(page, "verify my email");
      if (!verifyEmailClicked) verifyEmailClicked = await clickButton(page, "verify email");
      if (!verifyEmailClicked) verifyEmailClicked = await clickButton(page, "send code");
      console.log(`[TM-Playwright] Verify My Email clicked: ${verifyEmailClicked}`);

      await page.waitForTimeout(3000);
      pageText = await getPageText(page);
      pageLower = pageText.toLowerCase();

      if (isChallenge(pageLower)) {
        console.log("[TM-Playwright] Challenge after Verify My Email click, waiting for solver...");
        for (let cw = 0; cw < 40; cw++) {
          await page.waitForTimeout(3000);
          try {
            pageText = await getPageText(page);
            pageLower = pageText.toLowerCase();
            if (cw % 5 === 0) {
              console.log(`[TM-Playwright] Verify challenge wait [${cw * 3}s]: ${pageText.substring(0, 150).replace(/\n/g, ' ')}`);
            }
            if (!isChallenge(pageLower)) {
              console.log("[TM-Playwright] Verify challenge resolved!");
              break;
            }
          } catch {}
        }
      }

      await page.waitForTimeout(3000);
      pageText = await getPageText(page);
      console.log("[TM-Playwright] After verify email click (first 500):", pageText.substring(0, 500));

      const allInputs = await page.evaluate(`(() => {
        var inputs = document.querySelectorAll('input');
        var result = [];
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            result.push({
              tag: el.tagName, type: el.type, name: el.name, id: el.id,
              placeholder: el.placeholder, maxLength: el.maxLength,
              ariaLabel: el.getAttribute('aria-label') || '',
              dataTestId: el.getAttribute('data-testid') || ''
            });
          }
        }
        return result;
      })()`);
      console.log("[TM-Playwright] Visible inputs on verify page:", JSON.stringify(allInputs));

      onStatusUpdate("waiting_code");
      log(`⏳ Waiting for email verification code...`);

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
      log(`✏️ Entering email verification code: ${code}`);
      console.log(`[TM-Playwright] Entering verification code: ${code}`);

      let codeEntered = 'not-attempted';
      try {
        const otpInput = page.locator('#otp-input-input, input[aria-label="One-Time Code"], input[maxlength="6"]').first();
        if (await otpInput.isVisible({ timeout: 3000 })) {
          await otpInput.click({ timeout: 2000 });
          await page.waitForTimeout(300);
          await otpInput.fill('');
          await page.waitForTimeout(200);
          await otpInput.pressSequentially(code, { delay: 50 + Math.floor(Math.random() * 30) });
          await page.waitForTimeout(300);
          const val = await otpInput.inputValue().catch(() => '');
          if (val && val.length > 0) {
            codeEntered = 'typed-otp:' + val.length;
          } else {
            codeEntered = 'typed-but-empty';
          }
        }
      } catch (e: any) {
        console.log(`[TM-Playwright] OTP typing failed: ${e.message.substring(0, 80)}`);
      }

      if (codeEntered === 'not-attempted' || codeEntered === 'typed-but-empty') {
        const codeDigits = code.split('');
        codeEntered = await page.evaluate(`((code, digits) => {
          var inputs = document.querySelectorAll('input[maxlength="1"], input[data-index]');
          var visibleDigitInputs = [];
          for (var i = 0; i < inputs.length; i++) {
            var rect = inputs[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) visibleDigitInputs.push(inputs[i]);
          }

          function reactTrigger(element) {
            var rp = Object.keys(element).find(function(k) { return k.startsWith('__reactProps'); });
            if (rp && element[rp] && typeof element[rp].onChange === 'function') {
              element[rp].onChange({ target: element, currentTarget: element, type: 'change' });
            }
          }

          if (visibleDigitInputs.length >= digits.length) {
            for (var j = 0; j < digits.length; j++) {
              var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                              Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (nativeSet && nativeSet.set) nativeSet.set.call(visibleDigitInputs[j], digits[j]);
              else visibleDigitInputs[j].value = digits[j];
              visibleDigitInputs[j].dispatchEvent(new Event('input', { bubbles: true }));
              visibleDigitInputs[j].dispatchEvent(new Event('change', { bubbles: true }));
              reactTrigger(visibleDigitInputs[j]);
            }
            return 'individual-digits:' + visibleDigitInputs.length;
          }

          var otpEl = document.querySelector('#otp-input-input') || document.querySelector('input[aria-label="One-Time Code"]');
          if (otpEl) {
            otpEl.focus();
            var nativeSet2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet2 && nativeSet2.set) nativeSet2.set.call(otpEl, code);
            else otpEl.value = code;
            otpEl.dispatchEvent(new Event('input', { bubbles: true }));
            otpEl.dispatchEvent(new Event('change', { bubbles: true }));
            reactTrigger(otpEl);
            otpEl.dispatchEvent(new Event('blur', { bubbles: true }));
            return 'otp-native-setter';
          }

          var singleSelectors = [
            'input[name="code"]', 'input[id*="code"]', 'input[placeholder*="code"]',
            'input[data-testid*="code"]', 'input[inputmode="numeric"]',
            'input[type="text"]:not([name="email"]):not([name="firstName"]):not([name="lastName"]):not([name="postalCode"])',
            'input[type="number"]', 'input[type="tel"]'
          ];
          for (var s = 0; s < singleSelectors.length; s++) {
            var els = document.querySelectorAll(singleSelectors[s]);
            for (var k = 0; k < els.length; k++) {
              var r = els[k].getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                els[k].focus();
                var nativeSet3 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                                 Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                if (nativeSet3 && nativeSet3.set) nativeSet3.set.call(els[k], code);
                else els[k].value = code;
                els[k].dispatchEvent(new Event('input', { bubbles: true }));
                els[k].dispatchEvent(new Event('change', { bubbles: true }));
                reactTrigger(els[k]);
                els[k].dispatchEvent(new Event('blur', { bubbles: true }));
                return 'single-input:' + singleSelectors[s];
              }
            }
          }
          return 'no-input-found';
        })` + `(${JSON.stringify(code)}, ${JSON.stringify(code.split(''))})`) as string;
      }
      console.log(`[TM-Playwright] Code entry result: ${codeEntered}`);

      await page.waitForTimeout(1500);

      log(`🔘 Clicking verify code button...`);
      let verifyClicked = await page.evaluate(`(() => {
        var otpForm = document.querySelector('form:has(#otp-input-input), form:has(input[aria-label="One-Time Code"]), form:has(input[maxlength="6"])');
        if (otpForm) {
          var btns = otpForm.querySelectorAll('button, input[type="submit"]');
          for (var i = 0; i < btns.length; i++) {
            var rect = btns[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              var text = (btns[i].innerText || btns[i].textContent || '').trim().toLowerCase();
              if (text.includes('verify') || text.includes('submit') || text.includes('confirm') || text.includes('continue')) {
                btns[i].click();
                return 'otp-form-btn:' + text.substring(0, 40);
              }
            }
          }
          for (var j = 0; j < btns.length; j++) {
            var rect2 = btns[j].getBoundingClientRect();
            if (rect2.width > 0 && rect2.height > 0) {
              btns[j].click();
              return 'otp-form-btn-any:' + (btns[j].innerText || '').trim().substring(0, 40);
            }
          }
        }
        return false;
      })()`) as string | boolean;

      if (!verifyClicked) {
        verifyClicked = await clickButton(page, "verify code");
        if (!verifyClicked) verifyClicked = await clickButton(page, "verify");
        if (!verifyClicked) verifyClicked = await clickButton(page, "confirm");
        if (!verifyClicked) verifyClicked = await clickButton(page, "submit");
        if (!verifyClicked) verifyClicked = await clickButton(page, "continue");
        if (!verifyClicked) verifyClicked = await clickButton(page);
      }
      console.log(`[TM-Playwright] Verify code clicked: ${verifyClicked}`);

      await page.waitForTimeout(5000);

      pageText = await getPageText(page);
      pageLower = pageText.toLowerCase();
      if (isChallenge(pageLower)) {
        console.log("[TM-Playwright] Challenge after code verify, waiting...");
        for (let cw = 0; cw < 40; cw++) {
          await page.waitForTimeout(3000);
          try {
            pageText = await getPageText(page);
            pageLower = pageText.toLowerCase();
            if (cw % 5 === 0) {
              console.log(`[TM-Playwright] Post-code challenge [${cw * 3}s]: ${pageText.substring(0, 150).replace(/\n/g, ' ')}`);
            }
            if (!isChallenge(pageLower)) {
              console.log("[TM-Playwright] Post-code challenge resolved!");
              break;
            }
          } catch {}
        }
      }

      await page.waitForTimeout(3000);
      pageText = await getPageText(page);
      console.log("[TM-Playwright] After verification (first 500):", pageText.substring(0, 500));

      const emailVerified = await page.evaluate(`(() => {
        var body = document.body ? document.body.innerHTML.toLowerCase() : '';
        var hasCheckmark = body.includes('email') && (body.includes('✓') || body.includes('check') || body.includes('verified') || body.includes('complete'));
        var verifyStillShowing = body.includes('verify my email') || body.includes('send code');
        return { hasCheckmark: hasCheckmark, verifyStillShowing: verifyStillShowing, bodyPreview: (document.body ? document.body.innerText : '').substring(0, 300) };
      })()`);
      console.log("[TM-Playwright] Email verification state:", JSON.stringify(emailVerified));

      if (emailVerified.hasCheckmark) {
        log(`✅ Email verified! Dismissing overlay...`);
        console.log("[TM-Playwright] Email verified, dismissing OTP overlay...");
        const dismissResult = await page.evaluate(`(() => {
          var closeButtons = document.querySelectorAll('button[aria-label="Close"], button[aria-label="close"], button.close, [data-dismiss], [aria-label*="close" i], [aria-label*="dismiss" i]');
          for (var i = 0; i < closeButtons.length; i++) {
            var rect = closeButtons[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              closeButtons[i].click();
              return 'close-button';
            }
          }
          var doneButtons = document.querySelectorAll('button, a');
          for (var i = 0; i < doneButtons.length; i++) {
            var el = doneButtons[i];
            var rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              var text = (el.textContent || '').toLowerCase().trim();
              if (text === 'done' || text === 'ok' || text === 'close' || text === 'back' || text === 'continue' || text === 'got it') {
                el.click();
                return 'done-button:' + text;
              }
            }
          }
          var overlays = document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="backdrop"]');
          for (var i = 0; i < overlays.length; i++) {
            overlays[i].click();
            return 'overlay-click';
          }
          return 'no-dismiss-found';
        })()`);
        console.log("[TM-Playwright] Dismiss result:", dismissResult);
        await page.waitForTimeout(2000);

        try { await page.keyboard.press('Escape'); } catch {}
        await page.waitForTimeout(1000);

        const postDismissText = await getPageText(page);
        console.log("[TM-Playwright] After dismiss (first 300):", postDismissText.substring(0, 300));

        const postDismissInputs = await page.evaluate(`(() => {
          var all = document.querySelectorAll('input, select, textarea');
          var result = [];
          for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              result.push({ tag: el.tagName, type: el.type, name: el.name, id: el.id, maxLength: el.maxLength, ariaLabel: el.getAttribute('aria-label') || '' });
            }
          }
          return result;
        })()`);
        console.log("[TM-Playwright] Post-dismiss inputs:", JSON.stringify(postDismissInputs));
      }
    }

    pageText = await getPageText(page);
    let pageLowerFinal = pageText.toLowerCase();

    if (pageLowerFinal.includes("add my phone") || pageLowerFinal.includes("verify your phone") || pageLowerFinal.includes("phone number")) {
      log(`📱 Step 6: Phone verification required, starting SMS flow...`);
      console.log("[TM-Playwright] Phone verification required, starting SMSPool flow...");
      const phoneResult = await handlePhoneVerification(page, onStatusUpdate, log);
      totalSmsCost += phoneResult.smsCost || 0;
      if (phoneResult.success) {
        console.log("[TM-Playwright] Phone verification completed successfully!");
      } else {
        console.log("[TM-Playwright] Phone verification failed:", phoneResult.error);
        if (totalSmsCost > 0) {
          console.log(`[TM-Playwright] SMS cost spent: $${totalSmsCost.toFixed(2)} (non-recoverable)`);
        }
      }

      await page.waitForTimeout(3000);
      pageText = await getPageText(page);
    }

    const postVerifyLower = pageText.toLowerCase();
    const emailDone = postVerifyLower.includes("email verified");
    const phoneDone = postVerifyLower.includes("phone verified");
    const onVerifyPage = postVerifyLower.includes("almost there") || postVerifyLower.includes("verify your account") || postVerifyLower.includes("confirm your account");

    if (onVerifyPage && (emailDone || phoneDone)) {
      console.log(`[TM-Playwright] Verification state - email: ${emailDone}, phone: ${phoneDone}`);

      if (emailDone && phoneDone) {
        console.log("[TM-Playwright] Both verifications done!");
      } else if (!emailDone && phoneDone) {
        console.log("[TM-Playwright] Phone verified but email not yet, waiting for page update...");
        for (let w = 0; w < 5; w++) {
          await page.waitForTimeout(3000);
          pageText = await getPageText(page);
          if (pageText.toLowerCase().includes("email verified")) {
            console.log("[TM-Playwright] Email verified after wait");
            break;
          }
        }
      }

      for (let confirmWait = 0; confirmWait < 5; confirmWait++) {
        pageText = await getPageText(page);
        const pLower = pageText.toLowerCase();
        if (pLower.includes("confirm your account") || pLower.includes("done")) {
          console.log("[TM-Playwright] CONFIRM YOUR ACCOUNT page detected");
          break;
        }
        await page.waitForTimeout(2000);
      }

      log(`🔘 Step 7: Clicking "Done" to confirm account...`);
      console.log("[TM-Playwright] Looking for Done button to confirm account...");
      let doneClicked = await clickButton(page, "done");
      if (!doneClicked) doneClicked = await clickButton(page, "continue");
      if (!doneClicked) doneClicked = await clickButton(page, "finish");
      if (!doneClicked) doneClicked = await clickButton(page, "complete");
      if (!doneClicked) doneClicked = await clickButton(page, "let's go");
      if (!doneClicked) doneClicked = await clickButton(page, "go to my account");
      console.log(`[TM-Playwright] Done button clicked: ${doneClicked}`);

      if (doneClicked) {
        try {
          await page.waitForTimeout(keepBrowserOpen ? 3000 : 5000);
          if (!keepBrowserOpen) {
            await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
          }
        } catch (doneWaitErr: any) {
          console.log(`[TM-Playwright] Browser closed after Done click (account is verified): ${doneWaitErr.message?.substring(0, 100)}`);
          return { success: true, pageContent: "Account created. Both verifications confirmed. Done clicked. Browser closed during redirect.", smsCost: totalSmsCost };
        }
      }

      let pageLowerNow: string;
      try {
        pageText = await getPageText(page);
        pageLowerNow = pageText.toLowerCase();
        console.log("[TM-Playwright] After Done click (first 300):", pageText.substring(0, 300));
        console.log("[TM-Playwright] After Done URL:", page.url());
      } catch (getTextErr: any) {
        console.log(`[TM-Playwright] Browser closed after Done (account verified): ${getTextErr.message?.substring(0, 100)}`);
        return { success: true, pageContent: "Account created. Both verifications confirmed. Done clicked. Browser closed.", smsCost: totalSmsCost };
      }

      if (pageLowerNow.includes("add a passkey") || pageLowerNow.includes("passkey")) {
        log(`🔑 Passkey prompt detected, dismissing...`);
        console.log("[TM-Playwright] ADD A PASSKEY page detected, clicking 'Not Right Now'...");
        try {
          let passkeyDismissed = await clickButton(page, "not right now");
          if (!passkeyDismissed) passkeyDismissed = await clickButton(page, "skip");
          if (!passkeyDismissed) passkeyDismissed = await clickButton(page, "no thanks");
          if (!passkeyDismissed) passkeyDismissed = await clickButton(page, "maybe later");
          console.log(`[TM-Playwright] Passkey dismissed: ${passkeyDismissed}`);

          if (passkeyDismissed) {
            console.log("[TM-Playwright] Waiting for redirect to landing page...");
            try {
              if (keepBrowserOpen) {
                await page.waitForTimeout(5000);
              } else {
                await page.waitForTimeout(10000);
                await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
                await page.waitForTimeout(3000);
              }
            } catch {}

            try {
              const landingUrl = page.url();
              console.log("[TM-Playwright] Landing URL:", landingUrl);

              const isOnTMLanding = landingUrl.includes("ticketmaster.com") && !landingUrl.includes("authorization.oauth2");
              const isOnMyTM = landingUrl.includes("my.ticketmaster.com");

              if (isOnTMLanding || isOnMyTM) {
                console.log("[TM-Playwright] Redirected to TM! Checking page is alive...");
                let browserAlive = true;

                try {
                  await page.evaluate("1+1");
                } catch {
                  browserAlive = false;
                  console.log("[TM-Playwright] Browser died after redirect, but account is verified.");
                }

                if (browserAlive && keepBrowserOpen) {
                  console.log("[TM-Playwright] SUCCESS: Browser alive, returning for presale reuse.");
                  return { success: true, browser: remoteBrowser, page, pageContent: "Account created. Email verified. Phone verified. Redirected to: " + landingUrl.substring(0, 100), smsCost: totalSmsCost };
                }

                if (browserAlive && !keepBrowserOpen) {
                  try {
                    await page.waitForTimeout(3000);
                    const landingText = await getPageText(page);
                    console.log("[TM-Playwright] Landing page (first 400):", landingText.substring(0, 400));
                  } catch {}
                }

                console.log("[TM-Playwright] SUCCESS: Redirected to TM landing/account page. Account created.");
                return { success: true, pageContent: "Account created. Email verified. Phone verified. Redirected to: " + landingUrl.substring(0, 100), smsCost: totalSmsCost };
              } else {
                let browserAlive = true;
                try { await page.evaluate("1+1"); } catch { browserAlive = false; }

                if (browserAlive && keepBrowserOpen) {
                  console.log("[TM-Playwright] Still on auth page but verifications done. Browser alive for presale.");
                  return { success: true, browser: remoteBrowser, page, pageContent: "Account created. Email verified. Phone verified. Passkey dismissed. URL: " + landingUrl.substring(0, 100), smsCost: totalSmsCost };
                }

                console.log("[TM-Playwright] Still on auth page but verifications done. Account created.");
                return { success: true, pageContent: "Account created. Email verified. Phone verified. Passkey dismissed. URL: " + landingUrl.substring(0, 100), smsCost: totalSmsCost };
              }
            } catch (landingErr: any) {
              console.log(`[TM-Playwright] Browser closed during landing check (account verified): ${landingErr.message?.substring(0, 100)}`);
              return { success: true, pageContent: "Account created. Email verified. Phone verified. Browser closed after passkey dismiss.", smsCost: totalSmsCost };
            }
          }
        } catch (passkeyErr: any) {
          console.log(`[TM-Playwright] Passkey dismiss error (account is verified): ${passkeyErr.message?.substring(0, 100)}`);
          return { success: true, pageContent: "Account created. Email verified. Phone verified. Passkey page reached but dismiss failed.", smsCost: totalSmsCost };
        }
      }

      if (pageLowerNow.includes("confirm your account") && pageLowerNow.includes("email verified") && pageLowerNow.includes("phone verified")) {
        console.log("[TM-Playwright] Still on CONFIRM YOUR ACCOUNT page with both verifications done. Returning success.");
        return { success: true, browser: keepBrowserOpen ? remoteBrowser : undefined, page: keepBrowserOpen ? page : undefined, pageContent: "Account created. Both verifications confirmed. Done button may have failed.", smsCost: totalSmsCost };
      }

      if (!doneClicked) {
        try {
          console.log("[TM-Playwright] No button found, trying to navigate to TM account page directly...");
          await page.goto("https://www.ticketmaster.com/member/edit_account", { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(3000);
          pageText = await getPageText(page);
        } catch (navErr: any) {
          console.log("[TM-Playwright] Direct navigation attempt failed:", navErr.message?.substring(0, 100));
        }
      }

      console.log("[TM-Playwright] After finalize (first 300):", pageText.substring(0, 300));
      console.log("[TM-Playwright] After finalize URL:", page.url());
    }

    const currentUrl = page.url();
    const finalText = pageText;
    const finalLower = finalText.toLowerCase();

    console.log("[TM-Playwright] Final URL:", currentUrl);
    console.log("[TM-Playwright] Final text (first 500):", finalText.substring(0, 500));

    if (finalLower.includes("please enter a valid password") || finalLower.includes("password is required")) {
      return { success: false, error: "Password validation failed on TM form - password field was not accepted", pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
    }

    if (finalLower.includes("sign up") && finalLower.includes("password") && finalLower.includes("first name")) {
      return { success: false, error: "Still on sign-up form - registration was not submitted successfully", pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
    }

    const redirectedToAccount = currentUrl.includes("ticketmaster.com/member") ||
                      currentUrl.includes("ticketmaster.com/user") ||
                      (currentUrl.includes("ticketmaster.com") && !currentUrl.includes("authorization.oauth2") && !currentUrl.includes("auth.ticketmaster"));
    const textIndicatesSuccess = finalLower.includes("account created") ||
                      finalLower.includes("my account") ||
                      finalLower.includes("you're in") ||
                      finalLower.includes("welcome back") ||
                      finalLower.includes("account settings") ||
                      finalLower.includes("add a passkey");

    const domVerifyState = await page.evaluate(`(() => {
      var body = document.body ? document.body.innerHTML : '';
      var bodyLower = body.toLowerCase();
      var emailSection = '';
      var phoneSection = '';
      var allSections = document.querySelectorAll('section, div[class*="verify"], div[class*="Verify"]');
      for (var i = 0; i < allSections.length; i++) {
        var text = allSections[i].innerText.toLowerCase();
        if (text.includes('verify your email') || text.includes('verify my email')) emailSection = allSections[i].innerHTML.toLowerCase();
        if (text.includes('phone') && (text.includes('verify') || text.includes('add'))) phoneSection = allSections[i].innerHTML.toLowerCase();
      }
      var emailHasCheck = emailSection.includes('✓') || emailSection.includes('checkmark') || emailSection.includes('svg') || emailSection.includes('check-circle') || emailSection.includes('success');
      var phoneHasCheck = phoneSection.includes('✓') || phoneSection.includes('checkmark') || phoneSection.includes('svg') || phoneSection.includes('check-circle') || phoneSection.includes('success');
      var bodyText = document.body ? document.body.innerText.toLowerCase() : '';
      var emailVerifiedText = bodyText.includes('email verified') || bodyText.includes('email address verified');
      var phoneVerifiedText = bodyText.includes('phone verified') || bodyText.includes('phone number verified') || bodyText.includes('phone number added');
      return {
        emailVerified: emailHasCheck || emailVerifiedText,
        phoneVerified: phoneHasCheck || phoneVerifiedText,
        hasVerifyPage: bodyText.includes('almost there') || bodyText.includes('verify your account'),
        stillNeedsEmail: !emailHasCheck && !emailVerifiedText && bodyText.includes('verify my email'),
        stillNeedsPhone: !phoneHasCheck && !phoneVerifiedText && bodyText.includes('add my phone')
      };
    })()`) as any;
    console.log("[TM-Playwright] DOM verify state:", JSON.stringify(domVerifyState));

    const phoneVerified = domVerifyState.phoneVerified;
    const emailVerifiedOnPage = domVerifyState.emailVerified;

    const emailVerifiedPhonePending = domVerifyState.hasVerifyPage && emailVerifiedOnPage && !phoneVerified;
    const bothVerified = emailVerifiedOnPage && phoneVerified;
    const verifyPageCompleted = domVerifyState.hasVerifyPage && !domVerifyState.stillNeedsEmail && !domVerifyState.stillNeedsPhone;

    const isSuccess = redirectedToAccount || textIndicatesSuccess || verifyPageCompleted || bothVerified;

    console.log("[TM-Playwright] Success checks - redirected:", redirectedToAccount, "textSuccess:", textIndicatesSuccess, "phoneVerified:", phoneVerified, "emailVerified:", emailVerifiedOnPage, "emailOnlyDone:", emailVerifiedPhonePending, "verifyComplete:", verifyPageCompleted, "result:", isSuccess);

    if (isSuccess) {
      return { success: true, browser: keepBrowserOpen ? remoteBrowser : undefined, page: keepBrowserOpen ? page : undefined, pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
    }

    if (domVerifyState.hasVerifyPage) {
      if (domVerifyState.stillNeedsEmail && domVerifyState.stillNeedsPhone) {
        return { success: false, error: "Registration submitted but both email and phone verification incomplete.", pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
      }
      if (domVerifyState.stillNeedsEmail) {
        return { success: false, error: "Registration submitted but email verification incomplete.", pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
      }
      if (domVerifyState.stillNeedsPhone) {
        return { success: false, error: "Registration submitted but phone verification incomplete.", pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
      }
      return { success: false, error: "Verification page present but status unclear. " + finalText.substring(0, 200), pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
    }

    if (finalLower.includes("error") || finalLower.includes("failed") || finalLower.includes("invalid")) {
      return { success: false, error: "Registration failed: " + finalText.substring(0, 200), pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
    }

    return { success: false, error: "Registration status unclear: " + finalText.substring(0, 200), pageContent: finalText.substring(0, 500), smsCost: totalSmsCost };
  } catch (err: any) {
    if (keepBrowserOpen) {
      try { if (remoteBrowser) await remoteBrowser.close(); else if (context) await context.close(); } catch {}
    }
    return { success: false, error: err.message, smsCost: totalSmsCost };
  } finally {
    if (!keepBrowserOpen) {
      try {
        if (remoteBrowser) {
          await remoteBrowser.close();
        } else if (context) {
          await context.close();
        }
      } catch {}
    }
  }
}

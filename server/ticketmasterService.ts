import { chromium, type Browser, type Page } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { orderSMSNumber, pollForSMSCode, cancelSMSOrder } from "./smspoolService";

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

    if (result.error?.includes("bot detection") || result.error?.includes("blocked") || result.error?.includes("Access blocked") || result.error?.includes("server error") || result.error?.includes("form did not load") || result.error?.includes("cooldown") || result.error?.includes("no_peers") || result.error?.includes("Could not fill password") || result.error?.includes("Forbidden action") || result.error?.includes("robots.txt") || result.error?.includes("phone verification incomplete") || result.error?.includes("email verification incomplete") || result.error?.includes("status unclear")) {
      console.log(`[TM-Playwright] Retryable error on attempt ${attempt + 1}: ${result.error?.substring(0, 120)}`);
      continue;
    }

    return result;
  }

  return { success: false, error: "Failed after multiple retries (bot detection or crashes)" };
}

async function handlePhoneVerification(
  page: Page,
  onStatusUpdate: (status: string) => void
): Promise<{ success: boolean; error?: string }> {
  let smsOrderId: string | null = null;

  try {
    const smsOrder = await orderSMSNumber(1, "Ticketmaster");
    if (!smsOrder.success || !smsOrder.number || !smsOrder.orderId) {
      return { success: false, error: `SMSPool order failed: ${smsOrder.error}` };
    }

    smsOrderId = smsOrder.orderId;
    let phoneNumber = String(smsOrder.number);
    if (!phoneNumber.startsWith("+")) {
      phoneNumber = phoneNumber.startsWith("1") ? `+${phoneNumber}` : `+1${phoneNumber}`;
    }
    console.log(`[TM-Playwright] Got SMS number: ${phoneNumber} (order: ${smsOrderId})`);

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
              var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
              if (nativeSet && nativeSet.set) nativeSet.set.call(els[i], number);
              else els[i].value = number;
              els[i].dispatchEvent(new Event('input', { bubbles: true }));
              els[i].dispatchEvent(new Event('change', { bubbles: true }));
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
      console.log("[TM-Playwright] Could not find phone input field");
      await cancelSMSOrder(smsOrderId);
      return { success: false, error: "Phone input field not found on page" };
    }

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
    console.log("[TM-Playwright] Polling SMSPool for phone verification code...");
    const smsCode = await pollForSMSCode(smsOrderId, 60, 3000);

    if (!smsCode) {
      console.log("[TM-Playwright] No SMS code received from SMSPool");
      await cancelSMSOrder(smsOrderId);
      return { success: false, error: "Timed out waiting for SMS verification code" };
    }

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
            var nativeSet2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (nativeSet2 && nativeSet2.set) nativeSet2.set.call(els[k], code);
            else els[k].value = code;
            els[k].dispatchEvent(new Event('input', { bubbles: true }));
            els[k].dispatchEvent(new Event('change', { bubbles: true }));
            els[k].dispatchEvent(new Event('blur', { bubbles: true }));
            return 'single-input:' + singleSelectors[s];
          }
        }
      }
      return 'no-input-found';
    })("${smsCode}", ${JSON.stringify(codeDigits)})`);
    console.log(`[TM-Playwright] Phone code entry result: ${phoneCodeEntered}`);

    await page.waitForTimeout(1000);

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

    if (phoneVerifyState.stillNeedsPhone && smsOrderId) {
      await cancelSMSOrder(smsOrderId);
    }
    return { success: !phoneVerifyState.stillNeedsPhone };
  } catch (err: any) {
    console.log("[TM-Playwright] Phone verification error:", err.message);
    if (smsOrderId) {
      await cancelSMSOrder(smsOrderId);
    }
    return { success: false, error: err.message };
  }
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
      await page.route('**/t.contentsquare.net/**', (route: any) => route.abort());
      await page.route('**/*.contentsquare.net/**', (route: any) => route.abort());
      await page.route('**/*uxa.js*', (route: any) => route.abort());
      console.log("[TM-Playwright] Blocked ContentSquare scripts");
    } catch (e: any) {
      console.log("[TM-Playwright] Could not block ContentSquare:", e.message);
    }

    console.log("[TM-Playwright] Navigating to TM create_account...");
    try {
      await page.goto("https://www.ticketmaster.com/member/create_account", { waitUntil: "domcontentloaded", timeout: 120000 });
    } catch (navErr: any) {
      if (navErr.message && (navErr.message.includes("robots.txt") || navErr.message.includes("brob") || navErr.message.includes("restricted"))) {
        console.log("[TM-Playwright] robots.txt restriction, navigating directly to auth URL...");
        await page.goto("https://auth.ticketmaster.com/as/authorization.oauth2?client_id=8bf7204a7e97.web.ticketmaster.us&response_type=code&scope=openid%20profile%20phone%20email%20tm&redirect_uri=https://identity.ticketmaster.com/exchange&visualPresets=tm&lang=en-us&placementId=tmolMyAccount&showHeader=true&hideLeftPanel=false&integratorId=prd116.tmol&intSiteToken=tm-us", { waitUntil: "domcontentloaded", timeout: 120000 });
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
    console.log("[TM-Playwright] Attempting password fill with keyboard method...");

    try {
      const pwSelector = '#password-input, input[type="password"], input[name="password"]';
      const pwEl = page.locator(pwSelector).first();
      if (await pwEl.isVisible({ timeout: 5000 })) {
        await pwEl.click({ timeout: 3000 });
        await page.waitForTimeout(300);
        await pwEl.pressSequentially(password, { delay: 25 + Math.floor(Math.random() * 40) });
        await page.waitForTimeout(200);
        const val = await pwEl.inputValue();
        if (val && val.length > 0) {
          pwFilled = true;
          console.log("[TM-Playwright] Password filled via keyboard pressSequentially");
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
          await page.waitForTimeout(200);
          await page.keyboard.type(password, { delay: 30 + Math.floor(Math.random() * 40) });
          await page.waitForTimeout(200);
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
      console.log("[TM-Playwright] Trying clean iframe setter method...");
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
        console.log(`[TM-Playwright] Iframe setter failed: ${e.message.substring(0, 100)}`);
      }
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
    await page.waitForTimeout(8000);

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

    const needsCode = pageText.toLowerCase().includes("code") ||
                      pageText.toLowerCase().includes("verify") ||
                      pageText.toLowerCase().includes("confirmation") ||
                      pageText.toLowerCase().includes("check your email");

    if (needsCode) {
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

      const codeDigits = code.split('');
      const codeEntered = await page.evaluate(`((code, digits) => {
        var inputs = document.querySelectorAll('input[maxlength="1"], input[data-index]');
        var visibleDigitInputs = [];
        for (var i = 0; i < inputs.length; i++) {
          var rect = inputs[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) visibleDigitInputs.push(inputs[i]);
        }

        if (visibleDigitInputs.length >= digits.length) {
          for (var j = 0; j < digits.length; j++) {
            var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            if (nativeSet && nativeSet.set) nativeSet.set.call(visibleDigitInputs[j], digits[j]);
            else visibleDigitInputs[j].value = digits[j];
            visibleDigitInputs[j].dispatchEvent(new Event('input', { bubbles: true }));
            visibleDigitInputs[j].dispatchEvent(new Event('change', { bubbles: true }));
          }
          return 'individual-digits:' + visibleDigitInputs.length;
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
              var nativeSet2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                               Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (nativeSet2 && nativeSet2.set) nativeSet2.set.call(els[k], code);
              else els[k].value = code;
              els[k].dispatchEvent(new Event('input', { bubbles: true }));
              els[k].dispatchEvent(new Event('change', { bubbles: true }));
              els[k].dispatchEvent(new Event('blur', { bubbles: true }));
              return 'single-input:' + singleSelectors[s];
            }
          }
        }
        return 'no-input-found';
      })("${code}", ${JSON.stringify(codeDigits)})`);
      console.log(`[TM-Playwright] Code entry result: ${codeEntered}`);

      await page.waitForTimeout(1000);

      let verifyClicked = await clickButton(page, "verify");
      if (!verifyClicked) verifyClicked = await clickButton(page, "confirm");
      if (!verifyClicked) verifyClicked = await clickButton(page, "submit");
      if (!verifyClicked) verifyClicked = await clickButton(page, "continue");
      if (!verifyClicked) verifyClicked = await clickButton(page);
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
      console.log("[TM-Playwright] Phone verification required, starting SMSPool flow...");
      const phoneResult = await handlePhoneVerification(page, onStatusUpdate);
      if (phoneResult.success) {
        console.log("[TM-Playwright] Phone verification completed successfully!");
      } else {
        console.log("[TM-Playwright] Phone verification failed:", phoneResult.error);
        console.log("[TM-Playwright] Account is email-verified but phone-unverified, marking as success");
      }

      await page.waitForTimeout(3000);
      pageText = await getPageText(page);
    }

    const currentUrl = page.url();
    const finalText = pageText;
    const finalLower = finalText.toLowerCase();

    console.log("[TM-Playwright] Final URL:", currentUrl);
    console.log("[TM-Playwright] Final text (first 300):", finalText.substring(0, 300));

    const redirectedToAccount = currentUrl.includes("ticketmaster.com") && !currentUrl.includes("authorization.oauth2");
    const textIndicatesSuccess = finalLower.includes("account created") ||
                      finalLower.includes("success") ||
                      finalLower.includes("my account") ||
                      finalLower.includes("you're in") ||
                      finalLower.includes("welcome back");
    const verifyPageWithCodeDone = (finalLower.includes("almost there") || finalLower.includes("verify your account")) &&
                      !finalLower.includes("verify my email") &&
                      !finalLower.includes("send code");
    const emailDonePhonePending = (finalLower.includes("almost there") || finalLower.includes("verify your account")) &&
                      !finalLower.includes("verify my email") &&
                      !finalLower.includes("send code") &&
                      finalLower.includes("phone");
    const phoneVerified = finalLower.includes("phone verified");
    const emailVerifiedCheckmark = (finalLower.includes("almost there") || finalLower.includes("verify your account")) &&
                      !finalLower.includes("verify my email");

    const isSuccess = redirectedToAccount || textIndicatesSuccess || verifyPageWithCodeDone || phoneVerified ||
                      (emailVerifiedCheckmark && phoneVerified) ||
                      (emailDonePhonePending && phoneVerified);

    if (isSuccess) {
      return { success: true, pageContent: finalText.substring(0, 500) };
    }

    if (finalLower.includes("almost there") || finalLower.includes("verify your account")) {
      const stillNeedsEmail = finalLower.includes("verify my email") || finalLower.includes("send code");
      const stillNeedsPhone = finalLower.includes("add my phone") && !finalLower.includes("phone verified");
      if (stillNeedsEmail && stillNeedsPhone) {
        return { success: false, error: "Registration submitted but both email and phone verification incomplete.", pageContent: finalText.substring(0, 500) };
      }
      if (stillNeedsEmail) {
        return { success: false, error: "Registration submitted but email verification incomplete.", pageContent: finalText.substring(0, 500) };
      }
      if (stillNeedsPhone) {
        return { success: false, error: "Registration submitted but phone verification incomplete.", pageContent: finalText.substring(0, 500) };
      }
    }

    if (finalLower.includes("error") || finalLower.includes("failed") || finalLower.includes("invalid")) {
      return { success: false, error: "Registration failed: " + finalText.substring(0, 200), pageContent: finalText.substring(0, 500) };
    }

    return { success: false, error: "Registration status unclear: " + finalText.substring(0, 200), pageContent: finalText.substring(0, 500) };
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

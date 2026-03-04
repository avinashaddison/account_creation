import { chromium, type Browser, type Page } from "playwright";
import { execSync } from "child_process";

let browserInstance: Browser | null = null;
let launching = false;
let browserInstalled = false;

const UEFA_AUTH_BASE = "https://idp-production.uefa.com/as/authorize";
const UEFA_CLIENT_ID = "998b963a-5d91-4956-a062-33d809aaf15b";
const UEFA_REDIRECT = "https://www.uefa.com/";

function buildUefaAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: UEFA_CLIENT_ID,
    redirect_uri: UEFA_REDIRECT,
    response_type: "code",
    scope: "openid address email offline_access idp_profile idp_favourites p1:update:user:apps",
    state: Math.random().toString(36).substring(2, 15),
    code_challenge: "0qIkmbOYIfO8OkyTl4v59SVmq_mm7RWghHjTt71x3KQ",
    code_challenge_method: "S256",
    ui_locales: "en",
    screen: "login",
    regPlatform: "Desktop",
    regURL: UEFA_REDIRECT,
  });
  return `${UEFA_AUTH_BASE}?${params.toString()}`;
}

function generateDOB(): { day: string; month: string; year: string } {
  const year = 1980 + Math.floor(Math.random() * 20);
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return {
    day: day.toString(),
    month: month.toString(),
    year: year.toString(),
  };
}

async function ensureBrowserInstalled(): Promise<void> {
  if (browserInstalled) return;
  try {
    const execPath = chromium.executablePath();
    const fs = await import("fs");
    if (fs.existsSync(execPath)) {
      browserInstalled = true;
      return;
    }
  } catch {}
  console.log("[UEFA] Chromium not found, installing...");
  execSync("npx playwright install chromium", { stdio: "inherit", timeout: 120000 });
  browserInstalled = true;
}

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  if (launching) {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (browserInstance && browserInstance.isConnected()) return browserInstance;
    }
  }
  launching = true;
  try {
    await ensureBrowserInstalled();
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-gpu", "--disable-software-rasterizer", "--no-zygote",
        "--js-flags=--max-old-space-size=256",
      ],
    });
    browserInstance.on("disconnected", () => { browserInstance = null; });
    return browserInstance;
  } finally {
    launching = false;
  }
}

async function fillInput(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(`((sel, val) => {
    var el = document.querySelector(sel);
    if (!el) return false;
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  })("${selector}", "${value.replace(/"/g, '\\"')}")`) as Promise<boolean>;
}

async function checkCheckbox(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(`((sel) => {
    var el = document.querySelector(sel);
    if (!el) return false;
    if (!el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('click', { bubbles: true }));
    }
    return true;
  })("${selector}")`) as Promise<boolean>;
}

export async function uefaFullRegistrationFlow(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>
): Promise<{ success: boolean; error?: string }> {
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[UEFA] Retry attempt ${attempt + 1}/${maxRetries}...`);
      if (browserInstance) {
        try { await browserInstance.close(); } catch {}
        browserInstance = null;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    const result = await doUefaRegistration(email, firstName, lastName, password, onStatusUpdate, getVerificationCode);
    if (result.error?.includes("browser has been closed") || result.error?.includes("crashed")) {
      if (browserInstance) { try { await browserInstance.close(); } catch {} browserInstance = null; }
      continue;
    }
    return result;
  }
  return { success: false, error: "Browser crashed after multiple retries" };
}

async function doUefaRegistration(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>
): Promise<{ success: boolean; error?: string }> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err: any) {
    return { success: false, error: `Failed to launch browser: ${err.message}` };
  }

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  await page.route("**/*", (route) => {
    const resourceType = route.request().resourceType();
    if (["image", "media", "font"].includes(resourceType)) return route.abort();
    return route.continue();
  });

  try {
    onStatusUpdate("registering");
    console.log("[UEFA] Navigating to UEFA main page...");
    await page.goto("https://www.uefa.com/", { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(6000);

    for (const frame of page.frames()) {
      try {
        const btns = await frame.$$('button, a');
        for (const btn of btns) {
          const text = (await btn.textContent() || '').trim().toLowerCase();
          if (text.includes('accept') || text.includes('i accept')) {
            await btn.click();
            await page.waitForTimeout(2000);
            break;
          }
        }
      } catch {}
    }

    console.log("[UEFA] Looking for 'Log in' button...");
    const loginBtn = await page.$('pk-button:has-text("Log in"), button:has-text("Log in")');
    if (!loginBtn) {
      const loginFallback = await page.$('text=Log in');
      if (loginFallback) {
        await loginFallback.click();
      } else {
        await context.close();
        return { success: false, error: "Could not find Log in button on UEFA.com" };
      }
    } else {
      await loginBtn.click();
    }

    await page.waitForTimeout(8000);
    console.log("[UEFA] Auth page URL:", page.url());

    console.log("[UEFA] Looking for 'Create your UEFA account' button...");
    const createBtn = await page.$('button:has-text("Create your UEFA account"), button:has-text("Create")');
    if (!createBtn) {
      await context.close();
      return { success: false, error: "Could not find 'Create your UEFA account' button" };
    }
    await createBtn.click();
    await page.waitForTimeout(5000);

    console.log("[UEFA] Registration form should be visible...");

    const emailField = await page.$('#email');
    if (!emailField) {
      await context.close();
      return { success: false, error: "Registration form did not load (no email field)" };
    }

    console.log("[UEFA] Filling registration form...");
    const emailFilled = await fillInput(page, '#email', email);
    console.log(`[UEFA] Email filled: ${emailFilled}`);

    const pwFilled = await fillInput(page, '#password', password);
    console.log(`[UEFA] Password filled: ${pwFilled}`);

    const fnFilled = await fillInput(page, '#givenName', firstName);
    console.log(`[UEFA] First name filled: ${fnFilled}`);

    const lnFilled = await fillInput(page, '#familyName', lastName);
    console.log(`[UEFA] Last name filled: ${lnFilled}`);

    const dob = generateDOB();
    const dayFilled = await page.evaluate(`((val) => {
      var el = document.getElementById('profile.birthDay');
      if (!el) return false;
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })("${dob.day}")`) as boolean;
    const monthFilled = await page.evaluate(`((val) => {
      var el = document.getElementById('profile.birthMonth');
      if (!el) return false;
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })("${dob.month}")`) as boolean;
    const yearFilled = await page.evaluate(`((val) => {
      var el = document.getElementById('profile.birthYear');
      if (!el) return false;
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (setter && setter.set) setter.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })("${dob.year}")`) as boolean;
    console.log(`[UEFA] DOB filled: ${dayFilled}/${monthFilled}/${yearFilled} (${dob.day}/${dob.month}/${dob.year})`);

    const tandcChecked = await checkCheckbox(page, '#tandc');
    console.log(`[UEFA] Terms checked: ${tandcChecked}`);

    if (!emailFilled || !pwFilled) {
      await context.close();
      return { success: false, error: `Critical form fill failed - email:${emailFilled} pw:${pwFilled}` };
    }

    await page.waitForTimeout(1000);

    let apiResponse: { status: number; body: string } | null = null;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/as/') || url.includes('/api/') || url.includes('register') || url.includes('signup') || url.includes('account')) {
        try {
          const status = response.status();
          const body = await response.text().catch(() => '');
          if (body.length > 0 && body.length < 5000) {
            console.log(`[UEFA] Response ${status} from ${url.substring(0, 80)}: ${body.substring(0, 200)}`);
            if (url.includes('register') || url.includes('signup') || url.includes('account')) {
              apiResponse = { status, body: body.substring(0, 1000) };
            }
          }
        } catch {}
      }
    });

    console.log("[UEFA] Submitting form...");
    const submitClicked = await page.evaluate(`(() => {
      var btn = null;
      var allBtns = document.querySelectorAll('button');
      for (var i = 0; i < allBtns.length; i++) {
        var text = (allBtns[i].textContent || '').trim().toLowerCase();
        if (text.includes('create account')) {
          btn = allBtns[i];
          break;
        }
      }
      if (!btn) {
        var submits = document.querySelectorAll('button[type="submit"], input[type="submit"]');
        for (var j = 0; j < submits.length; j++) {
          var rect = submits[j].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) { btn = submits[j]; break; }
        }
      }
      if (btn) { btn.click(); return true; }
      return false;
    })()`);

    console.log(`[UEFA] Submit clicked: ${submitClicked}`);

    if (!submitClicked) {
      try {
        await page.click('button:has-text("Create account")');
      } catch {
        try {
          await page.click('button[type="submit"]');
        } catch {
          await context.close();
          return { success: false, error: "Could not find submit button" };
        }
      }
    }

    console.log("[UEFA] Waiting for response...");
    await page.waitForTimeout(10000);

    let pageText = "";
    try {
      pageText = await page.evaluate(`document.body.innerText`) as string;
    } catch (e: any) {
      await context.close();
      return { success: false, error: `Post-submit error: ${e.message}` };
    }

    console.log("[UEFA] Page text after submit (first 500):", pageText.substring(0, 500));
    console.log("[UEFA] URL after submit:", page.url());

    if (pageText.toLowerCase().includes("already exists") || pageText.toLowerCase().includes("already registered")) {
      await context.close();
      return { success: false, error: "Account already exists for this email" };
    }

    if (pageText.toLowerCase().includes("something went wrong")) {
      await context.close();
      return { success: false, error: "UEFA returned 'Something went wrong'. The registration form may have validation errors." };
    }

    const errorMessages = await page.evaluate(`(() => {
      var errors = [];
      var errorEls = document.querySelectorAll('.error-message, .field-error, [class*="error"], [role="alert"], .form-error, .validation-error');
      for (var i = 0; i < errorEls.length; i++) {
        var text = errorEls[i].textContent?.trim();
        if (text && text.length > 0 && text.length < 200) {
          errors.push(text);
        }
      }
      return errors;
    })()`) as string[];

    if (errorMessages.length > 0) {
      console.log("[UEFA] Form errors:", errorMessages);
      await context.close();
      return { success: false, error: `Form errors: ${errorMessages.join("; ")}` };
    }

    const lowerText = pageText.toLowerCase();
    const needsVerification = lowerText.includes("verification") || lowerText.includes("verify") ||
                               lowerText.includes("code") || lowerText.includes("confirm");

    if (needsVerification) {
      console.log("[UEFA] Verification needed, waiting for code...");
      onStatusUpdate("waiting_code");

      let code: string | null = null;
      try {
        code = await Promise.race([
          getVerificationCode(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 150000)),
        ]);
      } catch (e: any) {
        console.log("[UEFA] Error getting verification code:", e.message);
      }

      if (!code) {
        await context.close();
        return { success: false, error: "Timed out waiting for verification email" };
      }

      onStatusUpdate("verifying");
      console.log(`[UEFA] Entering verification code: ${code}`);

      const codeInput = await page.$('input[type="text"], input[name="code"], input[id*="code"]');
      if (codeInput) {
        await fillInput(page, 'input[type="text"]', code);
      }
      await page.waitForTimeout(1000);

      try {
        await page.click('button[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Confirm")');
      } catch {
        await page.evaluate(`(() => {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            var t = btns[i].textContent?.toLowerCase() || '';
            if (t.includes('verify') || t.includes('submit') || t.includes('confirm')) {
              btns[i].click(); return;
            }
          }
        })()`);
      }

      await page.waitForTimeout(8000);
    }

    const redirected = page.url().includes("uefa.com") && !page.url().includes("idp-production");
    const finalText = await page.evaluate(`document.body.innerText`) as string;
    const finalLower = finalText.toLowerCase();
    const hasError = finalLower.includes("something went wrong") || finalLower.includes("error") ||
                     finalLower.includes("invalid") || finalLower.includes("failed");
    const isSuccess = !hasError && (redirected || finalLower.includes("welcome") ||
                      finalLower.includes("account created") || finalLower.includes("success") ||
                      finalLower.includes("verify") || finalLower.includes("confirmation"));

    console.log("[UEFA] Final URL:", page.url());
    console.log("[UEFA] Final text (first 200):", finalText.substring(0, 200));
    console.log("[UEFA] Success:", isSuccess);

    await context.close();

    if (isSuccess) {
      return { success: true };
    }

    return { success: false, error: `Registration may have failed. Page: ${finalText.substring(0, 200)}` };

  } catch (err: any) {
    console.log("[UEFA] Error:", err.message);
    try { await context.close(); } catch {}
    return { success: false, error: err.message };
  }
}

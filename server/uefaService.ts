import { chromium, type Browser, type Page } from "playwright";
import { execSync } from "child_process";

let browserInstance: Browser | null = null;
let launching = false;
let browserInstalled = false;

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

    let launchFn = chromium.launch.bind(chromium);
    try {
      const { chromium: stealthChromium } = await import("playwright-extra");
      const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
      stealthChromium.use(StealthPlugin());
      launchFn = stealthChromium.launch.bind(stealthChromium);
      console.log("[UEFA] Using stealth plugin");
    } catch (e: any) {
      console.log("[UEFA] Stealth plugin not available, using standard chromium:", e.message);
    }

    browserInstance = await launchFn({
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-gpu", "--disable-software-rasterizer", "--no-zygote",
        "--js-flags=--max-old-space-size=256",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    browserInstance.on("disconnected", () => { browserInstance = null; });
    return browserInstance;
  } finally {
    launching = false;
  }
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
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "Europe/London",
    permissions: ["geolocation"],
    geolocation: { longitude: -0.1276, latitude: 51.5074 },
  });

  await context.addInitScript(`(() => {
    Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
    Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US', 'en']; } });
    Object.defineProperty(navigator, 'plugins', { get: function() { return [1, 2, 3, 4, 5]; } });
    if (window.chrome === undefined) {
      window.chrome = { runtime: {}, loadTimes: function() { return {}; }, csi: function() { return {}; } };
    }
    const origToString = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (this === Function.prototype.toString) return 'function toString() { [native code] }';
      return origToString.call(this);
    };
  })()`);

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  const dob = generateDOB();
  let registrationStepId = "";
  let interceptedSubmit = false;
  let submitResponseBody = "";

  page.on('response', async (response) => {
    if (response.request().method() === 'POST' && response.url().includes('davinci')) {
      try {
        const body = await response.text().catch(() => '');
        if (body) {
          console.log(`[UEFA-RES] ${response.status()}: ${body.substring(0, 300)}`);
          try {
            const parsed = JSON.parse(body);
            if (parsed.id && parsed.capabilityName === 'customHTMLTemplate') {
              const screenProps = parsed.screen?.properties;
              if (screenProps?.formFieldsList) {
                const fields = screenProps.formFieldsList.value || [];
                const hasEmail = fields.some((f: any) => f.propertyName === 'email' || f.propertyName === 'properties.email');
                const hasPassword = fields.some((f: any) => f.propertyName === 'password' || f.propertyName === 'properties.password');
                if (hasEmail && hasPassword) {
                  registrationStepId = parsed.id;
                  console.log(`[UEFA] Detected registration step ID: ${registrationStepId}`);
                }
              }
            }
          } catch {}
        }
      } catch {}
    }
  });

  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('davinci')) {
      const postData = request.postData();
      if (postData) {
        try {
          const body = JSON.parse(postData);
          const paramKeys = body.parameters ? Object.keys(body.parameters) : [];
          const logParams: Record<string, any> = {};
          for (const key of paramKeys) {
            if (key === 'riskSDK') logParams[key] = '(payload)';
            else if (key === 'password') logParams[key] = '***';
            else logParams[key] = body.parameters[key];
          }
          console.log(`[UEFA-REQ] POST id=${body.id} params=${JSON.stringify(logParams)}`);
        } catch {
          console.log(`[UEFA-REQ] POST: ${postData.substring(0, 300)}`);
        }
      }
    }
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
          if (text.includes('accept') || text.includes('i accept') || text.includes('agree')) {
            await btn.click();
            await page.waitForTimeout(2000);
            break;
          }
        }
      } catch {}
    }

    console.log("[UEFA] Looking for 'Log in' button...");
    let loginClicked = false;
    for (const selector of ['pk-button:has-text("Log in")', 'text=Log in', 'button:has-text("Log in")']) {
      try {
        await page.click(selector);
        loginClicked = true;
        break;
      } catch {}
    }
    if (!loginClicked) {
      await context.close();
      return { success: false, error: "Could not find Log in button on UEFA.com" };
    }

    await page.waitForTimeout(8000);
    console.log("[UEFA] Auth page URL:", page.url());

    await page.waitForTimeout(3000);

    console.log("[UEFA] Looking for 'Create your UEFA account' button...");
    let createClicked = false;
    for (const selector of ['button:has-text("Create your UEFA account")', 'button:has-text("Create")']) {
      try {
        await page.click(selector);
        createClicked = true;
        break;
      } catch {}
    }
    if (!createClicked) {
      await context.close();
      return { success: false, error: "Could not find 'Create your UEFA account' button" };
    }
    await page.waitForTimeout(5000);

    const emailField = await page.$('#email');
    if (!emailField) {
      await context.close();
      return { success: false, error: "Registration form did not load (no email field)" };
    }

    console.log("[UEFA] Registration form loaded.");

    if (!registrationStepId) {
      registrationStepId = "1k5y98i1v1";
      console.log("[UEFA] Using fallback registration step ID:", registrationStepId);
    }

    await page.waitForTimeout(3000);

    console.log("[UEFA] Filling form fields with realistic delays...");

    await page.waitForTimeout(500 + Math.random() * 1000);
    await page.click('#email');
    await page.waitForTimeout(200 + Math.random() * 300);
    await page.keyboard.type(email, { delay: 30 + Math.random() * 50 });
    await page.waitForTimeout(300 + Math.random() * 500);

    await page.click('#password');
    await page.waitForTimeout(200 + Math.random() * 300);
    await page.keyboard.type(password, { delay: 30 + Math.random() * 50 });
    await page.waitForTimeout(300 + Math.random() * 500);

    await page.click('#givenName');
    await page.waitForTimeout(200 + Math.random() * 300);
    await page.keyboard.type(firstName, { delay: 30 + Math.random() * 50 });
    await page.waitForTimeout(300 + Math.random() * 500);

    await page.click('#familyName');
    await page.waitForTimeout(200 + Math.random() * 300);
    await page.keyboard.type(lastName, { delay: 30 + Math.random() * 50 });
    await page.waitForTimeout(300 + Math.random() * 500);

    for (const { id, val } of [
      { id: 'profile.birthDay', val: dob.day },
      { id: 'profile.birthMonth', val: dob.month },
      { id: 'profile.birthYear', val: dob.year },
    ]) {
      try {
        await page.click(`[id="${id}"]`);
        await page.waitForTimeout(150 + Math.random() * 200);
        await page.keyboard.press('Control+a');
        await page.keyboard.type(val, { delay: 40 + Math.random() * 60 });
        await page.waitForTimeout(200 + Math.random() * 300);
      } catch (e) {
        console.log(`[UEFA] Failed to type DOB ${id}:`, (e as Error).message.substring(0, 80));
      }
    }

    console.log(`[UEFA] DOB typed: ${dob.day}/${dob.month}/${dob.year}`);

    await page.waitForTimeout(300 + Math.random() * 500);

    try {
      await page.click('label[for="tandc"]');
      console.log("[UEFA] Terms clicked via label");
    } catch {
      await page.evaluate(`(() => {
        var el = document.getElementById('tandc');
        if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
      })()`);
      console.log("[UEFA] Terms checked via evaluate");
    }

    await page.waitForTimeout(1000 + Math.random() * 1000);

    const formValues = await page.evaluate(`(() => {
      var result = {};
      var fields = ['email', 'password', 'givenName', 'familyName'];
      for (var i = 0; i < fields.length; i++) {
        var el = document.getElementById(fields[i]);
        result[fields[i]] = el ? el.value : 'NOT_FOUND';
      }
      var dobFields = ['profile.birthDay', 'profile.birthMonth', 'profile.birthYear'];
      for (var j = 0; j < dobFields.length; j++) {
        var el2 = document.getElementById(dobFields[j]);
        result[dobFields[j]] = el2 ? el2.value : 'NOT_FOUND';
      }
      var tandc = document.getElementById('tandc');
      result['tandc'] = tandc ? tandc.checked : 'NOT_FOUND';
      return result;
    })()`) as Record<string, any>;
    console.log("[UEFA] Form values before submit:", JSON.stringify(formValues));

    console.log("[UEFA] Clicking submit button...");

    const submitResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('davinci') && resp.request().method() === 'POST',
      { timeout: 30000 }
    ).catch(() => null);

    try {
      await page.click('button:has-text("Create account")', { timeout: 5000 });
      console.log("[UEFA] Submit clicked");
    } catch {
      try {
        await page.click('button[type="submit"]', { timeout: 5000 });
        console.log("[UEFA] Submit clicked via type=submit");
      } catch {
        await page.evaluate(`(() => {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').toLowerCase().includes('create account')) {
              btns[i].click();
              return true;
            }
          }
          return false;
        })()`);
        console.log("[UEFA] Submit clicked via evaluate");
      }
    }

    console.log("[UEFA] Waiting for DaVinci response...");
    const submitResponse = await submitResponsePromise;
    if (submitResponse) {
      try {
        submitResponseBody = await submitResponse.text();
        console.log(`[UEFA] Submit response status: ${submitResponse.status()}`);
        try {
          const parsed = JSON.parse(submitResponseBody);
          console.log(`[UEFA] Response capability: ${parsed.capabilityName}, id: ${parsed.id}`);
          if (parsed.screen?.properties?.messageTitle?.value) {
            console.log("[UEFA] messageTitle:", parsed.screen.properties.messageTitle.value);
          }
          if (parsed.screen?.properties?.message?.value) {
            console.log("[UEFA] message:", parsed.screen.properties.message.value);
          }
          if (parsed.screen?.properties?.customHTML?.value) {
            console.log("[UEFA] customHTML (first 500):", parsed.screen.properties.customHTML.value.substring(0, 500));
          }
          if (parsed.screen?.properties?.formFieldsList?.value) {
            const fieldNames = parsed.screen.properties.formFieldsList.value.map((f: any) => f.propertyName || f.displayName);
            console.log("[UEFA] Next form fields:", JSON.stringify(fieldNames));
          }
          const errorKeys = Object.keys(parsed).filter(k => k.toLowerCase().includes('error'));
          if (errorKeys.length > 0) {
            for (const k of errorKeys) {
              console.log(`[UEFA] ${k}:`, JSON.stringify(parsed[k]).substring(0, 300));
            }
          }
        } catch {}
      } catch {}
    }

    await page.waitForTimeout(5000);

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
      return { success: false, error: "UEFA returned 'Something went wrong' - PingOne risk signal may be blocking headless browser" };
    }

    const lowerText = pageText.toLowerCase();
    const needsVerification = lowerText.includes("verification") || lowerText.includes("verify") ||
                               lowerText.includes("code") || lowerText.includes("confirm your email");

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
        await codeInput.click();
        await page.waitForTimeout(200);
        await codeInput.fill(code);
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
    const hasError = finalLower.includes("something went wrong") || finalLower.includes("invalid") || finalLower.includes("failed");
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

import { chromium, type Browser, type Page } from "playwright";
import { execSync } from "child_process";

let browserInstance: Browser | null = null;
let launching = false;
let browserInstalled = false;

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
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (browserInstance && browserInstance.isConnected()) return browserInstance;
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
        "--single-process",
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

async function dismissOverlays(page: Page): Promise<void> {
  try {
    const cookieSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("Accept Cookies")',
      'button:has-text("I Accept")',
      'button:has-text("OK")',
      'button:has-text("Got it")',
      'button:has-text("Agree")',
      '[id*="cookie"] button',
      '[class*="cookie"] button',
      '[id*="consent"] button',
      '[class*="consent"] button',
      '[id*="onetrust"] button#onetrust-accept-btn-handler',
      '.onetrust-close-btn-handler',
    ];

    for (const sel of cookieSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click({ timeout: 2000 });
          console.log(`[Playwright] Dismissed overlay with selector: ${sel}`);
          await page.waitForTimeout(1000);
          break;
        }
      } catch {}
    }
  } catch {}
}

async function waitForRegistrationForm(page: Page): Promise<void> {
  console.log("[Playwright] Waiting for registration form to appear...");

  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForTimeout(3000);

  await dismissOverlays(page);

  for (let attempt = 0; attempt < 6; attempt++) {
    const emailInputs = page.locator('input[data-gigya-name="email"]');
    const count = await emailInputs.count();
    console.log(`[Playwright] Found ${count} email input(s), checking visibility...`);

    for (let i = 0; i < count; i++) {
      try {
        const input = emailInputs.nth(i);
        const isVisible = await input.isVisible({ timeout: 1000 });
        if (isVisible) {
          console.log(`[Playwright] Email input #${i} is visible`);
          return;
        }
      } catch {}
    }

    const allInputs = page.locator('input[name="email"], input[type="email"]');
    const allCount = await allInputs.count();
    for (let i = 0; i < allCount; i++) {
      try {
        const input = allInputs.nth(i);
        const isVisible = await input.isVisible({ timeout: 1000 });
        if (isVisible) {
          console.log(`[Playwright] Fallback email input #${i} is visible`);
          return;
        }
      } catch {}
    }

    console.log(`[Playwright] No visible email input yet, attempt ${attempt + 1}/6, waiting...`);
    await dismissOverlays(page);
    await page.waitForTimeout(3000);
  }

  const html = await page.evaluate(() => document.body.innerHTML.substring(0, 2000));
  console.log("[Playwright] Page HTML snippet:", html);
  throw new Error("Registration form did not become visible after waiting");
}

function getVisibleInput(page: Page, gigyaName: string) {
  return page.locator(`input[data-gigya-name="${gigyaName}"]`).and(page.locator(':visible')).first();
}

function getVisibleSelect(page: Page, gigyaName: string) {
  return page.locator(`select[data-gigya-name="${gigyaName}"]`).and(page.locator(':visible')).first();
}

export async function fullRegistrationFlow(
  email: string,
  firstName: string,
  lastName: string,
  password: string,
  country: string,
  language: string,
  onStatusUpdate: (status: string) => void,
  getVerificationCode: () => Promise<string | null>
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

  try {
    onStatusUpdate("registering");
    console.log("[Playwright] Navigating to LA28 registration...");
    await page.goto("https://la28id.la28.org/register/", { waitUntil: "domcontentloaded", timeout: 60000 });

    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch {
      console.log("[Playwright] Network idle timeout, continuing anyway...");
    }

    await waitForRegistrationForm(page);

    console.log("[Playwright] Filling form fields...");
    const emailInput = getVisibleInput(page, "email");
    await emailInput.click({ timeout: 5000 });
    await emailInput.fill(email);
    console.log("[Playwright] Filled email");

    const firstNameInput = getVisibleInput(page, "firstName");
    await firstNameInput.click({ timeout: 5000 });
    await firstNameInput.fill(firstName);
    console.log("[Playwright] Filled firstName");

    const lastNameInput = getVisibleInput(page, "lastName");
    await lastNameInput.click({ timeout: 5000 });
    await lastNameInput.fill(lastName);
    console.log("[Playwright] Filled lastName");

    const passwordInput = getVisibleInput(page, "password");
    await passwordInput.click({ timeout: 5000 });
    await passwordInput.fill(password);
    console.log("[Playwright] Filled password");

    console.log("[Playwright] Selecting country...");
    try {
      const residenceSelect = getVisibleSelect(page, "profile.country");
      const hasResidence = await residenceSelect.count();
      if (hasResidence > 0) {
        const options = await residenceSelect.evaluate((sel) =>
          Array.from((sel as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.textContent?.trim() || "" }))
        );
        const countryOpt = options.find((o) => o.text.toLowerCase().includes(country.toLowerCase()));
        if (countryOpt) {
          await residenceSelect.selectOption(countryOpt.value);
          console.log(`[Playwright] Selected country: ${countryOpt.text}`);
        }
      }
    } catch (e: any) {
      console.log(`[Playwright] Country select issue: ${e.message}`);
      try {
        const fallbackSelect = page.locator("select:visible").first();
        const options = await fallbackSelect.evaluate((sel) =>
          Array.from((sel as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.textContent?.trim() || "" }))
        );
        const countryOpt = options.find((o) => o.text.toLowerCase().includes(country.toLowerCase()));
        if (countryOpt) await fallbackSelect.selectOption(countryOpt.value);
      } catch {}
    }

    console.log("[Playwright] Selecting language...");
    try {
      const langSelect = getVisibleSelect(page, "data.personalization.siteLanguage");
      const hasLang = await langSelect.count();
      if (hasLang > 0) {
        const langOpts = await langSelect.evaluate((sel) =>
          Array.from((sel as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.textContent?.trim() || "" }))
        );
        const langOpt = langOpts.find((o) => o.text.toLowerCase().includes(language.toLowerCase()));
        if (langOpt) await langSelect.selectOption(langOpt.value);
      }
    } catch (e: any) {
      console.log(`[Playwright] Language select issue: ${e.message}`);
    }

    console.log("[Playwright] Checking checkboxes...");
    const checkboxNames = [
      "preferences.confirmationAge.isConsentGranted",
      "preferences.terms.LA2028siteTerms.isConsentGranted",
      "subscriptions.la2028EmailMarketingCommunications.email.isSubscribed",
    ];
    for (const name of checkboxNames) {
      try {
        const cb = page.locator(`input[data-gigya-name="${name}"]`).and(page.locator(':visible')).first();
        if (await cb.count() > 0 && !(await cb.isChecked())) {
          await cb.check({ force: true });
        }
      } catch {}
    }

    const fallbackCheckboxes = page.locator('input[type="checkbox"]:visible');
    const cbCount = await fallbackCheckboxes.count();
    for (let i = 0; i < cbCount; i++) {
      try {
        if (!(await fallbackCheckboxes.nth(i).isChecked())) {
          await fallbackCheckboxes.nth(i).check({ force: true });
        }
      } catch {}
    }

    console.log("[Playwright] Submitting form...");
    const submitBtn = page.locator('input[type="submit"]:visible').first();
    await submitBtn.click();

    console.log("[Playwright] Waiting for response...");
    await page.waitForTimeout(5000);

    const pageText = await page.evaluate(() => document.body.innerText);

    if (pageText.includes("already exists")) {
      await context.close();
      return { success: false, error: "Account already exists for this email" };
    }

    const formErrors = await page.evaluate(() => {
      const errorEls = document.querySelectorAll('.gigya-error-msg-active, .gigya-error-msg');
      return Array.from(errorEls)
        .filter((el) => (el as HTMLElement).offsetParent !== null && el.textContent?.trim())
        .map((el) => el.textContent?.trim() || "");
    });
    if (formErrors.length > 0 && formErrors.some(e => e.length > 0)) {
      const realErrors = formErrors.filter(e => e.length > 0);
      if (realErrors.length > 0) {
        await context.close();
        return { success: false, error: realErrors.join("; ") };
      }
    }

    if (!pageText.includes("Enter the code") && !pageText.includes("code") && !pageText.includes("Code") && !pageText.includes("verify") && !pageText.includes("Verify")) {
      await context.close();
      return { success: false, error: "Unexpected page state after submit", pageContent: pageText.substring(0, 500) };
    }

    console.log("[Playwright] Verification code needed. Waiting for code from email...");
    onStatusUpdate("waiting_code");

    const code = await getVerificationCode();
    if (!code) {
      await context.close();
      return { success: false, error: "Timed out waiting for verification email" };
    }

    onStatusUpdate("verifying");
    console.log(`[Playwright] Entering verification code: ${code}`);

    const codeInput = page.locator('input[data-gigya-name="code"], input.gigya-input-text').and(page.locator(':visible')).first();
    await codeInput.waitFor({ state: "visible", timeout: 10000 });
    await codeInput.click();
    await codeInput.fill(code);
    await page.waitForTimeout(500);

    console.log("[Playwright] Clicking Verify...");
    await page.locator('input[type="submit"]:visible').first().click();
    await page.waitForTimeout(8000);

    const finalText = await page.evaluate(() => document.body.innerText);
    console.log("[Playwright] Final page content (first 300):", finalText.substring(0, 300));

    const hasError = finalText.toLowerCase().includes("invalid code") ||
                     finalText.toLowerCase().includes("expired");

    await context.close();

    if (hasError) {
      return { success: false, error: "Verification failed", pageContent: finalText.substring(0, 500) };
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

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
    await page.goto("https://la28id.la28.org/register/", { waitUntil: "networkidle", timeout: 45000 });

    await page.waitForSelector('input[data-gigya-name="email"]', { state: "visible", timeout: 15000 });

    console.log("[Playwright] Filling form fields...");
    await page.locator('input[data-gigya-name="email"]:visible').fill(email);

    await page.waitForSelector('input[data-gigya-name="firstName"]', { state: "visible", timeout: 5000 });
    await page.locator('input[data-gigya-name="firstName"]:visible').fill(firstName);

    await page.waitForSelector('input[data-gigya-name="lastName"]', { state: "visible", timeout: 5000 });
    await page.locator('input[data-gigya-name="lastName"]:visible').fill(lastName);

    await page.waitForSelector('input[data-gigya-name="password"]', { state: "visible", timeout: 5000 });
    await page.locator('input[data-gigya-name="password"]:visible').fill(password);

    console.log("[Playwright] Selecting country...");
    const residenceSelect = page.locator('select[data-gigya-name="profile.country"]:visible');
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
    } else {
      const fallbackSelect = page.locator("select:visible").first();
      const options = await fallbackSelect.evaluate((sel) =>
        Array.from((sel as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.textContent?.trim() || "" }))
      );
      const countryOpt = options.find((o) => o.text.toLowerCase().includes(country.toLowerCase()));
      if (countryOpt) await fallbackSelect.selectOption(countryOpt.value);
    }

    console.log("[Playwright] Selecting language...");
    const langSelect = page.locator('select[data-gigya-name="data.personalization.siteLanguage"]:visible');
    const hasLang = await langSelect.count();
    if (hasLang > 0) {
      const langOpts = await langSelect.evaluate((sel) =>
        Array.from((sel as HTMLSelectElement).options).map((o) => ({ value: o.value, text: o.textContent?.trim() || "" }))
      );
      const langOpt = langOpts.find((o) => o.text.toLowerCase().includes(language.toLowerCase()));
      if (langOpt) await langSelect.selectOption(langOpt.value);
    }

    console.log("[Playwright] Checking checkboxes...");
    const ageCheckbox = page.locator('input[data-gigya-name="preferences.confirmationAge.isConsentGranted"]:visible');
    if (await ageCheckbox.count() > 0 && !(await ageCheckbox.isChecked())) {
      await ageCheckbox.check({ force: true });
    }
    const termsCheckbox = page.locator('input[data-gigya-name="preferences.terms.LA2028siteTerms.isConsentGranted"]:visible');
    if (await termsCheckbox.count() > 0 && !(await termsCheckbox.isChecked())) {
      await termsCheckbox.check({ force: true });
    }
    const marketingCheckbox = page.locator('input[data-gigya-name="subscriptions.la2028EmailMarketingCommunications.email.isSubscribed"]:visible');
    if (await marketingCheckbox.count() > 0 && !(await marketingCheckbox.isChecked())) {
      await marketingCheckbox.check({ force: true });
    }

    const fallbackCheckboxes = page.locator('input[type="checkbox"]:visible');
    const cbCount = await fallbackCheckboxes.count();
    for (let i = 0; i < cbCount; i++) {
      if (!(await fallbackCheckboxes.nth(i).isChecked())) {
        await fallbackCheckboxes.nth(i).check({ force: true });
      }
    }

    console.log("[Playwright] Submitting form...");
    await page.locator('input[type="submit"]:visible').first().click();

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

    if (!pageText.includes("Enter the code") && !pageText.includes("code")) {
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

    const codeInput = page.locator('input[data-gigya-name="code"]:visible, input.gigya-input-text:visible').first();
    await codeInput.waitFor({ state: "visible", timeout: 5000 });
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

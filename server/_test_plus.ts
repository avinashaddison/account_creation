import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { subscribePlusWithUPI } from "./chatgptService";
import { getFullInbox } from "./smtpDevService";

chromium.use(StealthPlugin());

// Existing confirmed-created account
const EMAIL       = "johntaylor31@addison.asia";
const SMTP_DEV_ID = "69d4e222ebdf710c5b0ba616";
const ADMIN_TG_ID = 1127734159;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function pollOTP(smtpDevId: string, since: number, log: (m: string) => void): Promise<string | null> {
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const msgs = await getFullInbox(smtpDevId).catch(() => []);
    for (const m of msgs) {
      const ts = new Date(m.createdAt).getTime();
      if (ts < since) continue;
      const otp = (m.bodyHtml ?? m.bodyText ?? "").match(/\b(\d{6})\b/)?.[1] ?? null;
      if (otp) { log(`[Login] OTP received: ${otp}`); return otp; }
    }
    log(`[Login] Waiting for OTP… (${i + 1}/24)`);
  }
  return null;
}

async function main() {
  console.log(`=== Plus Subscription Test — login + subscribe ===\n`);
  console.log(`Account: ${EMAIL}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled", "--window-size=1280,800", "--lang=en-US",
      "--use-gl=swiftshader", "--enable-webgl",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });

  const page = await context.newPage();
  const log = (msg: string) => console.log(msg);

  try {
    // ── Log in via chatgpt.com ─────────────────────────────────────────────
    log("Opening chatgpt.com…");
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(4000);

    // Click "Log in"
    const loginBtn = page.locator('button:has-text("Log in"), a:has-text("Log in")').first();
    if (await loginBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await loginBtn.click();
      log("Clicked Log in");
      await sleep(3000);
    }

    // Enter email
    const emailInput = await page.waitForSelector(
      'input[name="email"], input[type="email"], input[placeholder*="email" i]',
      { timeout: 15000 }
    ).catch(() => null);
    if (!emailInput) throw new Error("Email input not found");
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.type(EMAIL, { delay: 40 });
    log(`Entered email: ${EMAIL}`);
    const since = Date.now();

    // Click Continue
    const continueBtn = page.locator('button:has-text("Continue"), button[type="submit"]').first();
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }
    log("Email submitted — waiting for OTP or password…");
    await sleep(3000);

    // Check if password page appears first
    const pwInput = await page.waitForSelector('input[type="password"]', { timeout: 8000 }).catch(() => null);
    if (pwInput) {
      log("Password page appeared — entering blank (no password set for OTP accounts)");
      // No password for OTP accounts — press Enter to trigger OTP send
      await page.keyboard.press("Enter");
      await sleep(2000);
    }

    // Wait for OTP input
    const otpInput = await page.waitForSelector(
      'input[name*="code"], input[placeholder*="code" i], input[autocomplete*="one-time"], input[maxlength="6"]',
      { timeout: 20000 }
    ).catch(() => null);

    if (otpInput) {
      log("OTP input found — polling smtp.dev…");
      const otp = await pollOTP(SMTP_DEV_ID, since, log);
      if (!otp) throw new Error("OTP not received within 2 minutes");
      await otpInput.click({ clickCount: 3 });
      await page.keyboard.type(otp, { delay: 60 });
      await page.keyboard.press("Enter");
      log(`OTP ${otp} submitted`);
      await sleep(5000);
    }

    // Navigate to chatgpt.com if not there yet
    const currentUrl = page.url();
    if (!currentUrl.startsWith("https://chatgpt.com")) {
      log(`Still at ${currentUrl} — navigating to chatgpt.com`);
      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(4000);
    }

    log(`Logged in — URL: ${page.url()}`);

    // ── Run Plus subscription ─────────────────────────────────────────────
    await subscribePlusWithUPI({ page, email: EMAIL, notifyTelegramId: ADMIN_TG_ID, log });

    log("\n✅ Plus subscription flow completed");
  } catch (err: any) {
    log(`\n❌ Error: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(e => { console.error("Unhandled:", e); process.exit(1); });

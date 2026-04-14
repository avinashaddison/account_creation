import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { subscribePlusWithUPI } from "./chatgptService";
import { getFullInbox } from "./smtpDevService";

chromium.use(StealthPlugin());

// Use password-path failed account — OpenAI sends OTP for login verification
const EMAIL       = "user5761573892m50723@addison.asia";
const SMTP_DEV_ID = "69de01ded0f83aa1f50ac38e"; // for OTP retrieval
const ADMIN_TG_ID = 1127734159;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function pollLoginOTP(smtpDevId: string, since: number, log: (m: string) => void): Promise<string | null> {
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const msgs = await getFullInbox(smtpDevId).catch(() => []);
    for (const m of msgs) {
      if (new Date(m.createdAt).getTime() < since) continue;
      const otp = (m.text ?? "").match(/\b(\d{6})\b/)?.[1] ?? null;
      if (otp) { log(`OTP received: ${otp}`); return otp; }
    }
    log(`Waiting for OTP… (${i + 1}/24)`);
  }
  return null;
}

async function main() {
  console.log(`=== Plus Subscription Test ===`);
  console.log(`Account: ${EMAIL}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled", "--window-size=1280,800",
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
    // ── Log into chatgpt.com via "Log in" button ──────────────────────────
    log("Navigating to chatgpt.com…");
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(4000);
    log(`URL: ${page.url()}`);

    // Click "Log in" if on landing page
    const loginBtn = page.locator('button:has-text("Log in"), a:has-text("Log in")').first();
    if (await loginBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await loginBtn.click();
      log("Clicked Log in");
      await sleep(3000);
    }
    log(`URL after Log in click: ${page.url()}`);

    // Enter email — may be on chatgpt.com modal or auth.openai.com
    const emailInput = await page.waitForSelector(
      'input[name="email"], input[type="email"], input[placeholder*="email" i]',
      { timeout: 15000 }
    ).catch(() => null);
    if (!emailInput) {
      log(`Current URL: ${page.url()}`);
      log(`Page text: ${(await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => ""))}`);
      throw new Error("Email input not found");
    }

    const since = Date.now(); // for OTP timestamp comparison
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.type(EMAIL, { delay: 40 });
    log(`Entered email`);
    await page.keyboard.press("Enter");
    await sleep(4000);

    log(`URL after email: ${page.url()}`);

    // Try password first
    const pwInput = await page.waitForSelector('input[type="password"]', { timeout: 6000 }).catch(() => null);
    if (pwInput) {
      await pwInput.click({ clickCount: 3 });
      await page.keyboard.type(PASSWORD, { delay: 40 });
      log(`Entered password`);
      await page.keyboard.press("Enter");
      await sleep(5000);
      log(`URL after password: ${page.url()}`);
    } else {
      // OpenAI is using OTP for login — poll smtp.dev for the code
      const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? "").catch(() => "");
      log(`No password field — OTP login. Page: ${pageText.replace(/\n+/g, " ").slice(0, 150)}`);
      log(`Polling smtp.dev for login OTP…`);
      const loginOTP = await pollLoginOTP(SMTP_DEV_ID, since, log);
      if (!loginOTP) throw new Error("Login OTP not received within 2 minutes");

      const otpInput = await page.waitForSelector(
        'input[autocomplete*="one-time"], input[name*="code"], input[maxlength="6"], input[placeholder*="code" i]',
        { timeout: 10000 }
      ).catch(() => null);
      if (!otpInput) throw new Error("OTP input field not found");
      await otpInput.click({ clickCount: 3 });
      await page.keyboard.type(loginOTP, { delay: 60 });
      await page.keyboard.press("Enter");
      log(`OTP ${loginOTP} submitted`);
      await sleep(5000);
    }

    log(`URL after login attempt: ${page.url()}`);

    // If about-you appears, navigate past it
    if (page.url().includes("about-you") || page.url().includes("workspace")) {
      log(`Skipping ${page.url()} — navigating to chatgpt.com`);
      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(4000);
    }

    // Wait for chatgpt.com
    if (!page.url().startsWith("https://chatgpt.com")) {
      await page.waitForURL((u: URL) => u.toString().startsWith("https://chatgpt.com"), { timeout: 15000 });
    }
    log(`Logged in — on chatgpt.com`);
    await sleep(2000);

    // ── Run Plus subscription ──────────────────────────────────────────────
    await subscribePlusWithUPI({ page, email: EMAIL, notifyTelegramId: ADMIN_TG_ID, log });

    log("\n✅ Flow complete");
  } catch (err: any) {
    log(`\n❌ Error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });

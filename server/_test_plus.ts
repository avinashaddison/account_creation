/**
 * _test_plus.ts — standalone test for Plus subscription via Indian proxy
 *
 * NOTE: This test logs into an EXISTING account. The OAuth login flow via
 * chatgpt.com has known issues through the Indian proxy (the session cookie
 * flow behaves differently vs direct IP). This does NOT affect the production
 * flow, where subscribePlusWithUPI() is called immediately after account
 * creation — no separate login is needed since the browser session is already
 * authenticated from the signup.
 *
 * To test end-to-end: trigger batch account creation from Bot 1 admin.
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { subscribePlusWithUPI } from "./chatgptService";
import { getFullInbox } from "./smtpDevService";

chromium.use(StealthPlugin());

const EMAIL       = "charlessmith@addison.asia";
const SMTP_DEV_ID = "69d4e30000739311430cdc7e";
const ADMIN_TG_ID = 1127734159;

const PROXY = {
  server:   "http://proxy.nsocks.com:2312",
  username: "ns-mrqq7v2x6zlr_area-IN_session-fR44mD0VSI_life-5",
  password: process.env.NSOCKS_PROXY_PASSWORD ?? "",
};

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
  console.log(`=== Plus Subscription Test (Indian Proxy) ===`);
  console.log(`Account: ${EMAIL}\n`);
  console.log(`Proxy: ${PROXY.server}\n`);

  const browser = await chromium.launch({
    headless: true,
    proxy: PROXY,
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
    // ── Step 1: Navigate to auth.openai.com directly ──────────────────────
    log("Navigating to auth.openai.com login…");
    await page.goto("https://auth.openai.com/log-in", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(4000);
    log(`URL: ${page.url()}`);
    log(`Page: ${(await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "").catch(() => "")).replace(/\n+/g, " ")}`);

    // Handle "session has ended" or "continue" interstitial
    const interstitialBtn = page.locator('button:has-text("Log in"), a:has-text("Log in"), button:has-text("Continue")').first();
    if (await interstitialBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await interstitialBtn.click();
      log("Clicked interstitial Log in");
      await sleep(5000);
      log(`URL after interstitial: ${page.url()}`);
    }

    // ── Step 2: Find and fill email input ─────────────────────────────────
    const emailInput = await page.waitForSelector(
      'input[name="email"], input[type="email"], input[autocomplete*="email"]',
      { timeout: 15000 }
    ).catch(() => null);

    if (!emailInput) {
      log(`URL: ${page.url()}`);
      log(`Page: ${(await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? "").catch(() => "")).replace(/\n+/g, " ")}`);
      throw new Error("Email input not found — login flow changed with proxy");
    }

    const since = Date.now();
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.type(EMAIL, { delay: 40 });
    log("Entered email");
    await page.keyboard.press("Enter");
    await sleep(5000);
    log(`URL after email: ${page.url()}`);

    // ── Step 3: Get OTP and submit ─────────────────────────────────────────
    log("Polling smtp.dev for login OTP…");
    const loginOTP = await pollLoginOTP(SMTP_DEV_ID, since, log);
    if (!loginOTP) throw new Error("Login OTP not received within 2 minutes");

    const otpInput = await page.waitForSelector(
      'input[autocomplete*="one-time"], input[name*="code"], input[maxlength="6"], input[inputmode="numeric"]',
      { timeout: 10000 }
    ).catch(() => null);
    if (!otpInput) throw new Error("OTP input field not found");
    await otpInput.click({ clickCount: 3 });
    await page.keyboard.type(loginOTP, { delay: 60 });
    log(`OTP ${loginOTP} typed — pressing Enter`);
    await page.keyboard.press("Enter");
    await sleep(7000);
    log(`URL after OTP: ${page.url()}`);

    // Skip about-you / workspace if they appear
    if (page.url().includes("about-you") || page.url().includes("workspace")) {
      log(`Skipping ${page.url()} — navigating to chatgpt.com`);
      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(4000);
    }

    if (!page.url().startsWith("https://chatgpt.com")) {
      await page.waitForURL((u: URL) => u.toString().startsWith("https://chatgpt.com"), { timeout: 15000 });
    }
    log("Logged in — on chatgpt.com");
    await sleep(2000);

    // ── Step 4: Subscribe to Plus via UPI ─────────────────────────────────
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

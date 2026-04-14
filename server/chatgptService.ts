import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getFullInbox } from "./smtpDevService";
import { storage } from "./storage";
import { solveAntiTurnstile } from "./capsolverService";

chromium.use(StealthPlugin());

const FIRST_NAMES = ["James","Emily","Liam","Sophia","Noah","Olivia","William","Emma","Benjamin","Ava","Lucas","Isabella","Mason","Mia","Ethan","Charlotte"];
const LAST_NAMES  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Wilson","Taylor","Anderson","Thomas","Jackson","White","Harris"];

function randomName(): { first: string; last: string } {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last  = LAST_NAMES [Math.floor(Math.random() * LAST_NAMES.length)];
  return { first, last };
}

function randomAge(): string { return String(Math.floor(Math.random() * 8) + 22); }

function generatePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const nums  = "0123456789";
  const rand = (s: string) => s[Math.floor(Math.random() * s.length)];
  const body = Array.from({ length: 8 }, () => rand(chars + upper + nums)).join("");
  return rand(upper) + body + rand(nums) + "!A1";
}

// Click a button by matching its text content (case-insensitive)
async function jsClick(page: any, text: string): Promise<boolean> {
  return page.evaluate((t: string) => {
    const btn = [...document.querySelectorAll("button")].find(b =>
      b.textContent?.trim().toLowerCase() === t.toLowerCase()
    );
    if (btn) { (btn as HTMLElement).click(); return true; }
    return false;
  }, text);
}

export interface ChatGPTResult {
  success: boolean;
  email?: string;
  password?: string;
  mailPassword?: string;
  firstName?: string;
  lastName?: string;
  error?: string;
}

// ── Main automation ──────────────────────────────────────────────────────────
export async function createChatGPTAccount(opts: {
  email: string;
  smtpDevId: string;
  mailPassword: string;
  log?: (msg: string) => void;
}): Promise<ChatGPTResult> {
  const { email, smtpDevId, mailPassword, log = console.log } = opts;
  const { first, last } = randomName();
  const age = randomAge();
  const accountPassword = generatePassword();
  let browser: any;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const page = await context.newPage();

    // Pre-snapshot inbox so we only read new messages later
    const existingMsgs = await getFullInbox(smtpDevId).catch(() => [] as any[]);
    const existingIds  = new Set((existingMsgs as any[]).map((m: any) => m.id));

    // ── Step 1: chatgpt.com ──────────────────────────────────────────────────
    log(`[ChatGPT] Opening chatgpt.com…`);
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(4000);

    // ── Step 2: Click "Sign up for free" via JS (bypasses actionability issues)
    log(`[ChatGPT] Clicking Sign up for free…`);
    const signupClicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(b =>
        b.textContent?.trim().toLowerCase().includes("sign up")
      );
      if (btn) { (btn as HTMLElement).click(); return true; }
      return false;
    });
    if (!signupClicked) throw new Error("Sign up button not found on chatgpt.com");
    await sleep(3000);

    // ── Step 3: Fill email ───────────────────────────────────────────────────
    log(`[ChatGPT] Entering email: ${email}`);
    const emailInput = await page.waitForSelector(
      'input#email, input[name="email"], input[type="email"]',
      { timeout: 20_000 }
    );
    await emailInput.click();
    await emailInput.fill(email);
    await sleep(1000);

    await solveTurnstileIfPresent(page, log);

    const continueClicked = await jsClick(page, "Continue");
    if (!continueClicked) await emailInput.press("Enter");
    log(`[ChatGPT] Email submitted — waiting…`);
    await sleep(3000);

    // ── Step 4: Set account password ────────────────────────────────────────
    const urlAfterEmail = page.url();
    const contentAfterEmail = await page.evaluate(() => document.body.innerText?.slice(0, 300) ?? "");
    log(`[ChatGPT] URL: ${urlAfterEmail}`);

    const isPasswordPage = urlAfterEmail.includes("password") ||
      /create.*password|set.*password|password.*log in/i.test(contentAfterEmail);

    if (isPasswordPage) {
      log(`[ChatGPT] Password page — setting password…`);
      const pwInput = await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
      await pwInput.click();
      await pwInput.fill(accountPassword);
      await sleep(1000);

      await solveTurnstileIfPresent(page, log);
      const pwContinue = await jsClick(page, "Continue");
      if (!pwContinue) await page.click('button[type="submit"]').catch(() => pwInput.press("Enter"));
      log(`[ChatGPT] Password submitted — waiting for email verification…`);
      await sleep(4000);
    }

    // ── Step 5: Email verification OTP ──────────────────────────────────────
    const verifyUrl = page.url();
    const verifyContent = await page.evaluate(() => document.body.innerText?.slice(0, 500) ?? "");
    log(`[ChatGPT] URL: ${verifyUrl}`);

    const needsOtp = verifyUrl.includes("email-verification") ||
      /check your inbox|enter.*code|verification code|verify/i.test(verifyContent);

    if (needsOtp) {
      log(`[ChatGPT] Email verification step — polling for OTP…`);
      let otp: string | null = null;
      const deadline = Date.now() + 120_000;
      while (!otp && Date.now() < deadline) {
        await sleep(4_000);
        try {
          const msgs = await getFullInbox(smtpDevId);
          for (const m of msgs as any[]) {
            if (existingIds.has(m.id)) continue;
            const body  = (m.text || m.subject || "").replace(/\s+/g, " ");
            const match = body.match(/\b([0-9]{6})\b/);
            if (match) { otp = match[1]; break; }
          }
        } catch { /* retry */ }
      }
      if (!otp) throw new Error("Verification OTP not received within 2 minutes");
      log(`[ChatGPT] OTP received: ${otp}`);

      // Enter OTP
      const codeInput = await page.waitForSelector(
        'input[name="code"], input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type="text"][maxlength="6"]',
        { timeout: 20_000 }
      ).catch(() => null);

      if (codeInput) {
        await codeInput.click();
        await codeInput.fill(otp);
      } else {
        // Individual digit boxes
        const digitInputs = await page.$$('input[type="text"][maxlength="1"], input[inputmode="numeric"][maxlength="1"]');
        if (digitInputs.length >= 6) {
          for (let i = 0; i < 6; i++) await digitInputs[i].fill(otp[i]);
        } else {
          throw new Error("Could not locate OTP input field");
        }
      }

      await solveTurnstileIfPresent(page, log);
      const otpContinue = await jsClick(page, "Continue");
      if (!otpContinue) await page.click('button[type="submit"]').catch(() => {});
      log(`[ChatGPT] OTP submitted`);
      await sleep(4000);
    } else {
      log(`[ChatGPT] No email verification step — continuing…`);
    }

    // ── Step 6: Name / age (if present) ─────────────────────────────────────
    log(`[ChatGPT] Checking for name/age step…`);
    const nameInput = await page.waitForSelector(
      'input[name="full_name"], input[name="name"], input[placeholder*="name" i]',
      { timeout: 15_000 }
    ).catch(() => null);

    if (nameInput) {
      log(`[ChatGPT] Name/age step — filling ${first} ${last}, age ${age}`);
      await nameInput.fill(`${first} ${last}`);
      const ageInput = await page.waitForSelector(
        'input[name="age"], input[placeholder*="age" i]',
        { timeout: 8_000 }
      ).catch(() => null);
      if (ageInput) await ageInput.fill(age);
      await page.click('button:has-text("Finish creating account")').catch(() =>
        page.click('button[type="submit"]')
      );
      log(`[ChatGPT] Name/age submitted`);
      await sleep(3000);
    } else {
      log(`[ChatGPT] No name/age step`);
    }

    // ── Step 7: Skip optional onboarding ────────────────────────────────────
    for (const skipText of ["Skip for now", "Skip", "Maybe later"]) {
      const skipBtn = page.locator(`button:has-text("${skipText}")`).first();
      if (await skipBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await skipBtn.click().catch(() => {});
        log(`[ChatGPT] Skipped: ${skipText}`);
        await sleep(1500);
      }
    }

    // ── Step 8: Verify logged in ─────────────────────────────────────────────
    const finalUrl = page.url();
    log(`[ChatGPT] Final URL: ${finalUrl}`);
    const isSuccess = finalUrl.includes("chatgpt.com") || finalUrl.includes("openai.com");
    if (!isSuccess) throw new Error(`Unexpected final URL: ${finalUrl}`);

    // ── Step 9: Save to DB ───────────────────────────────────────────────────
    await storage.saveChatGptAccount({
      email,
      password: accountPassword,
      firstName: first,
      lastName: last,
      status: "created",
      createdBy: "bot_automation",
    });

    log(`[ChatGPT] Account created: ${email}`);
    return { success: true, email, password: accountPassword, mailPassword, firstName: first, lastName: last };

  } catch (err: any) {
    const msg = err.message || String(err);
    log(`[ChatGPT] Failed: ${msg}`);
    try {
      await storage.saveChatGptAccount({
        email,
        password: accountPassword ?? "",
        status: "failed",
        error: msg.slice(0, 300),
        createdBy: "bot_automation",
      });
    } catch { /* ignore */ }
    return { success: false, email, error: msg };
  } finally {
    await browser?.close().catch(() => {});
  }
}

// ── Batch registration ────────────────────────────────────────────────────────
export async function batchCreateChatGPTAccounts(opts: {
  count: number;
  log?: (msg: string) => void;
}): Promise<{ total: number; succeeded: number; failed: number; results: ChatGPTResult[] }> {
  const { count, log = console.log } = opts;

  const { db } = await import("./db");
  const { bizMailAccounts, chatgptAccounts } = await import("@shared/schema");
  const { isNull, isNotNull, notInArray, and, eq } = await import("drizzle-orm");

  // Only exclude accounts that were SUCCESSFULLY created — failed accounts are retried
  const successful = await db.select({ email: chatgptAccounts.email })
    .from(chatgptAccounts)
    .where(eq(chatgptAccounts.status, "created"));
  const doneEmails = successful.map(r => r.email);

  let candidates: any[];
  if (doneEmails.length > 0) {
    candidates = await db.select()
      .from(bizMailAccounts)
      .where(and(
        isNull(bizMailAccounts.deletedAt),
        isNotNull(bizMailAccounts.smtpAccountId),
        notInArray(bizMailAccounts.email, doneEmails)
      ))
      .limit(count);
  } else {
    candidates = await db.select()
      .from(bizMailAccounts)
      .where(and(
        isNull(bizMailAccounts.deletedAt),
        isNotNull(bizMailAccounts.smtpAccountId)
      ))
      .limit(count);
  }

  if (candidates.length === 0) {
    log(`[ChatGPT/Batch] No unregistered biz mail accounts available`);
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  log(`[ChatGPT/Batch] Starting ${candidates.length} account registration(s)…`);
  const results: ChatGPTResult[] = [];
  let succeeded = 0, failed = 0;

  for (const acct of candidates) {
    if (!acct.smtpAccountId) {
      log(`[ChatGPT/Batch] Skipping ${acct.email} — no smtp_dev_id`);
      failed++;
      results.push({ success: false, email: acct.email, error: "No smtp_dev_id" });
      continue;
    }
    const r = await createChatGPTAccount({
      email: acct.email,
      smtpDevId: acct.smtpAccountId,
      mailPassword: acct.password,
      log,
    });
    results.push(r);
    if (r.success) succeeded++; else failed++;
    await sleep(5_000);
  }

  log(`[ChatGPT/Batch] Done — ${succeeded} succeeded, ${failed} failed`);
  return { total: candidates.length, succeeded, failed, results };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function solveTurnstileIfPresent(page: any, log: (m: string) => void): Promise<void> {
  try {
    const frame = page.frames().find((f: any) => f.url().includes("challenges.cloudflare.com"));
    if (!frame) return;
    log(`[ChatGPT] Turnstile detected — solving via Capsolver…`);
    const token = await solveAntiTurnstile(page.url(), undefined, log);
    if (token) {
      await page.evaluate((t: string) => {
        const input = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
        if (input) { input.value = t; input.dispatchEvent(new Event("change", { bubbles: true })); }
        (window as any).turnstileCallback?.(t);
      }, token);
      log(`[ChatGPT] Turnstile solved`);
    }
  } catch { /* non-fatal */ }
}

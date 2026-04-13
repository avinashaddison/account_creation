import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getFullInbox } from "./smtpDevService";
import { storage } from "./storage";
import { solveAntiTurnstile } from "./capsolverService";

chromium.use(StealthPlugin());

const FIRST_NAMES = ["James", "Emily", "Liam", "Sophia", "Noah", "Olivia", "William", "Emma", "Benjamin", "Ava", "Lucas", "Isabella", "Mason", "Mia", "Ethan", "Charlotte"];
const LAST_NAMES  = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Wilson", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris"];

function randomName(): { first: string; last: string } {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last  = LAST_NAMES [Math.floor(Math.random() * LAST_NAMES.length)];
  return { first, last };
}

function randomAge(): string {
  return String(Math.floor(Math.random() * 8) + 22); // 22–29
}

export interface ChatGPTResult {
  success: boolean;
  email?: string;
  mailPassword?: string;
  firstName?: string;
  lastName?: string;
  error?: string;
}

// ── Main automation ────────────────────────────────────────────────────────────
export async function createChatGPTAccount(opts: {
  email: string;
  smtpDevId: string;
  mailPassword: string;
  log?: (msg: string) => void;
}): Promise<ChatGPTResult> {
  const { email, smtpDevId, mailPassword, log = console.log } = opts;
  const { first, last } = randomName();
  const age = randomAge();
  let browser: any;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
      ],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const page = await context.newPage();

    // ── Step 1: Load registration page ────────────────────────────────────────
    log(`[ChatGPT] Opening registration page…`);
    await page.goto("https://auth.openai.com/create-account", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // ── Snapshot existing inbox to filter later ────────────────────────────────
    const existingMsgs = await getFullInbox(smtpDevId).catch(() => [] as any[]);
    const existingIds  = new Set((existingMsgs as any[]).map((m: any) => m.id));

    // ── Step 2: Fill email ────────────────────────────────────────────────────
    log(`[ChatGPT] Entering email: ${email}`);
    const emailInput = await page.waitForSelector(
      'input[type="email"], input[name="username"], input[name="email"], input[autocomplete*="email"]',
      { timeout: 25_000 }
    );
    await emailInput.click();
    await emailInput.fill(email);

    // Try Turnstile if present (before clicking Continue)
    await solveTurnstileIfPresent(page, log);

    await page.click('button[type="submit"]').catch(() =>
      page.click('button:has-text("Continue")')
    );
    log(`[ChatGPT] Continue clicked — waiting for OTP email…`);

    // ── Step 3: Poll smtp.dev for OTP ─────────────────────────────────────────
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
    if (!otp) throw new Error("OTP email not received within 2 minutes");
    log(`[ChatGPT] OTP received: ${otp}`);

    // ── Step 4: Enter OTP ─────────────────────────────────────────────────────
    const codeInput = await page.waitForSelector(
      'input[name="code"], input[autocomplete="one-time-code"], input[type="text"][maxlength="6"]',
      { timeout: 30_000 }
    ).catch(() => null);

    if (codeInput) {
      await codeInput.fill(otp);
    } else {
      // Some flows render individual digit boxes
      const digitInputs = await page.$$('input[type="text"][maxlength="1"]');
      if (digitInputs.length >= 6) {
        for (let i = 0; i < 6; i++) await digitInputs[i].fill(otp[i]);
      } else {
        throw new Error("Could not locate OTP input field");
      }
    }

    await solveTurnstileIfPresent(page, log);
    await page.click('button[type="submit"]').catch(() =>
      page.click('button:has-text("Continue")')
    );
    log(`[ChatGPT] OTP submitted`);

    // ── Step 5: Name + Age ────────────────────────────────────────────────────
    await page.waitForURL(/about-you|create-account/, { timeout: 30_000 }).catch(() => {});
    log(`[ChatGPT] Filling name: ${first} ${last}  age: ${age}`);

    const nameInput = await page.waitForSelector(
      'input[name="full_name"], input[name="name"], input[placeholder*="Full name" i]',
      { timeout: 20_000 }
    );
    await nameInput.fill(`${first} ${last}`);

    const ageInput = await page.waitForSelector(
      'input[name="age"], input[placeholder*="Age" i]',
      { timeout: 10_000 }
    ).catch(() => null);
    if (ageInput) await ageInput.fill(age);

    await page.click('button:has-text("Finish creating account")').catch(() =>
      page.click('button[type="submit"]')
    );
    log(`[ChatGPT] Submitted name / age`);

    // ── Step 6: Skip interest survey ─────────────────────────────────────────
    try {
      await page.waitForSelector('button:has-text("Skip"), a:has-text("Skip")', { timeout: 15_000 });
      await page.click('button:has-text("Skip"), a:has-text("Skip")');
      log(`[ChatGPT] Skipped interest survey`);
    } catch { /* page may auto-advance */ }

    // ── Step 7: Confirm we landed on chatgpt.com ──────────────────────────────
    await page.waitForURL(/chatgpt\.com/, { timeout: 30_000 }).catch(() => {
      log(`[ChatGPT] Note: URL may not have changed to chatgpt.com — continuing anyway`);
    });

    // ── Step 8: Save to DB ────────────────────────────────────────────────────
    await storage.saveChatGptAccount({
      email,
      password: mailPassword,
      firstName: first,
      lastName: last,
      status: "created",
      createdBy: "bot_automation",
    });

    log(`[ChatGPT] ✅ Account created: ${email}`);
    return { success: true, email, mailPassword, firstName: first, lastName: last };

  } catch (err: any) {
    const msg = err.message || String(err);
    log(`[ChatGPT] ❌ Failed: ${msg}`);
    // Record failure in DB
    try {
      await storage.saveChatGptAccount({
        email,
        password: mailPassword,
        firstName: first,
        lastName: last,
        status: "failed",
        error: msg.slice(0, 300),
        createdBy: "bot_automation",
      });
    } catch { /* ignore */ }
    return { success: false, error: msg };
  } finally {
    await browser?.close().catch(() => {});
  }
}

// ── Batch registration ────────────────────────────────────────────────────────
// Picks the next N unregistered biz mail accounts and creates ChatGPT accounts.
export async function batchCreateChatGPTAccounts(opts: {
  count: number;
  log?: (msg: string) => void;
}): Promise<{ total: number; succeeded: number; failed: number; results: ChatGPTResult[] }> {
  const { count, log = console.log } = opts;

  const { db } = await import("./db");
  const { bizMailAccounts, chatgptAccounts } = await import("@shared/schema");
  const { sql, isNull, isNotNull, notInArray, and } = await import("drizzle-orm");

  // Get biz mail accounts not yet in chatgpt_accounts
  const registered = await db.select({ email: chatgptAccounts.email }).from(chatgptAccounts);
  const registeredEmails = registered.map(r => r.email);

  let candidates: any[];
  if (registeredEmails.length > 0) {
    candidates = await db.select()
      .from(bizMailAccounts)
      .where(and(
        isNull(bizMailAccounts.deletedAt),
        isNotNull(bizMailAccounts.smtpDevId),
        notInArray(bizMailAccounts.email, registeredEmails)
      ))
      .limit(count);
  } else {
    candidates = await db.select()
      .from(bizMailAccounts)
      .where(and(
        isNull(bizMailAccounts.deletedAt),
        isNotNull(bizMailAccounts.smtpDevId)
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
    if (!acct.smtpDevId) {
      log(`[ChatGPT/Batch] Skipping ${acct.email} — no smtp_dev_id`);
      failed++;
      results.push({ success: false, email: acct.email, error: "No smtp_dev_id" });
      continue;
    }
    const r = await createChatGPTAccount({
      email: acct.email,
      smtpDevId: acct.smtpDevId,
      mailPassword: acct.password,
      log,
    });
    results.push(r);
    if (r.success) succeeded++; else failed++;
    // Brief pause between accounts to avoid rate limits
    await sleep(3_000);
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
    const pageUrl = page.url();
    log(`[ChatGPT] Turnstile detected — solving via Capsolver…`);
    const token = await solveAntiTurnstile(pageUrl, undefined, log);
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

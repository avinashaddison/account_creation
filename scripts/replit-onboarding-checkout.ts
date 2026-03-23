/**
 * Replit Onboarding & Stripe Promo Code Automation
 *
 * Flow:
 *  1. Login to Replit with email + password
 *  2. Complete onboarding (username, full name → Developer → Google search → skip referral)
 *  3. Navigate to pricing → click "Continue with Core" ($20/month)
 *  4. Wait for real Stripe checkout redirect (no direct URL open)
 *  5. On Stripe: click "Add promotion code" → enter coupon → apply
 *
 * Usage:
 *   REPLIT_EMAIL=you@example.com REPLIT_PASS=yourpassword npx tsx scripts/replit-onboarding-checkout.ts
 *
 * Or set the constants below directly.
 */

import { chromium } from "playwright";
import * as fs from "fs";

// ─── Config ───────────────────────────────────────────────────────────────────
const REPLIT_EMAIL    = process.env.REPLIT_EMAIL    || "your@email.com";
const REPLIT_PASS     = process.env.REPLIT_PASS     || "yourpassword";
const REPLIT_USERNAME = process.env.REPLIT_USERNAME || "";     // optional, for onboarding pre-fill
const REPLIT_FULLNAME = process.env.REPLIT_FULLNAME || "";     // optional
const COUPON_CODE     = process.env.COUPON_CODE     || "AGENT4BC4974559665";
// Set USER_DATA_DIR to a stable path for persistent sessions across runs:
//   USER_DATA_DIR=/tmp/my-replit-profile npx tsx scripts/replit-onboarding-checkout.ts
const USER_DATA_DIR   = process.env.USER_DATA_DIR   || `/tmp/replit-profile-${Date.now()}`;

// ─── Logging ──────────────────────────────────────────────────────────────────
const LOG_FILE = `/tmp/replit-onboarding-${Date.now()}.log`;
fs.writeFileSync("/tmp/replit-onboarding-current-log.txt", LOG_FILE);

function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString("en-US", { hour12: false })}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Random delay between min..max ms to mimic human pacing. */
const humanDelay = (min = 800, max = 1800) =>
  sleep(min + Math.floor(Math.random() * (max - min)));

/** Type into a field character-by-character to look human.
 *  Uses pressSequentially which correctly handles all characters including
 *  symbols (@, #, !, etc.) common in emails and passwords.
 */
async function humanType(locator: import("playwright").Locator, text: string) {
  await locator.focus();
  await locator.fill("");                    // clear first
  await locator.pressSequentially(text, { delay: 50 + Math.floor(Math.random() * 80) });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log("═".repeat(60));
  log(`🚀 Replit Onboarding & Stripe Promo Automation`);
  log(`   Email  : ${REPLIT_EMAIL}`);
  log(`   Coupon : ${COUPON_CODE}`);
  log("═".repeat(60));

  // ── 1. Launch browser ───────────────────────────────────────────────────────
  log(`🌐 Launching browser (headful, stealth args) — profile: ${USER_DATA_DIR}`);
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900",
      "--lang=en-US,en;q=0.9",
    ],
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport:  { width: 1280, height: 900 },
    locale:    "en-US",
    timezoneId: "America/New_York",
    // No route/request interception — pure real browser traffic
  });

  // Hide webdriver property in every frame (runs in browser context where navigator is available)
  await ctx.addInitScript(() => {
    Object.defineProperty(window.navigator, "webdriver", { get: () => undefined });
  });

  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  try {
    // ── 2. Login ──────────────────────────────────────────────────────────────
    log("🔐 Navigating to Replit login page...");
    await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded" });
    await humanDelay(1500, 2500);

    // Fill email
    log("  ✏️  Filling email...");
    const emailField = page.getByRole("textbox", { name: /email/i })
      .or(page.locator('input[name="username"], input[type="email"], input[placeholder*="email" i]')).first();
    await emailField.waitFor({ state: "visible" });
    await humanType(emailField, REPLIT_EMAIL);
    await humanDelay();

    // Fill password
    log("  ✏️  Filling password...");
    const passField = page.getByRole("textbox", { name: /password/i })
      .or(page.locator('input[type="password"]')).first();
    await humanType(passField, REPLIT_PASS);
    await humanDelay(600, 1200);

    // Submit login
    log("  🖱️  Clicking Log in...");
    const loginBtn = page.getByRole("button", { name: /log in|sign in|continue/i }).first();
    await loginBtn.click();

    // Wait for post-login redirect (dashboard or onboarding)
    log("  ⏳ Waiting for post-login navigation...");
    await page.waitForURL(
      url => !url.href.includes("/login") && !url.href.includes("/signup"),
      { timeout: 30_000 }
    );
    await humanDelay(2000, 3000);
    log(`  ✅ Logged in — current URL: ${page.url()}`);

    // ── 3. Onboarding ─────────────────────────────────────────────────────────
    log("📋 Checking for onboarding overlay...");

    // Replit sometimes routes to /onboarding or shows an overlay on the home page
    const isOnboarding = page.url().includes("/onboarding") ||
      await page.locator('[data-cy="onboarding"], [class*="onboarding" i], [id*="onboarding" i]')
        .first().isVisible({ timeout: 4_000 }).catch(() => false);

    if (isOnboarding || page.url().includes("/onboarding")) {
      log("  📋 Onboarding detected — starting steps...");

      // ── Step 1: Username + Full name ────────────────────────────────────────
      log("  Step 1: Username & Full name");

      // Username field
      const usernameInput = page
        .getByRole("textbox", { name: /username/i })
        .or(page.locator('input[name="username"], input[placeholder*="username" i]'))
        .first();

      if (await usernameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const uname = REPLIT_USERNAME || REPLIT_EMAIL.split("@")[0].replace(/[^a-z0-9]/gi, "").slice(0, 20);
        log(`    username → ${uname}`);
        await humanType(usernameInput, uname);
        await humanDelay(500, 900);
      }

      // Full name field
      const fullNameInput = page
        .getByRole("textbox", { name: /full.?name|display.?name|name/i })
        .or(page.locator('input[name="fullName"], input[placeholder*="name" i]'))
        .first();

      if (await fullNameInput.isVisible({ timeout: 4_000 }).catch(() => false)) {
        const fname = REPLIT_FULLNAME || "Alex Taylor";
        log(`    full name → ${fname}`);
        await humanType(fullNameInput, fname);
        await humanDelay(500, 900);
      }

      // Click Next (step 1 → 2)
      await clickNextButton(page);
      await humanDelay(1200, 2000);

      // ── Step 2: Role — "Developer" ──────────────────────────────────────────
      log("  Step 2: Select role → Developer");
      const developerOption = page
        .getByRole("radio", { name: /developer/i })
        .or(page.getByText("Developer", { exact: false }))
        .or(page.locator('[data-value*="developer" i], [value*="developer" i]'))
        .first();

      if (await developerOption.isVisible({ timeout: 6_000 }).catch(() => false)) {
        await developerOption.click();
        log("    ✅ Developer selected");
      } else {
        log("    ⚠️  Developer option not found — attempting to click any role card...");
        // Try clicking a card-style option that contains "Developer"
        await page.locator("text=Developer").first().click().catch(() => {});
      }
      await humanDelay(800, 1400);

      // Click Next (step 2 → 3)
      await clickNextButton(page);
      await humanDelay(1200, 2000);

      // ── Step 3: Discovery — "Google search" ─────────────────────────────────
      log('  Step 3: Select "How did you hear about us" → Google search');
      const googleOption = page
        .getByRole("radio", { name: /google/i })
        .or(page.getByText(/google search/i))
        .or(page.locator('[data-value*="google" i], [value*="google" i]'))
        .first();

      if (await googleOption.isVisible({ timeout: 6_000 }).catch(() => false)) {
        await googleOption.click();
        log("    ✅ Google search selected");
      } else {
        log("    ⚠️  Google option not found — trying text match...");
        await page.locator("text=Google").first().click().catch(() => {});
      }
      await humanDelay(800, 1400);

      // Click Next (step 3 → 4)
      await clickNextButton(page);
      await humanDelay(1200, 2000);

      // ── Step 4: Referral — Skip ──────────────────────────────────────────────
      log("  Step 4: Referral — Skip");
      const skipBtn = page
        .getByRole("button", { name: /skip|later|no thanks|continue/i })
        .first();

      if (await skipBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await skipBtn.click();
        log("    ✅ Referral step skipped");
      } else {
        // If no skip, try clicking Next again to pass through
        log("    ℹ️  No skip button — clicking Next to continue...");
        await clickNextButton(page).catch(() => {});
      }
      await humanDelay(1500, 2500);
      log("  ✅ Onboarding complete");
    } else {
      log("  ℹ️  No onboarding overlay found — account appears already set up");
    }

    // ── 4. Navigate to pricing and click "Continue with Core" ─────────────────
    log("💰 Navigating to Replit pricing page...");
    await page.goto("https://replit.com/pricing", { waitUntil: "domcontentloaded" });
    await humanDelay(2500, 3500);

    log('  🔍 Looking for "Continue with Core" button...');

    // Try multiple selector strategies for the Replit Core upgrade button
    const coreBtn = page
      .getByRole("button", { name: /continue with core/i })
      .or(page.getByRole("link",   { name: /continue with core/i }))
      .or(page.locator("text=Continue with Core"))
      .first();

    await coreBtn.waitFor({ state: "visible", timeout: 15_000 });
    log('  🖱️  Clicking "Continue with Core"...');
    await coreBtn.click();

    // ── 5. Wait for Stripe checkout redirect ──────────────────────────────────
    log("⏳ Waiting for Stripe checkout redirect (max 45s)...");
    // Replit may redirect to checkout.stripe.com or billing.stripe.com
    await page.waitForURL(
      url =>
        url.href.includes("checkout.stripe.com") ||
        url.href.includes("billing.stripe.com") ||
        url.href.includes("stripe.com/checkout"),
      { timeout: 45_000 }
    );
    const stripeUrl = page.url();
    log(`  ✅ Stripe redirect received: ${stripeUrl.substring(0, 80)}...`);

    // Wait for Stripe page to fully load
    log("  ⏳ Waiting for Stripe page to finish loading...");
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {
      log("  ⚠️  networkidle timeout — proceeding anyway");
    });
    await humanDelay(2000, 3000);

    // ── 6. Apply promo code on Stripe ─────────────────────────────────────────
    log(`🎟️  Applying promo code: ${COUPON_CODE}`);

    // Click "Add promotion code" link/button
    const addPromoBtn = page
      .getByRole("button", { name: /add promotion code/i })
      .or(page.getByRole("link",   { name: /add promotion code/i }))
      .or(page.locator("text=Add promotion code"))
      .first();

    log('  🔍 Waiting for "Add promotion code"...');
    await addPromoBtn.waitFor({ state: "visible", timeout: 20_000 });
    await humanDelay(800, 1400);
    await addPromoBtn.click();
    log('  🖱️  Clicked "Add promotion code"');
    await humanDelay(1000, 1800);

    // Type coupon into promo input
    const promoInput = page
      .getByRole("textbox", { name: /promotion code|coupon|promo/i })
      .or(page.locator('input[name="promotionCode"], input[id*="promo" i], input[placeholder*="code" i]'))
      .first();

    await promoInput.waitFor({ state: "visible", timeout: 10_000 });
    log(`  ✏️  Typing coupon: ${COUPON_CODE}`);
    await humanType(promoInput, COUPON_CODE);
    await humanDelay(800, 1200);

    // Click Apply button
    const applyBtn = page
      .getByRole("button", { name: /apply/i })
      .first();

    await applyBtn.waitFor({ state: "visible", timeout: 8_000 });
    await applyBtn.click();
    log("  🖱️  Clicked Apply");

    // Wait for Stripe to validate the coupon (discount appears or error)
    log("  ⏳ Waiting for coupon validation...");
    await humanDelay(3000, 4000);

    // Check for a confirmed coupon success indicator:
    // Stripe typically shows a line item with the discount amount or "Discount" label.
    const discountLine = page.locator(
      '[class*="discount" i], [class*="coupon" i], [data-testid*="discount"]'
    ).first();

    // Also check page body text as a secondary signal
    const bodyText = await page.locator("body").textContent().catch(() => "");
    const bodyHasDiscount = /discount|coupon applied|promo applied|\$0\.00|100%/i.test(bodyText || "");

    const discountLineVisible = await discountLine.isVisible({ timeout: 8_000 }).catch(() => false);
    let couponConfirmed = discountLineVisible || bodyHasDiscount;

    if (discountLineVisible) {
      const discountText = await discountLine.textContent().catch(() => "");
      log(`  ✅ Coupon confirmed! Stripe discount element: "${discountText?.trim()}"`);
    } else if (bodyHasDiscount) {
      log("  ✅ Coupon confirmed via page body text (discount/promo keyword detected)");
    } else {
      log("  ⚠️  Coupon validation unconfirmed — no discount indicator found in DOM");
      couponConfirmed = false;
    }

    log("─".repeat(60));

    if (couponConfirmed) {
      log("✅ SUCCESS — Stripe checkout reached and promo code applied.");
      log(`   Coupon : ${COUPON_CODE}`);
      log(`   URL    : ${page.url().substring(0, 100)}`);
      log("─".repeat(60));
      log("ℹ️  Browser will remain open for 30 seconds so you can inspect...");
      await sleep(30_000);
    } else {
      log("❌ PARTIAL — Stripe checkout reached but coupon confirmation was not detected.");
      log(`   Coupon : ${COUPON_CODE}`);
      log(`   URL    : ${page.url().substring(0, 100)}`);
      log("─".repeat(60));
      log("ℹ️  Browser will remain open for 20 seconds so you can inspect...");
      await sleep(20_000);
      process.exitCode = 1;
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ FATAL ERROR: ${msg}`);
    log("  Keeping browser open for 20 seconds for inspection...");
    await sleep(20_000);
    throw err;
  } finally {
    await ctx.close();
    log("🔒 Browser closed.");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Click the primary "Next" or "Continue" button on an onboarding step. */
async function clickNextButton(page: import("playwright").Page) {
  const nextBtn = page
    .getByRole("button", { name: /^next$|^continue$|^next step$/i })
    .or(page.locator('[data-cy*="next" i], [data-testid*="next" i]'))
    .first();

  if (await nextBtn.isVisible({ timeout: 6_000 }).catch(() => false)) {
    await nextBtn.click();
    log("    🖱️  Clicked Next");
  } else {
    log("    ⚠️  Next button not found — trying generic submit...");
    await page.locator('button[type="submit"]').first().click().catch(() => {});
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

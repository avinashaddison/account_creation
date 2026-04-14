import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getFullInbox } from "./smtpDevService";
import { storage } from "./storage";
import { solveAntiTurnstile } from "./capsolverService";

chromium.use(StealthPlugin());

// Suppress unhandled CDPSession errors when proxy browsers are force-closed
process.on("unhandledRejection", (reason: any) => {
  const msg = String(reason?.message ?? reason ?? "");
  if (msg.includes("Target page, context or browser has been closed") ||
      msg.includes("cdpSession.send") ||
      msg.includes("Target closed")) return;
  console.error("[chatgptService] Unhandled rejection:", msg);
});

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

// ── Manual payment confirmation map (email → resolve fn) ─────────────────────
// telegramBot.ts calls resolvePaymentConfirmation(email) when admin taps "Paid"
export const pendingPaymentConfirmations = new Map<string, () => void>();

export function resolvePaymentConfirmation(email: string): boolean {
  const resolve = pendingPaymentConfirmations.get(email.toLowerCase());
  if (resolve) { resolve(); pendingPaymentConfirmations.delete(email.toLowerCase()); return true; }
  return false;
}

// ── Telegram Bot 1 (admin) helpers ────────────────────────────────────────────
async function sendPhotoToAdminBot(
  imageBuffer: Buffer,
  chatId: number | string,
  caption: string,
  inlineKeyboard?: object,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.error("[ChatGPT/Plus] TELEGRAM_BOT_TOKEN not set"); return; }
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([imageBuffer], { type: "image/png" }), "chatgpt_qr.png");
    if (inlineKeyboard) form.append("reply_markup", JSON.stringify(inlineKeyboard));
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
    const json = await resp.json() as any;
    if (!json.ok) console.error("[ChatGPT/Plus] sendPhoto failed:", JSON.stringify(json));
  } catch (e: any) { console.error("[ChatGPT/Plus] sendPhotoToAdminBot error:", e.message); }
}

async function sendTextToAdminBot(chatId: number | string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: "HTML" }),
  }).catch(() => {});
}

// ── Locate element across main page and all iframes ───────────────────────────
async function findInPageOrFrames(page: any, selectors: string[], timeout = 2000): Promise<any | null> {
  // Try main page first
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout }).catch(() => false)) return el;
  }
  // Try each iframe
  for (const frame of page.frames()) {
    if (!frame.url() || frame.url() === "about:blank") continue;
    for (const sel of selectors) {
      try {
        const el = frame.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) return el;
      } catch { /* skip */ }
    }
  }
  return null;
}

// ── Fresh login helper for proxy browser ─────────────────────────────────────
async function loginOnProxyBrowser(page: any, email: string, password: string, log: (msg: string) => void): Promise<boolean> {
  log("[ChatGPT/Plus] Logging in on proxy browser…");
  await page.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(4000);
  log(`[ChatGPT/Plus] Login page URL: ${page.url()}`);

  // Click "Log in" if we're on the landing page
  const loginBtnEl = page.locator('a[href*="login"], button:text("Log in")').first();
  if (await loginBtnEl.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginBtnEl.click();
    await sleep(3000);
  }

  // Look for email input (might be on a modal or a dedicated auth page)
  const emailInput = await page.$("input[type=email], input[name=email], input[id*=email]");
  if (!emailInput) {
    // Try navigating to auth.openai.com login
    await page.goto("https://auth.openai.com/authorize?response_type=code&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Flogin-web&client_id=pdlLIX2Y72MIl2rhLhTE9VV9bN9LdLpi&scope=openid+profile+email+offline_access&audience=https%3A%2F%2Fapi.openai.com%2Fv1&prompt=login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(4000);
  }

  const emailInputEl = await page.$("input[type=email], input[name=email]");
  if (!emailInputEl) { log("[ChatGPT/Plus] No email input found on login page"); return false; }

  await emailInputEl.fill(email);
  await page.keyboard.press("Enter");
  await sleep(3000);

  const pwInputEl = await page.$("input[type=password], input[name=password]");
  if (!pwInputEl) { log("[ChatGPT/Plus] No password input found"); return false; }

  await pwInputEl.fill(password);
  await page.keyboard.press("Enter");
  await sleep(7000);

  const finalUrl = page.url();
  log(`[ChatGPT/Plus] After login URL: ${finalUrl}`);
  return finalUrl.includes("chatgpt.com") && !finalUrl.includes("login") && !finalUrl.includes("auth.openai.com");
}

// ── Plus free trial subscription via UPI ─────────────────────────────────────
export async function subscribePlusWithUPI(opts: {
  page: any;
  email: string;
  password: string;
  notifyTelegramId: number | string;
  log: (msg: string) => void;
}): Promise<void> {
  const { page, email, password, notifyTelegramId, log } = opts;

  // A0: Ensure we're logged in on the proxy browser
  log("[ChatGPT/Plus] Checking login state on proxy browser…");
  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(4000);
  const landingUrl = page.url();
  log(`[ChatGPT/Plus] Landing URL: ${landingUrl}`);

  // Check for presence of "Log in" button — if visible, we're not logged in
  const notLoggedIn = await page.locator('a[href*="login"], button:text("Log in"), a:text("Log in")').first().isVisible({ timeout: 3000 }).catch(() => false);
  if (notLoggedIn) {
    log("[ChatGPT/Plus] Session not active on proxy — doing fresh login…");
    const loginOk = await loginOnProxyBrowser(page, email, password, log);
    if (!loginOk) throw new Error("Failed to log in on proxy browser");
    log("[ChatGPT/Plus] Fresh login successful");
  } else {
    log("[ChatGPT/Plus] Already logged in on proxy browser");
  }

  // A: Navigate to pricing page
  log("[ChatGPT/Plus] Navigating to chatgpt.com/pricing…");
  await page.goto("https://chatgpt.com/pricing", { waitUntil: "networkidle", timeout: 40_000 }).catch(async () => {
    // If networkidle times out, just wait for load
    await page.waitForLoadState("load").catch(() => {});
  });
  await sleep(6000);
  log(`[ChatGPT/Plus] Pricing URL: ${page.url()}`);

  // Scroll pricing cards into view so lazy-loaded content renders
  await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
  await sleep(3000);

  // B: Switch to "Personal" / "Individual" tab if present
  const personalBtn = await findInPageOrFrames(page, [
    'button:has-text("Individual")', '[role="tab"]:has-text("Individual")',
    'button:has-text("Personal")',   '[role="tab"]:has-text("Personal")',
  ], 4000);
  if (personalBtn) {
    await personalBtn.click();
    await sleep(2500);
    log("[ChatGPT/Plus] Switched to Individual tab");
  }

  // Log all button texts for debugging
  const allBtns = await page.evaluate(() =>
    [...document.querySelectorAll("button, a[href]")]
      .map(b => b.textContent?.trim().replace(/\s+/g, " "))
      .filter(t => t && t.length > 2 && t.length < 80)
  ).catch(() => []);
  log(`[ChatGPT/Plus] Pricing page buttons: ${JSON.stringify([...new Set(allBtns)].slice(0, 30))}`);

  // C: Find the Plus plan button using JS — look for a button/link near a "Plus" heading
  // This avoids clicking the "Upgrade" nav link by finding the button inside the pricing card
  const claimBtnHandle = await page.evaluateHandle(() => {
    const allLinks = [...document.querySelectorAll("button, a")];

    // Priority 1: Button with specific Plus-upgrade texts
    const plusTexts = [
      "claim free offer", "get plus", "upgrade to plus", "start free trial",
      "try plus", "subscribe to plus", "get chatgpt plus",
    ];
    const byText = allLinks.find(el => {
      const t = el.textContent?.trim().toLowerCase() ?? "";
      return plusTexts.some(pt => t === pt || t.startsWith(pt));
    });
    if (byText) return byText;

    // Priority 2: A button that is a sibling/child of a "Plus" plan section
    const plusSection = [...document.querySelectorAll("h2, h3, h4, [class*='plan'], [class*='tier']")]
      .find(el => /\bplus\b/i.test(el.textContent ?? ""));
    if (plusSection) {
      const container = plusSection.closest("section, article, div[class*='card'], div[class*='plan'], div[class*='tier']") ?? plusSection.parentElement?.parentElement;
      if (container) {
        const btn = container.querySelector("button, a[href*='checkout'], a[href*='upgrade']");
        if (btn) return btn;
      }
    }
    return null;
  }).catch(() => null);

  const claimBtn = claimBtnHandle && await claimBtnHandle.asElement() ? claimBtnHandle.asElement() : null;

  if (!claimBtn) {
    const dbgShot = await page.screenshot({ type: "png" }) as Buffer;
    await sendPhotoToAdminBot(dbgShot, notifyTelegramId,
      `⚠️ <b>Pricing page — Plus button not found</b>\n\nAccount: <code>${email}</code>\n\nButtons seen: ${JSON.stringify([...new Set(allBtns)].slice(0, 20))}`
    );
    throw new Error("Could not find Plus upgrade button on pricing page");
  }
  // D: Get checkout URL via ChatGPT backend API using the session cookies from this browser
  const btnText = await claimBtn.evaluate((el: Element) => el.textContent?.trim()).catch(() => "?");
  log(`[ChatGPT/Plus] Plus button found: "${btnText}"`);

  const isCheckout = (url: string) => url.includes("checkout") || url.includes("stripe.com") || url.includes("pay.openai");

  // Set up response interception to capture any checkout URL from network traffic
  let capturedCheckoutUrl: string | null = null;
  const capturedApiCalls: Array<{ url: string; status: number; bodyPreview: string }> = [];

  await page.route("**/backend-api/**", async (route: any) => {
    const req = route.request();
    try {
      const resp = await route.fetch();
      const text = await resp.text().catch(() => "");
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      const foundUrl = data?.url || data?.checkout_url || data?.redirect_url || data?.session_url;
      if (foundUrl && isCheckout(foundUrl) && !capturedCheckoutUrl) {
        capturedCheckoutUrl = foundUrl;
      }
      capturedApiCalls.push({ url: req.url(), status: resp.status(), bodyPreview: text.slice(0, 300) });
      await route.fulfill({ response: resp, body: text });
    } catch {
      await route.continue();
    }
  }).catch(() => {});

  // D1: Get accessToken from /api/auth/session, then call backend-api for checkout URL
  let checkoutUrl: string | null = null;
  try {
    log("[ChatGPT/Plus] Fetching session to get accessToken…");
    checkoutUrl = await page.evaluate(async () => {
      // Step 1: Get accessToken + account info from /api/auth/session
      const sessionResp = await fetch("/api/auth/session", { credentials: "include" });
      const session = await sessionResp.json() as any;
      const accessToken = session?.accessToken;
      const accountId   = session?.account?.id;
      if (!accessToken) return null;

      const authHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      };

      // Step 2: Try known checkout endpoints with Bearer token
      const checkoutEndpoints = [
        {
          url: "/backend-api/purchases/checkout_session",
          body: { plan_type: "monthly", return_url: "https://chatgpt.com/" },
        },
        {
          url: "/backend-api/subscriptions",
          body: { plan_type: "monthly", account_id: accountId },
        },
        {
          url: "/backend-api/me/subscription/upgrade",
          body: { plan: "chatgpt_plus", interval: "monthly", return_url: "https://chatgpt.com/" },
        },
        {
          url: "/backend-api/checkout",
          body: { plan_type: "chatgpt_plus_monthly", return_url: "https://chatgpt.com/" },
        },
      ];

      for (const ep of checkoutEndpoints) {
        try {
          const resp = await fetch(ep.url, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify(ep.body),
            credentials: "include",
          });
          const text = await resp.text();
          let data: any = {};
          try { data = JSON.parse(text); } catch { /* raw */ }
          const url = data?.url || data?.checkout_url || data?.redirect_url || data?.session_url || data?.stripe_url;
          if (url && (url.includes("checkout") || url.includes("stripe"))) return url;
          // Also log for debug
          if (!resp.ok || true) {
            (window as any).__checkoutLog = (window as any).__checkoutLog ?? [];
            (window as any).__checkoutLog.push({ ep: ep.url, status: resp.status, preview: text.slice(0, 200) });
          }
        } catch { /* skip */ }
      }
      return null;
    }).catch(() => null);

    // Retrieve debug log from page
    const checkoutLog = await page.evaluate(() => (window as any).__checkoutLog ?? []).catch(() => []);
    if (checkoutLog.length > 0) log(`[ChatGPT/Plus] API attempts: ${JSON.stringify(checkoutLog)}`);
    if (checkoutUrl) log(`[ChatGPT/Plus] API checkout URL: ${checkoutUrl.slice(0, 120)}`);
  } catch (e: any) { log(`[ChatGPT/Plus] API checkout error: ${e.message}`); }

  if (checkoutUrl) {
    // Navigate to the API-provided checkout URL
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(4000);
    log(`[ChatGPT/Plus] Checkout page URL: ${page.url()}`);
  } else {
    // D1.5: Click the claim button and intercept the resulting backend-api call
    log("[ChatGPT/Plus] D1 API call found no URL — clicking claim button to capture network…");
    await claimBtn.click({ force: true }).catch(async () => {
      await claimBtn.evaluate((el: Element) => (el as HTMLElement).click());
    });
    await sleep(6000); // Allow XHR to complete
    if (capturedApiCalls.length > 0) {
      log(`[ChatGPT/Plus] Intercepted API calls: ${JSON.stringify(capturedApiCalls.map(c => ({ url: c.url, status: c.status, body: c.bodyPreview.slice(0, 150) })))}`);
    }
    if (capturedCheckoutUrl) {
      log(`[ChatGPT/Plus] Captured checkout URL via interception: ${capturedCheckoutUrl.slice(0, 120)}`);
      await page.unroute("**/backend-api/**").catch(() => {});
      await page.goto(capturedCheckoutUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(4000);
      log(`[ChatGPT/Plus] Checkout page URL: ${page.url()}`);
    } else if (isCheckout(page.url())) {
      log(`[ChatGPT/Plus] Claim button navigated directly to checkout: ${page.url()}`);
    } else {
      // D2: Fallback — navigate to explore/plus and handle redirect
    const btnHref = await claimBtn.evaluate((el: Element) => (el as HTMLAnchorElement).href ?? "").catch(() => "");
    const exploreUrl = btnHref || "https://chatgpt.com/explore/plus";
    log(`[ChatGPT/Plus] API checkout failed — navigating to ${exploreUrl}…`);
    await page.goto(exploreUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(5000);
    log(`[ChatGPT/Plus] After explore/plus URL: ${page.url()}`);

    // If we landed on #pricing (home page), look for checkout button there
    if (page.url().includes("#pricing") || page.url() === "https://chatgpt.com/" || page.url() === "https://chatgpt.com") {
      log("[ChatGPT/Plus] Landed on home #pricing — checking session & looking for upgrade button…");
      await sleep(4000);

      // Check if still logged in by calling /api/auth/session
      const sessionInfo = await page.evaluate(async () => {
        try {
          const resp = await fetch("/api/auth/session", { credentials: "include" });
          const data = await resp.json() as any;
          return { ok: resp.ok, email: data?.user?.email ?? null, hasSession: !!data?.user };
        } catch { return { ok: false, email: null, hasSession: false }; }
      }).catch(() => ({ ok: false, email: null, hasSession: false }));
      log(`[ChatGPT/Plus] Session check: ${JSON.stringify(sessionInfo)}`);

      // Screenshot for debug
      const dbgShot = await page.screenshot({ type: "png" }) as Buffer;
      await sendPhotoToAdminBot(dbgShot, notifyTelegramId,
        `ℹ️ <b>Plus — landed on home #pricing</b>\n\nAccount: <code>${email}</code>\nSession: ${JSON.stringify(sessionInfo)}\n\nLooking for upgrade button…`
      );

      // Look for all buttons/links on the page for logging
      const allBtns2 = await page.evaluate(() =>
        [...document.querySelectorAll("button, a")]
          .map((b: any) => b.textContent?.trim()?.slice(0, 40))
          .filter((t: any) => t && t.length > 1)
      ).catch(() => []);
      log(`[ChatGPT/Plus] Home page buttons: ${JSON.stringify([...new Set(allBtns2)].slice(0, 20))}`);

      // Look for "Claim offer" button (shown on home page for new Plus-eligible users)
      const claimOfferSelectors = [
        'button:has-text("Claim offer")', 'a:has-text("Claim offer")',
        'button:has-text("Claim free offer")', 'a:has-text("Claim free offer")',
        'button:has-text("Claim")',
        'button:has-text("Upgrade to Plus")', 'a:has-text("Upgrade to Plus")',
        'button:has-text("Get Plus")',
        'button:has-text("Upgrade")',
      ];
      // Helper: check if a Stripe payment form is now embedded in the page
      const stripeFrameVisible = async (): Promise<boolean> => {
        const frames = page.frames();
        return frames.some((f: any) => {
          const u = f.url();
          return u.includes("stripe.com") || u.includes("js.stripe.com") || u.includes("stripe-js");
        }) || await page.evaluate(() =>
          !!document.querySelector('iframe[src*="stripe"], [data-stripe], #modal-account-payment iframe, #modal-account-payment [class*="stripe"]')
        ).catch(() => false);
      };

      const claimOfferBtn = await findInPageOrFrames(page, claimOfferSelectors, 8000);
      if (claimOfferBtn) {
        const claimText = await claimOfferBtn.evaluate((el: Element) => el.textContent?.trim()).catch(() => "?");
        log(`[ChatGPT/Plus] Found offer button: "${claimText}" — clicking…`);
        // Use force:true to bypass any overlay interception (modal-account-payment covers viewport)
        await claimOfferBtn.click({ force: true }).catch(async () => {
          await claimOfferBtn.evaluate((el: Element) => (el as HTMLElement).click());
        });
        await sleep(5000);
        const afterClickUrl = page.url();
        log(`[ChatGPT/Plus] After claim click URL: ${afterClickUrl}`);

        // If URL didn't change to checkout, look for embedded Stripe modal
        if (!isCheckout(afterClickUrl)) {
          const hasStripe = await stripeFrameVisible();
          if (hasStripe) {
            log("[ChatGPT/Plus] Stripe embedded modal detected — skipping URL check, proceeding to UPI…");
            // Unroute, clean up, and jump straight to UPI selection
            await page.unroute("**/backend-api/**").catch(() => {});
            await sleep(2000);
            // Goto E-G handling below — break out of D2
            // We fall through to the UPI section by not throwing
          } else {
            // Claim offer button might open a nested modal — look for inner pricing modal button
            log("[ChatGPT/Plus] No Stripe frame after click — looking for modal inner button…");
            const innerBtn = await findInPageOrFrames(page, [
              '#modal-account-payment button:has-text("Continue")',
              '#modal-account-payment button:has-text("Claim")',
              '#modal-account-payment button:has-text("Subscribe")',
              '#modal-account-payment button:has-text("Get Plus")',
            ], 5000);
            if (innerBtn) {
              const innerText = await innerBtn.evaluate((el: Element) => el.textContent?.trim()).catch(() => "?");
              log(`[ChatGPT/Plus] Found modal inner button: "${innerText}" — clicking…`);
              await innerBtn.click({ force: true }).catch(async () => {
                await innerBtn.evaluate((el: Element) => (el as HTMLElement).click());
              });
              await sleep(5000);
              log(`[ChatGPT/Plus] After inner button URL: ${page.url()}`);
            }
          }
        }
      } else {
        // No claim button — try href-based buttons
        const homeCheckoutBtns = await page.evaluate(() =>
          [...document.querySelectorAll("button, a[href]")]
            .map((b: any) => ({ text: b.textContent?.trim().toLowerCase(), href: b.href ?? "" }))
            .filter((b: any) => b.href.includes("checkout") || b.href.includes("stripe") ||
              b.text.includes("get plus") || b.text.includes("upgrade to plus") || b.text.includes("upgrade"))
        ).catch(() => []);
        log(`[ChatGPT/Plus] Home checkout buttons: ${JSON.stringify(homeCheckoutBtns.slice(0, 5))}`);
        if (homeCheckoutBtns.length > 0) {
          const btn = homeCheckoutBtns.find((b: any) => b.href.includes("checkout") || b.href.includes("stripe")) ?? homeCheckoutBtns[0];
          if (btn.href) {
            await page.goto(btn.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await sleep(4000);
            log(`[ChatGPT/Plus] After home btn click URL: ${page.url()}`);
          }
        }
      }
    }

    // Only wait for URL if we didn't detect an embedded Stripe modal
    const hasStripeNow = await (async () => {
      const frames = page.frames();
      return frames.some((f: any) => f.url().includes("stripe.com")) ||
        await page.evaluate(() => !!document.querySelector('iframe[src*="stripe"], #modal-account-payment iframe')).catch(() => false);
    })();

    if (!isCheckout(page.url()) && !hasStripeNow) {
      await page.waitForURL((url: URL) => isCheckout(url.toString()), { timeout: 20_000 }).catch(async () => {
        const dbgShot = await page.screenshot({ type: "png" }) as Buffer;
        await sendPhotoToAdminBot(dbgShot, notifyTelegramId,
          `⚠️ <b>Plus — checkout not reached</b>\n\nURL: ${page.url()}\nAccount: <code>${email}</code>`
        );
        throw new Error(`Checkout not reached — current URL: ${page.url()}`);
      });
    } else if (hasStripeNow) {
      log("[ChatGPT/Plus] Stripe embedded payment form active — proceeding to UPI selection…");
    }
    } // end D2 fallback else
  } // end D1.5 else
  await page.unroute("**/backend-api/**").catch(() => {});
  log(`[ChatGPT/Plus] Checkout page ready — URL: ${page.url()}`);
  await sleep(4000);

  // E: Select UPI payment method
  // Indian IP (via proxy) causes Stripe to show UPI natively — poll for it
  const upiSelectors = [
    '[role="tab"]:has-text("UPI")',
    'button:has-text("UPI")',
    'label:has-text("UPI")',
    '[data-testid*="upi" i]',
    'div[class*="Tab"]:has-text("UPI")',
    'p:has-text("UPI")',
    'span:has-text("UPI")',
  ];

  let upiEl: any = null;
  for (let attempt = 0; attempt < 5 && !upiEl; attempt++) {
    upiEl = await findInPageOrFrames(page, upiSelectors, 5000);
    if (!upiEl) {
      log(`[ChatGPT/Plus] Waiting for UPI option… (${attempt + 1}/5)`);
      await sleep(3000);
    }
  }

  if (upiEl) {
    await upiEl.click();
    await sleep(2000);
    log("[ChatGPT/Plus] UPI payment method selected");
  } else {
    log("[ChatGPT/Plus] UPI option not found — sending debug screenshot");
    const dbgShot = await page.screenshot({ type: "png" }) as Buffer;
    await sendPhotoToAdminBot(dbgShot, notifyTelegramId,
      `⚠️ <b>Debug: UPI tab not found</b>\n` +
      `Account: <code>${email}</code>\n\n` +
      `UPI did not appear on the checkout. Check screenshot.\n` +
      `Frames: ${page.frames().map((f: any) => f.url().slice(0, 80)).join(", ")}`
    );
    throw new Error("UPI payment option not found on checkout page");
  }

  // F: Fill billing address (India)
  async function fillBillingField(selectors: string[], value: string): Promise<void> {
    const el = await findInPageOrFrames(page, selectors, 3000);
    if (!el) return;
    try {
      await el.click({ clickCount: 3 });
      await el.fill(value);
    } catch { /* ignore */ }
  }

  await fillBillingField(
    ['[placeholder*="Full name" i]', '[autocomplete="name"]', '#billing-name', 'input[name="name"]', 'input[name="fullName"]'],
    "AJAY KUMAR"
  );
  await fillBillingField(
    ['[placeholder*="Address line 1" i]', '[autocomplete="address-line1"]', 'input[name="addressLine1"]', '#billing-address-1'],
    "Near Main Road, Ranchi"
  );
  await fillBillingField(
    ['[placeholder*="City" i]', '[autocomplete="address-level2"]', 'input[name="city"]', '#billing-city'],
    "Ranchi"
  );
  await fillBillingField(
    ['[placeholder*="PIN" i]', '[placeholder*="Postal" i]', '[placeholder*="Zip" i]', '[autocomplete="postal-code"]', 'input[name="postalCode"]', '#billing-postal'],
    "834005"
  );

  // State dropdown (Jharkhand for India)
  const stateDropdown = await findInPageOrFrames(page, [
    'select[autocomplete="address-level1"]', 'select[name*="state" i]', 'select[id*="state" i]',
    'select[data-elements-stable-field-name="state"]',
  ], 4000);
  if (stateDropdown) {
    await stateDropdown.selectOption({ label: "Jharkhand" }).catch(() =>
      stateDropdown.selectOption({ value: "JH" }).catch(() => {})
    );
  }

  log("[ChatGPT/Plus] Billing address filled (India)");
  await sleep(1500);

  // G: Click Subscribe
  const subscribeBtn = await findInPageOrFrames(page, [
    'button:has-text("Subscribe")', 'button[type="submit"]:has-text("Subscribe")',
    'button:has-text("Start free trial")', 'button:has-text("Confirm")',
  ], 10000);
  if (!subscribeBtn) throw new Error("Subscribe button not found on checkout page");
  await subscribeBtn.click();
  log("[ChatGPT/Plus] Clicked Subscribe");
  await sleep(6000);

  // H: Capture QR screenshot — poll for QR image to appear (in any frame)
  log("[ChatGPT/Plus] Waiting for QR code…");
  let qrScreenshot: Buffer | null = null;
  for (let i = 0; i < 15; i++) {
    const hasQR = await page.evaluate(() => {
      return [...document.querySelectorAll("img")].some(
        img => img.naturalWidth >= 80 && img.naturalWidth <= 500 && img.naturalHeight >= 80
      );
    }).catch(() => false);
    if (hasQR) {
      await sleep(800); // wait for full render
      qrScreenshot = await page.screenshot({ type: "png" }) as Buffer;
      log("[ChatGPT/Plus] QR screenshot captured");
      break;
    }
    await sleep(2000);
  }
  if (!qrScreenshot) {
    // Capture whatever is on screen
    qrScreenshot = await page.screenshot({ type: "png" }) as Buffer;
    log("[ChatGPT/Plus] Screenshot taken (QR may be in Stripe iframe)");
  }

  // I: Send QR screenshot to Bot 1 (admin) with "Payment Done" button
  const emailKey = email.toLowerCase();
  const manualConfirmPromise = new Promise<void>(resolve => {
    pendingPaymentConfirmations.set(emailKey, resolve);
  });

  await sendPhotoToAdminBot(
    qrScreenshot,
    notifyTelegramId,
    `🔐 <b>ChatGPT Plus — UPI QR Code</b>\n\n` +
    `Account: <code>${email}</code>\n\n` +
    `Scan this QR with your UPI app to activate 1 month free Plus.\n` +
    `<i>Tap the button below after you complete the payment.</i>`,
    {
      inline_keyboard: [[
        { text: "✅ Payment Done", callback_data: `plus_paid:${email}` },
      ]],
    }
  );
  log(`[ChatGPT/Plus] QR sent to admin Bot 1 (${notifyTelegramId}) — waiting for manual confirmation`);

  // J: Race between manual button tap AND auto-detection (page URL change)
  log("[ChatGPT/Plus] Waiting for payment (manual button or auto-detect, up to 30 min)…");

  const autoDetectPromise = (async () => {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await sleep(5000);
      const url = page.url();
      const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 600) ?? "").catch(() => "");
      const isSuccess = url.includes("success") || url.includes("confirmed")
        || txt.toLowerCase().includes("payment successful")
        || txt.toLowerCase().includes("you're subscribed")
        || txt.toLowerCase().includes("subscription active")
        || txt.toLowerCase().includes("plus plan")
        || (url.startsWith("https://chatgpt.com/") && !url.includes("checkout") && !url.includes("pricing"));
      if (isSuccess) { log("[ChatGPT/Plus] Auto-detected payment success"); return; }
    }
  })();

  await Promise.race([manualConfirmPromise, autoDetectPromise]);
  pendingPaymentConfirmations.delete(emailKey); // clean up if auto-detected

  log("[ChatGPT/Plus] Payment confirmed — capturing success screenshot…");
  await sleep(3000);
  const successShot = await page.screenshot({ type: "png" }) as Buffer;
  await sendPhotoToAdminBot(
    successShot,
    notifyTelegramId,
    `✅ <b>ChatGPT Plus Activated!</b>\n\nAccount: <code>${email}</code>\n\nFree 1-month Plus trial is now active.`
  );
  log("[ChatGPT/Plus] Done — Plus activated!");
}

// ── Main automation ──────────────────────────────────────────────────────────
export async function createChatGPTAccount(opts: {
  email: string;
  smtpDevId: string;
  mailPassword: string;
  subscribeAfter?: boolean;
  adminTelegramId?: number | string;
  log?: (msg: string) => void;
}): Promise<ChatGPTResult> {
  const { email, smtpDevId, mailPassword, subscribeAfter = false, adminTelegramId, log = console.log } = opts;
  const { first, last } = randomName();
  const age = randomAge();
  const accountPassword = generatePassword();
  let browser: any;

  try {
    // Use non-headless if DISPLAY is set (xvfb-run), otherwise headless
    const hasDisplay = !!process.env.DISPLAY;
    const BROWSER_ARGS = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1280,800",
      "--lang=en-US",
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--enable-webgl2",
    ];
    const CONTEXT_OPTS = {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    };
    // Account CREATION: NO proxy — the Indian proxy blocks auth.openai.com JS rendering
    browser = await chromium.launch({ headless: !hasDisplay, args: BROWSER_ARGS });

    const context = await browser.newContext(CONTEXT_OPTS);

    // Comprehensive stealth: mask all bot-detection signals including WebGL, canvas, screen
    await context.addInitScript(() => {
      // 1. Navigator signals
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      Object.defineProperty(navigator, "platform", { get: () => "Win32" });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });

      // 2. Chrome runtime
      (window as any).chrome = {
        runtime: { id: "chrome-extension", onMessage: { addListener: () => {} } },
        loadTimes: () => ({}),
        csi: () => ({}),
        app: { isInstalled: false },
      };

      // 3. Permissions
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        Object.defineProperty(navigator, "permissions", {
          get: () => ({
            query: (p: any) => p.name === "notifications"
              ? Promise.resolve({ state: "prompt" } as PermissionStatus)
              : originalQuery.call(navigator.permissions, p),
          }),
        });
      }

      // 4. WebGL vendor/renderer masking (prevents SwiftShader detection)
      const origGetParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter: number) {
        if (parameter === 37445) return "Intel Inc.";          // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return "Intel Iris OpenGL Engine"; // UNMASKED_RENDERER_WEBGL
        return origGetParam.call(this, parameter);
      };
      if (typeof WebGL2RenderingContext !== "undefined") {
        const origGet2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter: number) {
          if (parameter === 37445) return "Intel Inc.";
          if (parameter === 37446) return "Intel Iris OpenGL Engine";
          return origGet2.call(this, parameter);
        };
      }

      // 5. Screen properties (match viewport)
      Object.defineProperty(screen, "width", { get: () => 1280 });
      Object.defineProperty(screen, "height", { get: () => 800 });
      Object.defineProperty(screen, "availWidth", { get: () => 1280 });
      Object.defineProperty(screen, "availHeight", { get: () => 800 });
      Object.defineProperty(screen, "colorDepth", { get: () => 24 });
      Object.defineProperty(screen, "pixelDepth", { get: () => 24 });

      // 6. Window outer dimensions
      Object.defineProperty(window, "outerWidth", { get: () => 1280 });
      Object.defineProperty(window, "outerHeight", { get: () => 800 });

      // 7. Remove cdc_ properties (Playwright/Selenium automation markers)
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });

    const page = await context.newPage();

    // Pre-snapshot inbox so we only read new messages later
    const existingMsgs = await getFullInbox(smtpDevId).catch(() => [] as any[]);
    const existingIds  = new Set((existingMsgs as any[]).map((m: any) => m.id));

    // ── Step 1: Open chatgpt.com and click "Sign up" ─────────────────────────
    log(`[ChatGPT] Opening chatgpt.com…`);
    await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Wait for Cloudflare "Just a moment..." to pass (up to 30s)
    const title1 = await page.title();
    if (title1 === "Just a moment..." || title1 === "") {
      log(`[ChatGPT] CF challenge detected — waiting up to 30s…`);
      await page.waitForFunction(
        () => document.title !== "Just a moment..." && document.title !== "",
        { timeout: 30_000 }
      ).catch(() => log("[ChatGPT] CF still present after 30s"));
    }
    await sleep(3000);

    // ── Step 2: Click "Sign up for free" (via JS to bypass actionability issues)
    log(`[ChatGPT] Looking for Sign up button…`);
    const signupTexts = ["sign up", "get started", "start for free", "try chatgpt", "create account"];
    const signupClicked = await page.evaluate((texts: string[]) => {
      const btn = [...document.querySelectorAll("button, a")].find(b => {
        const t = b.textContent?.trim().toLowerCase() ?? "";
        return texts.some(x => t.includes(x));
      });
      if (btn) { (btn as HTMLElement).click(); return true; }
      return false;
    }, signupTexts);

    if (!signupClicked) {
      const pageTitle = await page.title();
      const pageText = (await page.evaluate(() => document.body.innerText?.slice(0, 200) ?? "")).replace(/\n+/g," ").trim();
      log(`[ChatGPT] chatgpt.com title: "${pageTitle}" | text: ${pageText.slice(0,80)}`);
      // Wait a bit more and retry
      await sleep(4000);
      await page.evaluate((texts: string[]) => {
        const btn = [...document.querySelectorAll("button, a")].find(b =>
          texts.some(x => (b.textContent?.trim().toLowerCase() ?? "").includes(x))
        );
        if (btn) (btn as HTMLElement).click();
      }, signupTexts);
    }
    await sleep(4000);
    await solveTurnstileIfPresent(page, log);
    await sleep(1500);

    // ── Step 2b: Wait for email input — either in a modal or on auth page ────
    // chatgpt.com now shows an in-page modal with email input after clicking Sign Up
    log(`[ChatGPT] Waiting for email input (modal or auth page)…`);
    await page.waitForSelector(
      'input[type="email"], input[name="email"], input[id*="email"], input[placeholder*="email" i]',
      { timeout: 25_000 }
    ).catch(async () => {
      log("[ChatGPT] Email not in modal after 25s — trying direct auth URL…");
      const DIRECT_URL =
        "https://auth.openai.com/authorize" +
        "?client_id=app_X8zY6vW2pQ9tR3dE7nK1jL5gH" +
        "&scope=openid%20email%20profile%20offline_access%20model.request%20model.read%20organization.read%20organization.write" +
        "&response_type=code" +
        "&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fapi%2Fauth%2Fcallback%2Fopenai" +
        "&audience=https%3A%2F%2Fapi.openai.com%2Fv1" +
        "&screen_hint=signup";
      await page.goto(DIRECT_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(8000);
      log(`[ChatGPT] Direct URL — now at: ${new URL(page.url()).hostname}`);
    });

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
    log(`[ChatGPT] Email submitted — waiting for navigation…`);

    // Wait for page to load after email submission (navigation may happen)
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
    await sleep(3000);

    // ── Step 4: Set account password ────────────────────────────────────────
    let urlAfterEmail = page.url();
    let contentAfterEmail = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? "").catch(() => "");
    log(`[ChatGPT] URL: ${urlAfterEmail}`);

    // NEW OpenAI flow: combined login_or_signup authorize page — re-submit email there
    if (urlAfterEmail.includes("api/accounts/authorize") && urlAfterEmail.includes("login_or_signup")) {
      log(`[ChatGPT] Combined auth page detected`);
      // Log page content for diagnosis
      const authContent = await page.evaluate(() => document.body.innerText?.slice(0, 400) ?? "");
      log(`[ChatGPT] Auth page content: ${authContent.replace(/\n+/g, " ").trim()}`);

      // If Cloudflare bot verification is blocking, wait for it to auto-resolve
      if (/security verification|just a moment|checking your browser|verif/i.test(authContent)) {
        log(`[ChatGPT] CF bot check on auth.openai.com — waiting for auto-resolve (up to 30s)…`);
        await page.waitForFunction(
          () => !/security verification|just a moment|checking your browser/i.test(document.body.innerText ?? ""),
          { timeout: 30_000 }
        ).catch(() => log("[ChatGPT] CF bot check still present after 30s"));
        await sleep(3000);
        const resolvedContent = await page.evaluate(() => document.body.innerText?.slice(0, 200) ?? "");
        log(`[ChatGPT] Post-CF content: ${resolvedContent.replace(/\n+/g, " ").trim()}`);
      }

      // Solve Turnstile if still present
      await solveTurnstileIfPresent(page, log);
      await sleep(1500);

      // Try to find email input on this page
      const authEmailInput = await page.$('input[name="email"], input[type="email"], input[id*="email"]');
      log(`[ChatGPT] Email input found on auth page: ${!!authEmailInput}`);
      if (authEmailInput) {
        await authEmailInput.click();
        await page.keyboard.press("Control+a");
        await authEmailInput.fill(email);
        await sleep(500);
      }

      // Click "Continue" or "Sign up" button
      const cont2 = await jsClick(page, "Continue");
      log(`[ChatGPT] Auth-page Continue clicked: ${cont2}`);
      if (!cont2) {
        const signupBtn = await page.evaluate(() => {
          const btn = [...document.querySelectorAll("button, a")].find(b => {
            const t = b.textContent?.trim().toLowerCase() ?? "";
            return t.includes("sign up") || t.includes("create account");
          });
          if (btn) { (btn as HTMLElement).click(); return true; }
          return false;
        });
        log(`[ChatGPT] Auth-page Sign up clicked: ${signupBtn}`);
      }
      log(`[ChatGPT] Auth-page submitted — waiting…`);
      await sleep(4000);
      urlAfterEmail = page.url();
      contentAfterEmail = await page.evaluate(() => document.body.innerText?.slice(0, 300) ?? "");
      log(`[ChatGPT] Post-auth-submit URL: ${urlAfterEmail}`);
    }

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

    // ── Step 6: about-you page — Full name + Age ────────────────────────────
    // Actual OpenAI fields: input[name="name"] + input[name="age"] (type=number)
    // The hidden "birthday" field is computed automatically from age.
    log(`[ChatGPT] Waiting for about-you form…`);
    const nameInput = await page.waitForSelector(
      'input[name="name"], input[placeholder="Full name"], input[name="full_name"], input[placeholder*="name" i]',
      { timeout: 20_000 }
    ).catch(() => null);

    if (nameInput) {
      const fullName = `${first} ${last}`;
      log(`[ChatGPT] Filling about-you — ${fullName}, age ${age}`);

      // Keyboard typing is the most reliable for React controlled inputs
      await nameInput.click({ clickCount: 3 }); // triple-click selects all
      await page.keyboard.press("Delete");
      await page.keyboard.type(fullName, { delay: 40 });
      await sleep(300);

      // Age field — keyboard type approach (label may intercept clicks)
      const ageInput = await page.waitForSelector(
        'input[name="age"], input[placeholder="Age"], input[placeholder*="age" i]',
        { timeout: 5_000 }
      ).catch(() => null);

      if (ageInput) {
        try {
          await ageInput.click({ position: { x: 5, y: 5 }, timeout: 5000 });
        } catch {
          await ageInput.scrollIntoViewIfNeeded();
          await page.evaluate(() => {
            (document.querySelector<HTMLInputElement>('input[name="age"]'))?.focus();
          });
        }
        await sleep(200);
        await page.keyboard.press("Control+a");
        await page.keyboard.press("Delete");
        await page.keyboard.type(age, { delay: 50 });
        await page.keyboard.press("Tab"); // blur triggers React state update
        await sleep(400);
        const ageVal = await ageInput.evaluate((el: HTMLInputElement) => el.value).catch(() => "?");
        log(`[ChatGPT] Age set: ${ageVal}`);
      } else {
        // Birthday selects fallback
        const selects = await page.$$("select");
        if (selects.length >= 3) {
          log(`[ChatGPT] Using birthday selects`);
          const birthYear = new Date().getFullYear() - parseInt(age);
          await selects[0].selectOption({ index: 1 }).catch(() => {});
          await selects[1].selectOption({ index: 1 }).catch(() => {});
          await selects[2].selectOption({ value: String(birthYear) }).catch(() => {});
          await sleep(400);
        } else {
          log(`[ChatGPT] No age field found`);
        }
      }

      // Solve any Turnstile before submitting
      await solveTurnstileIfPresent(page, log);
      await sleep(500);

      // Check and click any required checkboxes (ToS)
      await page.evaluate(() => {
        [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].forEach(cb => {
          if (!cb.checked) cb.click();
        });
      }).catch(() => {});

      // Click submit button — try all known text variants
      const submitTexts = ["Finish creating account", "Continue", "Agree", "Next", "Create account", "Done"];
      let clickedText: string | null = null;
      for (const text of submitTexts) {
        const btn = page.locator(`button`).filter({ hasText: text }).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await btn.click({ timeout: 5000 }).catch(() => {});
          clickedText = text;
          log(`[ChatGPT] About-you submit: "${text}"`);
          break;
        }
      }
      if (!clickedText) {
        const formSubmitted = await page.evaluate(() => {
          const form = document.querySelector("form");
          if (form) { form.requestSubmit(); return true; }
          return false;
        }).catch(() => false);
        log(`[ChatGPT] About-you requestSubmit: ${formSubmitted}`);
      }

      // Wait for navigation away from about-you
      await sleep(3000);
      await solveTurnstileIfPresent(page, log);
      await sleep(1000);

      try {
        await page.waitForURL((url: URL) => !url.toString().includes("about-you"), { timeout: 20_000 });
        log(`[ChatGPT] Advanced past about-you`);
      } catch {
        const stuckUrl = page.url();
        if (stuckUrl.includes("about-you")) {
          throw new Error("about-you form did not advance — check age/name validation");
        }
      }
      await sleep(2000);
    } else {
      log(`[ChatGPT] No about-you step`);
    }

    // ── Step 7: Skip optional onboarding / workspace pages ──────────────────
    for (const skipText of ["Skip for now", "Skip", "Maybe later", "Done", "Continue", "Get started", "Go to ChatGPT"]) {
      const skipBtn = page.locator(`button:has-text("${skipText}")`).first();
      if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await skipBtn.click().catch(() => {});
        log(`[ChatGPT] Skipped/continued: ${skipText}`);
        await sleep(1500);
      }
    }

    // If stuck on auth.openai.com/workspace or any auth page, navigate directly to chatgpt.com
    const midUrl = page.url();
    if (midUrl.includes("openai.com") && !midUrl.startsWith("https://chatgpt.com")) {
      log(`[ChatGPT] Stuck at ${midUrl} — navigating directly to chatgpt.com`);
      await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 20_000 });
      await sleep(3000);
    }

    // ── Step 8: Verify fully landed on chatgpt.com ───────────────────────────
    // Must start with chatgpt.com — "includes" would false-positive on redirect_uri params
    try {
      await page.waitForURL((url: URL) => url.toString().startsWith("https://chatgpt.com"), { timeout: 15_000 });
    } catch { /* will check URL below */ }

    const finalUrl = page.url();
    log(`[ChatGPT] Final URL: ${finalUrl}`);

    // Must be on chatgpt.com — NOT still stuck on auth.openai.com
    if (!finalUrl.startsWith("https://chatgpt.com")) {
      throw new Error(`Account not fully set up — stuck at: ${finalUrl}`);
    }

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

    // ── Step 10: Subscribe to Plus via UPI (optional) ────────────────────────
    // Reopen with Indian proxy (needed for Stripe to show UPI), carrying session cookies
    if (subscribeAfter && adminTelegramId) {
      let proxyBrowser: any;
      try {
        // Export cookies from the current (no-proxy) session
        const cookies = await context.cookies();
        const authCookieNames = cookies.filter((c: any) => c.name.includes("token") || c.name.includes("session") || c.name.includes("auth")).map((c: any) => c.name);
        log(`[ChatGPT/Plus] Exporting ${cookies.length} cookies — auth cookies: ${JSON.stringify(authCookieNames)}`);
        log("[ChatGPT/Plus] Transferring session to Indian proxy browser…");

        // Generate a fresh proxy session ID each time (avoids expired sessions)
        const proxySessionId = Math.random().toString(36).slice(2, 12).toUpperCase();
        proxyBrowser = await chromium.launch({
          headless: !hasDisplay,
          proxy: {
            server: "http://proxy.nsocks.com:2312",
            username: `ns-mrqq7v2x6zlr_area-IN_session-${proxySessionId}_life-30`,
            password: process.env.NSOCKS_PROXY_PASSWORD ?? "",
          },
          args: BROWSER_ARGS,
        });
        log(`[ChatGPT/Plus] Proxy session ID: ${proxySessionId}`);
        const proxyCtx = await proxyBrowser.newContext(CONTEXT_OPTS);
        await proxyCtx.addCookies(cookies);
        const proxyPage = await proxyCtx.newPage();

        log("[ChatGPT/Plus] Proxy browser ready — starting Plus subscription…");
        await subscribePlusWithUPI({ page: proxyPage, email, password: accountPassword, notifyTelegramId: adminTelegramId, log });
      } catch (plusErr: any) {
        log(`[ChatGPT/Plus] Subscription step failed: ${plusErr.message}`);
        // Account creation is still complete — don't throw
      } finally {
        await proxyBrowser?.close().catch(() => {});
      }
    }

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
  subscribeAfter?: boolean;
  adminTelegramId?: number | string;
  log?: (msg: string) => void;
}): Promise<{ total: number; succeeded: number; failed: number; results: ChatGPTResult[] }> {
  const { count, subscribeAfter = false, adminTelegramId, log = console.log } = opts;

  const { pickAvailableBizAccounts, setAccountPassword } = await import("./smtpDevService");
  const { db } = await import("./db");
  const { bizMailAccounts, chatgptAccounts } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  // Build set of already-used addresses: all biz_mail + successful chatgpt accounts
  const [bizRows, cgRows] = await Promise.all([
    db.select({ email: bizMailAccounts.email }).from(bizMailAccounts),
    db.select({ email: chatgptAccounts.email }).from(chatgptAccounts).where(eq(chatgptAccounts.status, "created")),
  ]);
  const usedAddresses = new Set([
    ...bizRows.map((r: any) => r.email.toLowerCase()),
    ...cgRows.map((r: any) => r.email.toLowerCase()),
  ]);

  log(`[ChatGPT/Batch] Picking ${count} account(s) from smtp.dev pool (${usedAddresses.size} addresses already used)…`);

  const picked = await pickAvailableBizAccounts(usedAddresses, count);
  if (picked.length === 0) {
    log(`[ChatGPT/Batch] No available accounts found in smtp.dev pool`);
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }
  if (picked.length < count) {
    log(`[ChatGPT/Batch] Only ${picked.length} of ${count} requested accounts available in pool`);
  }

  const results: ChatGPTResult[] = [];
  let succeeded = 0, failed = 0;
  const adminId = adminTelegramId ? Number(adminTelegramId) : undefined;

  for (let i = 0; i < picked.length; i++) {
    const acct = picked[i];
    const email = acct.address;
    const mailPwd = generatePassword();

    log(`[ChatGPT/Batch] [${i + 1}/${picked.length}] ${email} — setting password & registering…`);

    // Set a fresh known password on the existing smtp.dev account
    try {
      await setAccountPassword(acct.id, mailPwd);
      log(`[ChatGPT/Batch] Password set for ${email}`);
    } catch (e: any) {
      log(`[ChatGPT/Batch] Failed to set password for ${email}: ${e.message}`);
      failed++;
      results.push({ success: false, email, error: `smtp.dev password set failed: ${e.message}` });
      await sleep(2_000);
      continue;
    }

    // Save to biz_mail_accounts and auto-allocate to admin
    try {
      await storage.registerBizMailAccount(null, email, mailPwd, {
        smtpAccountId: acct.id,
        allocatedTo: adminId,
      });
      log(`[ChatGPT/Batch] Saved & allocated ${email} to admin ${adminId}`);
    } catch (e: any) {
      log(`[ChatGPT/Batch] DB save warning for ${email}: ${e.message}`);
      // Non-fatal — continue
    }

    const r = await createChatGPTAccount({
      email,
      smtpDevId: acct.id,
      mailPassword: mailPwd,
      subscribeAfter,
      adminTelegramId,
      log,
    });
    results.push(r);
    if (r.success) succeeded++; else failed++;
    if (i < picked.length - 1) await sleep(5_000);
  }

  log(`[ChatGPT/Batch] Done — ${succeeded} succeeded, ${failed} failed`);
  return { total: picked.length, succeeded, failed, results };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function solveTurnstileIfPresent(page: any, log: (m: string) => void): Promise<void> {
  try {
    // Detect CF Turnstile either via frame URL or hidden response input
    const hasTurnstile = page.frames().some((f: any) => f.url().includes("challenges.cloudflare.com"))
      || await page.evaluate(() => !!document.querySelector('input[name="cf-turnstile-response"]'));
    if (!hasTurnstile) return;

    log(`[ChatGPT] Turnstile detected — solving via Capsolver…`);

    // Extract siteKey: try DOM element first, then raw HTML, then known fallback
    let siteKey: string | null = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]');
      if (el) return el.getAttribute("data-sitekey");
      const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]') as HTMLIFrameElement;
      if (iframe?.src) {
        const m = iframe.src.match(/[?&]k=([^&]+)/);
        if (m) return m[1];
      }
      return null;
    });

    if (!siteKey) {
      // Try raw HTML extraction (siteKey often embedded before widgets render)
      const html = await page.content().catch(() => "");
      const m = html.match(/data-sitekey="([^"]+)"|sitekey['":\s]+['"]([0-9a-zA-Z_-]{20,})['"]/);
      siteKey = m?.[1] || m?.[2] || null;
    }

    if (!siteKey) {
      log(`[ChatGPT] Turnstile siteKey not found — skipping solve`);
      return;
    }

    log(`[ChatGPT] Turnstile siteKey: ${siteKey}`);
    const result = await solveAntiTurnstile(page.url(), siteKey);
    if (result?.token) {
      await page.evaluate((t: string) => {
        // Set the hidden input
        const input = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement;
        if (input) { input.value = t; input.dispatchEvent(new Event("change", { bubbles: true })); }
        // Also call global callback if present
        (window as any).turnstileCallback?.(t);
        (window as any).__CF_challenge_complete?.(t);
      }, result.token);
      log(`[ChatGPT] Turnstile solved — submitting form`);
      // Submit the CF challenge form
      await page.evaluate(() => {
        const form = document.querySelector('#challenge-form, form') as HTMLFormElement;
        if (form) form.submit();
      });
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch { /* non-fatal */ }
}

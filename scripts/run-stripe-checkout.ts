/**
 * Replit Core Stripe checkout automation — simple approach
 *  1. Login
 *  2. Navigate to checkout with coupon
 *  3. Fill card + billing address
 *  4. Click Subscribe
 *  5. When hCaptcha visual challenge appears → grab rqdata → solve with NopeCHA → inject token
 *  6. Payment processes → if 3DS → fetch OTP from Gmail → enter it
 */

import { chromium, type Page, type Frame } from "playwright";
import { ImapFlow } from "imapflow";
import * as fs from "fs";
import * as path from "path";

// ── Inline injectCaptchaSolverListener from Captcha Solver extension ──────────
async function injectCaptchaSolverListener(a: Page) {
  await a.exposeFunction("captchaSolverPlaywrightTaskSs", async () => {
    await a.waitForTimeout(1000);
    return `data:image/png;base64,${(await a.screenshot()).toString("base64")}`;
  });
  await a.exposeFunction("captchaSolverPlaywrightTaskExec", async (t: any) => {
    if (t.action === "click") {
      const e = t.answers, i = t.canvasPosOnView;
      if (e?.length > 0 && i) {
        for (let k = 0; k < e.length; k++) {
          await a.mouse.click(e[k].x + i.x, e[k].y + i.y);
          await a.waitForTimeout(300);
        }
      }
    } else if (t.action === "drag") {
      const e = t.paths, i = t.canvasPosOnView;
      if (e?.length > 0 && i) {
        for (let k = 0; k < e.length; k++) {
          const o = e[k];
          await a.mouse.move(o.start.x + i.x, o.start.y + i.y);
          await a.mouse.down();
          await a.waitForTimeout(200);
          await a.mouse.move(o.end.x + i.x, o.end.y + i.y, { steps: 15 });
          await a.mouse.up();
          await a.waitForTimeout(300);
        }
      }
    }
    return true;
  });
  await a.addInitScript(() => {
    window.addEventListener("cs-request-ba-ss", async () => {
      if (typeof (window as any).captchaSolverPlaywrightTaskSs === "function") {
        setTimeout(async () => {
          try {
            const dataUrl = await (window as any).captchaSolverPlaywrightTaskSs();
            window.postMessage({ from: "browser-automation", action: "ba-response-cs-ss", dataUrl }, "*");
          } catch (e) { console.error("Fail to call captchaSolverPlaywrightTaskSs:", e); }
        }, 10);
      }
    });
    window.addEventListener("cs-request-ba-op", async (ev: any) => {
      if (typeof (window as any).captchaSolverPlaywrightTaskExec === "function") {
        return await (window as any).captchaSolverPlaywrightTaskExec(ev.detail);
      }
    });
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────
const REPLIT_EMAIL    = "mitchellrobles7884@outlook.com";
const REPLIT_PASS     = "RPcohz1h#92";
const CARD_NUMBER     = "4065843006197211";
const CARD_EXP        = "03 / 31";
const CARD_CVV        = "007";
const CARD_HOLDER     = "AJAY KUMAR";
const BILLING_LINE1   = "123 Main St";
const BILLING_CITY    = "New York";
const BILLING_STATE   = "NY";
const BILLING_ZIP     = "10001";
const BILLING_COUNTRY = "US";
const COUPON          = "AGENT457AA6000306A";
// We navigate to Replit pricing → apply coupon → gets redirected to fresh Stripe checkout session
const REPLIT_PRICING_URL = "https://replit.com/pricing";

const NOPECHA_KEY     = "sub_1TDHVaCRwBwvt6pt1gtAMAdC";
const HCAP_SITEKEY    = "c7faac4c-1cd7-4b1b-b2d4-42ba98d09c7a";
const HCAP_PAGEURL    = "https://b.stripecdn.com";

// Gmail IMAP for OTP
const GMAIL_USER     = "ajayvaishwakarma@gmail.com";
const GMAIL_APP_PASS = "vcvg cejo aqqj kcxs";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const LOG_FILE = `/tmp/stripe-script-${Date.now()}.log`;
function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }
function log(msg: string) {
  const line = `[${ts()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── NopeCHA solve (new API: /token endpoint + Bearer auth) ──
async function solveHcaptcha(rqdata: string | null): Promise<string> {
  log(`🤖 NopeCHA submit (rqdata=${rqdata ? rqdata.substring(0, 20) + "..." : "none"})...`);

  const reqBody: Record<string, string> = {
    type: "hcaptcha",
    sitekey: HCAP_SITEKEY,
    url: HCAP_PAGEURL,
  };
  if (rqdata) reqBody.rqdata = rqdata;

  const sub = await fetch("https://api.nopecha.com/token", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NOPECHA_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reqBody),
  }).then(r => r.json()).catch(e => ({ error: e.message }));

  if (!sub.data) {
    throw new Error(`NopeCHA submit failed: ${JSON.stringify(sub)}`);
  }
  const jobId: string = sub.data;
  log(`  Job ID: ${jobId} — polling...`);

  for (let i = 0; i < 72; i++) {
    await sleep(5000);
    const res = await fetch(`https://api.nopecha.com/token?id=${encodeURIComponent(jobId)}`, {
      headers: { "Authorization": `Bearer ${NOPECHA_KEY}` },
    }).then(r => r.json()).catch(() => ({ error: "fetch failed" }));

    if (res.data && typeof res.data === "string" && res.data.length > 20) {
      log(`  ✅ NopeCHA solved at poll ${i + 1}, token len=${res.data.length}`);
      return res.data;
    }
    if (res.error) {
      log(`  ⚠️  NopeCHA poll ${i + 1}: ${JSON.stringify(res)}`);
    } else {
      log(`  ⏳ poll ${i + 1}: ${JSON.stringify(res).substring(0, 80)}`);
    }
  }
  throw new Error("NopeCHA timeout after 6 minutes");
}

// ── Inject hCaptcha token into all frames ──
async function injectHcapToken(page: Page, token: string) {
  // 1. Set token in ALL frames via evaluate AND postMessage
  for (const frame of page.frames()) {
    await frame.evaluate((t: string) => {
      const w = window as any;
      w.__hcapToken = t;
      // Broadcast inject-hcap-token to all child iframes
      document.querySelectorAll("iframe").forEach((iframe: HTMLIFrameElement) => {
        try { iframe.contentWindow?.postMessage({ type: "inject-hcap-token", token: t }, "*"); } catch {}
      });
      // If we have a pending execute stored by the init script, respond now
      if (w.__pendingExecute) {
        const pe = w.__pendingExecute;
        w.__pendingExecute = null;
        const response = {
          type: "stripe-third-party-child-to-parent",
          frameID: pe.frameID, requestID: pe.requestID,
          payload: { response: t },
        };
        try { window.parent.postMessage(response, "*"); } catch {}
        try { (w.top as any)?.postMessage(response, "*"); } catch {}
      }
      // Also set on hcaptcha response fields
      document.querySelectorAll("textarea[name='h-captcha-response'], input[name='h-captcha-response']").forEach((el: any) => {
        el.value = t;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }, token).catch(() => {});
  }
  // 2. Also broadcast from main page to all iframes
  await page.evaluate((t: string) => {
    document.querySelectorAll("iframe").forEach((iframe: HTMLIFrameElement) => {
      try { iframe.contentWindow?.postMessage({ type: "inject-hcap-token", token: t }, "*"); } catch {}
    });
  }, token).catch(() => {});
  log("  💉 Token injected into all frames via evaluate + postMessage");
}

// ── Fill a Stripe iframe field (uses fill() to bypass pointer event issues) ──
async function fillStripeField(page: Page, names: string[], value: string): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const name of names) {
      for (const sel of [`input[name="${name}"]`, `input[data-elements-stable-field-name="${name}"]`]) {
        const exists = await frame.$(sel).catch(() => null);
        if (exists) {
          try {
            await frame.fill(sel, value, { timeout: 5000 });
            log(`  ✏️  Filled [${name}] = "${value.substring(0, 12)}..."`);
            return true;
          } catch {
            // fallback: set via JS evaluation
            const ok = await frame.evaluate(({ s, v }: { s: string; v: string }) => {
              const el = document.querySelector<HTMLInputElement>(s);
              if (!el) return false;
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
              if (nativeInputValueSetter) nativeInputValueSetter.call(el, v);
              else el.value = v;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
              return true;
            }, { s: sel, v: value }).catch(() => false);
            if (ok) { log(`  ✏️  Filled [${name}] via JS = "${value.substring(0, 12)}..."`); return true; }
          }
        }
      }
    }
  }
  return false;
}

// ── Fetch OTP from Gmail via IMAP ──
async function fetchGmailOtp(sinceMs: number): Promise<string | null> {
  const since = new Date(sinceMs - 60000); // 1 min buffer
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS }, logger: false,
  });
  try {
    await client.connect();
    log(`  📧 IMAP connected to Gmail`);
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(5000);
      await client.mailboxOpen("INBOX");
      const msgs = await client.search({
        since, subject: "OTP"
      }).catch(() => []);
      if (!msgs || msgs.length === 0) {
        // Also search without subject filter
        const allMsgs = await client.search({ since }).catch(() => []);
        log(`  📧 Poll ${attempt + 1}: 0 OTP messages, ${allMsgs?.length || 0} total since ${since.toISOString()}`);
        continue;
      }
      // Get the latest message
      const latest = msgs[msgs.length - 1];
      const msg = await client.fetchOne(latest.toString(), { bodyStructure: true, source: true });
      const text = msg.source?.toString() || "";
      const m = text.match(/\b(\d{6})\b/);
      if (m) { log(`  📧 OTP found: ${m[1]}`); await client.logout(); return m[1]; }
      log(`  📧 Poll ${attempt + 1}: message found but no 6-digit OTP in body`);
    }
    await client.logout();
  } catch (e: any) {
    log(`  📧 Gmail IMAP error: ${e.message}`);
    await client.logout().catch(() => {});
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log(`🚀 Starting — ${REPLIT_EMAIL}`);

  const EXTENSION_PATH = path.resolve(process.cwd(), "extensions/captcha-solver");
  const userDataDir = `/tmp/chrome-profile-${Date.now()}`;
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security", "--window-size=1280,800"
    ],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  // ── Inject rqdata interceptor into ALL frames (including cross-origin iframes) ──
  // This runs before any frame's JS and captures EXECUTE messages from Stripe's hcaptcha-inner frame
  await ctx.addInitScript(() => {
    const w = window as any;
    w.__hcapToken = null;
    w.__capturedRqdata = null;
    w.__pendingExecute = null;

    window.addEventListener("message", function hcapIntercept(e: MessageEvent) {
      try {
        const d = e.data;
        if (!d || typeof d !== "object") return;

        // ── Capture injected token ──
        if (d.type === "inject-hcap-token") {
          w.__hcapToken = d.token;
          if (w.__pendingExecute) {
            const pe = w.__pendingExecute;
            w.__pendingExecute = null;
            const response = {
              type: "stripe-third-party-child-to-parent",
              frameID: pe.frameID, requestID: pe.requestID,
              payload: { response: d.token },
            };
            try { window.parent.postMessage(response, "*"); } catch {}
            try { (window.top as any)?.postMessage(response, "*"); } catch {}
          }
          return;
        }

        // ── Intercept EXECUTE from Stripe's hcaptcha-inner ──
        if (d.type === "stripe-third-party-parent-to-child") {
          const payload = d.payload;
          // Debug: log the full payload to console so Node can capture it
          console.error("[HCAP-MSG] stripe-third-party-parent-to-child payload: " + JSON.stringify(payload).substring(0, 200));
          const rqdata = (typeof payload === "object" && payload?.rqdata) || null;
          if (rqdata) {
            w.__capturedRqdata = rqdata;
            console.error("[HCAP-RQDATA] rqdata captured: " + rqdata.substring(0, 50));
            // Call Node.js exposed function directly (works in all frames via Playwright)
            try { (window as any).__nodeRqdataReady(rqdata); } catch {}
            try { window.parent.postMessage({ type: "hcap-rqdata", rqdata }, "*"); } catch {}
            try { (window.top as any)?.postMessage({ type: "hcap-rqdata", rqdata }, "*"); } catch {}
          }
          const isExecute = payload === "EXECUTE_HCAPTCHA_INVISIBLE" ||
            (typeof payload === "object" && (payload?.action === "EXECUTE_HCAPTCHA_INVISIBLE" || payload?.type === "EXECUTE_HCAPTCHA_INVISIBLE"));
          if (!isExecute) return;
          const params = new URLSearchParams(window.location.search);
          const frameID = d.frameID || params.get("id") || "hcaptcha-invisible";
          const requestID = d.requestID;
          if (w.__hcapToken) {
            const response = {
              type: "stripe-third-party-child-to-parent",
              frameID, requestID, payload: { response: w.__hcapToken },
            };
            try { window.parent.postMessage(response, "*"); } catch {}
            try { (window.top as any)?.postMessage(response, "*"); } catch {}
          } else {
            w.__pendingExecute = { frameID, requestID };
          }
        }

        // ── Forward rqdata from hcap-rqdata messages to main page ──
        if ((d.type === "hcap-rqdata" || d.type === "hcap-rqdata-execute") && d.rqdata) {
          if (!w.__capturedRqdata) w.__capturedRqdata = d.rqdata;
          try { window.parent.postMessage({ type: "hcap-rqdata", rqdata: d.rqdata }, "*"); } catch {}
          try { (window.top as any)?.postMessage({ type: "hcap-rqdata", rqdata: d.rqdata }, "*"); } catch {}
        }
      } catch {}
    }, true);
  });

  const page = await ctx.newPage();

  // Inject Captcha Solver extension listener (handles hCaptcha automatically via extension)
  await injectCaptchaSolverListener(page);
  log(`🧩 Captcha Solver extension listener injected`);

  // Track rqdata from hCaptcha network calls
  let rqdata: string | null = null;
  let hcaptchaFrameAppeared = false;
  let stripe3dsTriggered = false;
  let paymentTime = 0;

  // Expose Node.js functions callable from any frame
  let hcapToken: string | null = null;
  await page.exposeFunction("__nodeRqdataReady", (rd: string) => {
    if (!rqdata && rd && rd.length > 10) {
      rqdata = rd;
      log(`📦 rqdata captured via exposeFunction: ${rd.substring(0, 40)}...`);
    }
  });
  await page.exposeFunction("__nodeHcapTokenReady", (tok: string) => {
    if (!hcapToken && tok && tok.length > 20) {
      hcapToken = tok;
      log(`🎫 hCaptcha token auto-captured: len=${tok.length}`);
    }
  });

  // Intercept outgoing postMessages from ALL frames to capture auto-solved hCaptcha tokens
  await ctx.addInitScript(() => {
    const w = window as any;

    // Intercept postMessage calls from this frame (captures outgoing messages to parent)
    // HCaptcha.html sends token via: window.parent.postMessage({ type: "stripe-third-party-child-to-parent", payload: { response: TOKEN } })
    try {
      const origParentPM = window.parent.postMessage.bind(window.parent);
      window.parent.postMessage = function(data: any, targetOrigin: any, transfer?: any) {
        // Check if this is a hCaptcha response token being sent up
        if (data && typeof data === "object") {
          if (data.type === "stripe-third-party-child-to-parent" && data.payload?.response) {
            const tok = data.payload.response;
            if (tok && tok.length > 20) {
              try { w.__nodeHcapTokenReady(tok); } catch {}
            }
          }
        }
        return origParentPM(data, targetOrigin, transfer);
      };
    } catch {}

    // Also intercept window.top.postMessage for deeply nested frames
    try {
      const origTopPM = (window.top as any).postMessage.bind(window.top);
      (window.top as any).postMessage = function(data: any, targetOrigin: any, transfer?: any) {
        if (data && typeof data === "object") {
          if (data.type === "stripe-third-party-child-to-parent" && data.payload?.response) {
            const tok = data.payload.response;
            if (tok && tok.length > 20) {
              try { w.__nodeHcapTokenReady(tok); } catch {}
            }
          }
        }
        return origTopPM(data, targetOrigin, transfer);
      };
    } catch {}

    // Listen for any hcaptcha-related messages on this window and forward tokens
    window.addEventListener("message", (e: MessageEvent) => {
      try {
        const d = e.data;
        if (!d || typeof d !== "object") return;
        // Capture token from the hcaptcha response message
        if (d.type === "stripe-third-party-child-to-parent" && d.payload?.response) {
          const tok = d.payload.response;
          if (tok && tok.length > 20) {
            try { w.__nodeHcapTokenReady(tok); } catch {}
          }
        }
      } catch {}
    }, true); // capture phase
  });

  // Use context-level listeners to capture requests from ALL frames (not just main page)
  ctx.on("request", (req) => {
    try {
      const url = req.url();
      if (url.includes("hcaptcha.com") || url.includes("hcaptcha.net")) {
        const body = req.postData() || "";
        if (body.length > 0) {
          const m = body.match(/rqdata=([^&\s"]{10,})/);
          if (m && !rqdata) { rqdata = decodeURIComponent(m[1]); log(`📡 rqdata from POST body: ${rqdata.substring(0,40)}...`); }
          const mj = body.match(/"rqdata"\s*:\s*"([^"]{10,})"/);
          if (mj && !rqdata) { rqdata = mj[1]; log(`📡 rqdata from POST JSON: ${rqdata.substring(0,40)}...`); }
        }
      }
    } catch {}
  });

  ctx.on("response", async (response) => {
    try {
      const url = response.url();
      if (url.includes("getcaptcha") && url.includes("hcaptcha.com")) {
        const body = await response.text().catch(() => "");
        const m = body.match(/"rqdata"\s*:\s*"([^"]{10,})"/);
        if (m && !rqdata) { rqdata = m[1]; log(`📡 rqdata from getcaptcha response: ${rqdata.substring(0,40)}...`); }
      }
      // Detect 3DS
      if (url.includes("3ds2/authenticate") && response.request().method() === "POST") {
        stripe3dsTriggered = true;
        log(`  ⚡ 3DS auth triggered!`);
      }
      // Log important Stripe API responses
      if ((url.includes("api.stripe.com/v1/") || url.includes("checkout.stripe.com")) &&
          (url.includes("confirm") || url.includes("setup_intents") || url.includes("payment_intents") || url.includes("checkcaptcha"))) {
        const bodyText = await response.text().catch(() => "");
        const status = response.status();
        log(`  📡 ${response.request().method()} ${url.substring(0, 80)} → HTTP${status} body=${bodyText.substring(0, 200)}`);
      }
    } catch {}
  });

  try {
    // ── Step 1: Login ──
    log(`🔐 Logging in...`);
    await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const id = await page.$('input[name="username"], input[type="email"]').catch(() => null);
    if (id) { await id.click({ clickCount: 3 }); await id.type(REPLIT_EMAIL, { delay: 40 }); }
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll<HTMLElement>("button, input[type='submit']"))
        .find(b => ["continue","next","log in","login"].includes(
          ((b.textContent || (b as HTMLInputElement).value) || "").trim().toLowerCase()
        ))?.click();
    });
    await page.waitForTimeout(5000);
    const pw = await page.$('input[type="password"]').catch(() => null);
    if (pw) {
      await pw.click({ clickCount: 3 }); await pw.type(REPLIT_PASS, { delay: 40 });
      await pw.press("Enter");
    }
    await page.waitForURL(/^(?!.*\/login)/, { timeout: 30000 });
    log(`✅ Logged in`);

    // ── Step 2: Navigate to Stripe checkout with coupon ──
    log(`🛒 Navigating to checkout (coupon: ${COUPON})...`);
    const checkoutPageUrl = `https://replit.com/stripe-checkout-by-price/core_1mo_20usd_monthly_feb_26?coupon=${encodeURIComponent(COUPON)}&source=onboarding-purchase-modal&successRedirectPath=%2F~&cancelRedirectPath=%2F~`;
    await page.goto(checkoutPageUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(8000);
    log(`  After goto: ${page.url().substring(0, 100)}`);

    // If still on Replit (not on Stripe checkout), wait for redirect
    if (!page.url().includes("checkout.stripe.com")) {
      log(`  Waiting for redirect to Stripe checkout...`);
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 20000 }).catch(async () => {
        log(`  No redirect yet, current URL: ${page.url()}`);
      });
    }

    if (!page.url().includes("checkout.stripe.com")) {
      throw new Error(`Failed to reach Stripe checkout. Current page: ${page.url()}`);
    }

    await sleep(4000);
    log(`✅ On Stripe checkout — ${page.frames().length} frames — ${page.url().substring(0, 80)}`);

    // ── Step 3: Apply coupon if not already applied ──
    log(`🎟️  Checking coupon ${COUPON}...`);
    const pageText0 = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (!pageText0.includes(COUPON) && !pageText0.includes("$0.00")) {
      for (const frame of page.frames()) {
        const promoEl = await frame.$('input[placeholder*="promo" i], input[placeholder*="coupon" i], button:has-text("Add promotion code")').catch(() => null);
        if (promoEl) {
          const tag = await promoEl.evaluate((el: any) => el.tagName);
          if (tag === "BUTTON") {
            await promoEl.click(); await sleep(800);
            const inp = await frame.$('input[placeholder*="promo" i], input[placeholder*="code" i]').catch(() => null);
            if (inp) { await inp.type(COUPON, { delay: 40 }); await sleep(200); }
          } else {
            await promoEl.click({ clickCount: 3 }); await promoEl.type(COUPON, { delay: 40 }); await sleep(200);
          }
          await page.keyboard.press("Enter"); await sleep(1500);
          log(`  Coupon applied`); break;
        }
      }
    } else {
      log(`  Coupon already applied / $0.00 price shown`);
    }

    // ── Step 4: Fill card details ──
    log(`💳 Filling card details...`);
    await fillStripeField(page, ["cardNumber"], CARD_NUMBER);
    await sleep(400);
    await fillStripeField(page, ["cardExpiry"], CARD_EXP);
    await sleep(400);
    await fillStripeField(page, ["cardCvc"], CARD_CVV);
    await sleep(400);
    await fillStripeField(page, ["billingName"], CARD_HOLDER);
    await sleep(400);

    // Billing address — all in the main checkout frame
    log(`🏠 Filling billing address...`);
    await fillStripeField(page, ["billingAddressLine1"], BILLING_LINE1);
    await sleep(300);
    await fillStripeField(page, ["billingLocality"], BILLING_CITY);
    await sleep(300);

    // Country select — set via JS to avoid pointer event intercept
    for (const frame of page.frames()) {
      const ok = await frame.evaluate((country: string) => {
        const sel = document.querySelector<HTMLSelectElement>('select[name="billingCountry"], select[id="billingCountry"]');
        if (!sel) return false;
        sel.value = country;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }, BILLING_COUNTRY).catch(() => false);
      if (ok) { log(`  ✏️  Country set to ${BILLING_COUNTRY} via JS`); await sleep(600); break; }
    }

    // State (for US — appears after country is selected)
    await sleep(800);
    for (const frame of page.frames()) {
      const ok = await frame.evaluate((state: string) => {
        const sel = document.querySelector<HTMLSelectElement>(
          'select[name="billingState"], select[name="billingAdministrativeArea"], select[id="billingState"]'
        );
        if (!sel) return false;
        sel.value = state;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }, BILLING_STATE).catch(() => false);
      if (ok) { log(`  ✏️  State set to ${BILLING_STATE} via JS`); await sleep(300); break; }
    }

    await fillStripeField(page, ["billingPostalCode"], BILLING_ZIP);
    await sleep(300);

    log(`  Form filled. Waiting for button to become active...`);
    await sleep(2000);

    // ── Step 4.5: Inject rqdata postMessage listener BEFORE clicking ──
    // Stripe's hcaptcha-inner frame will send EXECUTE messages containing rqdata
    await page.evaluate(() => {
      (window as any).__capturedRqdata = null;
      window.addEventListener("message", (e: MessageEvent) => {
        try {
          const str = typeof e.data === "string" ? e.data : JSON.stringify(e.data || "");
          // Capture from EXECUTE messages
          const m1 = str.match(/"rqdata"\s*:\s*"([^"]{20,})"/);
          if (m1 && m1[1] !== (window as any).__capturedRqdata) {
            (window as any).__capturedRqdata = m1[1];
          }
          // Capture from URL-encoded form data
          const m2 = str.match(/rqdata=([A-Za-z0-9%._-]{20,})/);
          if (m2 && !((window as any).__capturedRqdata)) {
            (window as any).__capturedRqdata = decodeURIComponent(m2[1]);
          }
        } catch {}
      }, true);
    }).catch(() => {});

    // ── Step 5: Click Subscribe ──
    let subscribeBtn: any = null;
    for (const frame of page.frames()) {
      const btn = await frame.$('.SubmitButton:not([disabled]), button[type="submit"]:not([disabled])').catch(() => null);
      if (btn) { subscribeBtn = { frame, btn }; break; }
    }

    const btnText = subscribeBtn ? await subscribeBtn.btn.textContent().catch(() => "?") : "NOT FOUND";
    log(`🖱️  Subscribe button: "${btnText?.trim()}"`);

    if (!subscribeBtn) {
      // Try clicking via evaluate
      log(`  Button not found via selector — trying evaluate...`);
      await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>(".SubmitButton, button[type='submit']");
        btn?.click();
      });
    } else {
      await subscribeBtn.btn.click();
    }
    paymentTime = Date.now();
    log(`  Clicked Subscribe at ${new Date(paymentTime).toLocaleTimeString()}`);
    const framesBeforeSubscribe = new Set(page.frames().map(f => f.url()));
    let lastFrameCount = page.frames().length;
    await sleep(8000); // Give hCaptcha 8s to appear

    // ── Step 6: Wait for hCaptcha challenge OR success/3DS ──
    log(`⏳ Monitoring for hCaptcha / 3DS / success...`);
    // Log any new frames that appeared right after clicking
    const framesNow = page.frames();
    if (framesNow.length !== lastFrameCount) {
      log(`  Frames jumped ${lastFrameCount} → ${framesNow.length} after click:`);
      for (const f of framesNow) {
        const u = f.url();
        if (!framesBeforeSubscribe.has(u) && u !== "about:blank") {
          log(`    NEW FRAME: ${u.substring(0, 120)}`);
        }
      }
      lastFrameCount = framesNow.length;
    }
    const handledCaptchaFrames = new Set<string>(); // Track which hCaptcha frames we've solved
    for (let tick = 0; tick < 150; tick++) {
      await sleep(3000);
      const allFrameObjs = page.frames();
      const allFrames = allFrameObjs.map(f => f.url());
      // Only NEW unhandled hCaptcha frames (excludes already-solved ones)
      const newHcapFrames = allFrames.filter(u =>
        u.includes("newassets.hcaptcha.com") &&
        !framesBeforeSubscribe.has(u) &&
        !handledCaptchaFrames.has(u)
      );
      const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");

      // Log new frames when frame count changes
      if (allFrameObjs.length !== lastFrameCount) {
        log(`  Frame count changed: ${lastFrameCount} → ${allFrameObjs.length}`);
        for (const f of allFrameObjs) {
          const u = f.url();
          if (!framesBeforeSubscribe.has(u) && u !== "about:blank") {
            log(`    NEW FRAME: ${u.substring(0, 120)}`);
          }
        }
        lastFrameCount = allFrameObjs.length;
      }

      // ── Success ──
      if (pageText.includes("Your payment was successful") || pageText.includes("Subscription activated") ||
          page.url().includes("subscription_confirmed") || page.url().includes("success")) {
        log(`🎉 SUCCESS! Payment completed!`);
        break;
      }

      // ── 3DS triggered ──
      if (stripe3dsTriggered) {
        log(`🔐 3DS authentication required — fetching OTP...`);
        const otp = await fetchGmailOtp(paymentTime);
        if (!otp) { log(`❌ Could not get OTP from Gmail`); break; }
        log(`  OTP: ${otp}`);

        // Log all frames to find ACS frame
        const frames3ds = page.frames();
        log(`  Frames (${frames3ds.length}):`);
        frames3ds.forEach((f, i) => log(`    [${i}] ${f.url().substring(0, 120)}`));

        // Try entering OTP in each frame
        let otpEntered = false;
        for (const frame of frames3ds) {
          const url = frame.url();
          if (!url.includes("checkout.stripe.com") && !url.includes("js.stripe.com") &&
              !url.includes("about:blank") && !url.includes("hcaptcha") &&
              !url.includes("b.stripecdn") && !url.includes("r.stripe.com")) {
            log(`  🔍 Trying ACS frame: ${url.substring(0, 100)}`);
            // Try OTP selectors
            for (const sel of [
              'input[name="challengeDataEntry"]', 'input[type="password"]',
              'input[type="text"]', 'input[type="number"]',
              'input[name="otp"]', 'input[name="otpCode"]',
              'input[autocomplete="one-time-code"]', 'input[placeholder*="OTP" i]'
            ]) {
              const el = await frame.$(sel).catch(() => null);
              if (el) {
                log(`  ✅ Found OTP input: ${sel}`);
                await el.click({ clickCount: 3 }); await sleep(200);
                await el.type(otp, { delay: 100 });
                await sleep(500);
                await page.keyboard.press("Enter");
                otpEntered = true;
                break;
              }
            }
            if (otpEntered) break;
          }
        }

        if (!otpEntered) {
          log(`  ⚠️  OTP input not found in any frame — typing globally`);
          await page.keyboard.type(otp, { delay: 100 });
          await page.keyboard.press("Enter");
        }

        await sleep(5000);
        const textAfter3ds = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
        if (textAfter3ds.includes("successful") || textAfter3ds.includes("activated")) {
          log(`🎉 SUCCESS after 3DS!`);
        } else {
          log(`  Page after 3DS: ${textAfter3ds.substring(0, 200)}`);
        }
        break;
      }

      // ── hCaptcha visual challenge appeared ──
      if (newHcapFrames.length > 0) {
        log(`🧩 hCaptcha challenge appeared (${newHcapFrames.length} new frames)`);
        log(`  Waiting 3s for rqdata to be captured...`);
        await sleep(3000);

        // Try postMessage listener — check ALL frames for captured rqdata
        if (!rqdata) {
          for (const fr of page.frames()) {
            const pm = await fr.evaluate(() => (window as any).__capturedRqdata).catch(() => null);
            if (pm) { rqdata = pm; log(`  rqdata from frame[${fr.url().substring(0, 50)}]: ${rqdata!.substring(0, 40)}...`); break; }
          }
        }

        // Log ALL frame URLs to see what's there
        log(`  Frames (${page.frames().length}):`);
        for (const fr of page.frames()) {
          const u = fr.url();
          if (u !== "about:blank" && !u.includes("r.stripe.com") && !u.includes("b.stripecdn") && !u.includes("js.stripe.com/v3/m")) {
            log(`    ${u.substring(0, 120)}`);
          }
        }

        // Try extracting from hcaptcha-inner frame source
        if (!rqdata) {
          for (const fr of page.frames()) {
            const u = fr.url();
            if (u.includes("hcaptcha-inner") || u.includes("HCaptcha.html")) {
              // Log full URL (including hash fragment)
              const fullUrl = await fr.evaluate(() => window.location.href).catch(() => u);
              log(`  Full frame URL: ${fullUrl.substring(0, 200)}`);
              // Try to get rqdata from window variables
              const extracted = await fr.evaluate(() => {
                const w = window as any;
                const html = document.documentElement?.innerHTML || "";
                const m = html.match(/"rqdata"\s*:\s*"([^"]{20,})"/);
                if (m) return m[1];
                const m2 = html.match(/rqdata['"]\s*:\s*['"]([\w+/=.-]{20,})['"]/);
                if (m2) return m2[1];
                return w.rqdata || w.__rqdata || w.__capturedRqdata || null;
              }).catch(() => null);
              if (extracted) { rqdata = extracted; log(`  rqdata from frame DOM: ${rqdata!.substring(0, 40)}...`); break; }
            }
          }
        }

        // Check URL params in ALL hcaptcha-related frames
        if (!rqdata) {
          for (const fr of page.frames()) {
            const u = fr.url();
            if (u.includes("hcaptcha") || u.includes("HCaptcha")) {
              // Try URL fragment/params
              const paramMatch = u.match(/[?&#]rqdata=([^&"]{20,})/);
              if (paramMatch) { rqdata = decodeURIComponent(paramMatch[1]); log(`  rqdata from URL param: ${rqdata.substring(0, 40)}...`); break; }
              // Try getting full URL from frame (including hash)
              const fullUrl = await fr.evaluate(() => window.location.href).catch(() => "");
              const pm = fullUrl.match(/[?&#]rqdata=([^&"]{20,})/);
              if (pm) { rqdata = decodeURIComponent(pm[1]); log(`  rqdata from frame full URL: ${rqdata.substring(0, 40)}...`); break; }
            }
          }
        }

        log(`  rqdata: ${rqdata ? rqdata.substring(0, 40) + "..." : "NOT captured"}`);

        // ── Step 1: Try clicking the hCaptcha checkbox to trigger auto-solve ──
        hcapToken = null;
        let checkboxClicked = false;
        for (const fr of page.frames()) {
          const u = fr.url();
          if (u.includes("hcaptcha.com") && u.includes("frame=checkbox")) {
            try {
              // Click the checkbox element inside the iframe
              await fr.waitForSelector("#checkbox", { timeout: 3000 }).catch(() => null);
              const cb = await fr.$('#checkbox, .check, [role="checkbox"], .hcaptcha-checkbox');
              if (cb) {
                await cb.click({ timeout: 3000 });
                log(`  ✅ Clicked hCaptcha checkbox in frame`);
                checkboxClicked = true;
              } else {
                // Click center of frame
                const fbox = await fr.locator("body").first().boundingBox().catch(() => null);
                if (fbox) {
                  await page.mouse.click(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2);
                  log(`  ✅ Clicked hCaptcha frame center`);
                  checkboxClicked = true;
                }
              }
              break;
            } catch (e) {
              log(`  ⚠️  Checkbox click failed: ${(e as Error).message.substring(0, 60)}`);
            }
          }
        }

        if (checkboxClicked) {
          // Wait up to 30 seconds for auto-solve token
          log(`  ⏳ Waiting up to 30s for hCaptcha auto-solve...`);
          for (let i = 0; i < 30; i++) {
            await sleep(1000);
            if (hcapToken) { log(`  ✅ Got auto-solve token at ${i+1}s`); break; }
            if (i % 5 === 0) log(`  waiting ${i+1}/30s...`);
          }
        }

        let token: string;
        if (hcapToken) {
          token = hcapToken;
          log(`  Using auto-solve token (len=${token.length})`);
        } else {
          log(`  No auto-solve — falling back to 2captcha...`);
          token = await solveHcaptcha(rqdata);
          log(`  Token len=${token.length}`);
        }

        // Inject into page
        await injectHcapToken(page, token);
        await sleep(2000);

        // Re-click subscribe if needed
        log(`  Checking if Subscribe button needs re-click...`);
        const btnState = await page.evaluate(() => {
          const b = document.querySelector<HTMLElement>(".SubmitButton, button[type='submit']");
          return b ? `text="${b.textContent?.trim()}" disabled=${(b as HTMLButtonElement).disabled}` : "not found";
        }).catch(() => "error");
        log(`  Button: ${btnState}`);

        // Mark these captcha frames as handled so we don't re-solve them
        newHcapFrames.forEach(u => handledCaptchaFrames.add(u));
        rqdata = null; // Reset so we can capture fresh rqdata if another captcha appears
        log(`  ✅ Captcha handled — continuing to monitor for success/3DS...`);
        // DO NOT break — continue the loop to detect success or 3DS
      }

      log(`  tick=${tick} frames=${allFrames.length} 3DS=${stripe3dsTriggered} text="${pageText.substring(0, 60)}"`);
    }

  } catch (e: any) {
    log(`❌ Error: ${e.message}`);
    log(e.stack || "");
  } finally {
    await ctx.close().catch(() => {});
    log(`🏁 Done`);
    process.exit(0);
  }
}

main();

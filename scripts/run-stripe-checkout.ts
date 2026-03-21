/**
 * Stripe checkout — click Subscribe, start solving immediately in parallel with rqdata scan.
 * 
 * Flow:
 * 1. Login + checkout + card + address  (~38s)
 * 2. Click Subscribe to trigger hCaptcha
 * 3. Start hCaptcha solve immediately (even without rqdata)
 * 4. While solving, collect rqdata from frames
 * 5. After first solve completes: inject + re-click Subscribe
 * 6. Monitor: redirect / 3DS / hCaptcha retry
 */
import { chromium, type Page, type Frame } from "playwright";
import { solveHCaptchaWith2Captcha, solveHCaptcha } from "../server/capsolverService";
import { ImapFlow } from "imapflow";

const REPLIT_EMAIL = "mitchellrobles7884@outlook.com";
const REPLIT_PASSWORD = "RPcohz1h#92";

const CARD = {
  number: "4065843006197211",
  expiryMonth: "03",
  expiryYear: "31",
  cvv: "007",
  holderName: "AJAY KUMAR",
  otpEmail: "ajayvaishwakarma@gmail.com",
  otpPassword: "vcvg cejo aqqj kcxs",
};

const COUPON = "AGENT457AA6000306A";
const CHECKOUT_URL = `https://replit.com/stripe-checkout-by-price/core_1mo_20usd_monthly_feb_26?coupon=${encodeURIComponent(COUPON)}&source=onboarding-purchase-modal&successRedirectPath=%2F%7E&cancelRedirectPath=%2F%7E`;
const ADDR = { line1: "42 MG Road", city: "Bengaluru", state: "Karnataka", zip: "560001", phone: "+918041234567" };

function ts() { return new Date().toLocaleTimeString("en-US", { hour12: false }); }
function log(msg: string) { process.stdout.write(`[${ts()}] ${msg}\n`); }

let networkRqdata: string | null = null;

async function fillStripeField(page: Page, names: string[], value: string): Promise<boolean> {
  for (const frame of page.frames()) {
    for (const name of names) {
      for (const sel of [`input[name="${name}"]`, `input[data-elements-stable-field-name="${name}"]`]) {
        try {
          const el = frame.locator(sel).first();
          if (!await el.isVisible({ timeout: 700 }).catch(() => false)) continue;
          await el.click({ timeout: 2000 }).catch(() => {});
          await el.evaluate((i: HTMLInputElement) => { i.value = ""; });
          await el.type(value, { delay: 50 });
          await frame.locator("body").press("Tab").catch(() => {});
          log(`  "${name}" filled`);
          return true;
        } catch {}
      }
    }
  }
  return false;
}

async function quickRqdataScan(page: Page): Promise<string | null> {
  // 1. Main page listener capture
  const fromMain = await page.evaluate(() => (window as any).__capturedRqdata).catch(() => null);
  if (fromMain) { log(`  rqdata: main page listener`); return fromMain; }

  // 2. Network intercept
  if (networkRqdata) { log(`  rqdata: network`); return networkRqdata; }

  // 3. Frame URL parameters (rqdata might be in iframe src)
  for (const fr of page.frames()) {
    const url = fr.url();
    const m = url.match(/[?&]rqdata=([^&#]{10,})/);
    if (m) { const rd = decodeURIComponent(m[1]); log(`  rqdata: frame URL`); return rd; }
  }

  // 4. Main page DOM — scan iframe src attributes
  const fromSrc = await page.evaluate(() => {
    let rd: string | null = null;
    document.querySelectorAll("iframe").forEach((f: HTMLIFrameElement) => {
      const m = (f.src || "").match(/[?&]rqdata=([^&#]{10,})/);
      if (m && !rd) rd = decodeURIComponent(m[1]);
    });
    return rd;
  }).catch(() => null);
  if (fromSrc) { log(`  rqdata: iframe src`); return fromSrc; }

  // 5. All frames __capturedRqdata
  for (const fr of page.frames()) {
    try {
      const v = await fr.evaluate(() => (window as any).__capturedRqdata).catch(() => null);
      if (v) { log(`  rqdata: frame listener`); return v; }
    } catch {}
  }

  return null;
}

async function broadcastToken(page: Page, token: string) {
  // Use 2s per-operation timeout to avoid 30s hangs on cross-origin frames
  page.setDefaultTimeout(2000);

  // Main page: set __hcapToken + inject via iframe postMessage
  await page.evaluate((tok: string) => {
    (window as any).__hcapToken = tok;
    document.querySelectorAll("iframe").forEach((iframe: HTMLIFrameElement) => {
      try { iframe.contentWindow?.postMessage({ type: "inject-hcap-token", token: tok }, "*"); } catch {}
    });
  }, token).catch(() => {});

  // Set __hcapToken in ALL frames concurrently + respond to any pending EXECUTE
  await Promise.all(page.frames().map(frame =>
    frame.evaluate((tok: string) => {
      const w = window as any;
      w.__hcapToken = tok;
      document.querySelectorAll<HTMLTextAreaElement>("textarea[name='h-captcha-response'], input[name='h-captcha-response']")
        .forEach(el => { el.value = tok; el.dispatchEvent(new Event("change", { bubbles: true })); });
      if (w.__stripeHcaptchaCallback) { try { w.__stripeHcaptchaCallback(tok); } catch {} }
      // If this frame had a pending EXECUTE, respond now with the token
      if (w.__pendingExecute) {
        const pe = w.__pendingExecute;
        w.__pendingExecute = null;
        const resp = { type: "stripe-third-party-child-to-parent", frameID: pe.frameID, requestID: pe.requestID, payload: { response: tok } };
        try { window.parent.postMessage(resp, "*"); } catch {}
        try { (window.top as any)?.postMessage(resp, "*"); } catch {}
      }
    }, token).catch(() => {})
  ));

  // Fire challenge-passed + success messages in hcaptcha/bridge frames concurrently
  await Promise.all(page.frames().map(async (frame) => {
    const url = frame.url();
    const isHcap = url.includes("newassets.hcaptcha.com");
    const isBridge = url.includes("HCaptcha") || url.includes("hcaptcha-inner") || url.includes("hcaptcha-invisible");
    if (!isHcap && !isBridge) return;
    await frame.evaluate((args: { tok: string; isHcap: boolean }) => {
      const msgs = args.isHcap
        ? [
            JSON.stringify({ event: "challenge-passed", response: args.tok }),
            JSON.stringify({ id: "hcaptcha", type: "challenge.passed", response: args.tok }),
          ]
        : [
            JSON.stringify({ id: "hcaptcha", type: "success", token: args.tok }),
            JSON.stringify({ id: "hcaptcha", type: "challenge.passed", response: args.tok }),
            JSON.stringify({ source: "hcaptchaInvisible", response: args.tok, token: args.tok }),
          ];
      msgs.forEach(msg => { try { window.parent.postMessage(msg, "*"); } catch {} });
    }, { tok: token, isHcap }).catch(() => {});
  }));

  page.setDefaultTimeout(30000); // reset to 30s
  log(`  Token broadcasted to all frames`);
}

async function clickSubscribeBtn(page: Page): Promise<boolean> {
  for (const sel of ['button[data-testid="hosted-payment-submit-button"]', 'button[type="submit"]', 'button:has-text("Subscribe")']) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await el.click({ delay: 50, timeout: 3000 }).catch(() => {});
        log(`  Subscribe clicked`);
        return true;
      }
    } catch {}
  }
  return await page.evaluate(() => {
    const btn = document.querySelector("button[type='submit']:not(:disabled)") as HTMLButtonElement | null;
    if (btn) { btn.click(); return true; }
    return false;
  });
}

async function fetchBankOtp(since: Date): Promise<string | null> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    let client: any;
    try {
      client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: CARD.otpEmail, pass: CARD.otpPassword }, logger: false });
      await client.connect();
      await client.mailboxOpen("INBOX");
      const uids = await client.search({ since: new Date(since.getTime() - 60_000) }) as number[];
      for await (const msg of client.fetch(uids, { envelope: true, source: true })) {
        const d: Date = msg.envelope?.date ? new Date(msg.envelope.date) : new Date(0);
        if (d < since) continue;
        const raw = msg.source?.toString() || "";
        const fromAddr = (msg.envelope?.from?.[0]?.address || "").toLowerCase();
        if (!fromAddr.includes("federal") && !fromAddr.includes("bank") && !raw.toLowerCase().includes("otp")) continue;
        const m = raw.match(/\b([0-9]{6})\b/g);
        if (m) {
          const otp = m[m.length - 1];
          log(`✅ OTP: ${otp} (from ${fromAddr})`);
          try { await client.messageFlagsAdd({ uid: Number(msg.uid) }, ["\\Seen"]); } catch {}
          await client.logout();
          return otp;
        }
      }
      await client.logout();
    } catch (e: any) {
      try { await client?.logout(); } catch {}
    }
    await new Promise(r => setTimeout(r, 8000));
  }
  return null;
}

async function solveHcap(rqdata: string | null, label: string): Promise<string | null> {
  const sk = "a9b5fb07-92ff-493f-86fe-352a2803b3df", su = "https://checkout.stripe.com";
  log(`🤖 Solving [${label}] rqdata=${rqdata ? "YES " + rqdata.substring(0, 15) + "..." : "none"}...`);
  const r1 = await solveHCaptchaWith2Captcha(su, sk, rqdata ?? undefined).catch(() => ({ success: false, token: null as string | null }));
  if (r1.success && r1.token) { log(`✅ Solved [${label}] len=${r1.token.length}`); return r1.token; }
  const r2 = await solveHCaptcha(su, sk, undefined, rqdata ?? undefined).catch(() => ({ success: false, token: null as string | null }));
  if (r2.success && r2.token) { log(`✅ Solved [${label}] via fallback len=${r2.token.length}`); return r2.token; }
  log(`⚠️ Solve failed [${label}]`);
  return null;
}

async function enterOtpIn3DS(page: Page, otp: string) {
  const bankFrames = page.frames().filter((f: Frame) => {
    const u = f.url();
    return u.includes("m2pfintech") || u.includes("m2pSecAuth") || u.includes("federalbank");
  });
  const candidates = bankFrames.length > 0 ? bankFrames : page.frames().filter((f: Frame) => {
    const u = f.url();
    return !u.includes("js.stripe.com") && !u.includes("stripecdn") && !u.includes("hcaptcha") && u !== "about:blank" && u !== "";
  });
  for (const fr of candidates) {
    for (const sel of ['input[name="challengeDataEntry"]', 'input[autocomplete="one-time-code"]', 'input[type="tel"]', 'input[type="number"]', 'input[type="password"]', 'input[type="text"]']) {
      try {
        const el = fr.locator(sel).first();
        if (!await el.isVisible({ timeout: 1200 }).catch(() => false)) continue;
        await el.fill(otp);
        log(`  OTP "${otp}" → ${fr.url().substring(0, 60)}`);
        await page.waitForTimeout(400);
        const btn = fr.locator('button[type="submit"],input[type="submit"],button:has-text("Submit"),button:has-text("Verify")').first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) { await btn.click(); log(`  OTP submit clicked`); }
        else { await el.press("Enter"); log(`  OTP submitted via Enter`); }
        return;
      } catch {}
    }
  }
}

async function getResidentialProxy() {
  try {
    const { db } = await import("../server/db");
    const { sql: drizzleSql } = await import("drizzle-orm");
    // Prefer ZenRows browser_proxy_url (confirmed working residential proxy)
    const res = await db.execute(drizzleSql`SELECT key, value FROM settings WHERE key IN ('browser_proxy_url', 'soax_proxy_template', 'residential_proxy_url')`);
    const byKey: Record<string, string> = {};
    for (const r of res.rows) byKey[r.key as string] = r.value as string;
    // ZenRows superproxy: confirmed working (190.5.33.30)
    const rawUrl = byKey["browser_proxy_url"] || byKey["residential_proxy_url"] || byKey["soax_proxy_template"] || null;
    if (!rawUrl) return null;
    const m = rawUrl.match(/^http:\/\/([^:]+):([^@]+)@([^:]+):(\d+)/);
    if (!m) return null;
    const [, user, pass, host, port] = m;
    // For ZenRows: inject a fresh random session ID each run for a new residential IP
    const randSession = Math.random().toString(36).substring(2, 14);
    const freshPass = pass.replace(/_session-[^_]+/, `_session-${randSession}`);
    log(`🌐 Proxy: ${host}:${port} user=${user.substring(0, 15)}...`);
    return { server: `http://${host}:${port}`, username: user, password: freshPass };
  } catch (e: any) {
    log(`⚠️ Proxy fetch failed: ${e.message} — proceeding without proxy`);
    return null;
  }
}

async function main() {
  log(`🚀 Checkout: ${REPLIT_EMAIL}`);

  const proxy = await getResidentialProxy();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
    ...(proxy ? { proxy } : {}),
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "America/New_York",
    // ZenRows and other MitM proxies re-sign TLS — ignore certificate errors
    ...(proxy ? { ignoreHTTPSErrors: true } : {}),
  });
  await context.addInitScript(() => {
    const w = window as any;
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    w.chrome = { runtime: {}, app: {} };
    w.__capturedRqdata = null;
    w.__hcapToken = null;
    w.__pendingExecute = null;

    // Send hCaptcha response in Stripe's exact format
    function sendHcapResponse(frameID: string, requestID: any, token: string) {
      const response = {
        type: "stripe-third-party-child-to-parent",
        frameID,
        requestID,
        payload: { response: token },
      };
      try { window.parent.postMessage(response, "*"); } catch {}
      try { (window.top as any)?.postMessage(response, "*"); } catch {}
    }

    // Capture rqdata from any postMessage (broad catch)
    window.addEventListener("message", (e: MessageEvent) => {
      try {
        const str = typeof e.data === "string" ? e.data : JSON.stringify(e.data || "");
        const m = str.match(/"rqdata"\s*:\s*"([^"]{10,})"/);
        if (m && !w.__capturedRqdata) {
          w.__capturedRqdata = m[1];
          try { window.parent.postMessage({ type: "hcap-rqdata", rqdata: m[1] }, "*"); } catch {}
          try { (window.top as any)?.postMessage({ type: "hcap-rqdata", rqdata: m[1] }, "*"); } catch {}
        }
      } catch {}
    }, true);

    window.addEventListener("message", (e: MessageEvent) => {
      try {
        const d = e.data;
        if (!d || typeof d !== "object") return;

        // Receive injected token
        if (d.type === "inject-hcap-token") {
          w.__hcapToken = d.token;
          if (w.__pendingExecute) {
            const pe = w.__pendingExecute;
            w.__pendingExecute = null;
            sendHcapResponse(pe.frameID, pe.requestID, d.token);
          }
          return;
        }

        // Collect hcap-rqdata forwarded from child frames and re-forward up
        if ((d.type === "hcap-rqdata" || d.type === "hcap-rqdata-execute") && d.rqdata) {
          w.__capturedRqdata = d.rqdata;
          try { window.parent.postMessage({ type: "hcap-rqdata", rqdata: d.rqdata }, "*"); } catch {}
          try { (window.top as any)?.postMessage({ type: "hcap-rqdata", rqdata: d.rqdata }, "*"); } catch {}
          return;
        }

        // Log ALL message types for debugging
        if (d.type) { console.error("[INIT-MSG] " + window.location.hostname.substring(0,25) + " type=" + d.type + " payload=" + JSON.stringify(d.payload)?.substring(0,60)); }

        // Stripe's hCaptcha EXECUTE message: {type: "stripe-third-party-parent-to-child", payload: {action/type: "EXECUTE_HCAPTCHA_INVISIBLE", rqdata}, frameID, requestID}
        if (d.type === "stripe-third-party-parent-to-child") {
          const payload = d.payload;
          const rqdata = (typeof payload === "object" && payload?.rqdata) || null;
          if (rqdata) {
            w.__capturedRqdata = rqdata;
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
            sendHcapResponse(frameID, requestID, w.__hcapToken);
          } else {
            w.__pendingExecute = { frameID, requestID };
            if (rqdata) {
              try { window.parent.postMessage({ type: "hcap-rqdata-execute", rqdata }, "*"); } catch {}
            }
          }
        }
      } catch {}
    }, true);
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  // Capture console.error messages from init script (for rqdata debugging)
  page.on("console", (msg) => {
    try {
      if (msg.type() === "error" && msg.text().includes("[INIT-MSG]")) {
        log(`  [browser] ${msg.text().substring(0, 120)}`);
      }
      if (msg.type() === "error" && msg.text().includes("[HCAP-INTERCEPT]")) {
        log(`  [browser] ${msg.text().substring(0, 120)}`);
      }
    } catch {}
  });

  // Capture rqdata from network requests (POST body) and responses
  page.on("request", (req) => {
    try {
      const url = req.url();
      if (!url.includes("hcaptcha.com") && !url.includes("hcaptcha.net")) return;
      const body = req.postData() || "";
      const m = body.match(/rqdata=([^&\s"]{10,})/);
      if (m && !networkRqdata) { networkRqdata = decodeURIComponent(m[1]); log(`📡 rqdata from request: ${networkRqdata.substring(0,30)}...`); }
    } catch {}
  });
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!url.includes("hcaptcha.com") && !url.includes("hcaptcha.net")) return;
      const body = await response.text().catch(() => "");
      const m = body.match(/"rqdata"\s*:\s*"([^"]{10,})"/);
      if (m && !networkRqdata) { networkRqdata = m[1]; log(`📡 rqdata from response: ${networkRqdata.substring(0,30)}...`); }
    } catch {}
  });

  try {
    // ── Login ──────────────────────────────────────────────────────────
    log(`🔐 Login...`);
    await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    const id = await page.$('input[name="username"], input[type="email"]').catch(() => null);
    if (id) { await id.click({ clickCount: 3 }); await id.type(REPLIT_EMAIL, { delay: 40 }); }
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      Array.from(document.querySelectorAll<HTMLElement>("button, input[type='submit']")).find(b => ["continue","next","log in","login"].includes((b.textContent||(b as HTMLInputElement).value||"").trim().toLowerCase()))?.click();
    });
    await page.waitForTimeout(5000);
    const pw = await page.$('input[type="password"]').catch(() => null);
    if (pw) {
      await pw.click({ clickCount: 3 }); await pw.type(REPLIT_PASSWORD, { delay: 40 }); await page.waitForTimeout(400);
      await page.evaluate(() => { Array.from(document.querySelectorAll<HTMLElement>("button")).find(b => ["log in","login","sign in","continue"].includes((b.textContent||"").trim().toLowerCase()))?.click(); });
      await page.waitForTimeout(8000);
    }
    if (page.url().includes("/login")) { log(`❌ Login failed`); await browser.close(); process.exit(1); }
    log(`✅ Logged in`);

    // ── Checkout ───────────────────────────────────────────────────────
    log(`🛒 Checkout...`);
    await page.goto(CHECKOUT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(10000);
    if (!page.url().includes("checkout.stripe.com")) { log(`❌ Not on Stripe`); await browser.close(); process.exit(1); }
    for (let i = 0; i < 8; i++) { if (page.frames().some((f: Frame) => f.url().includes("js.stripe.com"))) break; await page.waitForTimeout(1200); }
    const checkoutLoadTime = Date.now();
    // Print FULL URLs for hcaptcha frames (don't truncate)
    const allFrameUrls = page.frames().map((f: Frame) => {
      const u = f.url();
      const isHcap = u.includes("hcaptcha.com") || u.includes("HCaptcha");
      return isHcap ? `[HCAP] ${u}` : u.substring(0, 80);
    });
    log(`✅ ${allFrameUrls.length} frames:\n  ${allFrameUrls.join("\n  ")}`);
    const rqdataAtLoad = await quickRqdataScan(page);
    if (rqdataAtLoad) log(`  🎯 rqdata already present at load: ${rqdataAtLoad.substring(0,50)}`);
    else log(`  rqdata not present at load (expected — will appear after Subscribe click)`);

    // ── Card + Address ─────────────────────────────────────────────────
    log(`💳 Card + Address...`);
    const exp = `${CARD.expiryMonth.padStart(2,"0")}${CARD.expiryYear.slice(-2)}`;
    await fillStripeField(page, ["cardnumber","cardNumber","card-number","number"], CARD.number);
    await page.waitForTimeout(400);
    await fillStripeField(page, ["exp-date","cardExpiry","card-expiry","expiry","exp"], exp);
    await page.waitForTimeout(400);
    await fillStripeField(page, ["cvc","cardCvc","cvv","card-cvc"], CARD.cvv);
    await page.waitForTimeout(300);

    // Fill billing name (in main page)
    await page.fill('input[name="billingName"]', CARD.holderName).catch(async () => {
      await page.fill('input[autocomplete="cc-name"]', CARD.holderName).catch(() => {});
    });
    log(`  billingName: "${CARD.holderName}"`);

    // Billing country — read current default value first
    const defCountry = await page.evaluate(() => {
      const sel = document.querySelector<HTMLSelectElement>('select[name="billingCountry"]');
      return sel ? sel.value : null;
    }).catch(() => null);
    log(`  billingCountry default: ${defCountry}`);

    // Only change country if it's not already what we want; use US for simpler address requirements
    const targetCountry = "US";
    if (defCountry !== targetCountry) {
      await page.selectOption('select[name="billingCountry"]', { value: targetCountry }).catch(() => {});
      log(`  billingCountry set to ${targetCountry}`);
      await page.waitForTimeout(600);
    }

    // Fill address fields for US (short timeout to avoid 30s hangs)
    const T = { timeout: 800 };
    await page.fill('input[name="billingAddressLine1"]', "123 Main St", T).catch(() => {});
    await page.fill('input[name="billingLocality"]', "New York", T).catch(async () => {
      await page.fill('input[placeholder*="City" i]', "New York", T).catch(() => {});
    });
    await page.fill('input[name="billingPostalCode"]', "10001", T).catch(async () => {
      await page.fill('input[placeholder*="ZIP" i]', "10001", T).catch(async () => {
        await page.fill('input[placeholder*="Postal" i]', "10001", T).catch(() => {});
      });
    });
    // State field (US-specific) — use short timeout to avoid 30s hangs
    await page.selectOption('select[name="billingState"]', { value: "NY" }, T).catch(async () => {
      await page.fill('input[name="billingState"]', "NY", T).catch(() => {});
    });
    log(`  address: 123 Main St, New York, 10001 US`);

    // ── Print visible inputs for debugging ────────────────────────────────────
    const visibleInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input, select, textarea, button[type="submit"]'))
        .filter((el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el: Element) => {
          const e = el as HTMLInputElement;
          return `${e.tagName.toLowerCase()}[name="${e.name}"][type="${e.type}"][placeholder="${e.placeholder}"]`;
        });
    }).catch(() => [] as string[]);
    log(`  Visible inputs on main page: ${visibleInputs.join(" | ").substring(0, 400)}`);

    // ── Wait for hCaptcha to initialize (need ~30s from checkout load) ──────────
    // Also scan for rqdata pre-emptively in case it appears early
    const minHcapInitMs = 30000;
    const preElapsed = Date.now() - checkoutLoadTime;
    if (preElapsed < minHcapInitMs) {
      const waitMs = minHcapInitMs - preElapsed;
      log(`⏳ Waiting ${Math.round(waitMs/1000)}s for hCaptcha init (have ${Math.round(preElapsed/1000)}s so far)...`);
      // Poll for early rqdata during wait
      let earlyRqdata: string | null = null;
      const polls = Math.ceil(waitMs / 1000);
      for (let i = 0; i < polls; i++) {
        await page.waitForTimeout(1000);
        earlyRqdata = await quickRqdataScan(page);
        if (earlyRqdata) { log(`  🎯 Pre-Subscribe rqdata at ${Math.round(preElapsed/1000)+i+1}s`); break; }
      }
    }

    // ── Click Subscribe (first time — triggers hCaptcha, broadcasts rqdata) ───────
    const paymentTime = new Date();
    log(`🖱️ Subscribe (triggers hCaptcha + rqdata capture)...`);
    await clickSubscribeBtn(page);

    // ── Wait for rqdata (appears 3-5s after Subscribe triggers hCaptcha execute) ──
    log(`📦 Waiting for rqdata (up to 10s)...`);
    let rqdata: string | null = null;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      rqdata = await quickRqdataScan(page);
      if (rqdata) { log(`  ✅ rqdata at ${i+1}s: ${rqdata.substring(0,40)}...`); break; }
    }
    if (!rqdata) log(`  ⚠️ rqdata not found after 10s — solving without it`);

    // ── Solve hCaptcha with rqdata ─────────────────────────────────────────────
    let token = await solveHcap(rqdata, rqdata ? "rqdata" : "no-rqdata");

    // ── Inject token + re-click Subscribe ──────────────────────────────────────
    if (token) {
      log(`💉 Injecting token into all existing + future frames...`);
      await broadcastToken(page, token);

      // Hook: inject token into every NEW frame that navigates after this point.
      // When Subscribe is clicked again, fresh hcaptcha-inner / HCaptcha frames
      // appear — they must have __hcapToken before the EXECUTE message arrives.
      let liveToken: string | null = token;
      const injectIntoFrame = async (frame: Frame) => {
        if (!liveToken) return;
        const tok = liveToken;
        await frame.evaluate((t: string) => {
          const w = window as any;
          w.__hcapToken = t;
          document.querySelectorAll<HTMLTextAreaElement>("textarea[name='h-captcha-response'], input[name='h-captcha-response']")
            .forEach(el => { el.value = t; el.dispatchEvent(new Event("change", { bubbles: true })); });
          if (w.__stripeHcaptchaCallback) { try { w.__stripeHcaptchaCallback(t); } catch {} }
          if (w.__pendingExecute) {
            const pe = w.__pendingExecute;
            w.__pendingExecute = null;
            const resp = { type: "stripe-third-party-child-to-parent", frameID: pe.frameID, requestID: pe.requestID, payload: { response: t } };
            try { window.parent.postMessage(resp, "*"); } catch {}
            try { (window.top as any)?.postMessage(resp, "*"); } catch {}
          }
        }, tok).catch(() => {});
      };
      page.on("framenavigated", injectIntoFrame);

      await page.waitForTimeout(1500);
      await clickSubscribeBtn(page);

      // Wait a bit for new frames to get the token before monitoring
      await page.waitForTimeout(3000);
    } else {
      log(`⚠️ No token — re-clicking Subscribe without token`);
      await clickSubscribeBtn(page);
    }

    // ── Monitor loop ──────────────────────────────────────────────────
    log(`⏳ Monitoring...`);
    const endTime = Date.now() + 180_000;
    let checkoutComplete = false;
    let solveAttempts = 0;

    while (!checkoutComplete && Date.now() < endTime) {
      // First poll: longer wait (15s) for payment processing + redirect
      await page.waitForTimeout(solveAttempts === 0 ? 15000 : 5000);
      const url = page.url();

      if (url.includes("replit.com") && !url.includes("stripe")) {
        log(`✅ Redirected to Replit — COMPLETE!`);
        checkoutComplete = true;
        break;
      }

      const has3DS = page.frames().some((f: Frame) => {
        const u = f.url();
        return u.includes("m2pfintech") || u.includes("m2pSecAuth") || u.includes("federalbank") || u.includes("three-ds");
      });
      // hasPaymentHcap: check for payment-specific sitekey (a9b5fb07), not pre-loaded security frames
      const hasPaymentHcap = page.frames().some((f: Frame) => {
        const u = f.url();
        return u.includes("newassets.hcaptcha.com") && u.includes("a9b5fb07");
      });
      const pageText = await page.evaluate(() => document.body.innerText.replace(/\n/g," ").substring(0,200)).catch(()=>"");
      log(`  payHcap=${hasPaymentHcap} 3DS=${has3DS} | ${pageText.substring(0,100)}`);

      if (has3DS) {
        log(`🔐 3DS detected — fetching OTP from Gmail...`);
        const otp = await fetchBankOtp(paymentTime);
        if (otp) {
          await enterOtpIn3DS(page, otp);
          for (let poll = 0; poll < 25; poll++) {
            await page.waitForTimeout(3000);
            if (page.url().includes("replit.com") && !page.url().includes("stripe")) { checkoutComplete = true; log(`✅ Complete after OTP!`); break; }
          }
        } else { log(`⚠️ OTP timeout`); }
        break;
      }

      if (hasPaymentHcap && solveAttempts < 2) {
        solveAttempts++;
        log(`🔄 Payment hCaptcha retry ${solveAttempts} — fresh rqdata scan...`);
        await page.waitForTimeout(1000);
        const freshRq = await quickRqdataScan(page);
        log(`  rqdata: ${freshRq ? freshRq.substring(0,30)+"..." : "none"}`);
        const newTok = await solveHcap(freshRq, `retry-${solveAttempts}`);
        if (newTok) {
          await broadcastToken(page, newTok);
          await page.waitForTimeout(1500);
          await clickSubscribeBtn(page);
        }
        continue;
      }

      if (pageText.toLowerCase().includes("declined") || pageText.toLowerCase().includes("payment failed")) {
        log(`❌ Payment declined`);
        break;
      }

      // No 3DS, no payment hCaptcha, no redirect — wait briefly more
      log(`  Still on Stripe checkout — waiting...`);
    }

    log("─".repeat(60));
    log(`URL : ${page.url()}`);
    const ft = await page.evaluate(() => document.body.innerText.toLowerCase().substring(0,300)).catch(()=>"");
    log(`Text: ${ft.substring(0,200)}`);
    log(checkoutComplete ? `✅ CHECKOUT COMPLETE` : `⚠️ Uncertain — check ${page.url()}`);

  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main();

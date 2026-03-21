/**
 * Replit Core Stripe checkout automation (simplified)
 * Flow:
 *  1. Login to Replit
 *  2. Navigate to checkout URL with coupon (shows $0.00 after coupon)
 *  3. Fill card number, expiry, CVV, billing name + US address
 *  4. Click Subscribe
 *  5. hCaptcha appears → solve via NopeCHA /v1/token/hcaptcha
 *  6. Inject token → Stripe proceeds → OTP section appears
 *  7. Fetch OTP from Gmail → enter it → wait for success
 */

import { chromium, type Page } from "playwright";
import { ImapFlow } from "imapflow";
import * as fs from "fs";
import * as path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────
const REPLIT_EMAIL  = "mitchellrobles7884@outlook.com";
const REPLIT_PASS   = "RPcohz1h#92";
const COUPON        = "AGENT4EEDB083F1A5B";
const CARD_NUMBER   = "4065843006197211";
const CARD_EXPIRY   = "03/31";
const CARD_CVV      = "007";
const CARD_HOLDER   = "AJAY KUMAR";
const BILLING_LINE1 = "123 Main St";
const BILLING_CITY  = "New York";
const BILLING_STATE = "NY";
const BILLING_ZIP   = "10001";

// hCaptcha (Stripe's sitekey for checkout)
const HCAP_SITEKEY  = "c7faac4c-1cd7-4b1b-b2d4-42ba98d09c7a";
const HCAP_PAGEURL  = "https://b.stripecdn.com";

// NopeCHA API
const NOPECHA_KEY   = "sub_1TDHVaCRwBwvt6pt1gtAMAdC";
const NOPECHA_HDRS  = {
  "Content-Type": "application/json",
  "Authorization": `Basic ${NOPECHA_KEY}`,
};
// 2captcha API (fallback)
const TWOCAPTCHA_KEY = "3cd7a9b9cccd581f39296b9c9e397360";

// Gmail IMAP for OTP
const GMAIL_USER    = "ajayvaishwakarma@gmail.com";
const GMAIL_PASS    = "vcvg cejo aqqj kcxs";

// ─── Logging ──────────────────────────────────────────────────────────────────
const LOG_FILE = `/tmp/stripe-script-${Date.now()}.log`;
fs.writeFileSync("/tmp/stripe-current-log.txt", LOG_FILE);
function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Solve hCaptcha using 2captcha (primary) with NopeCHA fallback
async function solveHcaptcha(rqdata: string | null): Promise<string> {
  // ── Try 2captcha first ──────────────────────────────────────────────────────
  try {
    log(`🤖 2captcha submit${rqdata ? " (with rqdata)" : " (no rqdata)"}...`);
    const params = new URLSearchParams({
      key: TWOCAPTCHA_KEY,
      method: "hcaptcha",
      sitekey: HCAP_SITEKEY,
      pageurl: HCAP_PAGEURL,
      invisible: "1",
      json: "1",
    });
    if (rqdata) params.set("rqdata", rqdata);
    const submitRes = await fetch("https://2captcha.com/in.php", {
      method: "POST",
      body: params,
    });
    const submitJson = await submitRes.json() as any;
    if (submitJson.status !== 1 || !submitJson.request) throw new Error(`2captcha submit failed: ${JSON.stringify(submitJson)}`);
    const taskId = submitJson.request;
    log(`  2captcha job ID: ${taskId} — polling...`);
    // Poll up to 36 × 5s = 180s
    for (let i = 1; i <= 36; i++) {
      await sleep(5000);
      const pollRes = await fetch(`https://2captcha.com/res.php?key=${TWOCAPTCHA_KEY}&action=get&id=${taskId}&json=1`);
      const pollJson = await pollRes.json() as any;
      if (pollJson.status === 1 && pollJson.request && pollJson.request.length > 30) {
        log(`  ✅ 2captcha solved at poll ${i}, token len=${pollJson.request.length}`);
        return pollJson.request;
      }
      if (pollJson.request !== "CAPCHA_NOT_READY") {
        log(`  ⚠️  2captcha poll ${i}: ${JSON.stringify(pollJson)}`);
      }
    }
    throw new Error("2captcha timed out");
  } catch (err2cap) {
    log(`  ⚠️  2captcha failed: ${err2cap} — trying NopeCHA...`);
  }

  // ── Fallback: NopeCHA ───────────────────────────────────────────────────────
  const body: any = { sitekey: HCAP_SITEKEY, url: HCAP_PAGEURL };
  if (rqdata) body.data = { rqdata };
  log(`🤖 NopeCHA submit${rqdata ? " (with rqdata)" : " (no rqdata)"}...`);
  const submitRes = await fetch("https://api.nopecha.com/v1/token/hcaptcha", {
    method: "POST",
    headers: NOPECHA_HDRS,
    body: JSON.stringify(body),
  });
  const submitJson = await submitRes.json() as any;
  const jobId = submitJson.data;
  if (!jobId || submitJson.error) throw new Error(`NopeCHA submit failed: ${JSON.stringify(submitJson)}`);
  log(`  NopeCHA Job ID: ${jobId} — polling...`);
  for (let i = 1; i <= 24; i++) {
    await sleep(5000);
    const pollRes = await fetch(`https://api.nopecha.com/v1/token/hcaptcha?id=${jobId}`, { headers: NOPECHA_HDRS });
    const pollJson = await pollRes.json() as any;
    if (pollJson.data && typeof pollJson.data === "string" && pollJson.data.length > 30) {
      log(`  ✅ NopeCHA solved at poll ${i}, token len=${pollJson.data.length}`);
      return pollJson.data;
    }
    log(`  ⚠️  NopeCHA poll ${i}: ${JSON.stringify(pollJson)}`);
  }
  throw new Error("NopeCHA timed out");
}

// Fill a Stripe iframe field by name
async function fillStripeField(page: Page, name: string, value: string) {
  for (const frame of page.frames()) {
    const selectors = [
      `input[name="${name}"]`,
      `input[data-elements-stable-field-name="${name}"]`,
      `input[autocomplete="${name}"]`,
    ];
    for (const sel of selectors) {
      const el = await frame.$(sel).catch(() => null);
      if (el) {
        try { await frame.fill(sel, value, { timeout: 4000 }); } catch {
          await frame.evaluate(({ s, v }: any) => {
            const inp = document.querySelector(s) as HTMLInputElement;
            if (!inp) return;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (setter) setter.call(inp, v); else inp.value = v;
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
          }, { s: sel, v: value });
        }
        log(`  ✏️  ${name} = "${value.substring(0, 15)}"`);
        return;
      }
    }
  }
  log(`  ⚠️  Field not found: ${name}`);
}

// Inject hCaptcha token into all page frames
async function injectToken(page: Page, token: string) {
  log(`  💉 Injecting token (len=${token.length}) into all frames...`);

  for (const frame of page.frames()) {
    const url = frame.url();
    await frame.evaluate((t: string) => {
      const w = window as any;
      w.__hcapToken = t;

      // Set h-captcha-response textarea/input
      document.querySelectorAll<HTMLElement>("textarea[name='h-captcha-response'], input[name='h-captcha-response']").forEach(el => {
        (el as any).value = t;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });

      // Try calling hCaptcha widget callback (for HCaptcha.html frame)
      try {
        const hc = (window as any).hcaptcha;
        if (hc) {
          // Try internal widget map
          const widgetMap = hc._widgets || hc._widgetMap || hc.widgets || {};
          Object.values(widgetMap).forEach((widget: any) => {
            try { if (widget?.callback) widget.callback(t); } catch {}
            try { if (widget?.g?.callback) widget.g.callback(t); } catch {}
            try { if (widget?.l?.callback) widget.l.callback(t); } catch {}
          });
          // Also try public API
          Object.keys(hc).forEach(k => {
            try {
              const v = hc[k];
              if (v && typeof v === "object") {
                if (v.callback) v.callback(t);
                if (v.g && v.g.callback) v.g.callback(t);
              }
            } catch {}
          });
        }
      } catch {}

      // If there's a pending execute (invisible phase), respond with correct format
      if (w.__pendingExecute) {
        const pe = w.__pendingExecute;
        w.__pendingExecute = null;
        const resp = {
          type: "stripe-third-party-child-to-parent",
          frameID: pe.frameID, requestID: pe.requestID,
          // Use correct RESPONSE_HCAPTCHA_INVISIBLE format
          payload: { tag: "RESPONSE_HCAPTCHA_INVISIBLE", value: { response: t } },
        };
        console.log(`[INJECT] Responding to pendingExecute frameID=${pe.frameID}`);
        try { window.parent.postMessage(resp, "*"); } catch {}
      }
    }, token).catch(() => {});

    // For HCaptcha.html (visual challenge frame) — send response to hcaptcha-inner
    if (url.includes("HCaptcha.html")) {
      const frameId = new URL(url).searchParams.get("id") || "";
      log(`    → HCaptcha.html detected (id=${frameId.substring(0,20)}) — sending completion to parent`);
      await frame.evaluate(({ t, fid }: any) => {
        // Send "captcha complete" event to hcaptcha-inner (parent)
        const responses = [
          // Try different payload formats
          { type: "stripe-third-party-child-to-parent", frameID: fid, payload: { type: "response", token: t } },
          { type: "stripe-third-party-child-to-parent", frameID: fid, payload: { type: "event", name: "captcha-complete", response: t } },
          { type: "stripe-third-party-child-to-parent", frameID: fid, payload: { type: "event", name: "captcha-verified", response: t } },
        ];
        responses.forEach(msg => {
          try { window.parent.postMessage(msg, "*"); } catch {}
        });
        // Also try to trigger hcaptcha execute callback  
        try {
          const hc = (window as any).hcaptcha;
          if (hc && typeof hc.execute === "function") {
            // Override execute to use our token
            const orig = hc.execute.bind(hc);
          }
        } catch {}
      }, { t: token, fid: frameId }).catch(() => {});
    }
  }

  // Broadcast inject-hcap-token to all iframes from main page context
  await page.evaluate((t: string) => {
    document.querySelectorAll<HTMLIFrameElement>("iframe").forEach(iframe => {
      try { iframe.contentWindow?.postMessage({ type: "inject-hcap-token", token: t }, "*"); } catch {}
    });
  }, token).catch(() => {});
}

// Fetch OTP from Gmail — looks for 6-digit code in bank/OTP emails
// IMPORTANT: IMAP SINCE only filters by date (not time). We must manually check email timestamps.
async function fetchGmailOtp(sinceMs: number): Promise<string | null> {
  const sinceDate = new Date(sinceMs);
  // IMAP SINCE only works at day granularity, use yesterday to get all today's emails
  const sinceDay = new Date(sinceDate);
  sinceDay.setHours(0, 0, 0, 0);
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }, logger: false,
  });
  try {
    await client.connect();
    log(`  📧 Gmail IMAP connected (need email AFTER ${sinceDate.toLocaleTimeString()})`);
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(5000);
      await client.mailboxOpen("INBOX");
      const msgs = await client.search({ since: sinceDay }).catch(() => [] as any[]);
      log(`  📧 Poll ${attempt + 1}/30: found ${msgs?.length || 0} today's emails`);
      for (const uid of (msgs || []).reverse()) {
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }).catch(() => null);
        if (!msg) continue;
        const text = msg.source?.toString() || "";
        const subj = (msg as any).envelope?.subject || "";
        const from = (msg as any).envelope?.from?.[0]?.address || "";

        // Check the email's Date header to ensure it arrived AFTER payment time
        const dateHeader = text.match(/^Date:\s*(.+)$/im)?.[1]?.trim() || "";
        const emailTime = dateHeader ? new Date(dateHeader).getTime() : 0;
        // Allow emails up to 5 min before sinceMs (buffer) — but must be after sinceMs-5min
        if (emailTime > 0 && emailTime < sinceMs - 300000) { // skip if >5min before payment
          log(`  📧 Skip stale email from=${from} emailTime=${new Date(emailTime).toLocaleTimeString()} (${emailTime}) < paymentTime=${sinceDate.toLocaleTimeString()} (${sinceMs})`);
          continue;
        }

        log(`  📧 Email from=${from} subject="${subj.substring(0,60)}" time=${dateHeader ? new Date(dateHeader).toLocaleTimeString() : "??"}`);

        // Only accept OTP emails from banking/payment domains
        const isBankSender = from.includes("federalbank") || from.includes("federal.bank") ||
          from.includes("rbi.org") || from.includes("npci.org") || from.includes("visa.com") ||
          from.includes("mastercard") || from.includes("hdfc") || from.includes("sbi.") ||
          subj.toLowerCase().includes("otp") || subj.toLowerCase().includes("one time") ||
          subj.toLowerCase().includes("verification") || subj.toLowerCase().includes("transaction") ||
          subj.toLowerCase().includes("secure") || subj.toLowerCase().includes("authenticate");

        if (!isBankSender) {
          log(`  📧 Skipping non-bank email from ${from}`);
          continue;
        }

        // Look for 6-digit OTP in banking/verification context
        const strictPatterns = [
          /(?:OTP|otp|one.?time|verification|passcode|code|authenticate)[^\d]{0,30}(\d{6})/i,
          /(\d{6})(?:[^\d]{0,30}(?:OTP|otp|one.?time|verification|passcode|code))/i,
          /is\s+(\d{6})/i,
          /:\s*(\d{6})\b/,
          /\b(\d{6})\b/,
        ];
        for (const pat of strictPatterns) {
          const m = text.match(pat);
          if (m && m[1] && m[1] !== "000000") {
            log(`  📧 OTP found: ${m[1]} (from ${from} at ${dateHeader ? new Date(dateHeader).toLocaleTimeString() : "??"})`);
            await client.logout();
            return m[1];
          }
        }
      }
    }
    await client.logout();
  } catch (e: any) {
    log(`  📧 IMAP error: ${e.message}`);
    try { await client.logout(); } catch {}
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`🚀 Starting checkout — ${REPLIT_EMAIL}`);
  log(`   Coupon: ${COUPON}`);

  const EXTENSION_PATH = path.resolve(process.cwd(), "extensions/capsolver");
  const userDataDir = `/tmp/chrome-profile-${Date.now()}`;
  const USE_EXTENSION = process.env.STRIPE_NO_EXT !== "1";
  log(`  Extension: ${USE_EXTENSION ? "ENABLED" : "DISABLED (STRIPE_NO_EXT=1)"}`);

  const extensionArgs = USE_EXTENSION ? [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
  ] : [];

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      ...extensionArgs,
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,900",
    ],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  // Expose NopeCHA solver to browser pages (with rqdata support)
  await ctx.exposeFunction("__solveHcapWithRqdata", async (rqdataArg: string | null) => {
    log(`🔓 __solveHcapWithRqdata called from browser (rqdata=${rqdataArg ? rqdataArg.substring(0,30)+"..." : "none"})`);
    return solveHcaptcha(rqdataArg);
  });

  // Intercept postMessages in ALL frames to capture rqdata and auto-tokens
  await ctx.addInitScript(() => {
    const w = window as any;

    window.addEventListener("message", async (e: MessageEvent) => {
      try {
        const d = e.data;
        if (!d || typeof d !== "object") return;

        // Log ALL stripe messages for debugging
        if (d.type && (d.type.includes("stripe") || d.type.includes("hcaptcha"))) {
          const loc = window.location.pathname + window.location.search.substring(0, 30);
          const pl = JSON.stringify(d.payload || "").substring(0, 80);
          console.log(`[STRIPE-MSG] ${loc} GOT: ${d.type} payload=${pl} frameID=${d.frameID} reqID=${d.requestID}`);
        }

        // Auto-capture token from child-to-parent (when VISUAL hCaptcha completes)
        // Only capture RESPONSE_HCAPTCHA (visual), NOT RESPONSE_HCAPTCHA_INVISIBLE
        const respToken = d.payload?.response || d.payload?.value?.response || d.payload?.token;
        const respTag = d.payload?.tag || "";
        if (d.type === "stripe-third-party-child-to-parent" && respToken && respToken.length > 20) {
          console.log(`[TOKEN-UPSTREAM] tag=${respTag} token len=${respToken.length} from ${window.location.href.substring(0,60)}`);
          // Only forward VISUAL hcaptcha token (not invisible)
          if (respTag === "RESPONSE_HCAPTCHA" || (respTag === "" && !window.location.href.includes("invisible") && !window.location.href.includes("Invisible"))) {
            try { (window as any).__nodeHcapTokenReady?.(respToken); } catch {}
          }
        }

        // EXECUTE-INVIS: when HCaptchaInvisible gets Execute command, solve with NopeCHA+rqdata
        // and respond with RESPONSE_HCAPTCHA_INVISIBLE to trigger verify_chall
        if (d.type === "stripe-third-party-parent-to-child" &&
            d.payload?.tag === "EXECUTE_HCAPTCHA_INVISIBLE" &&
            window.location.href.includes("HCaptchaInvisible.html")) {
          console.log(`[EXECUTE-INVIS] Received EXECUTE_HCAPTCHA_INVISIBLE — solving with NopeCHA+rqdata...`);
          const rqdataVal = (window as any).__capturedRqdata || null;
          (window as any).__solveHcapWithRqdata?.(rqdataVal).then((token: string | null) => {
            if (!token) { console.log(`[EXECUTE-INVIS] NopeCHA returned no token`); return; }
            console.log(`[EXECUTE-INVIS] Token ready (len=${token.length}), sending RESPONSE_HCAPTCHA_INVISIBLE`);
            const frameId = new URLSearchParams(window.location.search).get("id") || d.frameID || "";
            window.parent.postMessage({
              type: "stripe-third-party-child-to-parent",
              frameID: frameId,
              payload: { tag: "RESPONSE_HCAPTCHA_INVISIBLE", value: { response: token } }
            }, "*");
          }).catch((err: any) => console.log(`[EXECUTE-INVIS] Error: ${err}`));
        }
      } catch {}
    }, true);
  });

  const page = await ctx.newPage();

  // ── Inject NopeCHA extension bridge (ba-playwright.js equivalent) ─────────────
  // Exposes screenshot + mouse-click functions so the extension can visually solve
  // hCaptcha by clicking on the correct images (generates legitimate tokens).
  await page.exposeFunction("captchaSolverPlaywrightTaskSs", async () => {
    log(`📸 captchaSolverPlaywrightTaskSs called (extension taking screenshot)`);
    await page.waitForTimeout(1000);
    const buf = await page.screenshot();
    log(`📸 Screenshot taken (${buf.length} bytes)`);
    return `data:image/png;base64,${buf.toString("base64")}`;
  });
  await page.exposeFunction("captchaSolverPlaywrightTaskExec", async (t: any) => {
    log(`🖱️  captchaSolverPlaywrightTaskExec called: action=${t?.action} answers=${JSON.stringify(t?.answers)?.substring(0,80)}`);
    if (t.action === "click") {
      const answers = t.answers as Array<{x: number; y: number}>;
      const pos = t.canvasPosOnView as {x: number; y: number};
      if (answers?.length > 0 && pos) {
        for (const ans of answers) {
          await page.mouse.click(ans.x + pos.x, ans.y + pos.y);
          await page.waitForTimeout(300);
        }
      }
    } else if (t.action === "drag") {
      const paths = t.paths as Array<{start: {x:number;y:number}; end: {x:number;y:number}}>;
      const pos = t.canvasPosOnView as {x: number; y: number};
      if (paths?.length > 0 && pos) {
        for (const p of paths) {
          await page.mouse.move(p.start.x + pos.x, p.start.y + pos.y);
          await page.mouse.down();
          await page.waitForTimeout(200);
          await page.mouse.move(p.end.x + pos.x, p.end.y + pos.y, { steps: 15 });
          await page.mouse.up();
          await page.waitForTimeout(300);
        }
      }
    }
    return true;
  });
  // Init-script bridge: forwards screenshot/click events from extension content-script
  // KEY FIX: the extension dispatches cs-request-ba-ss/op on the hcaptcha FRAME's window,
  // but captchaSolverPlaywrightTaskSs/Exec are only exposed to the TOP-LEVEL page.
  // We relay events cross-frame using window.top.postMessage.
  await page.addInitScript(() => {
    const isTopFrame = () => window === window.top;

    // ── cs-request-ba-ss: take screenshot ───────────────────────────────────
    window.addEventListener("cs-request-ba-ss", async () => {
      if (isTopFrame() && typeof (window as any).captchaSolverPlaywrightTaskSs === "function") {
        // Top-level: handle directly
        setTimeout(async () => {
          try {
            const dataUrl = await (window as any).captchaSolverPlaywrightTaskSs();
            window.postMessage({ from: "browser-automation", action: "ba-response-cs-ss", dataUrl }, "*");
          } catch (err) { console.error("captchaSolverPlaywrightTaskSs failed:", err); }
        }, 10);
      } else if (!isTopFrame()) {
        // Cross-origin sub-frame: relay to top
        try { window.top!.postMessage({ from: "cs-relay", type: "ss" }, "*"); } catch {}
      }
    });

    // ── cs-request-ba-op: execute click/drag ─────────────────────────────────
    window.addEventListener("cs-request-ba-op", async (ev: any) => {
      if (isTopFrame() && typeof (window as any).captchaSolverPlaywrightTaskExec === "function") {
        // Top-level: handle directly
        await (window as any).captchaSolverPlaywrightTaskExec(ev.detail);
      } else if (!isTopFrame()) {
        // Cross-origin sub-frame: relay to top
        try { window.top!.postMessage({ from: "cs-relay", type: "op", detail: ev.detail }, "*"); } catch {}
      }
    });

    // ── Handle relayed events from sub-frames (only runs in top-level frame) ─
    window.addEventListener("message", async (e: MessageEvent) => {
      if (e.data?.from !== "cs-relay") return;
      const src = e.source as Window | null;

      if (e.data.type === "ss" && typeof (window as any).captchaSolverPlaywrightTaskSs === "function") {
        // Take screenshot and send back to the requesting sub-frame
        setTimeout(async () => {
          try {
            const dataUrl = await (window as any).captchaSolverPlaywrightTaskSs();
            // Broadcast to all (for same-origin listeners) and send directly to source frame
            window.postMessage({ from: "browser-automation", action: "ba-response-cs-ss", dataUrl }, "*");
            try { src?.postMessage({ from: "browser-automation", action: "ba-response-cs-ss", dataUrl }, "*"); } catch {}
          } catch (err) { console.error("cs-relay ss error:", err); }
        }, 10);
      } else if (e.data.type === "op" && typeof (window as any).captchaSolverPlaywrightTaskExec === "function") {
        try { await (window as any).captchaSolverPlaywrightTaskExec(e.data.detail); } catch {}
      }
    });
  });
  log(`🔌 NopeCHA extension bridge injected (screenshot + click, with cross-frame relay)`);

  // Capture console.log from browser frames (for debugging initScript messages)
  page.on("console", msg => {
    const txt = msg.text();
    if (txt.includes("[STRIPE-MSG]") || txt.includes("[TOKEN-UPSTREAM]") ||
        txt.includes("[EXECUTE") || txt.includes("[HCAP-")) {
      log(`🖥️  ${txt.substring(0, 200)}`);
    }
  });

  // Track rqdata and auto-solved tokens
  let rqdata: string | null = null;
  let autoToken: string | null = null;
  let paymentTime = 0;
  await page.exposeFunction("__nodeRqdataReady", (rd: string) => {
    if (!rqdata && rd) {
      rqdata = rd;
      log(`📦 rqdata captured: ${rd.substring(0, 40)}...`);
    }
  });
  await page.exposeFunction("__nodeHcapTokenReady", (tok: string) => {
    if (!autoToken && tok) {
      autoToken = tok;
      log(`🎫 Auto-token captured: len=${tok.length}`);
    }
  });

  // Capture rqdata from hCaptcha network requests
  ctx.on("request", req => {
    try {
      const url = req.url();
      if (url.includes("hcaptcha.com") || url.includes("hcaptcha.net")) {
        const body = req.postData() || "";
        const m = body.match(/rqdata=([^&\s"]{10,})/);
        if (m && !rqdata) { rqdata = decodeURIComponent(m[1]); log(`📡 rqdata from POST: ${rqdata.substring(0,40)}...`); }
        const mj = body.match(/"rqdata"\s*:\s*"([^"]{10,})"/);
        if (mj && !rqdata) { rqdata = mj[1]; log(`📡 rqdata from JSON: ${rqdata.substring(0,40)}...`); }
      }
    } catch {}
  });

  ctx.on("response", async response => {
    try {
      const url = response.url();
      // Capture rqdata from getcaptcha response
      if (url.includes("getcaptcha") && url.includes("hcaptcha.com")) {
        const body = await response.text().catch(() => "");
        const m = body.match(/"rqdata"\s*:\s*"([^"]{10,})"/);
        if (m && !rqdata) { rqdata = m[1]; log(`📡 rqdata from getcaptcha: ${rqdata.substring(0,40)}...`); }
      }
      // Log ALL Stripe API responses (to catch confirm, setup_intents, etc.)
      if (url.includes("api.stripe.com") && response.request().method() !== "GET") {
        const body = await response.text().catch(() => "");
        const shortUrl = url.substring(url.indexOf("/v1/") + 4, url.indexOf("/v1/") + 60);
        // Parse key fields from setup_intent responses
        try {
          const json = JSON.parse(body);
          const status = json.status || "";
          const errCode = json.last_setup_error?.code || json.error?.code || "";
          const nextAction = json.next_action?.type || "";
          log(`  📡 POST /v1/${shortUrl} → HTTP${response.status()} status="${status}" err="${errCode}" next="${nextAction}"`);
          if (errCode) log(`    err_msg: ${(json.last_setup_error?.message || json.error?.message || "").substring(0, 200)}`);
        } catch {
          log(`  📡 POST /v1/${shortUrl} → HTTP${response.status()} ${body.substring(0, 200)}`);
        }
      }
      // Log 3DS-related requests (hooks.stripe, ACS, DDC)
      if (url.includes("hooks.stripe.com") || url.includes("3ds.") ||
          url.includes("acs.") || url.includes("centinel") ||
          url.includes("federalbank") || url.includes("npci") ||
          (url.includes("stripe.com") && (url.includes("3ds") || url.includes("challenge") || url.includes("fingerprint")))) {
        const method = response.request().method();
        log(`  🏦 3DS request [${method}] ${url.substring(0, 120)} → HTTP${response.status()}`);
      }
    } catch {}
  });

  // Also log notable requests (not just responses)
  ctx.on("request", req => {
    try {
      const url = req.url();
      if (url.includes("hooks.stripe.com") ||
          url.includes("federalbank") || url.includes("npci") ||
          url.includes("centinel") || url.includes("3ds.")) {
        log(`  🏦 3DS REQ [${req.method()}] ${url.substring(0, 120)}`);
      }
    } catch {}
  });

  try {
    // ── Step 1: Login ──────────────────────────────────────────────────────────
    log(`\n─── Step 1: Login ───`);
    await page.goto("https://replit.com/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);

    // Fill email
    const emailInput = await page.$('input[name="username"], input[type="email"], input[name="email"]').catch(() => null);
    if (emailInput) {
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(REPLIT_EMAIL, { delay: 50 });
    }
    await sleep(500);

    // Click Continue
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll<HTMLElement>("button, input[type='submit']"));
      const btn = btns.find(b => /continue|next|log\s*in|login/i.test(b.textContent || (b as HTMLInputElement).value || ""));
      btn?.click();
    });
    await sleep(5000);

    // Fill password
    const pwInput = await page.$('input[type="password"]').catch(() => null);
    if (pwInput) {
      await pwInput.click({ clickCount: 3 });
      await pwInput.type(REPLIT_PASS, { delay: 50 });
      await pwInput.press("Enter");
    }
    await page.waitForURL(u => !String(u).includes("/login"), { timeout: 30000 });
    log(`✅ Logged in — ${page.url().substring(0, 60)}`);

    // ── Step 2: Navigate to checkout ──────────────────────────────────────────
    log(`\n─── Step 2: Navigate to checkout ───`);
    const checkoutUrl = `https://replit.com/stripe-checkout-by-price/core_1mo_20usd_monthly_feb_26?coupon=${encodeURIComponent(COUPON)}&source=onboarding-purchase-modal&successRedirectPath=%2F~&cancelRedirectPath=%2F~`;
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(8000);
    log(`  URL: ${page.url().substring(0, 100)}`);

    // Wait for Stripe checkout to fully load
    const pageText0 = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    log(`  Page: ${pageText0.substring(0, 100)}`);

    // ── Step 3: Fill card details ─────────────────────────────────────────────
    log(`\n─── Step 3: Fill card + billing ───`);
    await sleep(3000);

    // Card number
    await fillStripeField(page, "cardNumber", CARD_NUMBER.replace(/\s/g, ""));
    await sleep(500);
    await fillStripeField(page, "cardExpiry", CARD_EXPIRY.replace("/", ""));
    await sleep(500);
    await fillStripeField(page, "cardCvc", CARD_CVV);
    await sleep(500);
    await fillStripeField(page, "billingName", CARD_HOLDER);
    await sleep(500);
    await fillStripeField(page, "billingAddressLine1", BILLING_LINE1);
    await sleep(500);
    await fillStripeField(page, "billingLocality", BILLING_CITY);
    await sleep(500);
    await fillStripeField(page, "billingPostalCode", BILLING_ZIP);
    await sleep(500);

    // Select state (NY)
    for (const frame of page.frames()) {
      const stateEl = await frame.$('select[name="billingState"], select[name="state"]').catch(() => null);
      if (stateEl) {
        await frame.selectOption('select[name="billingState"], select[name="state"]', { value: BILLING_STATE }).catch(async () => {
          await frame.evaluate(({ v }: any) => {
            const sel = document.querySelector('select[name="billingState"], select[name="state"]') as HTMLSelectElement;
            if (!sel) return;
            sel.value = v;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }, { v: BILLING_STATE });
        });
        log(`  ✏️  billingState = ${BILLING_STATE}`);
        break;
      }
    }
    await sleep(500);

    // Ensure country is US
    for (const frame of page.frames()) {
      const countryEl = await frame.$('select[name="billingCountry"], select[name="country"]').catch(() => null);
      if (countryEl) {
        await frame.selectOption('select[name="billingCountry"], select[name="country"]', { value: "US" }).catch(() => {});
        log(`  ✏️  billingCountry = US`);
        break;
      }
    }
    await sleep(500);

    log(`  Form fill complete`);

    // ── Step 4: On-demand hCaptcha solving (with rqdata) ─────────────────────
    log(`\n─── Step 4: Ready for on-demand hCaptcha solve (with rqdata) ───`);

    // ── Step 4b: Set up ACS/3DS popup detection BEFORE Subscribe ─────────────
    log(`\n─── Step 4b: Setting up 3DS popup detection ───`);
    let acsPage: any = null;

    const handle3DSPage = (popup: any) => {
      const initUrl = popup.url();
      log(`📄 3DS candidate page created: ${initUrl.substring(0, 100)}`);

      // Watch this page for navigation away from about:blank
      popup.on("load", async () => {
        const u = popup.url();
        log(`📄 3DS candidate loaded: ${u.substring(0, 100)}`);
        if (u && u !== "about:blank" &&
            !u.includes("js.stripe.com") && !u.includes("checkout.stripe.com") &&
            !u.includes("b.stripecdn.com") && !u.includes("newassets.hcaptcha") &&
            !u.includes("m.stripe.network")) {
          log(`🏦 ACS/3DS page detected via load: ${u.substring(0, 100)}`);
          acsPage = popup;
        }
      });

      popup.on("framenavigated", async (f: any) => {
        try {
          const u = f.url();
          if (u && u !== "about:blank" &&
              !u.includes("js.stripe.com") && !u.includes("checkout.stripe.com") &&
              !u.includes("b.stripecdn.com") && !u.includes("newassets.hcaptcha") &&
              !u.includes("m.stripe.network")) {
            log(`📎 3DS page frame navigated: ${u.substring(0, 100)}`);
            // If main frame navigated, this is the ACS page
            if (f === popup.mainFrame()) {
              log(`🏦 ACS/3DS main frame detected: ${u.substring(0, 100)}`);
              acsPage = popup;
            }
          }
        } catch {}
      });
    };

    // Monitor ALL existing non-checkout pages
    for (const pg of ctx.pages()) {
      if (pg !== page) {
        log(`  Existing page for monitoring: ${pg.url().substring(0, 80)}`);
        handle3DSPage(pg);
      }
    }
    // Monitor any NEW pages
    ctx.on("page", handle3DSPage);

    // ── Step 5: Click Subscribe ───────────────────────────────────────────────
    log(`\n─── Step 5: Click Subscribe ───`);
    // Capture current frames BEFORE clicking so we can detect NEW hCaptcha frames
    const framesAtClick = new Set(page.frames().map(f => f.url()));
    log(`  Frames before click: ${framesAtClick.size}`);
    let clicked = false;
    for (const frame of page.frames()) {
      const btn = await frame.$('.SubmitButton:not([disabled]), button[type="submit"]:not([disabled])').catch(() => null);
      if (btn) {
        const txt = await btn.textContent().catch(() => "");
        log(`  Found button: "${txt?.trim()}" — clicking...`);
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      log(`  Button not found by selector — trying evaluate...`);
      await page.evaluate(() => {
        const b = document.querySelector<HTMLElement>(".SubmitButton, button[type='submit']");
        b?.click();
      });
    }
    paymentTime = Date.now();
    log(`  Clicked at ${new Date(paymentTime).toLocaleTimeString()}`);
    await sleep(5000);

    // ── Step 6: Monitor for hCaptcha / 3DS / success ─────────────────────────
    log(`\n─── Step 6: Monitoring for hCaptcha / success / 3DS ───`);
    const solvedFrames = new Set<string>();
    let captchaSolved = false;
    let otpDone = false;
    let visualTokenSent = false;  // track whether we've already injected the visual token

    for (let tick = 0; tick < 1200; tick++) {
      await sleep(3000);
      const allFrames = page.frames();
      const allUrls = allFrames.map(f => f.url());
      const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      const pageUrl = page.url();

      // ── Success ──────────────────────────────────────────────────────────────
      if (pageText.includes("Your payment was successful") ||
          pageText.includes("Subscription activated") ||
          pageText.includes("Payment successful") ||
          pageText.includes("subscription_confirmed") ||
          pageUrl.includes("success") || pageUrl.includes("confirmed")) {
        log(`🎉🎉🎉 SUCCESS! Subscription complete!`);
        log(`  URL: ${pageUrl}`);
        log(`  Page: ${pageText.substring(0, 300)}`);
        break;
      }

      // ── New hCaptcha frames appeared ──────────────────────────────────────────
      const newHcapUrls = allUrls.filter(u =>
        u.includes("newassets.hcaptcha.com") &&
        !framesAtClick.has(u) &&
        !solvedFrames.has(u)
      );

      if (newHcapUrls.length > 0 && !captchaSolved) {
        log(`🧩 hCaptcha appeared (${newHcapUrls.length} new frames) at tick=${tick}`);
        newHcapUrls.forEach(u => solvedFrames.add(u));

        // Debug: log all frame URLs so we can see hcaptcha-inner
        log(`  All frames (${allFrames.length}):`);
        for (const f of allFrames) {
          const u = f.url();
          if (u.includes("hcaptcha") || u.includes("stripe") || u.includes("stripecdn")) {
            const pe = await f.evaluate(() => !!(window as any).__pendingExecute).catch(() => false);
            const tok = await f.evaluate(() => !!(window as any).__hcapToken).catch(() => false);
            log(`    ${u.substring(0,80)} | pendingExec=${pe} hasToken=${tok}`);
          }
        }

        // Try to get rqdata from frames
        await sleep(2000);
        if (!rqdata) {
          for (const frame of allFrames) {
            const url = frame.url();
            // From URL params
            const paramMatch = (url + (await frame.evaluate(() => window.location.href).catch(() => ""))).match(/[?&#]rqdata=([^&"]{20,})/);
            if (paramMatch) { rqdata = decodeURIComponent(paramMatch[1]); break; }
            // From window variable
            const fromWin = await frame.evaluate(() => (window as any).__capturedRqdata).catch(() => null);
            if (fromWin) { rqdata = fromWin; break; }
          }
          if (rqdata) log(`  rqdata: ${rqdata.substring(0, 50)}...`);
          else log(`  rqdata: not captured`);
        }

        captchaSolved = true;
        log(`  ⏳ hCaptcha visual challenge detected — will inject token from HCaptcha.html frame`);
        await sleep(5000);

      } else if (newHcapUrls.length > 0 && captchaSolved) {
        log(`🔄 New secondary hCaptcha detected — solving via 2captcha automatically...`);
        newHcapUrls.forEach(u => solvedFrames.add(u));
        visualTokenSent = false;
        autoToken = null;
        await sleep(3000);
        try {
          const secToken = await solveHcaptcha(rqdata);
          if (secToken) {
            log(`💉 Secondary hCaptcha token obtained (len=${secToken.length}) — injecting...`);
            await injectToken(page, secToken);
            // Also try injecting via all hcaptcha frames directly
            for (const fr of page.frames()) {
              const fu = fr.url();
              if (fu.includes("hcaptcha.com") || fu.includes("HCaptcha")) {
                await fr.evaluate((t: string) => {
                  const fid = new URLSearchParams(window.location.search).get("id") || "";
                  window.parent.postMessage({
                    type: "stripe-third-party-child-to-parent",
                    frameID: fid,
                    payload: { tag: "RESPONSE_HCAPTCHA", value: { response: t } }
                  }, "*");
                }, secToken).catch(() => {});
              }
            }
            // Click "I am human" checkbox if visible in any frame
            for (const fr of page.frames()) {
              const anchor = await fr.$('#checkbox, [id*="checkbox"], .anchor-checkbox, [aria-label*="human"]').catch(() => null);
              if (anchor) {
                log(`  🖱️  Clicking I am human checkbox...`);
                await anchor.click().catch(() => {});
                break;
              }
            }
            visualTokenSent = true;
          }
        } catch (err) {
          log(`  ⚠️  Secondary hCaptcha auto-solve error: ${err}`);
        }
        await sleep(5000);
      }

      // ── Visual token injection: forward frictionless hcaptcha-inner token from HCaptcha.html ──
      if (captchaSolved && !visualTokenSent && autoToken) {
        log(`🔑 autoToken available (len=${autoToken.length}) — injecting RESPONSE_HCAPTCHA from HCaptcha.html`);
        const hcapVisualFrames = allFrames.filter(f =>
          f.url().includes("HCaptcha.html") && !f.url().includes("Invisible")
        );
        if (hcapVisualFrames.length > 0) {
          for (const hcapFrame of hcapVisualFrames) {
            try {
              const result = await hcapFrame.evaluate((token: string) => {
                const frameId = new URLSearchParams(window.location.search).get("id") || "";
                const msg = {
                  type: "stripe-third-party-child-to-parent",
                  frameID: frameId,
                  payload: { tag: "RESPONSE_HCAPTCHA", value: { response: token } }
                };
                window.parent.postMessage(msg, "*");
                return `frameId=${frameId} url=${window.location.href.substring(0, 80)}`;
              }, autoToken);
              log(`  💉 RESPONSE_HCAPTCHA injected: ${result}`);
              visualTokenSent = true;
            } catch (err) {
              log(`  ⚠️  HCaptcha.html injection error: ${err}`);
            }
          }
        } else {
          log(`  ⚠️  No HCaptcha.html frame found (${allFrames.length} frames total)`);
        }
      } else if (captchaSolved && !visualTokenSent && !autoToken) {
        // ── Auto-click "I am human" if "One more step" modal is visible ──────────
        if (pageText.includes("One more step") || pageText.includes("Select the checkbox below")) {
          log(`  🔲 "One more step" modal detected — clicking hCaptcha checkbox...`);
          let clicked = false;
          for (const fr of allFrames) {
            const fu = fr.url();
            if (!fu.includes("hcaptcha") && !fu.includes("HCaptcha")) continue;
            try {
              const cbClicked = await fr.evaluate(() => {
                const cb = document.querySelector('#checkbox, .anchor-checkbox, [id*="checkbox"], [aria-label*="human"]') as HTMLElement | null;
                if (cb) { cb.click(); return true; }
                return false;
              });
              if (cbClicked) { log(`  ✅ Clicked hCaptcha checkbox in frame ${fu.substring(0,60)}`); clicked = true; break; }
            } catch {}
          }
          if (!clicked) {
            // Try clicking on the main page at known coordinates for the checkbox
            await page.mouse.click(416, 322).catch(() => {});
            log(`  🖱️  Fallback: clicked at main page (416,322) for I am human checkbox`);
          }
          await sleep(2000);
        }

        // ── Direct visual solve: take screenshot and check for manual click file ──
        if (tick % 5 === 0) {
          log(`  ⏳ Waiting for visual solve... (tick=${tick})`);
          // Take page screenshot for analysis
          try {
            const buf = await page.screenshot({ fullPage: false });
            const fs2 = await import("fs");
            fs2.writeFileSync("/tmp/hcap-challenge.png", buf);
            // Try to get prompt text from challenge frames
            let promptText = "";
            let challengeImgUrls: string[] = [];
            for (const frame of allFrames) {
              if (!frame.url().includes("newassets.hcaptcha.com")) continue;
              const info = await frame.evaluate(() => {
                const prompt = document.querySelector(".prompt-text, [class*='prompt'] span, .task-label, [class*='label']");
                const imgs = Array.from(document.querySelectorAll(".task-image img, [class*='challenge'] img, img")).slice(0, 16);
                return {
                  text: prompt?.textContent?.trim() || document.body?.innerText?.substring(0, 100) || "",
                  imgs: imgs.map(i => (i as HTMLImageElement).src).filter(s => s.startsWith("http")),
                  html: document.body?.innerHTML?.substring(0, 300) || ""
                };
              }).catch(() => null);
              if (info && (info.text.length > 3 || info.imgs.length > 0)) {
                promptText = info.text;
                challengeImgUrls = info.imgs;
                log(`  🔍 Challenge frame: prompt="${promptText.substring(0,60)}" imgs=${info.imgs.length}`);
                log(`  🔍 Frame HTML preview: ${info.html.substring(0,150)}`);
                break;
              }
            }
            const infoData = { tick, promptText, imgCount: challengeImgUrls.length, imgUrls: challengeImgUrls.slice(0,9) };
            fs2.writeFileSync("/tmp/hcap-info.json", JSON.stringify(infoData, null, 2));
            log(`  📸 Challenge screenshot saved → /tmp/hcap-challenge.png (prompt="${promptText.substring(0,40)}")`);
          } catch (err) { log(`  ⚠️  Screenshot error: ${err}`); }
        }

        // ── Check for manual click file (/tmp/hcap-clicks.json) ──────────────────
        try {
          const fs2 = await import("fs");
          if (fs2.existsSync("/tmp/hcap-clicks.json")) {
            const clickData = JSON.parse(fs2.readFileSync("/tmp/hcap-clicks.json", "utf8")) as {
              coords?: Array<{x: number; y: number}>;
              drag?: {from: {x: number; y: number}; to: {x: number; y: number}};
              indices?: number[];
              verifyCoord?: {x: number; y: number};
              verify?: boolean;
            };
            fs2.unlinkSync("/tmp/hcap-clicks.json");
            log(`  🖱️  Got clicks from /tmp/hcap-clicks.json: ${JSON.stringify(clickData)}`);

            // ── Drag operation (for drag-to-match challenges) ──────────────────
            if (clickData.drag) {
              const { from, to } = clickData.drag;
              log(`  🖱️  Drag from (${from.x},${from.y}) to (${to.x},${to.y})`);
              await page.mouse.move(from.x, from.y);
              await sleep(300);
              await page.mouse.down();
              await sleep(400);
              // Move gradually to simulate human drag
              const steps = 15;
              for (let i = 1; i <= steps; i++) {
                await page.mouse.move(
                  from.x + (to.x - from.x) * i / steps,
                  from.y + (to.y - from.y) * i / steps
                );
                await sleep(50);
              }
              await sleep(300);
              await page.mouse.up();
              log(`  ✅ Drag complete`);
              await sleep(1000);
              await page.screenshot({ path: "/tmp/hcap-after-cells.png" }).catch(() => {});
              log(`  📸 Post-drag screenshot saved to /tmp/hcap-after-cells.png`);
            }

            // ── Coordinate-based clicking (preferred) ──────────────────────────
            if (clickData.coords && clickData.coords.length > 0) {
              for (const pt of clickData.coords) {
                log(`  🖱️  Mouse click at (${pt.x}, ${pt.y})`);
                await page.mouse.move(pt.x, pt.y);
                await sleep(200);
                await page.mouse.click(pt.x, pt.y);
                await sleep(600);
              }
              log(`  ✅ Clicked ${clickData.coords.length} coordinate points`);

              // Save post-cell-click screenshot so we can see Verify button position
              await sleep(800);
              await page.screenshot({ path: "/tmp/hcap-after-cells.png" }).catch(() => {});
              log(`  📸 Post-cell screenshot saved to /tmp/hcap-after-cells.png`);

              // Click Verify at provided coordinate or search for the button
              if (clickData.verifyCoord) {
                await sleep(800);
                log(`  🖱️  Clicking Verify at (${clickData.verifyCoord.x}, ${clickData.verifyCoord.y})`);
                await page.mouse.click(clickData.verifyCoord.x, clickData.verifyCoord.y);
              } else if (clickData.verify !== false) {
                await sleep(800);
                let verifyClicked = false;
                // Try getByText in each hcaptcha frame first
                for (const frame of allFrames) {
                  if (!frame.url().includes("hcaptcha") && !frame.url().includes("HCaptcha")) continue;
                  try {
                    const btn = frame.getByText("Verify", { exact: true });
                    await btn.click({ timeout: 2000 });
                    log(`  ✅ Clicked Verify via getByText`);
                    verifyClicked = true;
                    break;
                  } catch { /* try next */ }
                }
                if (!verifyClicked) {
                  // Try querySelectorAll approach
                  for (const frame of allFrames) {
                    if (!frame.url().includes("hcaptcha") && !frame.url().includes("HCaptcha")) continue;
                    const clicked = await frame.evaluate(() => {
                      const allEls = Array.from(document.querySelectorAll("*"));
                      const btn = allEls.find(el =>
                        el.children.length === 0 && el.textContent?.trim() === "Verify"
                      ) as HTMLElement | null;
                      if (btn) { btn.click(); return true; }
                      const btn2 = Array.from(document.querySelectorAll("button, [role='button']"))
                        .find(el => el.textContent?.toLowerCase().includes("verif")) as HTMLElement | null;
                      if (btn2) { btn2.click(); return true; }
                      return false;
                    }).catch(() => false);
                    if (clicked) { log(`  ✅ Clicked Verify via frame evaluate`); verifyClicked = true; break; }
                  }
                }
                if (!verifyClicked) {
                  // Wait for user to provide verifyCoord in a new click file
                  log(`  ⚠️  Could not find Verify button via DOM — check /tmp/hcap-after-cells.png and provide {"verifyCoord":{x,y}} in /tmp/hcap-clicks.json`);
                }
              }
            }
            // ── Index-based clicking (fallback) ────────────────────────────────
            else if (clickData.indices && clickData.indices.length > 0) {
              let clickFrame: any = null;
              for (const frame of allFrames) {
                if (!frame.url().includes("newassets.hcaptcha.com")) continue;
                const hasCells = await frame.evaluate(() =>
                  document.querySelectorAll(".task-image, [class*='challenge-image'], [class*='cell'], .task").length > 0
                ).catch(() => false);
                if (hasCells) { clickFrame = frame; break; }
              }

              if (clickFrame) {
                for (const idx of clickData.indices) {
                  await clickFrame.evaluate((cellIdx: number) => {
                    const cells = document.querySelectorAll(".task-image, [class*='challenge-image'], [class*='cell'], .task");
                    const cell = cells[cellIdx] as HTMLElement;
                    if (cell) cell.click();
                  }, idx).catch((e: any) => log(`  ⚠️  Cell click error: ${e}`));
                  await sleep(400);
                }
                log(`  ✅ Clicked ${clickData.indices.length} cells by index`);
                if (clickData.verify !== false) {
                  await sleep(1000);
                  await clickFrame.evaluate(() => {
                    const btn = document.querySelector("button.button-submit, [class*='submit'], [class*='verify']") as HTMLElement;
                    if (btn) btn.click();
                  }).catch((e: any) => log(`  ⚠️  Verify click error: ${e}`));
                }
              } else {
                log(`  ⚠️  No challenge frame found for index-based clicking`);
              }
            }
          }
        } catch (err) { /* no click file yet */ }
      }

      // ── Dismiss Stripe Link / bank-connection popups (they block payment) ───
      if (pageText.toLowerCase().includes("log in to chase") || pageText.toLowerCase().includes("agree and continue") ||
          pageText.toLowerCase().includes("connect your bank")) {
        // Click X button to close the Stripe Link modal (top-right of modal, ~(629,74))
        const dismissed = await page.evaluate(() => {
          // Find close/X button inside any modal overlay
          const btns = Array.from(document.querySelectorAll("button, [role='button']"));
          for (const b of btns) {
            const t = (b as HTMLElement).textContent?.trim() || "";
            const label = (b as HTMLElement).getAttribute("aria-label") || "";
            if (t === "×" || t === "✕" || t === "✗" || label.toLowerCase().includes("close") || label.toLowerCase().includes("dismiss")) {
              (b as HTMLElement).click(); return "button-" + t;
            }
          }
          return null;
        }).catch(() => null);
        if (dismissed) {
          log(`  🔒 Dismissed Stripe Link modal (${dismissed})`);
          await sleep(1000);
        } else {
          // Try clicking the close X by coordinate from screenshot (629, 74)
          await page.mouse.click(629, 74).catch(() => {});
          log(`  🔒 Clicked close X at (629, 74) to dismiss Link modal`);
          await sleep(1000);
        }
      }

      // ── OTP section appeared ──────────────────────────────────────────────────
      const otpTriggerText = pageText.toLowerCase().includes("verification code") ||
          pageText.toLowerCase().includes("enter code") ||
          pageText.toLowerCase().includes("one-time") ||
          pageText.toLowerCase().includes("otp") ||
          pageText.toLowerCase().includes("authenticate");
      const otpTriggerUrl = allUrls.some(u =>
        (u.includes("3ds") || u.includes("acs.") || u.includes("challenge")) &&
        !u.includes("hcaptcha") && !u.includes("newassets.hcaptcha") && !u.includes("hcaptcha.net")
      );
      // Also check popup pages for 3DS content
      const ctxPages = ctx.pages();
      const popupTexts = await Promise.all(ctxPages.filter(p => p !== page).map(p =>
        p.evaluate(() => document.body?.innerText || "").catch(() => "")
      ));
      const otpTriggerPopup = popupTexts.some(t =>
        t.toLowerCase().includes("otp") || t.toLowerCase().includes("verification") || t.toLowerCase().includes("one-time") || t.toLowerCase().includes("authenticate")
      );

      // Detect inline Federal Bank ACS frame in any page frame
      let acsFrame: any = null;
      for (const f of allFrames) {
        const fu = f.url();
        if ((fu.includes("federalbank") || fu.includes("federal.bank") || fu.includes("eazypay") ||
             (fu.includes("acs") && !fu.includes("hcaptcha")) ||
             (fu.includes("3ds") && !fu.includes("hcaptcha") && !fu.includes("stripe"))) && fu !== "about:blank") {
          log(`🏦 Inline ACS frame found: ${fu.substring(0, 100)}`);
          acsFrame = f;
          break;
        }
      }

      // OTP trigger: URL-based ACS frames take priority; also trigger on inline ACS frame
      const realOtpTrigger = otpTriggerUrl || !!acsFrame || (acsPage !== null);
      // Only trigger text-based if very specific phrases (not Stripe Link bank UI)
      const pageTextLower = pageText.toLowerCase();
      const otpTriggerTextStrict = (pageTextLower.includes("enter otp") || pageTextLower.includes("enter the otp") ||
          pageTextLower.includes("one time password") || pageTextLower.includes("otp sent") ||
          pageTextLower.includes("secure code")) && !pageTextLower.includes("log in to chase") &&
          !pageTextLower.includes("connect your bank");

      if (!otpDone && captchaSolved && (realOtpTrigger || otpTriggerTextStrict || otpTriggerPopup)) {
        log(`🔐 OTP / 3DS detected (url=${otpTriggerUrl} frame=${!!acsFrame} text=${otpTriggerTextStrict} popup=${otpTriggerPopup})`);

        // ── Wait for ACS popup/frame to navigate (up to 120s after OTP trigger) ──────
        log(`  Waiting for ACS popup/frame to load (up to 120s)...`);
        for (let w = 0; w < 40 && !acsPage && !acsFrame; w++) {
          await sleep(3000);
          // Check for inline ACS frames on any page
          const allPgs2 = ctx.pages();
          for (const pg2 of allPgs2) {
            for (const f of pg2.frames()) {
              const fu = f.url();
              if ((fu.includes("federalbank") || fu.includes("federal.bank") ||
                   (fu.includes("acs") && !fu.includes("hcaptcha")) ||
                   (fu.includes("3ds") && !fu.includes("hcaptcha") && !fu.includes("stripe"))) && fu !== "about:blank") {
                log(`  🏦 Inline ACS frame detected: ${fu.substring(0, 100)}`);
                acsFrame = f;
                break;
              }
            }
            if (acsFrame) break;
          }
          if (w % 5 === 4) {
            const allPgs = ctx.pages();
            log(`  ACS wait poll ${w + 1}/40: ${allPgs.length} pages open`);
            allPgs.forEach((pg, i) => log(`    page[${i}]: ${pg.url().substring(0, 100)}`));
          }
        }

        // Screenshot main page for debugging
        await page.screenshot({ path: "/tmp/stripe-3ds-debug.png" }).catch(() => {});
        log(`  Main page screenshot saved`);

        // Handle inline ACS frame
        if (acsFrame) {
          log(`  ✅ Inline ACS frame: ${acsFrame.url().substring(0, 100)}`);
          const acsText = await acsFrame.evaluate(() => document.body?.innerText || "").catch(() => "");
          log(`  ACS frame text: "${acsText.replace(/\n/g, " ").substring(0, 400)}"`);
          const acsInputs = await acsFrame.evaluate(() =>
            Array.from(document.querySelectorAll("input")).map((i: any) =>
              `${i.type}[name=${i.name}][id=${i.id}][maxlen=${i.maxLength}]`
            )
          ).catch(() => [] as string[]);
          log(`  ACS frame inputs: ${JSON.stringify(acsInputs)}`);
          const otp = await fetchGmailOtp(paymentTime);
          if (otp) {
            log(`  OTP from email: ${otp}`);
            // Try to fill OTP in ACS frame
            const otpSelectors = ['input[type="number"]','input[type="text"]','input[type="tel"]','input[type="password"]','input'];
            for (const sel of otpSelectors) {
              const filled = await acsFrame.evaluate((args: {sel: string, otp: string}) => {
                const inp = document.querySelector(args.sel) as HTMLInputElement | null;
                if (inp) { inp.value = args.otp; inp.dispatchEvent(new Event("input", {bubbles:true})); inp.dispatchEvent(new Event("change", {bubbles:true})); return true; }
                return false;
              }, {sel, otp}).catch(() => false);
              if (filled) {
                log(`  ✅ Filled OTP in ACS frame via ${sel}`);
                await sleep(1000);
                // Click submit
                await acsFrame.evaluate(() => {
                  const btn = (document.querySelector('button[type="submit"], input[type="submit"], button') as HTMLElement | null);
                  if (btn) btn.click();
                }).catch(() => {});
                otpDone = true;
                break;
              }
            }
          }
        }

        // Screenshot ACS popup page if found
        if (acsPage) {
          log(`  ✅ ACS page ready: ${acsPage.url().substring(0, 100)}`);
          await acsPage.screenshot({ path: "/tmp/stripe-3ds-acs.png" }).catch(() => {});
          log(`  ACS screenshot saved to /tmp/stripe-3ds-acs.png`);
          // Log ACS page text
          const acsText = await acsPage.evaluate(() => document.body?.innerText || "").catch(() => "");
          log(`  ACS page text: "${acsText.replace(/\n/g, " ").substring(0, 400)}"`);
          // Log all inputs
          const acsInputs = await acsPage.evaluate(() =>
            Array.from(document.querySelectorAll("input")).map(i =>
              `${i.type}[name=${i.name}][id=${i.id}][maxlen=${i.maxLength}][vis=${!!(i as any).offsetParent}]`
            )
          ).catch(() => [] as string[]);
          log(`  ACS inputs: ${JSON.stringify(acsInputs)}`);
        } else {
          log(`  ⚠️  ACS popup not detected after 120s`);
          // Log all current pages for debugging
          const allPgs = ctx.pages();
          allPgs.forEach((pg, i) => log(`    page[${i}]: ${pg.url().substring(0, 100)}`));
          // Log all frames with OTP keywords for debugging
          const framesNow = allPgs.flatMap(p => p.frames());
          for (const f of framesNow) {
            const result = await f.evaluate(() => {
              const text = document.body?.innerText || "";
              const inputs = Array.from(document.querySelectorAll("input")).map(i =>
                `${i.type}[name=${i.name || "?"}][id=${i.id || "?"}][maxlen=${i.maxLength}][visible=${!!(i as any).offsetParent}]`
              );
              return { text: text.substring(0, 200).replace(/\n/g, " "), inputs };
            }).catch(() => ({ text: "", inputs: [] as string[] }));
            const hasOtpKeyword = result.text.toLowerCase().includes("otp") ||
              result.text.toLowerCase().includes("verif") || result.text.toLowerCase().includes("one-time");
            if (result.inputs.length > 0 || hasOtpKeyword) {
              log(`  frame [${f.url().substring(0, 70)}]`);
              if (hasOtpKeyword) log(`    OTP text: "${result.text.substring(0, 150)}"`);
              result.inputs.forEach(inp => log(`    input: ${inp}`));
            }
          }
        }

        const otp = await fetchGmailOtp(paymentTime);
        if (!otp) {
          log(`  ❌ Could not get OTP — continuing to wait...`);
        } else {
          log(`  OTP: ${otp}`);

          const otpSelectors = [
            'input[autocomplete="one-time-code"]',
            'input[name="challengeDataEntry"]',
            'input[name="otpEntry"]',
            'input[name="otp"]',
            'input[name="otpCode"]',
            'input[name="code"]',
            'input[type="number"][maxlength="6"]',
            'input[type="text"][maxlength="6"]',
            'input[type="tel"][maxlength="6"]',
            'input[type="password"][maxlength="6"]',
            'input[type="number"]',
            'input[type="text"]',
            'input[type="tel"]',
          ];
          // Known non-OTP field names to skip
          const skipNames = new Set(["phoneNumber", "cardNumber", "cardExpiry", "cardCvc",
            "billingName", "billingAddressLine1", "billingAddressLine2", "billingLocality", "billingPostalCode"]);

          // Build frame list: prefer ACS page frames, then all other frames
          const acsFrames = acsPage ? acsPage.frames() : [];
          const allPageFrames = ctx.pages().flatMap(p => p.frames());
          const searchFrames = [...new Set([...acsFrames, ...allPageFrames])];

          log(`  Searching ${searchFrames.length} frames for OTP input (${acsFrames.length} from ACS, acsPage=${acsPage ? acsPage.url().substring(0, 60) : "none"})`);

          let otpFilled = false;
          for (const frame of searchFrames) {
            for (const sel of otpSelectors) {
              const el = await frame.$(sel).catch(() => null);
              if (el) {
                // Skip known non-OTP fields
                const elName = await el.getAttribute("name").catch(() => "");
                if (skipNames.has(elName || "")) continue;
                const vis = await el.isVisible().catch(() => false);
                if (!vis) continue;
                await el.click({ clickCount: 3 });
                await sleep(200);
                await el.type(otp, { delay: 100 });
                await sleep(500);
                log(`  ✅ OTP entered: sel="${sel}" name="${elName}" frame=${frame.url().substring(0, 80)}`);
                await sleep(500);
                // Try to submit via button click in ACS page first
                if (acsPage) {
                  await acsPage.evaluate(() => {
                    const btn = document.querySelector<HTMLElement>('button[type="submit"], input[type="submit"], button');
                    if (btn) { btn.click(); }
                  }).catch(() => {});
                  await acsPage.keyboard.press("Enter").catch(() => {});
                } else {
                  await frame.evaluate(() => {
                    const btn = document.querySelector<HTMLElement>('button[type="submit"], input[type="submit"], button');
                    if (btn) { btn.click(); }
                  }).catch(() => {});
                }
                await page.keyboard.press("Enter").catch(() => {});
                otpFilled = true;
                otpDone = true;
                break;
              }
            }
            if (otpFilled) break;
          }
          if (!otpFilled) log(`  ⚠️  OTP input not found in ${searchFrames.length} frames`);
          await sleep(5000);
        }
      }

      // Periodic log
      if (tick % 5 === 0) {
        log(`  tick=${tick} frames=${allFrames.length} captchaSolved=${captchaSolved} text="${pageText.substring(0, 60).replace(/\n/g, " ")}"`);
      }
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

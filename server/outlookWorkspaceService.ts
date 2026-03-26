/**
 * Outlook Workspace Service — Playwright + Bearer Token Capture
 *
 * The new Outlook Live uses Bearer tokens (not just cookies) for all API calls.
 * We log in via Playwright, intercept the outgoing requests to capture the Bearer
 * token + API base URL, then use them to call the email API directly.
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";

chromium.use(StealthPlugin());

export interface OutlookEmail {
  uid: number;
  folder: string;
  folderDisplay: string;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  otp: string | null;
  isNew: boolean;
  id: string;
}

export interface FolderInfo {
  imap: string;
  display: string;
  count: number;
}

export interface LogEntry {
  time: string;
  msg: string;
  level: "info" | "warn" | "error" | "ok";
}

interface OutlookSession {
  email: string;
  password: string;
  messages: OutlookEmail[];
  folders: FolderInfo[];
  seenIds: Set<string>;
  newSinceLastFetch: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  pollLock: boolean;
  startedAt: Date;
  lastPollAt: Date | null;
  error: string | null;
  status: "connecting" | "active" | "error";
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  loggedIn: boolean;
  logs: LogEntry[];
  bearerToken: string | null;
  apiBase: string | null;
}

const sessions = new Map<string, OutlookSession>();

function tsLog(session: OutlookSession, msg: string, level: LogEntry["level"] = "info") {
  const entry: LogEntry = { time: new Date().toISOString(), msg, level };
  session.logs.push(entry);
  if (session.logs.length > 200) session.logs.splice(0, session.logs.length - 200);
  console.log(`[OutlookWS] [${level.toUpperCase()}] ${msg}`);
}

/* ─── OTP extraction ──────────────────────────────────────── */
function extractOtp(text: string): string | null {
  const patterns = [
    /(?:verification|confirm(?:ation)?|code|otp|pin|passcode|token|security)[^\d]{0,30}(\d{4,8})/i,
    /(?:your|the)\s+(?:code|pin|otp)[^\d]{0,20}(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{8})\b/,
    /\b(\d{4})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/* ─── Launch browser ──────────────────────────────────────── */
async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: [
      "--no-sandbox", "--disable-setuid-sandbox",
      "--disable-dev-shm-usage", "--disable-gpu",
      "--disable-background-timer-throttling",
    ],
  });
}

/* ─── Capture Bearer token from SPA outgoing requests ────── */
async function captureTokenFromRequests(
  page: Page,
  session: OutlookSession,
  timeoutMs = 15000
): Promise<{ token: string; apiBase: string } | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let token: string | null = null;
    let apiBase: string | null = null;

    const done = (result: { token: string; apiBase: string } | null) => {
      if (resolved) return;
      resolved = true;
      page.off("request", onRequest);
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      // If we captured a token but not an API base, use a default
      if (token) {
        tsLog(session, `Token captured (base unknown), using substrate.office.com`, "warn");
        done({ token, apiBase: "https://substrate.office.com" });
      } else {
        tsLog(session, `No Bearer token captured in ${timeoutMs}ms`, "warn");
        done(null);
      }
    }, timeoutMs);

    const onRequest = (request: any) => {
      try {
        const auth = (request.headers()["authorization"] || "") as string;
        if (!auth.startsWith("Bearer ")) return;
        const t = auth.substring(7);
        if (!t || t.length < 20) return;
        token = t;

        const url = request.url();
        // Prefer email-related API base URLs
        if (
          url.includes("mailFolders") || url.includes("/messages") ||
          url.includes("substrate.office.com") || url.includes("/ows/") ||
          url.includes("/mail/")
        ) {
          try {
            const u = new URL(url);
            apiBase = u.origin;
            tsLog(session, `Bearer token captured from: ${url.substring(0, 80)}`, "ok");
            done({ token: t, apiBase });
          } catch {}
        }
      } catch {}
    };

    page.on("request", onRequest);
  });
}

/* ─── Login to Microsoft ──────────────────────────────────── */
async function loginToMicrosoft(page: Page, session: OutlookSession): Promise<void> {
  const { email, password } = session;
  tsLog(session, `Starting login for ${email}`, "info");

  await page.goto("https://login.live.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  tsLog(session, "Login page loaded, entering email...", "info");

  await page.waitForSelector('input[type="email"], #i0116', { timeout: 15000 });
  await page.fill('input[type="email"], #i0116', email);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000, waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('input[type="submit"], #idSIButton9').catch(() => page.keyboard.press("Enter")),
  ]);

  tsLog(session, "Email submitted, entering password...", "info");
  await page.waitForSelector('input[type="password"], #i0118', { timeout: 15000 });
  await page.fill('input[type="password"], #i0118', password);
  await Promise.all([
    page.waitForNavigation({ timeout: 20000, waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('input[type="submit"], #idSIButton9').catch(() => page.keyboard.press("Enter")),
  ]);

  tsLog(session, "Password submitted, handling prompts...", "info");

  // "Stay signed in?" → No
  try {
    await page.waitForSelector('#idBtn_Back, #declineButton', { timeout: 5000 });
    await page.click('#idBtn_Back, #declineButton').catch(() => {});
    await page.waitForNavigation({ timeout: 10000, waitUntil: "domcontentloaded" }).catch(() => {});
  } catch {}

  tsLog(session, "Navigating to Outlook inbox...", "info");
}

/* ─── Navigate to Outlook and capture token ──────────────── */
async function navigateAndCaptureToken(page: Page, session: OutlookSession): Promise<void> {
  // Start listening for tokens BEFORE navigation
  const capturePromise = captureTokenFromRequests(page, session, 20000);

  await page.goto("https://outlook.live.com/mail/0/inbox", { waitUntil: "domcontentloaded", timeout: 30000 });
  tsLog(session, `Outlook loaded at: ${page.url()}`, "info");

  // Wait for token capture with some extra buffer
  const auth = await capturePromise;
  if (auth) {
    session.bearerToken = auth.token;
    session.apiBase = auth.apiBase;
    tsLog(session, `Auth ready — API base: ${auth.apiBase}`, "ok");
  } else {
    tsLog(session, "No token captured — will try DOM scraping", "warn");
  }
}

/* ─── Fetch folder via API with captured Bearer token ─────── */
const FOLDER_DEFS = [
  { folder: "inbox",        display: "Inbox",  imap: "inbox"        },
  { folder: "junkemail",    display: "Junk",   imap: "junkemail"    },
  { folder: "sentitems",    display: "Sent",   imap: "sentitems"    },
  { folder: "deleteditems", display: "Trash",  imap: "deleteditems" },
];

const EMAIL_API_BASES = [
  "https://substrate.office.com",
  "https://outlook.live.com",
];

async function fetchFolderWithToken(
  page: Page,
  session: OutlookSession,
  folder: string,
  display: string,
  top = 25
): Promise<OutlookEmail[]> {
  const token = session.bearerToken;
  if (!token) return [];

  // Try multiple API base URLs
  const bases = session.apiBase
    ? [session.apiBase, ...EMAIL_API_BASES.filter(b => b !== session.apiBase)]
    : EMAIL_API_BASES;

  const result = await page.evaluate(
    async (args: { folder: string; top: number; bases: string[]; token: string }) => {
      for (const base of args.bases) {
        const url = `${base}/ows/v1.0/me/mailFolders/${args.folder}/messages?$top=${args.top}&$select=id,from,subject,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`;
        try {
          const r = await fetch(url, {
            credentials: "include",
            headers: {
              "Accept": "application/json",
              "Authorization": `Bearer ${args.token}`,
            },
          });
          if (r.ok) {
            const data = await r.json();
            return { items: data.value || [], base, error: null };
          }
          const txt = await r.text().catch(() => "");
          if (r.status === 401) {
            return { items: [], base, error: `401 at ${base} — token expired?`, items401: true };
          }
          return { items: [], base, error: `HTTP ${r.status}: ${txt.substring(0, 100)}` };
        } catch (e: any) {
          continue;
        }
      }
      return { items: [], base: "", error: "All bases failed" };
    },
    { folder, top, bases, token }
  );

  if (result.error) {
    tsLog(session, `${display}: ${result.error}`, result.error.includes("401") ? "warn" : "error");
    // If 401, token is expired — clear it
    if (result.error.includes("401")) {
      session.bearerToken = null;
    }
    return [];
  }

  tsLog(session, `${display}: ${result.items.length} emails via API (base: ${result.base})`, "ok");

  return result.items.map((m: any, idx: number) => {
    const fromAddr = m.from?.emailAddress || {};
    const fromName = fromAddr.name || fromAddr.address || "Unknown";
    const fromEmail = fromAddr.address || "";
    const subject = m.subject || "(no subject)";
    const date = m.receivedDateTime || new Date().toISOString();
    const preview = m.bodyPreview || "";
    return {
      uid: idx,
      folder,
      folderDisplay: display,
      from: fromName,
      fromEmail,
      subject,
      date,
      snippet: preview.substring(0, 300),
      body: preview.substring(0, 5000),
      otp: extractOtp(`${subject} ${preview}`),
      isNew: false,
      id: `api::${folder}::${m.id || idx}`,
    };
  });
}

/* ─── DOM scraping fallback ───────────────────────────────── */
async function scrapeFolderDOM(
  page: Page,
  session: OutlookSession,
  navUrl: string,
  folder: string,
  display: string
): Promise<OutlookEmail[]> {
  tsLog(session, `${display}: DOM scraping fallback`, "info");
  await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(5000);

  const items = await page.evaluate(() => {
    const results: any[] = [];
    const SKIP = /^(no results|no messages|no mail|loading|sign in)/i;

    // Strategy: data-convid attribute (most stable)
    const convItems = Array.from(document.querySelectorAll("[data-convid]"));
    for (const el of convItems) {
      const text = (el as HTMLElement).innerText || "";
      if (SKIP.test(text.trim())) continue;
      const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
      results.push({
        id: (el as HTMLElement).getAttribute("data-convid") || "",
        from: lines[0] || "Unknown",
        subject: lines[1] || "(no subject)",
        preview: lines[2] || "",
        date: lines[3] || "",
        raw: text.substring(0, 300),
      });
    }
    if (results.length > 0) return results;

    // Strategy: role=option elements with meaningful content
    const optItems = Array.from(document.querySelectorAll("[role='option'], [role='listitem']"));
    for (const el of optItems) {
      const text = (el as HTMLElement).innerText || "";
      if (!text.trim() || SKIP.test(text.trim())) continue;
      if (text.length < 5) continue;
      const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
      results.push({
        id: `dom-${results.length}`,
        from: lines[0] || "Unknown",
        subject: lines[1] || "(no subject)",
        preview: lines.slice(2).join(" "),
        date: "",
        raw: text.substring(0, 300),
      });
    }
    return results;
  });

  return items.map((m: any, idx: number) => ({
    uid: idx,
    folder,
    folderDisplay: display,
    from: m.from,
    fromEmail: "",
    subject: m.subject,
    date: m.date || new Date().toISOString(),
    snippet: m.preview.substring(0, 300),
    body: m.raw.substring(0, 5000),
    otp: extractOtp(`${m.subject} ${m.preview}`),
    isNew: false,
    id: `dom::${folder}::${m.id || idx}`,
  }));
}

/* ─── Main poll ───────────────────────────────────────────── */
async function runPoll(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session || session.pollLock) return;
  session.pollLock = true;

  try {
    // Launch browser if needed
    if (!session.browser || !session.browser.isConnected()) {
      tsLog(session, "Launching headless browser...", "info");
      session.browser = await launchBrowser();
      session.context = await session.browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      });
      session.page = await session.context.newPage();
      session.loggedIn = false;
      session.bearerToken = null;
    }

    const page = session.page!;

    // Login + capture token if needed
    if (!session.loggedIn) {
      await loginToMicrosoft(page, session);
      await navigateAndCaptureToken(page, session);
      session.loggedIn = true;
    } else if (!session.bearerToken) {
      // Token expired — refresh it
      tsLog(session, "Token expired, refreshing...", "warn");
      await navigateAndCaptureToken(page, session);
    }

    // Fetch each folder
    const allMessages: OutlookEmail[] = [];
    const folderInfos: FolderInfo[] = [];
    const FOLDER_URLS: Record<string, string> = {
      inbox:        "https://outlook.live.com/mail/0/inbox",
      junkemail:    "https://outlook.live.com/mail/0/junk",
      sentitems:    "https://outlook.live.com/mail/0/sentitems",
      deleteditems: "https://outlook.live.com/mail/0/deleteditems",
    };

    for (const { folder, display, imap } of FOLDER_DEFS) {
      try {
        let msgs: OutlookEmail[] = [];

        if (session.bearerToken) {
          msgs = await fetchFolderWithToken(page, session, folder, display);
        }

        // Fallback to DOM if token approach failed
        if (msgs.length === 0 && !session.bearerToken) {
          msgs = await scrapeFolderDOM(page, session, FOLDER_URLS[folder], folder, display);
        }

        folderInfos.push({ imap, display, count: msgs.length });
        allMessages.push(...msgs);
      } catch (err: any) {
        tsLog(session, `Folder ${display} error: ${err.message}`, "error");
        folderInfos.push({ imap, display, count: 0 });
      }
    }

    // Mark new messages
    let newCount = 0;
    const isFirstPoll = session.seenIds.size === 0;
    for (const msg of allMessages) {
      if (!session.seenIds.has(msg.id)) {
        session.seenIds.add(msg.id);
        if (!isFirstPoll) { msg.isNew = true; newCount++; }
      }
    }

    allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    session.messages = allMessages;
    session.folders = folderInfos;
    session.newSinceLastFetch += newCount;
    session.lastPollAt = new Date();
    session.status = "active";
    session.error = null;

    const total = allMessages.length;
    tsLog(session, `Scan complete — ${total} total emails across ${folderInfos.length} folders`, "ok");
  } catch (err: any) {
    const msg = err.message || String(err);
    if (session) {
      tsLog(session, `Poll error: ${msg}`, "error");
      session.error = msg;
      session.status = "error";
      try { await session.browser?.close(); } catch {}
      session.browser = null;
      session.context = null;
      session.page = null;
      session.loggedIn = false;
      session.bearerToken = null;
    }
  } finally {
    if (session) session.pollLock = false;
  }
}

/* ─── Session management ──────────────────────────────────── */
export async function activateOutlookSession(userId: string, email: string, password: string): Promise<void> {
  stopOutlookSession(userId);

  const session: OutlookSession = {
    email, password,
    messages: [], folders: [],
    seenIds: new Set(),
    newSinceLastFetch: 0,
    pollTimer: null,
    pollLock: false,
    startedAt: new Date(),
    lastPollAt: null,
    error: null,
    status: "connecting",
    browser: null, context: null, page: null,
    loggedIn: false,
    logs: [],
    bearerToken: null,
    apiBase: null,
  };
  sessions.set(userId, session);
  tsLog(session, `Session started for ${email}`, "info");

  runPoll(userId).catch(() => {});
  const s = sessions.get(userId);
  if (s) s.pollTimer = setInterval(() => runPoll(userId).catch(() => {}), 30000);
}

export function stopOutlookSession(userId: string): void {
  const session = sessions.get(userId);
  if (!session) return;
  if (session.pollTimer) clearInterval(session.pollTimer);
  session.browser?.close().catch(() => {});
  sessions.delete(userId);
}

export function getOutlookMessages(userId: string): {
  messages: OutlookEmail[];
  folders: FolderInfo[];
  newCount: number;
  email: string | null;
  status: string;
  error: string | null;
  lastPollAt: string | null;
  startedAt: string | null;
  method: string;
  logs: LogEntry[];
} {
  const session = sessions.get(userId);
  if (!session) {
    return { messages: [], folders: [], newCount: 0, email: null, status: "inactive", error: null, lastPollAt: null, startedAt: null, method: "none", logs: [] };
  }
  const newCount = session.newSinceLastFetch;
  session.newSinceLastFetch = 0;
  return {
    messages: session.messages,
    folders: session.folders,
    newCount,
    email: session.email,
    status: session.status,
    error: session.error,
    lastPollAt: session.lastPollAt?.toISOString() || null,
    startedAt: session.startedAt.toISOString(),
    method: "playwright+token",
    logs: [...session.logs],
  };
}

export function getOutlookSessionInfo(userId: string): { active: boolean; email: string | null; status: string } {
  const session = sessions.get(userId);
  return { active: !!session, email: session?.email || null, status: session?.status || "inactive" };
}

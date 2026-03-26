/**
 * Outlook Workspace Service — Playwright + Response Interception
 *
 * Microsoft blocks basic-auth IMAP (BasicAuthBlocked) for personal accounts.
 * We log in via Playwright, then intercept the Outlook SPA's own API responses
 * to capture emails. This works regardless of which Outlook API version is used.
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page, Response } from "playwright";

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
}

const sessions = new Map<string, OutlookSession>();

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

/* ─── Microsoft Login ─────────────────────────────────────── */
async function loginToMicrosoft(page: Page, email: string, password: string): Promise<void> {
  console.log(`[OutlookWS] Starting login for ${email}`);
  await page.goto("https://login.live.com/", { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.waitForSelector('input[type="email"], #i0116', { timeout: 15000 });
  await page.fill('input[type="email"], #i0116', email);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000, waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('input[type="submit"], #idSIButton9').catch(() => page.keyboard.press("Enter")),
  ]);

  await page.waitForSelector('input[type="password"], #i0118', { timeout: 15000 });
  await page.fill('input[type="password"], #i0118', password);
  await Promise.all([
    page.waitForNavigation({ timeout: 20000, waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('input[type="submit"], #idSIButton9').catch(() => page.keyboard.press("Enter")),
  ]);

  // "Stay signed in?" → No
  try {
    await page.waitForSelector('#idBtn_Back, #declineButton', { timeout: 5000 });
    await page.click('#idBtn_Back, #declineButton').catch(() => {});
    await page.waitForNavigation({ timeout: 10000, waitUntil: "domcontentloaded" }).catch(() => {});
  } catch {}

  await page.goto("https://outlook.live.com/mail/0/inbox", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  const url = page.url();
  console.log(`[OutlookWS] Logged in, at: ${url}`);
  if (!url.includes("outlook.live.com")) {
    throw new Error(`Login failed — ended up at: ${url}`);
  }
}

/* ─── Parse any email item shape ─────────────────────────── */
function parseEmailItem(m: any, folder: string, display: string, idx: number): OutlookEmail {
  // Graph API / OWS v1
  const fromGrp = m.from?.emailAddress || m.From?.EmailAddress || {};
  const fromName = fromGrp.name || fromGrp.Name || fromGrp.address || fromGrp.Address || m.SenderName || "Unknown";
  const fromEmail = fromGrp.address || fromGrp.Address || m.SenderEmailAddress || "";
  const subject = m.subject || m.Subject || m.NormalizedSubject || "(no subject)";
  const date = m.receivedDateTime || m.ReceivedDateTime || m.DateTimeReceived || new Date().toISOString();
  const preview = m.bodyPreview || m.BodyPreview || m.Preview || "";
  const otp = extractOtp(`${subject} ${preview}`);
  const msgId = m.id || m.Id || m.ItemId?.Id || `${folder}-${idx}`;

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
    otp,
    isNew: false,
    id: `api::${folder}::${msgId}`,
  };
}

/* ─── Direct OWS/Graph API call via page.evaluate ─────────── */
const OWS_FOLDER_URLS = [
  { folder: "inbox",       imap: "inbox",       display: "Inbox" },
  { folder: "junkemail",   imap: "junkemail",   display: "Junk"  },
  { folder: "sentitems",   imap: "sentitems",   display: "Sent"  },
  { folder: "deleteditems",imap: "deleteditems",display: "Trash" },
];

async function fetchViaOwsApi(page: Page, folder: string, display: string): Promise<OutlookEmail[]> {
  const result = await page.evaluate(async (args: { folder: string }) => {
    const endpoints = [
      `https://outlook.live.com/ows/v1.0/me/mailFolders/${args.folder}/messages?$top=25&$select=id,from,subject,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`,
      `https://outlook.live.com/ows/v2.0/me/mailFolders/${args.folder}/messages?$top=25&$select=id,from,subject,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`,
      `/ows/v1.0/me/mailFolders/${args.folder}/messages?$top=25&$select=id,from,subject,receivedDateTime,bodyPreview&$orderby=receivedDateTime%20desc`,
    ];

    const log: string[] = [];
    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          credentials: "include",
          headers: { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" },
        });
        const status = r.status;
        log.push(`${url.substring(0, 80)}: HTTP ${status}`);
        if (r.ok) {
          const data = await r.json();
          const items = data.value || data.Messages || [];
          return { items, error: null, log };
        } else {
          const text = await r.text().catch(() => "");
          log.push(`  body: ${text.substring(0, 120)}`);
        }
      } catch (e: any) {
        log.push(`  error: ${e.message}`);
      }
    }
    return { items: [], error: "All OWS endpoints failed", log };
  }, { folder });

  if (result.log?.length) {
    console.log(`[OutlookWS] ${display} API probe:\n${result.log.join("\n")}`);
  }

  if (result.error && (!result.items || result.items.length === 0)) {
    return [];
  }

  return result.items.map((m: any, idx: number) => parseEmailItem(m, folder, display, idx));
}

/* ─── Interception-based fetch: navigate & capture responses ─ */
const FOLDER_URLS: Record<string, string> = {
  inbox:        "https://outlook.live.com/mail/0/inbox",
  junkemail:    "https://outlook.live.com/mail/0/junk",
  sentitems:    "https://outlook.live.com/mail/0/sentitems",
  deleteditems: "https://outlook.live.com/mail/0/deleteditems",
};

async function fetchViaInterception(page: Page, folder: string, display: string): Promise<OutlookEmail[]> {
  const captured: any[] = [];
  let captureEndpoint = "";

  const handler = async (response: Response) => {
    try {
      const url = response.url();
      const ct = response.headers()["content-type"] || "";
      if (!ct.includes("application/json") && !ct.includes("application/x-javascript")) return;

      // Look for email list API responses
      const isEmailEndpoint =
        (url.includes("mailFolders") && url.includes("messages")) ||
        url.includes("FindItem") || url.includes("FindConversation") ||
        url.includes("GetConversationItems") || url.includes("Sync") ||
        (url.includes("messages") && !url.includes(".js"));

      if (!isEmailEndpoint) return;

      const data = await response.json().catch(() => null);
      if (!data) return;

      const items = data.value || data.Messages || data.Body?.Messages || [];
      if (Array.isArray(items) && items.length > 0) {
        const first = items[0];
        // Check if this looks like email data
        if (first.subject !== undefined || first.Subject !== undefined ||
            first.from !== undefined || first.SenderName !== undefined) {
          captured.push(...items);
          captureEndpoint = url.substring(0, 100);
          console.log(`[OutlookWS] Intercepted ${items.length} emails from: ${captureEndpoint}`);
        }
      }
    } catch {}
  };

  page.on("response", handler);
  try {
    const navUrl = FOLDER_URLS[folder] || `https://outlook.live.com/mail/0/inbox`;
    await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(4000);
  } finally {
    page.off("response", handler);
  }

  return captured.map((m, idx) => parseEmailItem(m, folder, display, idx));
}

/* ─── Combined folder fetch ───────────────────────────────── */
async function fetchFolder(page: Page, folder: string, display: string): Promise<OutlookEmail[]> {
  // Try direct OWS API first (fast, no navigation needed)
  const owsEmails = await fetchViaOwsApi(page, folder, display);
  if (owsEmails.length > 0) {
    console.log(`[OutlookWS] ${display}: ${owsEmails.length} via OWS API`);
    return owsEmails;
  }

  // Fallback: navigate and intercept responses
  console.log(`[OutlookWS] ${display}: OWS API empty, trying navigation+interception`);
  const intercepted = await fetchViaInterception(page, folder, display);
  console.log(`[OutlookWS] ${display}: ${intercepted.length} via interception`);
  return intercepted;
}

/* ─── Full message body fetch ─────────────────────────────── */
async function fetchMessageBody(page: Page, messageId: string): Promise<string> {
  const result = await page.evaluate(async (msgId: string) => {
    try {
      const r = await fetch(`https://outlook.live.com/ows/v1.0/me/messages/${msgId}?$select=body`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!r.ok) return "";
      const data = await r.json();
      const content = data.body?.content || data.Body?.Content || "";
      const div = document.createElement("div");
      div.innerHTML = content;
      return div.textContent || div.innerText || "";
    } catch { return ""; }
  }, messageId);
  return result || "";
}

/* ─── Main poll ───────────────────────────────────────────── */
async function runPoll(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session || session.pollLock) return;
  session.pollLock = true;

  try {
    if (!session.browser || !session.browser.isConnected()) {
      console.log(`[OutlookWS] Launching browser for ${session.email}`);
      session.browser = await launchBrowser();
      session.context = await session.browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      });
      session.page = await session.context.newPage();
      session.loggedIn = false;
    }

    const page = session.page!;

    if (!session.loggedIn) {
      await loginToMicrosoft(page, session.email, session.password);
      session.loggedIn = true;
    }

    const allMessages: OutlookEmail[] = [];
    const folderInfos: FolderInfo[] = [];

    for (const { folder, imap, display } of OWS_FOLDER_URLS) {
      try {
        const msgs = await fetchFolder(page, folder, display);
        folderInfos.push({ imap, display, count: msgs.length });
        allMessages.push(...msgs);
      } catch (err: any) {
        console.log(`[OutlookWS] Folder ${display} error: ${err.message}`);
        folderInfos.push({ imap, display, count: 0 });
      }
    }

    // Fetch full body for OTP candidates
    const otpCandidates = allMessages.filter(m => m.otp);
    if (otpCandidates.length > 0) {
      const bodyFetches = otpCandidates.slice(0, 5).map(async (m) => {
        const rawId = m.id.replace(/^api::[^:]+::/, "");
        if (rawId && rawId.length > 5) {
          const fullBody = await fetchMessageBody(page, rawId).catch(() => "");
          if (fullBody) {
            m.body = fullBody.substring(0, 5000);
            const newOtp = extractOtp(`${m.subject} ${fullBody.substring(0, 800)}`);
            if (newOtp) m.otp = newOtp;
          }
        }
      });
      await Promise.allSettled(bodyFetches);
    }

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
  } catch (err: any) {
    console.error(`[OutlookWS] Poll error for ${session.email}: ${err.message}`);
    session.error = err.message;
    session.status = "error";
    try { await session.browser?.close(); } catch {}
    session.browser = null;
    session.context = null;
    session.page = null;
    session.loggedIn = false;
  } finally {
    session.pollLock = false;
  }
}

/* ─── Session management ──────────────────────────────────── */
export async function activateOutlookSession(userId: string, email: string, password: string): Promise<void> {
  stopOutlookSession(userId);

  const session: OutlookSession = {
    email,
    password,
    messages: [],
    folders: [],
    seenIds: new Set(),
    newSinceLastFetch: 0,
    pollTimer: null,
    pollLock: false,
    startedAt: new Date(),
    lastPollAt: null,
    error: null,
    status: "connecting",
    browser: null,
    context: null,
    page: null,
    loggedIn: false,
  };
  sessions.set(userId, session);

  runPoll(userId).catch(() => {});

  const s = sessions.get(userId);
  if (s) {
    s.pollTimer = setInterval(() => runPoll(userId).catch(() => {}), 30000);
  }
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
} {
  const session = sessions.get(userId);
  if (!session) {
    return { messages: [], folders: [], newCount: 0, email: null, status: "inactive", error: null, lastPollAt: null, startedAt: null, method: "none" };
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
    method: "playwright+ows",
  };
}

export function getOutlookSessionInfo(userId: string): { active: boolean; email: string | null; status: string } {
  const session = sessions.get(userId);
  return { active: !!session, email: session?.email || null, status: session?.status || "inactive" };
}

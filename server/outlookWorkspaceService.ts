/**
 * Outlook Workspace Service — Playwright-based web scraping
 * 
 * Microsoft has blocked basic-auth IMAP (BasicAuthBlocked) and ROPC
 * Graph API for personal outlook.com/hotmail.com accounts.
 * This service uses Playwright to log into Outlook Web and scrape emails.
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
  const args = [
    "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ];
  return chromium.launch({ headless: true, args });
}

/* ─── Microsoft Login ─────────────────────────────────────── */
async function loginToMicrosoft(page: Page, email: string, password: string): Promise<void> {
  console.log(`[OutlookWS] Starting login for ${email}`);

  await page.goto("https://outlook.live.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Already logged in?
  if (page.url().includes("outlook.live.com/mail")) {
    console.log(`[OutlookWS] Already logged in for ${email}`);
    return;
  }

  // Click "Sign in" button on landing page
  try {
    const signInBtn = page.locator('a[data-bi-id="HeroSignIn"]').first();
    if (await signInBtn.isVisible({ timeout: 3000 })) {
      await signInBtn.click();
    }
  } catch {}

  // Try sign-in from the header
  try {
    await page.click('a[href*="login.live.com"], a[href*="login.microsoftonline"]', { timeout: 3000 });
  } catch {}

  // If still not on login page, navigate directly
  if (!page.url().includes("login.live.com") && !page.url().includes("microsoftonline")) {
    await page.goto("https://login.live.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
  }

  // Enter email
  await page.waitForSelector('input[type="email"], input[name="loginfmt"], #i0116', { timeout: 15000 });
  await page.fill('input[type="email"], input[name="loginfmt"], #i0116', email);
  await page.click('input[type="submit"], button[type="submit"], #idSIButton9').catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});

  // Enter password
  await page.waitForSelector('input[type="password"], input[name="passwd"], #i0118', { timeout: 15000 });
  await page.fill('input[type="password"], input[name="passwd"], #i0118', password);
  await page.click('input[type="submit"], button[type="submit"], #idSIButton9').catch(() => {});
  await page.keyboard.press("Enter").catch(() => {});

  // Handle "Stay signed in?" prompt — click No
  try {
    await page.waitForSelector('#idBtn_Back, [id*="Stay"]', { timeout: 5000 });
    await page.click('#idBtn_Back').catch(() => {});
  } catch {}

  // Handle "Don't show this again" type prompts
  try {
    const declineBtn = page.locator('input[value*="No"], input[value*="no"], button:has-text("No")').first();
    if (await declineBtn.isVisible({ timeout: 2000 })) await declineBtn.click();
  } catch {}

  // Wait for Outlook to load
  await page.waitForURL("**/mail/**", { timeout: 30000 });
  console.log(`[OutlookWS] Login successful for ${email}, URL: ${page.url()}`);
}

/* ─── Folder navigation URLs ──────────────────────────────── */
const FOLDER_URLS: { name: string; display: string; url: string }[] = [
  { name: "inbox", display: "Inbox", url: "https://outlook.live.com/mail/0/inbox" },
  { name: "junkemail", display: "Junk", url: "https://outlook.live.com/mail/0/junkemail" },
  { name: "sentitems", display: "Sent", url: "https://outlook.live.com/mail/0/sentitems" },
];

/* ─── Scrape email list from current page ─────────────────── */
async function scrapeEmailList(page: Page, folderName: string, display: string): Promise<OutlookEmail[]> {
  // Wait for email list to appear
  await page.waitForLoadState("domcontentloaded");

  // Try to wait for at least one email row (or empty state)
  try {
    await page.waitForSelector(
      '[role="option"], [data-convid], [aria-label*="Message from"], .customScrollBar > div > div > div',
      { timeout: 8000 }
    );
  } catch {}

  const emails = await page.evaluate((args: { folderName: string; display: string }) => {
    const results: any[] = [];

    // Strategy 1: [data-convid] — Outlook uses this on conversation rows
    const convItems = document.querySelectorAll('[data-convid]');
    if (convItems.length > 0) {
      convItems.forEach((item, idx) => {
        const convId = item.getAttribute('data-convid') || `conv-${idx}`;
        const textContent = item.textContent || '';
        const allText = textContent.replace(/\s+/g, ' ').trim();

        // Try specific child elements
        const spans = Array.from(item.querySelectorAll('span, div')).map(el => el.textContent?.trim()).filter(Boolean);

        // Subject is usually a prominent text element
        let subject = '';
        let from = '';
        let snippet = '';

        // Look for aria-label hints
        const ariaLabel = item.getAttribute('aria-label') || '';
        if (ariaLabel) {
          const parts = ariaLabel.split(';').map((s: string) => s.trim());
          if (parts.length >= 2) {
            from = parts[0] || '';
            subject = parts[1] || '';
            snippet = parts[2] || '';
          }
        }

        // Fallback: use the first few meaningful spans
        if (!from && spans.length > 0) from = spans[0] || '';
        if (!subject && spans.length > 1) subject = spans[1] || '';
        if (!snippet && spans.length > 2) snippet = spans.slice(2, 5).join(' ');

        if (!subject) subject = allText.substring(0, 80);

        results.push({
          id: `web::${args.folderName}::${convId}`,
          uid: idx,
          folder: args.folderName,
          folderDisplay: args.display,
          from: from.substring(0, 100),
          fromEmail: '',
          subject: subject.substring(0, 200),
          date: new Date().toISOString(),
          snippet: snippet.substring(0, 300),
          body: allText.substring(0, 1000),
          rawText: allText,
        });
      });
      return results;
    }

    // Strategy 2: [role="option"] — sometimes used in message list
    const optionItems = document.querySelectorAll('[role="option"], [role="listitem"]');
    if (optionItems.length > 0) {
      optionItems.forEach((item, idx) => {
        const ariaLabel = item.getAttribute('aria-label') || '';
        const text = (item.textContent || '').replace(/\s+/g, ' ').trim();
        results.push({
          id: `web::${args.folderName}::opt-${idx}`,
          uid: idx,
          folder: args.folderName,
          folderDisplay: args.display,
          from: ariaLabel.split(';')[0]?.trim() || 'Unknown',
          fromEmail: '',
          subject: text.substring(0, 100),
          date: new Date().toISOString(),
          snippet: text.substring(0, 300),
          body: text.substring(0, 1000),
          rawText: text,
        });
      });
      return results;
    }

    // Strategy 3: Extract anything that looks like email rows from the page text
    const allVisibleText = document.body.innerText || '';
    results.push({
      id: `web::${args.folderName}::fallback`,
      uid: 0,
      folder: args.folderName,
      folderDisplay: args.display,
      from: 'Page Text',
      fromEmail: '',
      subject: `(${args.display} folder loaded — ${optionItems.length} items found)`,
      date: new Date().toISOString(),
      snippet: allVisibleText.substring(0, 500),
      body: allVisibleText.substring(0, 3000),
      rawText: allVisibleText,
    });

    return results;
  }, { folderName, display });

  // Post-process: extract OTPs and clean up
  const result: OutlookEmail[] = emails.map((e, idx) => {
    const combinedText = `${e.subject} ${e.snippet} ${e.rawText || ''}`;
    const otp = extractOtp(combinedText.substring(0, 800));
    return {
      uid: idx,
      folder: e.folder,
      folderDisplay: e.folderDisplay,
      from: e.from || 'Unknown',
      fromEmail: e.fromEmail || '',
      subject: e.subject || '(no subject)',
      date: e.date,
      snippet: e.snippet || '',
      body: e.body || '',
      otp,
      isNew: false,
      id: e.id,
    };
  }).filter(e => e.subject && !e.subject.includes('folder loaded'));

  console.log(`[OutlookWS] Scraped ${result.length} emails from ${display}`);
  return result;
}

/* ─── Main poll ───────────────────────────────────────────── */
async function runPoll(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session || session.pollLock) return;
  session.pollLock = true;

  try {
    // Launch browser if needed
    if (!session.browser || !session.browser.isConnected()) {
      console.log(`[OutlookWS] Launching browser for ${session.email}`);
      session.browser = await launchBrowser();
      session.context = await session.browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
      });
      session.page = await session.context.newPage();
      session.loggedIn = false;
    }

    const page = session.page!;

    // Login if needed
    if (!session.loggedIn) {
      await loginToMicrosoft(page, session.email, session.password);
      session.loggedIn = true;
    }

    // Scrape each folder
    const allMessages: OutlookEmail[] = [];
    const folderInfos: FolderInfo[] = [];

    for (const { name, display, url } of FOLDER_URLS) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        const msgs = await scrapeEmailList(page, name, display);
        folderInfos.push({ imap: name, display, count: msgs.length });
        allMessages.push(...msgs);
      } catch (err: any) {
        console.log(`[OutlookWS] Folder ${display} error: ${err.message}`);
        folderInfos.push({ imap: name, display, count: 0 });
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
  } catch (err: any) {
    console.error(`[OutlookWS] Poll error for ${session.email}: ${err.message}`);
    session.error = err.message;
    session.status = "error";
    // Kill browser so next poll starts fresh
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

  // Fire first poll in background
  runPoll(userId).catch(() => {});

  // Poll every 30 seconds (browser-based is slower than IMAP)
  const s = sessions.get(userId);
  if (s) {
    s.pollTimer = setInterval(() => runPoll(userId).catch(() => {}), 30000);
  }
}

export function stopOutlookSession(userId: string): void {
  const session = sessions.get(userId);
  if (!session) return;
  if (session.pollTimer) clearInterval(session.pollTimer);
  // Close browser asynchronously
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
    method: "playwright",
  };
}

export function getOutlookSessionInfo(userId: string): { active: boolean; email: string | null; status: string } {
  const session = sessions.get(userId);
  return { active: !!session, email: session?.email || null, status: session?.status || "inactive" };
}

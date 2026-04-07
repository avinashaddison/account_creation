// smtp.dev API service
// Docs: https://smtp.dev/docs/api/
// Base URL: https://api.smtp.dev
// Auth: X-API-KEY header
//
// IMPORTANT — actual API behaviour (verified against live API):
//   • GET /accounts        → plain JSON ARRAY  (not the { member: [...] } the docs show)
//   • GET /accounts?page=N → same plain array, 30 items per page
//   • No view.next / hydra:next links — must increment ?page=N until empty page
//   • GET /accounts?address=email → filtered plain array (partial match, usually exact hit)
//   • GET /accounts/{id}   → single account object with mailboxes array
//   • Mailboxes ARE included in list responses — no extra call needed
// Rate limit: 4096 req/min sliding window.

const SMTP_DEV_BASE = "https://api.smtp.dev";

function apiKey(): string {
  const key = process.env.SMTP_DEV_API_KEY;
  if (!key) throw new Error("SMTP_DEV_API_KEY is not configured");
  return key;
}

function hdrs() {
  return {
    "X-API-KEY": apiKey(),
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

async function call<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${SMTP_DEV_BASE}${path}`, {
    method,
    headers: hdrs(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`smtp.dev ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  // DELETE returns 204 No Content
  if (res.status === 204 || res.headers.get("content-length") === "0") return undefined as T;
  return res.json() as Promise<T>;
}

// ── Types ───────────────────────────────────────────────────────

export interface SmtpDevDomain {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface SmtpDevMailbox {
  id: string;
  path: string;
  totalMessages?: number;
  totalUnreadMessages?: number;
}

export interface SmtpDevAccount {
  id: string;
  address: string;
  isActive: boolean;
  isDeleted: boolean;
  mailboxes: SmtpDevMailbox[];  // included in all responses (list and single)
  createdAt: string;
}

export interface SmtpDevMessage {
  id: string;
  from: string;
  subject: string;
  intro: string;
  date: string;
  seen: boolean;
  hasAttachments: boolean;
}

export interface SmtpDevMessageDetail extends SmtpDevMessage {
  text: string;
  html: string;
}

// ── Helpers ─────────────────────────────────────────────────────

// The API returns plain JSON arrays — handle that and the JSON-LD { member: [] } fallback.
function members(data: any): any[] {
  return Array.isArray(data) ? data : (data?.member ?? []);
}

function parseAccount(a: any): SmtpDevAccount {
  const mailboxes: SmtpDevMailbox[] = (a.mailboxes ?? []).map((m: any) => ({
    id: String(m.id ?? ""),
    path: m.path ?? "INBOX",
    totalMessages: m.totalMessages ?? 0,
    totalUnreadMessages: m.totalUnreadMessages ?? 0,
  }));
  return {
    id: String(a.id ?? ""),
    address: a.address ?? "",
    isActive: a.isActive ?? true,
    isDeleted: a.isDeleted ?? false,
    mailboxes,
    createdAt: a.createdAt ?? new Date().toISOString(),
  };
}

// ── Domain API ──────────────────────────────────────────────────

export async function listDomains(): Promise<SmtpDevDomain[]> {
  const all: SmtpDevDomain[] = [];
  let page = 1;
  while (true) {
    const data: any = await call("GET", `/domains?page=${page}`);
    const items = members(data);
    if (items.length === 0) break;
    items.forEach((d: any) => all.push({
      id: String(d.id ?? ""),
      name: d.domain ?? d.name ?? "",
      isActive: d.isActive ?? true,
      createdAt: d.createdAt ?? new Date().toISOString(),
    }));
    page++;
    if (page > 100) break; // safety cap
  }
  return all;
}

// ── Account API ─────────────────────────────────────────────────

// First page only (30 accounts).
export async function listAccounts(): Promise<SmtpDevAccount[]> {
  const data: any = await call("GET", "/accounts");
  return members(data).map(parseAccount);
}

// Find an account by exact email address.
// Uses ?address= filter then verifies exact match — avoids full pagination.
export async function findAccountByAddress(address: string): Promise<SmtpDevAccount | null> {
  const normalised = address.toLowerCase();
  let page = 1;
  while (true) {
    const data: any = await call("GET", `/accounts?address=${encodeURIComponent(address)}&page=${page}`);
    const items = members(data);
    if (items.length === 0) break;

    const match = items.find((a: any) => (a.address ?? "").toLowerCase() === normalised);
    if (match) return parseAccount(match);

    // If returned items don't contain exact match, keep paginating the filtered results
    page++;
    if (page > 20) break; // address filter should narrow results significantly
  }
  return null;
}

// Direct account lookup by smtp.dev UUID — O(1), returns full account with mailboxes.
export async function getAccountById(accountId: string): Promise<SmtpDevAccount | null> {
  try {
    const data: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}`);
    return parseAccount(data);
  } catch (err: any) {
    console.error("[smtp.dev] getAccountById error:", err.message);
    return null;
  }
}

// Paginate ALL accounts using ?page=N incrementing (no view.next — plain array responses).
// Mailboxes are included in each item.
export async function listAllAccounts(): Promise<SmtpDevAccount[]> {
  const all: SmtpDevAccount[] = [];
  let page = 1;
  while (true) {
    const data: any = await call("GET", `/accounts?page=${page}`);
    const items = members(data);
    if (items.length === 0) break;
    all.push(...items.map(parseAccount));
    page++;
    if (page > 400) break; // safety cap — 10 000 accounts max
  }
  return all;
}

export async function createAccount(address: string, password: string): Promise<{ account: SmtpDevAccount; password: string }> {
  const data: any = await call("POST", "/accounts", { address, password });
  return { account: parseAccount(data), password };
}

export async function deleteAccount(accountId: string): Promise<void> {
  await call("DELETE", `/accounts/${encodeURIComponent(accountId)}`);
}

// ── Message helpers ─────────────────────────────────────────────

function parseFrom(raw: any): string {
  if (!raw) return "unknown";
  if (typeof raw === "string") return raw;
  const name    = raw.name    ? String(raw.name).trim()    : "";
  const address = raw.address ? String(raw.address).trim() : "";
  if (name && address) return `${name} <${address}>`;
  return address || name || "unknown";
}

function parseMsg(m: any): SmtpDevMessageDetail {
  const rawHtml = m.html ?? m.body ?? m.htmlBody ?? "";
  // smtp.dev sometimes returns html as an array of string chunks — join them
  const html = typeof rawHtml === "string" ? rawHtml
    : Array.isArray(rawHtml) ? rawHtml.join("") : "";
  const htmlStripped = html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  const rawText = m.text ?? m.textBody ?? "";
  const text = (typeof rawText === "string" && rawText) ? rawText : (htmlStripped || String(m.intro || ""));
  return {
    id: String(m.id ?? ""),
    from: parseFrom(m.from),
    subject: m.subject ?? "(no subject)",
    intro: m.intro ?? m.preview ?? m.snippet ?? "",
    date: m.date ?? m.createdAt ?? new Date().toISOString(),
    seen: m.isRead ?? m.seen ?? false,
    hasAttachments: m.hasAttachments ?? false,
    text,
    html,
  };
}

// ── Mailbox / Message API ───────────────────────────────────────

export async function listMessages(accountId: string, mailboxId: string, limit = 30): Promise<SmtpDevMessage[]> {
  const data: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}/mailboxes/${encodeURIComponent(mailboxId)}/messages`);
  return members(data).slice(0, limit).map(parseMsg);
}

export async function getMessage(accountId: string, mailboxId: string, messageId: string): Promise<SmtpDevMessageDetail | null> {
  try {
    const m: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}`);
    return parseMsg(m);
  } catch (err: any) {
    console.error("[smtp.dev] getMessage error:", err.message);
    return null;
  }
}

// ── Replit verification polling ─────────────────────────────────

export async function pollForReplitVerificationEmail(
  emailAddress: string,
  timeoutMs: number,
  log: (msg: string) => void,
  smtpDevId?: string,
): Promise<{ link?: string; code?: string } | null> {
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;
  const pollIntervalMs = 15_000;
  // Only accept emails that arrived within 10 minutes BEFORE the poll started or after.
  // This prevents stale verification emails from previous attempts being matched.
  const cutoffMs = startTime - 10 * 60 * 1000;

  log(`[smtp.dev] Polling inbox of ${emailAddress} for Replit verification email...`);

  let smtpAccountId: string | null = null;
  let inboxMailboxId: string | null = null;

  try {
    let acct: SmtpDevAccount | null = null;

    if (smtpDevId) {
      log(`[smtp.dev] Direct lookup by ID: ${smtpDevId}`);
      acct = await getAccountById(smtpDevId);
    } else {
      log(`[smtp.dev] Looking up account for ${emailAddress} via address filter...`);
      acct = await findAccountByAddress(emailAddress);
    }

    if (!acct || acct.isDeleted) {
      log(`[smtp.dev] ⚠️ Could not find smtp.dev account for ${emailAddress}`);
      return null;
    }

    smtpAccountId = acct.id;

    // Mailboxes are included in both list and single-account responses.
    // If for some reason they're empty, fetch the full account.
    let mailboxes = acct.mailboxes;
    if (mailboxes.length === 0) {
      log(`[smtp.dev] Fetching full account to get mailbox list...`);
      const full = await getAccountById(acct.id);
      mailboxes = full?.mailboxes ?? [];
    }

    const inbox = mailboxes.find(m => m.path === "INBOX") ?? mailboxes[0];
    if (!inbox) {
      log(`[smtp.dev] ⚠️ No mailbox found for ${emailAddress}`);
      return null;
    }
    inboxMailboxId = inbox.id;
    log(`[smtp.dev] Found account id=${smtpAccountId}, inbox id=${inboxMailboxId}`);
  } catch (err: any) {
    log(`[smtp.dev] ⚠️ Account lookup failed: ${err.message}`);
    return null;
  }

  while (Date.now() < deadline) {
    try {
      const messages = await listMessages(smtpAccountId, inboxMailboxId, 20);
      for (const msg of messages) {
        // Skip emails that arrived before the registration started (stale from previous attempts)
        const msgTime = msg.date ? new Date(msg.date).getTime() : 0;
        if (msgTime > 0 && msgTime < cutoffMs) {
          log(`[smtp.dev] Skipping old email "${msg.subject}" (${msg.date}) — predates registration`);
          continue;
        }

        const sub = (msg.subject || "").toLowerCase();
        const from = (msg.from || "").toLowerCase();
        const intro = (msg.intro || "").toLowerCase();
        const isReplit = from.includes("replit") || sub.includes("replit") || sub.includes("verify") || sub.includes("confirm") || intro.includes("replit");
        if (!isReplit) continue;

        log(`[smtp.dev] Found Replit email: "${msg.subject}" from ${msg.from}`);

        const detail = await getMessage(smtpAccountId, inboxMailboxId, msg.id);
        if (!detail) continue;

        const body = detail.html || detail.text || detail.intro || "";

        const linkMatch =
          body.match(/href="(https?:\/\/[^"]*replit\.com[^"]*)"/i) ||
          body.match(/(https?:\/\/replit\.com\/[^\s"'<>\r\n)]+)/i);
        if (linkMatch) {
          const link = linkMatch[1].trim();
          log(`[smtp.dev] ✅ Extracted verification link: ${link.substring(0, 100)}...`);
          return { link };
        }

        const plainText = detail.text || body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const codeMatch = plainText.match(/\b([0-9]{6})\b/);
        if (codeMatch) {
          log(`[smtp.dev] ✅ Extracted verification code: ${codeMatch[1]}`);
          return { code: codeMatch[1] };
        }

        log(`[smtp.dev] Email found but could not extract link or code — retrying...`);
      }
    } catch (err: any) {
      log(`[smtp.dev] Poll error: ${err.message}`);
    }

    const remaining = Math.round((deadline - Date.now()) / 1000);
    if (remaining <= 0) break;
    log(`[smtp.dev] No Replit email yet — waiting ${Math.floor(pollIntervalMs / 1000)}s... (${remaining}s remaining)`);
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  log(`[smtp.dev] ⚠️ Timed out waiting for Replit verification email`);
  return null;
}

// ── Inbox helper ────────────────────────────────────────────────

export async function getFullInbox(accountId: string): Promise<Array<{ id: string; from: string; subject: string; text: string; createdAt: string }>> {
  const acct = await getAccountById(accountId);
  if (!acct) return [];
  const inbox = acct.mailboxes.find(m => m.path === "INBOX") ?? acct.mailboxes[0];
  if (!inbox) return [];
  const messages = await listMessages(accountId, inbox.id, 50);
  return messages.map(m => ({
    id: m.id,
    from: m.from,
    subject: m.subject,
    text: (m as SmtpDevMessageDetail).text ?? m.intro,
    createdAt: m.date,
  }));
}

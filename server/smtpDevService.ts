// smtp.dev API service
// Docs: https://smtp.dev/docs/api/
// Base URL: https://api.smtp.dev
// Auth: X-API-KEY header
// Pagination: { member: [...], view: { first, last, previous, next } }
//   — follow view.next (a path+query string) until it is null/empty.
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
  name: string;      // the domain string, e.g. "addison.asia"
  isActive: boolean;
  createdAt: string;
}

export interface SmtpDevMailbox {
  id: string;
  path: string;      // "INBOX", "Sent", "Trash", etc.
  totalMessages?: number;
  totalUnreadMessages?: number;
}

export interface SmtpDevAccount {
  id: string;
  address: string;   // full email, e.g. "john@addison.asia"
  isActive: boolean;
  isDeleted: boolean;
  mailboxes: SmtpDevMailbox[];  // only populated from GET /accounts/{id} — empty from list endpoint
  createdAt: string;
}

export interface SmtpDevMessage {
  id: string;
  from: string;
  subject: string;
  intro: string;     // preview / snippet
  date: string;
  seen: boolean;
  hasAttachments: boolean;
}

export interface SmtpDevMessageDetail extends SmtpDevMessage {
  text: string;      // plain text body
  html: string;      // HTML body
}

// ── Pagination helper ───────────────────────────────────────────
// The API returns: { member: [...], view: { first, last, previous, next } }
// "next" is a path+query string like "/accounts?page=2" or null when on last page.

function members(data: any): any[] {
  // Response is always { member: [...] } per the API docs.
  // Guard against plain arrays just in case.
  return Array.isArray(data) ? data : (data?.member ?? []);
}

function nextPagePath(data: any): string | null {
  const view = data?.view ?? null;
  const next: string | undefined = view?.next ?? undefined;
  if (!next) return null;
  try {
    // next may be a full URL or a path+query string
    const url = new URL(next, SMTP_DEV_BASE);
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

// ── Domain API ──────────────────────────────────────────────────

export async function listDomains(): Promise<SmtpDevDomain[]> {
  const all: SmtpDevDomain[] = [];
  let path: string | null = "/domains";
  while (path) {
    const data: any = await call("GET", path);
    members(data).forEach((d: any) => all.push({
      id: String(d.id ?? ""),
      name: d.domain ?? d.name ?? "",
      isActive: d.isActive ?? true,
      createdAt: d.createdAt ?? new Date().toISOString(),
    }));
    path = nextPagePath(data);
  }
  return all;
}

// ── Account parsers ─────────────────────────────────────────────

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

// ── Account API ─────────────────────────────────────────────────

// Returns first page only (30 accounts). Use listAllAccounts() for full list.
export async function listAccounts(): Promise<SmtpDevAccount[]> {
  const data: any = await call("GET", "/accounts");
  return members(data).map(parseAccount);
}

// Find an account by its exact email address.
// Uses GET /accounts?address=... filter (partial match on the API side),
// then verifies the exact address in the result — avoids paginating all accounts.
export async function findAccountByAddress(address: string): Promise<SmtpDevAccount | null> {
  const normalised = address.toLowerCase();
  // The address filter does a partial/prefix match — retrieve filtered results
  // and follow view.next if the exact match hasn't appeared yet (rare edge case).
  let path: string | null = `/accounts?address=${encodeURIComponent(address)}`;

  while (path) {
    const data: any = await call("GET", path);
    const page = members(data);

    const match = page.find((a: any) =>
      (a.address ?? "").toLowerCase() === normalised
    );
    if (match) return parseAccount(match);

    // If there's a next page in the filtered results, keep looking
    path = nextPagePath(data);
  }

  return null;
}

// Paginate ALL accounts and return every one.
// Follows view.next links until exhausted (proper API pagination).
// Note: list response does NOT include mailboxes — call getAccountById() for those.
export async function listAllAccounts(): Promise<SmtpDevAccount[]> {
  const all: SmtpDevAccount[] = [];
  let path: string | null = "/accounts";

  while (path) {
    const data: any = await call("GET", path);
    const items = members(data);
    if (items.length === 0) break;
    all.push(...items.map(parseAccount));
    path = nextPagePath(data);
  }

  return all;
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
  // smtp.dev returns { address, name } object
  const name    = raw.name    ? String(raw.name).trim()    : "";
  const address = raw.address ? String(raw.address).trim() : "";
  if (name && address) return `${name} <${address}>`;
  return address || name || "unknown";
}

function parseMsg(m: any): SmtpDevMessageDetail {
  const rawHtml = m.html ?? m.body ?? m.htmlBody ?? "";
  const html = typeof rawHtml === "string" ? rawHtml : "";
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
  smtpDevId?: string,            // when provided, skip address search and use direct ID lookup
): Promise<{ link?: string; code?: string } | null> {
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 15_000;

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
      log(`[smtp.dev] ⚠️ Could not find smtp.dev account for ${emailAddress} — address may not be on smtp.dev`);
      return null;
    }

    smtpAccountId = acct.id;

    // Mailboxes are included in the single-account response (GET /accounts/{id}).
    // If we searched by address and got a list-item (no mailboxes), fetch full account.
    let mailboxes = acct.mailboxes;
    if (mailboxes.length === 0) {
      log(`[smtp.dev] Fetching full account details for mailbox list...`);
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
  // Fetch the full account (with mailboxes) via single-account endpoint
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

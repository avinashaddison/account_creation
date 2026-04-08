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
  mailboxes: SmtpDevMailbox[];
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

// ── Hydra JSON-LD helpers ───────────────────────────────────────

function members(data: any): any[] {
  return Array.isArray(data) ? data : (data?.member ?? data?.["hydra:member"] ?? []);
}

// ── Public API ──────────────────────────────────────────────────

export async function listDomains(): Promise<SmtpDevDomain[]> {
  const data: any = await call("GET", "/domains");
  return members(data).map((d: any) => ({
    id: String(d.id ?? ""),
    name: d.domain ?? d.name ?? "",
    isActive: d.isActive ?? true,
    createdAt: d.createdAt ?? new Date().toISOString(),
  }));
}

export async function listAccounts(): Promise<SmtpDevAccount[]> {
  const data: any = await call("GET", "/accounts");
  return members(data).map(parseAccount);
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

export async function createAccount(address: string, password: string): Promise<{ account: SmtpDevAccount; password: string }> {
  const data: any = await call("POST", "/accounts", { address, password });
  return { account: parseAccount(data), password };
}

export async function deleteAccount(accountId: string): Promise<void> {
  await call("DELETE", `/accounts/${encodeURIComponent(accountId)}`);
}

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

export async function getFullInbox(accountId: string): Promise<Array<{ id: string; from: string; subject: string; text: string; createdAt: string }>> {
  // Get account with embedded mailboxes in a single call
  const data: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}`);
  const account = parseAccount(data);
  const inbox = account.mailboxes.find(m => m.path === "INBOX") ?? account.mailboxes[0];
  if (!inbox) return [];

  // text/html are already in the list response — no extra per-message call needed
  const messages = await listMessages(accountId, inbox.id, 50);
  return messages.map(m => ({
    id: m.id,
    from: m.from,
    subject: m.subject,
    text: (m as SmtpDevMessageDetail).text ?? m.intro,
    createdAt: m.date,
  }));
}

export async function listAccountsPage(page: number): Promise<SmtpDevAccount[]> {
  const data: any = await call("GET", `/accounts?page=${page}`);
  return members(data).map(parseAccount);
}

export async function getAccountById(accountId: string): Promise<SmtpDevAccount | null> {
  try {
    const data: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}`);
    return parseAccount(data);
  } catch {
    return null;
  }
}

// Pick `count` biz accounts that are NOT in `usedAddresses` set.
// Scans pages starting from a random offset to spread usage across the pool.
export async function pickAvailableBizAccounts(
  usedAddresses: Set<string>,
  count: number
): Promise<SmtpDevAccount[]> {
  const result: SmtpDevAccount[] = [];
  const seenIds = new Set<string>();

  // Start from a random page so we don't always reuse page 1
  const MAX_PAGES = 300; // 8599 / 30 ≈ 287 pages
  const startPage = Math.floor(Math.random() * MAX_PAGES) + 1;

  for (let offset = 0; offset < MAX_PAGES && result.length < count; offset++) {
    const page = ((startPage - 1 + offset) % MAX_PAGES) + 1;
    try {
      const accounts = await listAccountsPage(page);
      if (accounts.length === 0) break;
      for (const acc of accounts) {
        if (result.length >= count) break;
        if (seenIds.has(acc.id)) continue;
        seenIds.add(acc.id);
        if (!usedAddresses.has(acc.address.toLowerCase()) && acc.isActive && !acc.isDeleted) {
          result.push(acc);
        }
      }
    } catch {
      // Skip bad pages
    }
  }

  return result;
}

// Poll a biz mailbox for a Replit verification email arriving after `afterMs` (Unix ms).
// Returns { link, code } — at least one will be set if found.
export async function pollReplitVerificationEmail(
  accountId: string,
  inboxId: string,
  afterMs: number,
  log: (msg: string) => void,
  timeoutMs = 120_000
): Promise<{ link: string | null; code: string | null }> {
  const deadline = Date.now() + timeoutMs;
  const seenIds = new Set<string>();
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      const messages = await listMessages(accountId, inboxId, 30);
      for (const msg of messages) {
        if (seenIds.has(msg.id)) continue;
        seenIds.add(msg.id);

        const msgDate = new Date(msg.date).getTime();
        if (msgDate < afterMs - 30_000) continue; // too old

        const fromStr = msg.from.toLowerCase();
        const subjectStr = msg.subject.toLowerCase();
        if (!fromStr.includes("replit") && !subjectStr.includes("replit") && !subjectStr.includes("verify") && !subjectStr.includes("confirm")) continue;

        // Fetch full message to get body
        const full = await getMessage(accountId, inboxId, msg.id);
        const body = full?.html || full?.text || msg.intro || "";

        const linkMatch = body.match(/https?:\/\/replit\.com\/[^\s"'<>\r\n)]+/);
        const link = linkMatch ? linkMatch[0].trim() : null;

        const codeMatch = body.match(/\b([0-9]{6})\b/);
        const code = !link && codeMatch ? codeMatch[1] : null;

        if (link || code) {
          log(`  📬 Biz mail: found Replit verification ${link ? "link" : "code"} in "${msg.subject}"`);
          return { link, code };
        }
      }
    } catch (err: any) {
      log(`  ⚠️ Biz mail poll error: ${(err.message || "").substring(0, 60)}`);
    }

    if (Date.now() < deadline) {
      log(`  📭 Biz mail: no verification email yet (attempt ${attempt}) — retrying in 8s...`);
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  return { link: null, code: null };
}

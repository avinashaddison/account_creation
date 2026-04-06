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

export async function listMessages(accountId: string, mailboxId: string, limit = 30): Promise<SmtpDevMessage[]> {
  const data: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}/mailboxes/${encodeURIComponent(mailboxId)}/messages?page=1`);
  return members(data).slice(0, limit).map((m: any) => ({
    id: String(m.id ?? ""),
    from: m.from ?? "unknown",
    subject: m.subject ?? "(no subject)",
    intro: m.intro ?? m.preview ?? m.snippet ?? "",
    date: m.createdAt ?? m.date ?? new Date().toISOString(),
    seen: m.seen ?? m.isRead ?? false,
    hasAttachments: m.hasAttachments ?? false,
  }));
}

export async function getMessage(accountId: string, mailboxId: string, messageId: string): Promise<SmtpDevMessageDetail | null> {
  try {
    const m: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}`);
    const html = m.html ?? m.body ?? m.htmlBody ?? "";
    const text = m.text ?? m.textBody ?? (html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : m.intro ?? "");
    return {
      id: String(m.id ?? ""),
      from: m.from ?? "unknown",
      subject: m.subject ?? "(no subject)",
      intro: m.intro ?? m.preview ?? "",
      date: m.createdAt ?? m.date ?? new Date().toISOString(),
      seen: m.seen ?? true,
      hasAttachments: m.hasAttachments ?? false,
      text,
      html,
    };
  } catch (err: any) {
    console.error("[smtp.dev] getMessage error:", err.message);
    return null;
  }
}

export async function getFullInbox(accountId: string): Promise<Array<{ id: string; from: string; subject: string; text: string; createdAt: string }>> {
  // Get account to find INBOX mailbox id (mailboxes are embedded)
  const data: any = await call("GET", `/accounts/${encodeURIComponent(accountId)}`);
  const account = parseAccount(data);
  const inbox = account.mailboxes.find(m => m.path === "INBOX") ?? account.mailboxes[0];
  if (!inbox) return [];

  const messages = await listMessages(accountId, inbox.id, 30);
  const result = [];
  for (const msg of messages) {
    const detail = await getMessage(accountId, inbox.id, msg.id);
    result.push({
      id: msg.id,
      from: msg.from,
      subject: msg.subject,
      text: detail?.text ?? msg.intro,
      createdAt: msg.date,
    });
  }
  return result;
}

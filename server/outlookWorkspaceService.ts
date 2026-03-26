import { ImapFlow } from "imapflow";

export interface OutlookEmail {
  uid: number;
  folder: string;
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

interface FolderCount {
  name: string;
  displayName: string;
  count: number;
}

interface OutlookSession {
  email: string;
  password: string;
  messages: OutlookEmail[];
  folderCounts: FolderCount[];
  seenIds: Set<string>;
  newSinceLastFetch: number;
  polling: boolean;
  pollTimer: ReturnType<typeof setInterval> | null;
  startedAt: Date;
  lastPollAt: Date | null;
  error: string | null;
  status: "connecting" | "active" | "error";
}

const sessions = new Map<string, OutlookSession>();

const OUTLOOK_FOLDERS = [
  { imap: "INBOX", display: "Inbox" },
  { imap: "Junk Email", display: "Junk" },
  { imap: "Junk", display: "Junk" },
  { imap: "Spam", display: "Spam" },
  { imap: "Sent Items", display: "Sent" },
  { imap: "Sent", display: "Sent" },
  { imap: "Deleted Items", display: "Trash" },
];

function extractOtp(text: string): string | null {
  const patterns = [
    /(?:verification|confirm|code|otp|pin|passcode)[^\d]{0,20}(\d{4,8})/i,
    /(\d{4,8})(?:[^\d]{0,20}(?:verification|confirm|code|otp|pin))/i,
    /\b([A-Z0-9]{6,8})\b(?=[^a-z]*(?:code|verify|confirm))/,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function fetchFolderMessages(
  client: ImapFlow,
  folderImap: string,
  folderDisplay: string,
  limit = 15
): Promise<OutlookEmail[]> {
  try {
    const lock = await client.getMailboxLock(folderImap);
    try {
      const status = await client.status(folderImap, { messages: true });
      const total = status.messages ?? 0;
      if (total === 0) return [];

      const seqFrom = Math.max(1, total - limit + 1);
      const messages: OutlookEmail[] = [];

      for await (const msg of client.fetch(`${seqFrom}:${total}`, {
        uid: true,
        envelope: true,
        bodyStructure: true,
        bodyParts: ["text", "1", "1.1", "1.2"],
      })) {
        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        const fromName = fromAddr?.name || fromAddr?.address || "Unknown";
        const fromEmail = fromAddr?.address || "";
        const subject = env?.subject || "(no subject)";
        const date = env?.date ? new Date(env.date).toISOString() : new Date().toISOString();

        let body = "";
        if (msg.bodyParts) {
          for (const [, content] of msg.bodyParts) {
            if (content) {
              const raw = content.toString();
              body += raw.includes("<") ? stripHtml(raw) : raw;
            }
          }
        }
        body = body.trim();

        const snippet = body.substring(0, 200).replace(/\s+/g, " ");
        const otp = extractOtp(subject + " " + body.substring(0, 500));
        const id = `${folderImap}::${msg.uid}`;

        messages.push({
          uid: msg.uid,
          folder: folderImap,
          from: fromName,
          fromEmail,
          subject,
          date,
          snippet,
          body: body.substring(0, 5000),
          otp,
          isNew: false,
          id,
        });
      }

      return messages.reverse();
    } finally {
      lock.release();
    }
  } catch {
    return [];
  }
}

async function pollSession(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session || !session.polling) return;

  let client: ImapFlow | null = null;
  try {
    client = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: session.email, pass: session.password },
      logger: false,
      tls: { rejectUnauthorized: false },
    });

    await client.connect();
    session.status = "active";
    session.error = null;

    const allMessages: OutlookEmail[] = [];
    const folderCounts: FolderCount[] = [];
    const seenFolders = new Set<string>();

    for (const { imap, display } of OUTLOOK_FOLDERS) {
      if (seenFolders.has(display)) continue;
      const msgs = await fetchFolderMessages(client, imap, display);
      if (msgs.length > 0 || imap === "INBOX") {
        seenFolders.add(display);
        folderCounts.push({ name: imap, displayName: display, count: msgs.length });
        allMessages.push(...msgs);
      }
    }

    let newCount = 0;
    for (const msg of allMessages) {
      if (!session.seenIds.has(msg.id)) {
        msg.isNew = true;
        newCount++;
        session.seenIds.add(msg.id);
      }
    }

    if (session.seenIds.size === 0) {
      for (const msg of allMessages) {
        session.seenIds.add(msg.id);
        msg.isNew = false;
      }
      newCount = 0;
    }

    session.messages = allMessages;
    session.folderCounts = folderCounts;
    session.newSinceLastFetch += newCount;
    session.lastPollAt = new Date();

    await client.logout();
  } catch (err: any) {
    session.error = err.message || "IMAP connection failed";
    session.status = "error";
    if (client) {
      try { await client.logout(); } catch {}
    }
  }
}

export async function activateOutlookSession(
  userId: string,
  email: string,
  password: string
): Promise<void> {
  stopOutlookSession(userId);

  const session: OutlookSession = {
    email,
    password,
    messages: [],
    folderCounts: [],
    seenIds: new Set(),
    newSinceLastFetch: 0,
    polling: true,
    pollTimer: null,
    startedAt: new Date(),
    lastPollAt: null,
    error: null,
    status: "connecting",
  };
  sessions.set(userId, session);

  await pollSession(userId);

  session.pollTimer = setInterval(() => {
    pollSession(userId).catch(() => {});
  }, 8000);
}

export function stopOutlookSession(userId: string): void {
  const session = sessions.get(userId);
  if (!session) return;
  session.polling = false;
  if (session.pollTimer) clearInterval(session.pollTimer);
  sessions.delete(userId);
}

export function getOutlookMessages(userId: string): {
  messages: OutlookEmail[];
  folderCounts: FolderCount[];
  newCount: number;
  email: string | null;
  status: string;
  error: string | null;
  lastPollAt: string | null;
  startedAt: string | null;
} {
  const session = sessions.get(userId);
  if (!session) {
    return { messages: [], folderCounts: [], newCount: 0, email: null, status: "inactive", error: null, lastPollAt: null, startedAt: null };
  }
  const newCount = session.newSinceLastFetch;
  session.newSinceLastFetch = 0;
  return {
    messages: session.messages,
    folderCounts: session.folderCounts,
    newCount,
    email: session.email,
    status: session.status,
    error: session.error,
    lastPollAt: session.lastPollAt?.toISOString() || null,
    startedAt: session.startedAt.toISOString(),
  };
}

export function getOutlookSessionInfo(userId: string): { active: boolean; email: string | null; status: string } {
  const session = sessions.get(userId);
  return { active: !!session, email: session?.email || null, status: session?.status || "inactive" };
}

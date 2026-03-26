import { ImapFlow } from "imapflow";

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
  startedAt: Date;
  lastPollAt: Date | null;
  error: string | null;
  status: "connecting" | "active" | "error";
}

const sessions = new Map<string, OutlookSession>();

const FOLDER_MAP: Record<string, string> = {
  "INBOX": "Inbox",
  "Junk Email": "Junk",
  "Junk": "Junk",
  "Spam": "Spam",
  "Sent Items": "Sent",
  "Sent": "Sent",
  "Deleted Items": "Trash",
  "Archive": "Archive",
  "Drafts": "Drafts",
};

function extractOtp(text: string): string | null {
  const patterns = [
    /(?:verification|confirm(?:ation)?|code|otp|pin|passcode|token)[^\d]{0,30}(\d{4,8})/i,
    /(?:your|the)\s+(?:code|pin|otp)[^\d]{0,20}(\d{4,8})/i,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
    /\b(\d{8})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractTextFromMime(raw: string): string {
  try {
    // Find header/body split
    const splitIdx = raw.indexOf("\r\n\r\n");
    if (splitIdx === -1) return raw.substring(0, 3000);

    const headers = raw.substring(0, splitIdx).toLowerCase();
    const body = raw.substring(splitIdx + 4);

    // Handle multipart
    const boundaryMatch = headers.match(/boundary=["']?([^"'\r\n;]+)["']?/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1].trim();
      const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"));
      const textParts: string[] = [];
      for (const part of parts) {
        const lpart = part.toLowerCase();
        if (lpart.includes("content-type: text/plain") || lpart.includes("content-type:text/plain")) {
          const pSplit = part.indexOf("\r\n\r\n");
          if (pSplit !== -1) {
            const pHeaders = part.substring(0, pSplit).toLowerCase();
            let pBody = part.substring(pSplit + 4);
            pBody = pBody.split("--")[0]; // stop at next boundary
            if (pHeaders.includes("base64")) {
              try { pBody = Buffer.from(pBody.replace(/\s/g, ""), "base64").toString("utf8"); } catch {}
            } else if (pHeaders.includes("quoted-printable")) {
              pBody = pBody.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
            }
            textParts.push(pBody.trim());
          }
        }
      }
      if (textParts.length > 0) return textParts.join("\n").substring(0, 5000);
    }

    // Single-part: check encoding
    const isBase64 = headers.includes("base64");
    const isQP = headers.includes("quoted-printable");
    let text = body.substring(0, 5000);
    if (isBase64) {
      try { text = Buffer.from(text.replace(/\s/g, ""), "base64").toString("utf8"); } catch {}
    } else if (isQP) {
      text = text.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }

    // Strip HTML tags if present
    if (text.includes("<html") || text.includes("<div") || text.includes("<p>")) {
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                 .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                 .replace(/<[^>]+>/g, " ")
                 .replace(/&nbsp;/g, " ")
                 .replace(/&amp;/g, "&")
                 .replace(/&lt;/g, "<")
                 .replace(/&gt;/g, ">")
                 .replace(/&quot;/g, '"')
                 .replace(/&#\d+;/g, " ");
    }
    return text.replace(/\s{3,}/g, "\n\n").trim().substring(0, 5000);
  } catch {
    return raw.substring(0, 2000);
  }
}

async function fetchFolderMessages(
  client: ImapFlow,
  folderImap: string,
  display: string,
  limit = 20
): Promise<OutlookEmail[]> {
  const lock = await client.getMailboxLock(folderImap);
  try {
    const uids = await client.search({ all: true }, { uid: true });
    if (!uids || uids.length === 0) return [];

    const recentUids = uids.slice(-limit);
    const range = recentUids.join(",");
    const messages: OutlookEmail[] = [];

    for await (const msg of client.fetch(range, { uid: true, envelope: true, source: true }, { uid: true })) {
      try {
        const env = msg.envelope;
        const fromAddr = env?.from?.[0];
        const fromName = fromAddr?.name || fromAddr?.address || "Unknown";
        const fromEmail = fromAddr?.address || "";
        const subject = env?.subject || "(no subject)";
        const date = env?.date ? new Date(env.date).toISOString() : new Date().toISOString();

        const rawSource = msg.source?.toString("utf8") || "";
        const body = extractTextFromMime(rawSource);
        const snippet = body.replace(/\s+/g, " ").trim().substring(0, 200);
        const otp = extractOtp(subject + " " + body.substring(0, 600));
        const id = `${folderImap}::${msg.uid}`;

        messages.push({
          uid: msg.uid,
          folder: folderImap,
          folderDisplay: display,
          from: fromName,
          fromEmail,
          subject,
          date,
          snippet,
          body,
          otp,
          isNew: false,
          id,
        });
      } catch {}
    }

    return messages.reverse();
  } finally {
    lock.release();
  }
}

async function discoverFolders(client: ImapFlow): Promise<{ imap: string; display: string }[]> {
  try {
    const list = await client.list();
    const result: { imap: string; display: string }[] = [];
    const priorityOrder = ["INBOX", "Junk Email", "Junk", "Spam", "Sent Items", "Sent", "Deleted Items", "Archive", "Drafts"];
    const found = new Set<string>();

    for (const name of priorityOrder) {
      const match = list.find(l => l.path === name || l.name === name);
      if (match && !found.has(match.path)) {
        found.add(match.path);
        result.push({ imap: match.path, display: FOLDER_MAP[name] || name });
      }
    }

    // Add any extras
    for (const folder of list) {
      if (!found.has(folder.path) && !folder.flags?.has("\\Noselect")) {
        found.add(folder.path);
        result.push({ imap: folder.path, display: FOLDER_MAP[folder.path] || folder.name || folder.path });
      }
    }

    return result;
  } catch {
    return [
      { imap: "INBOX", display: "Inbox" },
      { imap: "Junk Email", display: "Junk" },
      { imap: "Sent Items", display: "Sent" },
    ];
  }
}

async function runPoll(userId: string): Promise<void> {
  const session = sessions.get(userId);
  if (!session) return;

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

    const folderList = await discoverFolders(client);
    const allMessages: OutlookEmail[] = [];
    const folderInfos: FolderInfo[] = [];
    const seenDisplays = new Set<string>();

    for (const { imap, display } of folderList) {
      if (seenDisplays.has(display)) continue;
      try {
        const msgs = await fetchFolderMessages(client, imap, display, 20);
        seenDisplays.add(display);
        folderInfos.push({ imap, display, count: msgs.length });
        allMessages.push(...msgs);
      } catch {}
    }

    // Mark new messages
    let newCount = 0;
    const isFirstPoll = session.seenIds.size === 0;
    for (const msg of allMessages) {
      if (!session.seenIds.has(msg.id)) {
        session.seenIds.add(msg.id);
        if (!isFirstPoll) {
          msg.isNew = true;
          newCount++;
        }
      }
    }

    // Sort all messages by date (newest first)
    allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    session.messages = allMessages;
    session.folders = folderInfos;
    session.newSinceLastFetch += newCount;
    session.lastPollAt = new Date();
    session.status = "active";
    session.error = null;

    await client.logout();
  } catch (err: any) {
    session.error = err.message || "IMAP connection failed";
    session.status = "error";
    try { if (client) await client.logout(); } catch {}
  }
}

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
    startedAt: new Date(),
    lastPollAt: null,
    error: null,
    status: "connecting",
  };
  sessions.set(userId, session);

  // First poll immediately
  await runPoll(userId);

  // Schedule recurring polls every 10 seconds
  const s = sessions.get(userId);
  if (s) {
    s.pollTimer = setInterval(() => runPoll(userId).catch(() => {}), 10000);
  }
}

export function stopOutlookSession(userId: string): void {
  const session = sessions.get(userId);
  if (!session) return;
  if (session.pollTimer) clearInterval(session.pollTimer);
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
} {
  const session = sessions.get(userId);
  if (!session) {
    return { messages: [], folders: [], newCount: 0, email: null, status: "inactive", error: null, lastPollAt: null, startedAt: null };
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
  };
}

export function getOutlookSessionInfo(userId: string): { active: boolean; email: string | null; status: string } {
  const session = sessions.get(userId);
  return { active: !!session, email: session?.email || null, status: session?.status || "inactive" };
}

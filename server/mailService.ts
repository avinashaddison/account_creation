import { ImapFlow } from "imapflow";

const PROVIDERS = {
  "mail.tm": "https://api.mail.tm",
  "mail.gw": "https://api.mail.gw",
} as const;

type Provider = keyof typeof PROVIDERS;

const MAIL_TM_DOMAINS = new Set<string>();
const MAIL_GW_DOMAINS = new Set<string>();

export function registerMailGwDomain(domain: string): void {
  MAIL_GW_DOMAINS.add(domain);
}

export function registerMailTmDomain(domain: string): void {
  MAIL_TM_DOMAINS.add(domain);
}

let _gmailAddress: string | null = null;
let _gmailAppPassword: string | null = null;

export function setGmailCredentials(email: string | null, appPassword: string | null): void {
  _gmailAddress = email || null;
  _gmailAppPassword = appPassword || null;
  if (_gmailAddress && _gmailAppPassword) {
    console.log(`[Gmail] Credentials configured for ${_gmailAddress}`);
  }
}

export function getGmailAddress(): string | null { return _gmailAddress; }

export function hasGmailCredentials(): boolean {
  return !!(
    _gmailAddress &&
    _gmailAddress.includes("@gmail.com") &&
    _gmailAppPassword &&
    _gmailAppPassword.length > 0
  );
}

export function createGmailAddress(): string {
  if (!_gmailAddress) throw new Error("Gmail credentials not configured");
  const base = _gmailAddress.replace("@gmail.com", "");

  // Gmail dot trick: insert a dot at a random position in the username.
  // All these addresses deliver to the same inbox but look unique to LA28.
  // The username must have at least 2 chars with no leading/trailing dots.
  const chars = base.split("");
  // Build all valid insertion positions (between adjacent chars, not at start/end)
  const positions: number[] = [];
  for (let i = 1; i < chars.length; i++) {
    if (chars[i - 1] !== "." && chars[i] !== ".") positions.push(i);
  }

  // Pick a random subset of positions (1 to 3 dots) for more combinations
  const shuffled = positions.sort(() => Math.random() - 0.5);
  const numDots = Math.floor(Math.random() * 3) + 1; // 1–3 dots
  const chosen = shuffled.slice(0, numDots).sort((a, b) => a - b);

  let dotted = base;
  let offset = 0;
  for (const pos of chosen) {
    dotted = dotted.slice(0, pos + offset) + "." + dotted.slice(pos + offset);
    offset++;
  }

  return `${dotted}@gmail.com`;
}

export async function pollGmailForVerificationCode(
  targetAddress: string,
  maxAttempts: number = 70,
  intervalMs: number = 3000
): Promise<string | null> {
  if (!_gmailAddress || !_gmailAppPassword) {
    console.log("[Gmail] No credentials configured");
    return null;
  }

  const startTime = new Date(Date.now() - 5 * 60 * 1000);
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: _gmailAddress, pass: _gmailAppPassword },
    logger: false,
  });

  try {
    await client.connect();

    // Search All Mail (includes Spam/Promotions) so we never miss LA28 emails
    const mailboxesToTry = ["[Gmail]/All Mail", "INBOX", "[Gmail]/Spam"];
    let activeLock: any = null;
    for (const box of mailboxesToTry) {
      try {
        activeLock = await client.getMailboxLock(box);
        console.log(`[Gmail] Opened mailbox: ${box}`);
        break;
      } catch {
        console.log(`[Gmail] Could not open ${box}, trying next...`);
      }
    }
    if (!activeLock) throw new Error("Could not open any Gmail mailbox");
    const lock = activeLock;

    try {
      for (let i = 0; i < maxAttempts; i++) {
        console.log(`[Gmail] Polling for code to ${targetAddress}... attempt ${i + 1}/${maxAttempts}`);

        try {
          // Gmail IMAP TO: search doesn't work with + tagged addresses.
          // Instead search by FROM domain (LA28 sends from olympicid.olympics.com)
          // combined with the start time to avoid picking up old emails.
          const uids = await client.search(
            { from: "olympicid.olympics.com", since: startTime },
            { uid: true }
          );
          console.log(`[Gmail] Found ${uids.length} LA28 message(s) since session start`);

          if (uids.length > 0) {
            const range = uids.join(",");
            for await (const msg of client.fetch(range, { source: true, envelope: true }, { uid: true })) {
              const toAddr = (msg.envelope?.to?.[0]?.address || "").toLowerCase();
              // Verify it's addressed to a variant of our base Gmail address
              // (Gmail dot-trick: a.vinash@gmail.com routes to avinash@gmail.com)
              const baseUser = targetAddress.split("@")[0].replace(/\./g, "");
              const toUser = toAddr.split("@")[0].replace(/\./g, "");
              if (toUser !== baseUser) {
                console.log(`[Gmail] Skipping - addressed to different user: ${toAddr}`);
                continue;
              }
              console.log(`[Gmail] Matched message to: ${toAddr}`);
              const raw = msg.source.toString("utf8");
              const codeMatch = raw.match(/\b(\d{6})\b/);
              if (codeMatch) {
                console.log(`[Gmail] Extracted verification code: ${codeMatch[1]}`);
                return codeMatch[1];
              }
              const altMatch = raw.match(/code[:\s=]*(\d{4,6})/i);
              if (altMatch) {
                console.log(`[Gmail] Extracted verification code (alt): ${altMatch[1]}`);
                return altMatch[1];
              }
            }
            console.log("[Gmail] Message(s) found but no 6-digit code yet, continuing...");
          }
        } catch (searchErr: any) {
          console.log(`[Gmail] Search error: ${searchErr.message}`);
        }

        if (i < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      }
    } finally {
      lock.release();
    }
  } catch (err: any) {
    console.log(`[Gmail] IMAP connection error: ${err.message}`);
  } finally {
    try {
      await client.logout();
    } catch {}
  }

  console.log("[Gmail] Timed out waiting for verification email");
  return null;
}

export async function pollGmailForElevenLabsLink(
  targetAddress: string,
  maxWaitMs: number = 120000,
  intervalMs: number = 5000,
  log: (msg: string) => void = console.log
): Promise<string | null> {
  if (!_gmailAddress || !_gmailAppPassword) {
    log("[Gmail] No credentials configured — cannot poll for ElevenLabs link");
    return null;
  }

  const startTime = new Date(Date.now() - 60 * 1000); // look back 1 min for safety
  const baseUser = targetAddress.split("@")[0].replace(/\./g, "").toLowerCase();

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: _gmailAddress, pass: _gmailAppPassword },
    logger: false,
  });

  try {
    await client.connect();
    const mailboxesToTry = ["[Gmail]/All Mail", "INBOX", "[Gmail]/Spam", "[Gmail]/Promotions"];
    let activeLock: any = null;
    for (const box of mailboxesToTry) {
      try { activeLock = await client.getMailboxLock(box); log(`[Gmail] Opened mailbox: ${box}`); break; }
      catch { log(`[Gmail] Could not open ${box}, trying next...`); }
    }
    if (!activeLock) throw new Error("Could not open any Gmail mailbox");
    const lock = activeLock;

    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    try {
      while (Date.now() < deadline) {
        attempt++;
        log(`[Gmail] Polling for ElevenLabs verification email... attempt ${attempt}`);
        try {
          // Search from ElevenLabs domain — they send from noreply@elevenlabs.io
          const uids = await client.search(
            { or: [{ from: "elevenlabs.io" }, { from: "elevenlabs" }], since: startTime },
            { uid: true }
          );
          log(`[Gmail] Found ${uids.length} ElevenLabs message(s)`);
          if (uids.length > 0) {
            const range = (uids as number[]).join(",");
            for await (const msg of client.fetch(range, { source: true, envelope: true }, { uid: true })) {
              const toAddr = (msg.envelope?.to?.[0]?.address || "").toLowerCase();
              const toUser = toAddr.split("@")[0].replace(/\./g, "");
              // Accept if addressed to our base user (dot variants all map to same user)
              if (toUser !== baseUser) {
                log(`[Gmail] Skipping — addressed to ${toAddr}, expected ${baseUser}`);
                continue;
              }
              log(`[Gmail] Matched email to: ${toAddr}`);
              const raw = msg.source.toString("utf8");
              // Look for ElevenLabs verification link (oobCode or verify in URL)
              const linkPatterns = [
                /https?:\/\/[^\s"<>\]]+oobCode[^\s"<>\]]*/i,
                /https?:\/\/[^\s"<>\]]+elevenlabs[^\s"<>\]]*verify[^\s"<>\]]*/i,
                /https?:\/\/elevenlabs\.io\/[^\s"<>\]]*/i,
                /href="(https?:\/\/[^"]+oobCode[^"]*)">/i,
                /href="(https?:\/\/[^"]+elevenlabs[^"]+)">/i,
              ];
              for (const pattern of linkPatterns) {
                const m = raw.match(pattern);
                if (m) {
                  const link = (m[1] || m[0]).replace(/=\r?\n/g, "").replace(/=3D/g, "=");
                  log(`[Gmail] ✅ Verification link found: ${link.substring(0, 80)}…`);
                  return link;
                }
              }
              log("[Gmail] Email found but no verification link in body");
            }
          }
        } catch (searchErr: any) {
          log(`[Gmail] Search error: ${searchErr.message}`);
        }
        if (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, intervalMs));
        }
      }
    } finally {
      lock.release();
    }
  } catch (err: any) {
    log(`[Gmail] IMAP connection error: ${err.message}`);
  } finally {
    try { await client.logout(); } catch {}
  }

  log("[Gmail] Timed out waiting for ElevenLabs verification email");
  return null;
}

// ── Extract readable text from raw MIME email source ─────────────────────────
function extractMimeText(raw: string): string {
  // Find boundary for multipart messages
  const boundaryMatch = raw.match(/Content-Type:\s*multipart\/[^;]+;\s*boundary="?([^"\r\n]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const parts = raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?`));
    for (const part of parts) {
      if (/Content-Type:\s*text\/plain/i.test(part)) {
        const bodyStart = part.indexOf("\r\n\r\n");
        if (bodyStart === -1) continue;
        return part.slice(bodyStart + 4)
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .trim()
          .substring(0, 800);
      }
    }
    // Fallback to first HTML part stripped of tags
    for (const part of parts) {
      if (/Content-Type:\s*text\/html/i.test(part)) {
        const bodyStart = part.indexOf("\r\n\r\n");
        if (bodyStart === -1) continue;
        return part.slice(bodyStart + 4)
          .replace(/=\r?\n/g, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 800);
      }
    }
  }

  // Plain (non-multipart) message — everything after the blank header line
  const bodyStart = raw.indexOf("\r\n\r\n");
  if (bodyStart !== -1) {
    return raw.slice(bodyStart + 4)
      .replace(/=\r?\n/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 800);
  }
  return "";
}

// ── Gmail IMAP IDLE monitor for forwarded business mail ───────────────────────
// Uses IMAP IDLE so Gmail pushes new-mail events (~1–2 s after delivery).
// Business mail accounts forward to Gmail via /api/forwarders.
export async function pollBizMailViaGmail(
  bizEmail: string,
  since: Date,
  onMessage: (msg: BizMailMessage) => Promise<void>,
  shouldStop: () => boolean,
  maxMinutes = 120,
): Promise<void> {
  if (!_gmailAddress || !_gmailAppPassword) {
    console.log("[BizMail] Gmail credentials not configured — cannot monitor");
    return;
  }

  const deadline  = Date.now() + maxMinutes * 60 * 1000;
  const seenUids  = new Set<number>();
  let   uidCursor = 0; // highest UID we've already scanned — only look above this

  const processNewMail = async (client: ImapFlow) => {
    // Step 1: find only truly new UIDs (above our cursor, since session start)
    const criteria: any = { since };
    if (uidCursor > 0) criteria.uid = `${uidCursor + 1}:*`;
    const allUids = await client.search(criteria, { uid: true });
    const newUids = allUids.filter(u => u > uidCursor && !seenUids.has(u));
    if (!newUids.length) return;

    // Advance cursor immediately so re-entrant calls skip these
    const topUid = Math.max(...newUids);
    if (topUid > uidCursor) uidCursor = topUid;
    newUids.forEach(u => seenUids.add(u));

    // Step 2: fetch only the tiny header block — no body download yet
    const range = newUids.join(",");
    const matchingUids: number[] = [];
    for await (const msg of client.fetch(
      range,
      { headers: ["to", "cc", "delivered-to", "from", "subject", "date"], internalDate: true },
      { uid: true },
    )) {
      const hdrs = msg.headers?.toString("utf8") || "";
      const toLine      = hdrs.match(/^To:([^\r\n]+)/im)?.[1]           || "";
      const ccLine      = hdrs.match(/^Cc:([^\r\n]+)/im)?.[1]           || "";
      const delTo       = hdrs.match(/^Delivered-To:([^\r\n]+)/im)?.[1] || "";
      const combined    = `${toLine} ${ccLine} ${delTo}`.toLowerCase();
      if (!combined.includes(bizEmail.toLowerCase())) continue;
      const msgDate = msg.internalDate || new Date();
      if (msgDate < since) continue;
      matchingUids.push(msg.uid);
    }

    if (!matchingUids.length) return;

    // Step 3: fetch full source only for the emails that actually match
    for await (const msg of client.fetch(
      matchingUids.join(","),
      { source: true, envelope: true, internalDate: true },
      { uid: true },
    )) {
      const rawSrc  = msg.source?.toString("utf8") || "";
      const fromAddr = msg.envelope?.from?.[0];
      const from    = fromAddr?.address || fromAddr?.name || "unknown";
      const subject = msg.envelope?.subject || "(no subject)";
      const body    = extractMimeText(rawSrc);
      const msgDate = msg.internalDate || new Date();
      console.log(`[BizMail] IDLE → new email for ${bizEmail}: from=${from}, subject=${subject}`);
      await onMessage({ uid: msg.uid, from, subject, date: msgDate, body }).catch(() => {});
    }
  };

  while (!shouldStop() && Date.now() < deadline) {
    const client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: _gmailAddress, pass: _gmailAppPassword },
      logger: false,
      // Large idleTimeout — we no longer rely on the timer for detection.
      // The 'exists' event fires instantly; idle() just keeps the connection alive.
      idleTimeout: 28 * 60 * 1000,
    });

    try {
      await client.connect();

      let lock: any = null;
      for (const box of ["[Gmail]/All Mail", "INBOX"]) {
        try { lock = await client.getMailboxLock(box); break; } catch {}
      }
      if (!lock) { await client.logout(); await new Promise(r => setTimeout(r, 10_000)); continue; }

      try {
        // Initial sweep for anything that arrived since session start
        await processNewMail(client);

        // When Gmail pushes a new-mail notification it fires 'exists' INSTANTLY
        // (within 1-2 s of delivery). ImapFlow automatically sends DONE to exit
        // IDLE, runs our commands, then re-enters IDLE — no timer wait needed.
        let busy = false;
        const onExists = async () => {
          if (shouldStop() || busy) return;
          busy = true;
          try { await processNewMail(client); } catch {}
          busy = false;
        };
        client.on("exists", onExists);

        try {
          while (!shouldStop() && Date.now() < deadline) {
            // idle() keeps the persistent connection open.
            // It resolves when EXISTS interrupts it (instant) or after 28 min (reconnect).
            await Promise.race([
              client.idle(),
              new Promise<void>(r => setTimeout(r, 28 * 60 * 1000)),
            ]);
            // Safety sweep in case exists fired but busy flag blocked it
            if (!shouldStop() && !busy) await processNewMail(client).catch(() => {});
          }
        } finally {
          client.off("exists", onExists);
        }
      } finally {
        lock.release();
      }
    } catch (err: any) {
      console.log(`[BizMail] IDLE error: ${err.message} — reconnecting in 5 s`);
      if (!shouldStop()) await new Promise(r => setTimeout(r, 5_000));
    } finally {
      try { await client.logout(); } catch {}
    }
  }
  console.log(`[BizMail] IDLE monitor stopped for ${bizEmail}`);
}

export function detectProviderFromDomain(domain: string): Provider {
  if (MAIL_TM_DOMAINS.has(domain)) return "mail.tm";
  if (MAIL_GW_DOMAINS.has(domain)) return "mail.gw";
  return "mail.tm";
}

export async function getAvailableDomain(preferGw = true): Promise<string> {
  const results = await Promise.allSettled(
    (["mail.tm", "mail.gw"] as Provider[]).map(async (provider) => {
      const baseUrl = PROVIDERS[provider];
      const res = await fetch(`${baseUrl}/domains`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const members: any[] = data["hydra:member"] || [];
      return members.map((m: any) => ({ domain: m.domain as string, provider }));
    })
  );

  const allDomains: { domain: string; provider: Provider }[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const provider = i === 0 ? "mail.tm" : "mail.gw";
    if (r.status === "fulfilled") {
      for (const { domain } of r.value) {
        if (provider === "mail.tm") MAIL_TM_DOMAINS.add(domain);
        else MAIL_GW_DOMAINS.add(domain);
        allDomains.push({ domain, provider });
      }
    } else {
      console.log(`[Mail] Provider ${provider} domain fetch failed: ${(r as any).reason?.message}`);
    }
  }

  if (allDomains.length === 0) throw new Error("No email domains available from any provider");

  const gwDomains = allDomains.filter((d) => d.provider === "mail.gw");
  const tmDomains = allDomains.filter((d) => d.provider === "mail.tm");

  let pool: { domain: string; provider: Provider }[];
  if (preferGw && gwDomains.length > 0) {
    pool = Math.random() < 0.85 ? gwDomains : allDomains;
  } else {
    pool = allDomains;
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  console.log(`[Mail] Using provider: ${chosen.provider}, domain: ${chosen.domain} (${gwDomains.length} gw + ${tmDomains.length} tm available)`);
  return chosen.domain;
}

export async function getMailGwDomain(): Promise<string> {
  return getAvailableDomain(true);
}

export async function getMailTmOnlyDomain(): Promise<string> {
  const baseUrl = PROVIDERS["mail.tm"];
  const res = await fetch(`${baseUrl}/domains`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`mail.tm domain fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const members: any[] = data["hydra:member"] || [];
  if (members.length === 0) throw new Error("No mail.tm domains available");
  const domains = members.map((m: any) => m.domain as string);
  for (const d of domains) MAIL_TM_DOMAINS.add(d);
  const chosen = domains[Math.floor(Math.random() * domains.length)];
  console.log(`[Mail] mail.tm-only domain selected: ${chosen}`);
  return chosen;
}

export async function createTempEmail(
  address: string,
  password: string
): Promise<{ id: string; address: string; provider: Provider }> {
  const domain = address.split("@")[1] || "";
  const provider = detectProviderFromDomain(domain);
  const baseUrl = PROVIDERS[provider];
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        return { ...data, provider };
      }
      const text = await res.text();
      if (res.status === 422 && text.includes("already")) {
        console.log(`[Mail] Account ${address} already exists (${provider}), continuing...`);
        return { id: "existing", address, provider };
      }
      if (res.status === 429 && attempt < maxRetries) {
        const delay = Math.min(attempt * 3000, 15000);
        console.log(`[Mail] Rate limited (429) creating ${address}, retry ${attempt}/${maxRetries} in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        console.log(`[Mail] Server error (${res.status}) creating ${address}, retry ${attempt}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new Error(`Failed to create email account: ${res.status} - ${text}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" && attempt < maxRetries) {
        console.log(`[Mail] Timeout creating ${address}, retry ${attempt}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (attempt >= maxRetries) throw err;
    }
  }
  throw new Error(`Failed to create email account after ${maxRetries} retries`);
}

export async function getAuthToken(address: string, password: string, provider?: Provider): Promise<string> {
  const resolvedProvider: Provider = provider || detectProviderFromDomain(address.split("@")[1] || "");
  const baseUrl = PROVIDERS[resolvedProvider];
  const maxRetries = 4;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[Mail] Token obtained from ${resolvedProvider} for ${address}`);
        return data.token;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = Math.min(attempt * 2000, 10000);
        console.log(`[Mail] Token request ${res.status} for ${address}, retry ${attempt}/${maxRetries} in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      const text = await res.text();
      throw new Error(`Failed to get token: ${res.status} - ${text}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" && attempt < maxRetries) {
        console.log(`[Mail] Token timeout for ${address}, retry ${attempt}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (attempt >= maxRetries) throw err;
    }
  }
  throw new Error(`Failed to get token after ${maxRetries} retries`);
}

export async function fetchMessages(token: string, provider: Provider = "mail.tm"): Promise<any[]> {
  const baseUrl = PROVIDERS[provider];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        return data["hydra:member"] || [];
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 2000));
        continue;
      }
      if (res.status === 401) {
        console.log(`[Mail] Token expired (401) on ${provider}, cannot fetch messages`);
        return [];
      }
      throw new Error(`Failed to fetch messages: ${res.status}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" && attempt < 3) {
        console.log(`[Mail] Fetch timeout on ${provider}, retry ${attempt}/3...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (attempt >= 3) throw err;
    }
  }
  return [];
}

export async function fetchMessageContent(
  token: string,
  messageId: string,
  provider: Provider = "mail.tm"
): Promise<string> {
  const baseUrl = PROVIDERS[provider];
  const res = await fetch(`${baseUrl}/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Failed to fetch message: ${res.status}`);
  const data = await res.json();
  let content: string = "";
  if (typeof data.text === "string" && data.text.length > 0) {
    content = data.text;
  } else if (data.html) {
    if (Array.isArray(data.html)) content = data.html.join("\n");
    else if (typeof data.html === "string") content = data.html;
    else content = JSON.stringify(data.html);
  }
  console.log(`[Mail] Content length: ${content.length}, preview: ${content.substring(0, 200)}`);
  return content;
}

export async function pollForVerificationCode(
  address: string,
  password: string,
  provider: Provider,
  maxAttempts: number = 70,
  intervalMs: number = 3000
): Promise<string | null> {
  let token: string | null = null;
  for (let t = 1; t <= 5; t++) {
    token = await getAuthToken(address, password, provider).catch(() => null);
    if (token) break;
    console.log(`[Mail] Token fetch failed for ${address}, retry ${t}/5 in 5s...`);
    await new Promise(r => setTimeout(r, 5000));
  }
  if (!token) {
    console.log(`[Mail] Failed to get initial token for ${address} after 5 retries, aborting poll`);
    return null;
  }

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0 && i % 40 === 0) {
      console.log(`[Mail] Refreshing token at attempt ${i + 1}/${maxAttempts}...`);
      const freshToken = await getAuthToken(address, password, provider).catch(() => null);
      if (freshToken) token = freshToken;
      else console.log(`[Mail] Token refresh failed, continuing with old token`);
    }

    console.log(`[Mail] Polling for verification email (${provider})... attempt ${i + 1}/${maxAttempts}`);
    try {
      const messages = await fetchMessages(token, provider);
      console.log(`[Mail] Inbox has ${messages.length} message(s)`);

      if (messages.length > 0) {
        for (const msg of messages) {
          const latestId = msg.id;
          const subject = msg.subject || "";
          console.log(`[Mail] Checking message: subject="${subject}"`);
          const content = await fetchMessageContent(token, latestId, provider);

          const codeMatch = content.match(/\b(\d{6})\b/);
          if (codeMatch) {
            console.log(`[Mail] Extracted verification code: ${codeMatch[1]}`);
            return codeMatch[1];
          }
          const codeMatch2 = content.match(/code[:\s]*(\d{4,6})/i);
          if (codeMatch2) {
            console.log(`[Mail] Extracted verification code (alt): ${codeMatch2[1]}`);
            return codeMatch2[1];
          }
        }
        console.log(`[Mail] No code found in ${messages.length} message(s), continuing...`);
      }
    } catch (err: any) {
      console.log(`[Mail] Poll error (attempt ${i + 1}): ${err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.log("[Mail] Timed out waiting for verification email");
  return null;
}

export async function pollForDrawConfirmation(
  address: string,
  password: string,
  provider: Provider,
  maxAttempts: number = 20,
  intervalMs: number = 5000
): Promise<boolean> {
  let token = await getAuthToken(address, password, provider).catch(() => null);
  if (!token) {
    console.log(`[Mail] Failed to get token for draw confirmation poll`);
    return false;
  }

  for (let i = 0; i < maxAttempts; i++) {
    console.log(`[Mail] Polling for draw confirmation email (${provider})... attempt ${i + 1}/${maxAttempts}`);
    try {
      const messages = await fetchMessages(token, provider);
      for (const msg of messages) {
        const subject = (msg.subject || "").toLowerCase();
        const from = (msg.from?.address || msg.from?.name || "").toLowerCase();
        if (
          (subject.includes("confirmed") && subject.includes("la28")) ||
          (subject.includes("registered") && subject.includes("ticket draw")) ||
          (subject.includes("confirmed") && subject.includes("ticket draw")) ||
          (from.includes("la28") && subject.includes("confirmed"))
        ) {
          console.log(`[Mail] Draw confirmation email found! Subject: ${msg.subject}`);
          return true;
        }
      }
    } catch (err: any) {
      console.log(`[Mail] Error polling for confirmation: ${err.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.log("[Mail] Timed out waiting for draw confirmation email");
  return false;
}

export function generateRandomUsername(): string {
  const adjectives = ["swift", "brave", "cool", "epic", "fast", "keen", "bold", "wild", "pure", "true"];
  const nouns = ["tiger", "eagle", "wolf", "hawk", "bear", "lion", "fox", "deer", "lynx", "ram"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9999);
  return `${adj}${noun}${num}`;
}

// ── Business Mail (mailbux.com / addison.asia) ────────────────────────────────

const MAILBUX_API   = "https://mail.mailbux.com/api";
const MAILBUX_USER  = "user39b9897f";
const MAILBUX_PASS  = "Tvk*nWnlAmYz&SR%";
const MAILBUX_DOMAIN = "addison.asia";
const MAILBUX_IMAP_HOST = "mail.mailbux.com";

function mailbuxBasicAuth(): string {
  return "Basic " + Buffer.from(`${MAILBUX_USER}:${MAILBUX_PASS}`).toString("base64");
}

function genBizPassword(): string {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  const num  = Math.floor(Math.random() * 9999);
  return `Biz@${rand}${num}`;
}

// Mailbux requires quota >= 1 GB or omit the field (omitting = server default / no limit)

export async function createBizMailAccount(opts: {
  requestedNum?: number;    // re-create a specific numbered slot
  customUsername?: string;  // create/recreate a custom-named account (e.g. "john")
} = {}): Promise<{ email: string; password: string; accountNum: number | null; isCustom: boolean; recycled: string[] }> {
  const { storage } = await import("./storage");
  const token = await getMailbuxBearerToken();
  const isCustom = !!opts.customUsername;

  // ── Fixed paths (recovery / custom) ─────────────────────────────────────
  if (opts.customUsername || opts.requestedNum !== undefined) {
    const password = genBizPassword();
    let email: string;
    let accountNum: number | null = null;

    if (opts.customUsername) {
      const username = opts.customUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (!username) throw new Error("Invalid username — use letters, numbers, dots, hyphens, or underscores only.");
      email = `${username}@${MAILBUX_DOMAIN}`;
    } else {
      accountNum = opts.requestedNum!;
      email = `account${accountNum}@${MAILBUX_DOMAIN}`;
    }

    const res = await fetch(`${MAILBUX_API}/principal`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        type: "individual",
        tenant: MAILBUX_USER,
        name: email,
        description: isCustom
          ? `Addison Panel custom mail — ${email}`
          : `Addison Panel business mail #${accountNum}`,
        secrets: [password],
        emails: [email],
        roles: ["user"],
      }),
    });
    const json: any = await res.json();
    const detail: string = (json.details || json.detail || json.error || "").toLowerCase();

    if ((json.data && typeof json.data === "number") ||
        detail.includes("already") || detail.includes("exists") || detail.includes("duplicate")) {
      if (json.data) console.log(`[BizMail] Created ${email} (Stalwart ID: ${json.data})`);
      else           console.log(`[BizMail] ${email} already existed on server — reactivating in DB`);
      const existing = await storage.getBizMailByEmail(email);
      if (existing) {
        await storage.reactivateBizMailAccountByEmail(email, password);
      } else {
        await storage.registerBizMailAccount(accountNum, email, password);
      }
      return { email, password, accountNum, isCustom, recycled: [] };
    }

    throw new Error(json.details || json.detail || json.error || JSON.stringify(json));
  }

  // ── Auto-recycle: if at capacity (≥10 active), delete the 5 oldest ────────
  const ACTIVE_CAP    = 10;
  const RECYCLE_COUNT = 5;
  const recycled: string[] = [];
  const active = await storage.getActiveBizMailAccounts();
  if (active.length >= ACTIVE_CAP) {
    const toDelete = await storage.getOldestActiveBizMailAccounts(RECYCLE_COUNT);
    console.log(`[BizMail] At capacity (${active.length}/${ACTIVE_CAP}) — recycling ${toDelete.length} oldest accounts`);
    for (const acct of toDelete) {
      try {
        await deleteBizMailAccount(acct.email);        // throws on non-2xx
        await storage.markBizMailDeletedByEmail(acct.email); // only runs if delete succeeded
        recycled.push(acct.email);
        console.log(`[BizMail] Recycled ${acct.email}`);
      } catch (e: any) {
        console.warn(`[BizMail] Recycle error for ${acct.email}: ${e.message}`);
      }
    }
  }

  // ── Auto-increment: loop past any slots that already exist on the server ─
  const MAX_SKIP = 50; // safety guard against infinite loops
  for (let skip = 0; skip < MAX_SKIP; skip++) {
    const password = genBizPassword();

    // Re-read DB each iteration so we account for slots registered mid-loop
    const all    = await storage.getAllBizMailAccounts();
    const nums   = all.map(a => a.accountNum).filter((n): n is number => n !== null);
    const maxNum = nums.length > 0 ? Math.max(...nums) : 0;
    const accountNum = maxNum + 1;
    const email = `account${accountNum}@${MAILBUX_DOMAIN}`;

    const res = await fetch(`${MAILBUX_API}/principal`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        type: "individual",
        tenant: MAILBUX_USER,
        name: email,
        description: `Addison Panel business mail #${accountNum}`,
        secrets: [password],
        emails: [email],
        roles: ["user"],
      }),
    });
    const json: any = await res.json();
    const detail: string = (json.details || json.detail || json.error || "").toLowerCase();

    if (json.data && typeof json.data === "number") {
      // Fresh account created successfully
      console.log(`[BizMail] Created ${email} (Stalwart ID: ${json.data})`);
      await storage.registerBizMailAccount(accountNum, email, password);
      return { email, password, accountNum, isCustom: false, recycled };
    }

    if (detail.includes("already") || detail.includes("exists") || detail.includes("duplicate")) {
      // This slot already exists on the server (leftover from a previous session).
      // Register it in DB so the counter skips it next iteration, then try next number.
      console.log(`[BizMail] ${email} already exists on server — skipping to next number`);
      const existing = await storage.getBizMailByEmail(email);
      if (!existing) {
        // Placeholder entry (isActive=false so it's not treated as a live account)
        await storage.registerBizMailAccount(accountNum, email, "orphaned");
        await storage.markBizMailDeletedByEmail(email);
      }
      continue; // try accountNum + 1
    }

    throw new Error(json.details || json.detail || json.error || JSON.stringify(json));
  }

  throw new Error("Could not find a free account slot after 50 attempts — server may be at capacity.");
}

export async function deleteBizMailAccount(email: string): Promise<void> {
  const token = await getMailbuxBearerToken();
  const res = await fetch(`${MAILBUX_API}/principal/${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`Stalwart DELETE ${email} returned ${res.status}: ${body.substring(0, 120)}`);
  }
  console.log(`[BizMail] Deleted Stalwart account: ${email} (status ${res.status})`);
}

// ── Email Forwarders API ──────────────────────────────────────────────────────
// Uses /api/forwarders — supports external forwarding (e.g. to Gmail)

export interface BizMailForwarder {
  id: string;
  fromEmail: string;
  to: string;
  keepLocal: boolean;
  description?: string;
}

export async function listBizMailForwarders(domain = MAILBUX_DOMAIN): Promise<BizMailForwarder[]> {
  try {
    const token = await getMailbuxBearerToken();
    const res = await fetch(`${MAILBUX_API}/forwarders?domain=${encodeURIComponent(domain)}`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    const data: any = await res.json();
    if (!data?.forwarders) return [];
    return (data.forwarders as any[]).map(f => ({
      id: f.id,
      fromEmail: f.source || f.from_email || f.fromEmail || "",
      to: f.destination || f.to || "",
      keepLocal: f.keep_copy ?? f.keepLocal ?? true,
      description: f.description || "",
    }));
  } catch (err: any) {
    console.log(`[BizMail] listForwarders error: ${err.message}`);
    return [];
  }
}

export async function createBizMailForwarder(
  fromEmail: string,
  to: string,
  keepLocal = true,
  description = "",
): Promise<{ success: boolean; id?: string }> {
  try {
    const token = await getMailbuxBearerToken();
    const res = await fetch(`${MAILBUX_API}/forwarders`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ fromEmail, to, keepLocal, description }),
    });
    const data: any = await res.json();
    if (data?.success) {
      const id = data.id || data.forwarder?.id || "";
      console.log(`[BizMail] Created forwarder: ${fromEmail} → ${to} (id=${id})`);
      return { success: true, id };
    }
    console.log(`[BizMail] createForwarder failed (${res.status}):`, JSON.stringify(data).substring(0, 100));
    return { success: false };
  } catch (err: any) {
    console.log(`[BizMail] createForwarder error: ${err.message}`);
    return { success: false };
  }
}

export async function deleteBizMailForwarder(forwarderId: string): Promise<void> {
  try {
    const token = await getMailbuxBearerToken();
    await fetch(`${MAILBUX_API}/forwarders/${encodeURIComponent(forwarderId)}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    console.log(`[BizMail] Deleted forwarder: ${forwarderId}`);
  } catch (err: any) {
    console.log(`[BizMail] deleteForwarder error: ${err.message}`);
  }
}

export interface BizMailMessage {
  uid: number;
  from: string;
  subject: string;
  date: Date;
  body: string;
}

// ── Mailbux admin Bearer token via pure HTTP (no Playwright) ─────────────────
// Flow: GET /auth/login (get CSRF + session cookie) → POST /api/login → Stalwart token

let _cachedMailbuxToken: { token: string; expiry: number } | null = null;
let _cachedMailbuxCookies: string = "";

async function mailbuxHttpGet(url: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[]>; body: string; rawCookies: string[] }> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AddisonsBot/1.0)",
      ...extraHeaders,
    },
    redirect: "manual",
  });
  const body = await res.text();
  const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body, rawCookies };
}

async function mailbuxHttpPost(url: string, payload: object, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; AddisonsBot/1.0)",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { status: res.status, body };
}

export async function getMailbuxBearerToken(): Promise<string> {
  if (_cachedMailbuxToken && Date.now() < _cachedMailbuxToken.expiry) {
    return _cachedMailbuxToken.token;
  }

  // ── Method 1: POST /api/oauth password grant (simplest — try first) ────────
  try {
    const oauthRes = await mailbuxHttpPost("https://mail.mailbux.com/api/oauth", {
      grant_type: "password",
      username: MAILBUX_USER,
      password: MAILBUX_PASS,
    });
    if (oauthRes.status >= 200 && oauthRes.status < 300) {
      let oauthData: any;
      try { oauthData = JSON.parse(oauthRes.body); } catch { /* fall through */ }
      const oauthToken = oauthData?.access_token || oauthData?.stalwart_tokens?.access_token || "";
      if (oauthToken) {
        _cachedMailbuxToken = { token: oauthToken, expiry: Date.now() + 50 * 60 * 1000 };
        console.log("[BizMail] Got Bearer token via /api/oauth");
        return oauthToken;
      }
    }
  } catch { /* fall through to CSRF method */ }

  // ── Method 2: CSRF login flow — GET /auth/login → POST /api/login ─────────
  // Confirmed working: returns stalwart_tokens.access_token
  const loginPage = await mailbuxHttpGet("https://mail.mailbux.com/auth/login");
  const csrfMatch = loginPage.body.match(/name="csrf-token"\s+content="([^"]+)"/);
  const csrf = csrfMatch?.[1] || "";
  if (!csrf) throw new Error("Could not extract CSRF token from mailbux login page");

  const sessionCookie = loginPage.rawCookies.map((c: string) => c.split(";")[0]).join("; ");

  const loginRes = await mailbuxHttpPost("https://mail.mailbux.com/api/login", {
    email: MAILBUX_USER,
    username: MAILBUX_USER,
    password: MAILBUX_PASS,
    login_type: "tenant",
  }, {
    "X-CSRF-TOKEN": csrf,
    "X-Requested-With": "XMLHttpRequest",
    "Cookie": sessionCookie,
    "Referer": "https://mail.mailbux.com/auth/login",
    "Origin": "https://mail.mailbux.com",
  });

  let data: any;
  try { data = JSON.parse(loginRes.body); } catch { throw new Error(`Mailbux login parse error: ${loginRes.body.substring(0, 100)}`); }
  if (!data?.stalwart_tokens?.access_token) {
    throw new Error(`Mailbux login failed (${loginRes.status}): ${loginRes.body.substring(0, 150)}`);
  }

  const token = data.stalwart_tokens.access_token;
  _cachedMailbuxToken = { token, expiry: Date.now() + 50 * 60 * 1000 };
  _cachedMailbuxCookies = sessionCookie;
  console.log("[BizMail] Got Stalwart Bearer token via CSRF login flow");
  return token;
}

// ── JMAP-based mailbox access via admin account ───────────────────────────────
// Stalwart exposes JMAP at my.mailbux.com/jmap. The admin user (user39b9897f)
// has accountId "bte2". Individual @addison.asia accounts get their email
// routed to admin by removing the email from their own principal and adding it
// to admin's principal, then creating a JMAP identity for that address.

const JMAP_BASE_URL = "https://my.mailbux.com/jmap";
const JMAP_ADMIN_ACCOUNT_ID = "bte2";
const JMAP_INBOX_MAILBOX_ID = "a"; // inbox role mailbox ID for admin

async function jmapAdminCall(methodCalls: any[]): Promise<any> {
  const adminBasic = Buffer.from(`${MAILBUX_USER}:${MAILBUX_PASS}`).toString("base64");
  const r = await fetch(`${JMAP_BASE_URL}/`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${adminBasic}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls,
    }),
  });
  if (!r.ok) throw new Error(`JMAP call failed: ${r.status}`);
  return r.json();
}

// Route a biz mail address to admin JMAP inbox.
// Removes the email from the individual account principal and adds it to admin,
// then creates a JMAP identity so admin can send/receive as that address.
export async function ensureBizMailJmapRouting(bizEmail: string): Promise<void> {
  try {
    const adminToken = await getMailbuxBearerToken();
    const encodedEmail = encodeURIComponent(bizEmail);

    // Step 1: Remove email from individual account's principal
    await fetch(`https://mail.mailbux.com/api/principal/${encodedEmail}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify([{ action: "removeItem", field: "emails", value: bizEmail }]),
    });

    // Step 2: Add email to admin principal
    const addRes = await fetch("https://mail.mailbux.com/api/principal/user39b9897f", {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify([{ action: "addItem", field: "emails", value: bizEmail }]),
    });
    const addData = await addRes.json() as any;
    if (addData?.error === "fieldAlreadyExists") {
      console.log(`[BizMail JMAP] ${bizEmail} already routed to admin`);
    } else {
      console.log(`[BizMail JMAP] Routed ${bizEmail} → admin inbox`);
    }

    // Step 3: Create JMAP identity so admin can receive/filter as that address
    try {
      await jmapAdminCall([
        ["Identity/set", {
          accountId: JMAP_ADMIN_ACCOUNT_ID,
          create: {
            "identity1": { name: bizEmail, email: bizEmail, textSignature: "" },
          },
        }, "0"],
      ]);
    } catch { /* identity may already exist — ignore */ }
  } catch (err: any) {
    console.log(`[BizMail JMAP] ensureBizMailJmapRouting error for ${bizEmail}: ${err.message}`);
  }
}

// Set up JMAP routing for all existing biz mail accounts.
// Call once at startup so all accounts are ready.
export async function setupAllBizMailJmapRouting(): Promise<void> {
  try {
    const adminToken = await getMailbuxBearerToken();
    const domainRes = await fetch("https://mail.mailbux.com/api/principal/addison.asia", {
      headers: { "Authorization": `Bearer ${adminToken}`, "Accept": "application/json" },
    });
    const domainData = await domainRes.json() as any;
    const memberCount = domainData?.data?.members || 0;
    console.log(`[BizMail JMAP] Setting up routing for ${memberCount} @addison.asia accounts`);
    for (let i = 1; i <= memberCount; i++) {
      const email = `account${i}@addison.asia`;
      await ensureBizMailJmapRouting(email);
    }
  } catch (err: any) {
    console.log(`[BizMail JMAP] setupAllBizMailJmapRouting error: ${err.message}`);
  }
}

// Search admin JMAP inbox for emails addressed to a specific biz mail account.
// Returns matching email objects from the JMAP response.
async function jmapSearchForBizMailEmails(toEmail: string, since: Date): Promise<any[]> {
  const result = await jmapAdminCall([
    ["Email/query", {
      accountId: JMAP_ADMIN_ACCOUNT_ID,
      limit: 50,
      sort: [{ property: "receivedAt", isAscending: false }],
    }, "0"],
    ["Email/get", {
      accountId: JMAP_ADMIN_ACCOUNT_ID,
      "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
      properties: ["id", "from", "to", "subject", "receivedAt", "preview", "bodyValues", "textBody"],
      fetchTextBodyValues: true,
    }, "1"],
  ]);

  const emails: any[] = result?.methodResponses?.[1]?.[1]?.list || [];
  return emails.filter((m: any) => {
    const toAddresses: string[] = (m.to || []).map((t: any) => (t.email || "").toLowerCase());
    if (!toAddresses.includes(toEmail.toLowerCase())) return false;
    const receivedAt = new Date(m.receivedAt || 0);
    return receivedAt >= since;
  });
}

export async function registerBizMailWebmail(email: string, password: string, displayName: string): Promise<boolean> {
  // Route the bizmail address through admin JMAP inbox (no webmail registration needed)
  await ensureBizMailJmapRouting(email);
  return true;
}

export async function pollBizMailInbox(
  email: string,
  password: string,
  since: Date,
  onMessage: (msg: BizMailMessage) => Promise<void>,
  shouldStop: () => boolean,
  maxMinutes = 60,
): Promise<void> {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  const seenIds  = new Set<string>();

  await ensureBizMailJmapRouting(email);
  console.log(`[BizMail JMAP] Polling inbox for ${email}...`);

  while (!shouldStop() && Date.now() < deadline) {
    try {
      const messages = await jmapSearchForBizMailEmails(email, since);
      for (const m of messages) {
        const id = m.id as string;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const from    = m.from?.[0]?.email || m.from?.[0]?.name || "unknown";
        const subject = m.subject || "(no subject)";
        const bodyText = Object.values(m.bodyValues || {}).map((v: any) => v.value || "").join(" ");
        const body = (m.preview || bodyText).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 800);
        const date = new Date(m.receivedAt || since);

        await onMessage({ uid: 0, from, subject, date, body });
      }
    } catch (err: any) {
      console.log(`[BizMail JMAP] poll error: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 20_000));
  }
}

// ── Poll admin JMAP inbox for an OpenAI/ChatGPT verification email ─────────────
// Returns { code } (6-digit OTP) or { link } (verify URL), whichever is found first.
export async function fetchOpenAICodeFromBizMail(
  email: string,
  password: string,
  since: Date,
  log: (msg: string) => void,
  timeoutMs = 180_000,
): Promise<{ code?: string; link?: string } | null> {
  const deadline = Date.now() + timeoutMs;

  // Ensure this biz mail address routes to admin's inbox
  await ensureBizMailJmapRouting(email);
  log(`[BizMail JMAP] Routing confirmed for ${email} — polling admin inbox...`);

  const seenIds = new Set<string>();

  while (Date.now() < deadline) {
    try {
      const messages = await jmapSearchForBizMailEmails(email, since);

      for (const m of messages) {
        const id = m.id as string;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const from    = (m.from?.[0]?.email || m.from?.[0]?.name || "").toLowerCase();
        const subject = (m.subject || "").toLowerCase();
        const bodyText = Object.values(m.bodyValues || {}).map((v: any) => v.value || "").join(" ");
        const rawBody = m.preview || bodyText;
        const body    = rawBody.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
        const fullText = `${from} ${subject} ${body}`;

        const isOpenAI =
          from.includes("openai") || from.includes("noreply") ||
          subject.includes("verify") || subject.includes("confirm") || subject.includes("openai") ||
          body.toLowerCase().includes("openai") || body.toLowerCase().includes("chatgpt");
        if (!isOpenAI) continue;

        log(`[BizMail JMAP] Found email from="${from}" sub="${m.subject}"`);

        // Extract 6-digit OTP code
        const codeMatch =
          fullText.match(/(?:verification|confirm|one.time)[^\d]*(\d{6})\b/i) ||
          fullText.match(/\b(\d{6})\b(?=[^\d]*(?:is your|to verify|code))/i) ||
          fullText.match(/\b([0-9]{6})\b/);
        if (codeMatch) {
          log(`[BizMail JMAP] ✅ Found OTP: ${codeMatch[1]}`);
          return { code: codeMatch[1] };
        }

        // Extract verify link
        const linkMatch =
          rawBody.match(/href="(https?:\/\/[^"]*(?:verify|confirm|callback|activate)[^"]*)"/i) ||
          body.match(/(https?:\/\/[^\s"<>]*(?:verify|confirm|callback|activate)[^\s"<>]*)/i) ||
          rawBody.match(/href="(https?:\/\/[^"]*openai\.com[^"]*)"/i);
        if (linkMatch) {
          log(`[BizMail JMAP] ✅ Found verify link: ${linkMatch[1].substring(0, 80)}...`);
          return { link: linkMatch[1] };
        }

        log(`[BizMail JMAP] Email found but no code/link extracted — continuing poll`);
      }
    } catch (err: any) {
      log(`[BizMail JMAP] poll error: ${err.message}`);
    }

    const remaining = Math.round((deadline - Date.now()) / 1000);
    if (remaining > 0) {
      log(`[BizMail JMAP] Waiting... (${remaining}s remaining)`);
      await new Promise(r => setTimeout(r, 15_000));
    }
  }

  log(`[BizMail JMAP] Timed out waiting for OpenAI verification email to ${email}`);
  return null;
}

// ── UPI Payment email parser (Axis Bank alerts) ────────────────────────────────
// Subject format:  "INR 2000.00 was credited to your A/c."
// From:            alerts@axis.bank.in
// Body contains:   "UPI/P2A/602487211999/MOHD AADI/HDFC/Sent"

export interface UpiPaymentInfo {
  utr:        string;
  amountInr:  number;
  senderName: string | null;
  senderBank: string | null;
}

function parseAxisBankEmail(subject: string, body: string): UpiPaymentInfo | null {
  // Extract amount from subject
  const amtMatch = subject.match(/INR\s+([\d,]+\.?\d*)\s+was credited/i);
  if (!amtMatch) return null;
  const amountInr = parseFloat(amtMatch[1].replace(/,/g, ""));
  if (isNaN(amountInr) || amountInr <= 0) return null;

  // Extract UTR, sender name, sender bank from body
  // Patterns: UPI/P2A/UTR/NAME/BANK/Sent  or  UPI/P2P/UTR/NAME/BANK/Sent
  const txMatch = body.match(/UPI\/P2[AP]\/(\d{6,})\/?([^\/\r\n]*)?\/?([^\/\r\n]*)?/i);
  if (!txMatch) {
    // Fallback: look for a standalone 12-digit UTR
    const utrOnly = body.match(/\b(\d{12})\b/);
    if (!utrOnly) return null;
    return { utr: utrOnly[1], amountInr, senderName: null, senderBank: null };
  }

  return {
    utr:        txMatch[1],
    amountInr,
    senderName: txMatch[2]?.trim() || null,
    senderBank: txMatch[3]?.trim() || null,
  };
}

/**
 * Searches Gmail IMAP for an Axis Bank UPI credit notification containing the
 * given UTR number.  Looks back `sinceHours` hours.  Returns payment details
 * or null if not found.
 */
export async function searchUpiPaymentEmail(
  utr: string,
  sinceHours = 48,
): Promise<UpiPaymentInfo | null> {
  if (!_gmailAddress || !_gmailAppPassword) {
    console.log("[UPI] Gmail credentials not configured");
    return null;
  }

  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: _gmailAddress, pass: _gmailAppPassword },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX").catch(async () => {
      // Try [Gmail]/All Mail as fallback
      return client.getMailboxLock("[Gmail]/All Mail");
    });

    try {
      const uids = await client.search(
        { from: "axis.bank.in", since },
        { uid: true },
      );

      if (!uids.length) {
        console.log("[UPI] No Axis Bank emails found in timeframe");
        return null;
      }

      const range = (uids as number[]).join(",");
      for await (const msg of client.fetch(range, { source: true, envelope: true }, { uid: true })) {
        const subject = msg.envelope?.subject || "";
        const raw     = msg.source?.toString("utf8") || "";
        const body    = extractMimeText(raw);
        const full    = subject + " " + body + " " + raw;

        const info = parseAxisBankEmail(subject, full);
        if (!info) continue;
        if (info.utr !== utr) continue;

        console.log(`[UPI] Found matching email: UTR=${info.utr} INR=${info.amountInr}`);
        return info;
      }
    } finally {
      lock.release();
    }
  } catch (err: any) {
    console.error("[UPI] IMAP error:", err.message);
  } finally {
    try { await client.logout(); } catch {}
  }

  return null;
}

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

const BIZ_MAIL_QUOTA_BYTES = 10_485_760; // 10 MB per account — allows thousands on the plan

export async function createBizMailAccount(
  requestedNum?: number, // if set, re-create this specific number (recovery flow)
): Promise<{ email: string; password: string; accountNum: number }> {
  const { storage } = await import("./storage");
  const password = genBizPassword();
  const token = await getMailbuxBearerToken();

  let targetNum: number;

  if (requestedNum !== undefined) {
    targetNum = requestedNum;
  } else {
    // Always pick max-ever-used + 1 — numbering goes up forever, no cap
    const all    = await storage.getAllBizMailAccounts();
    const maxNum = all.length > 0 ? Math.max(...all.map(a => a.accountNum)) : 0;
    targetNum    = maxNum + 1;
  }

  const email = `account${targetNum}@${MAILBUX_DOMAIN}`;
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
      description: `Addison Panel business mail #${targetNum}`,
      secrets: [password],
      emails: [email],
      quota: BIZ_MAIL_QUOTA_BYTES,
      roles: ["user"],
    }),
  });
  const json: any = await res.json();

  if (json.data && typeof json.data === "number") {
    console.log(`[BizMail] Created ${email} (Stalwart ID: ${json.data})`);
    const existing = await storage.getBizMailByNum(targetNum);
    if (existing) {
      await storage.reactivateBizMailAccount(targetNum, password);
    } else {
      await storage.registerBizMailAccount(targetNum, email, password);
    }
    return { email, password, accountNum: targetNum };
  }

  throw new Error(json.details || json.detail || json.error || JSON.stringify(json));
}

export async function deleteBizMailAccount(email: string): Promise<void> {
  try {
    const token = await getMailbuxBearerToken();
    await fetch(`${MAILBUX_API}/principal/${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    console.log(`[BizMail] Deleted Stalwart account: ${email}`);
  } catch (err: any) {
    console.log(`[BizMail] deleteBizMailAccount error: ${err.message}`);
  }
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

// ── Register an account in the mailbux WEBMAIL system ────────────────────────
// The mailbux webmail at /inbox has its own auth system separate from Stalwart.
// We need to register here so users can log in at mail.mailbux.com/inbox/login.

// ── Get the Sanctum XSRF-TOKEN for webmail API calls ─────────────────────────
async function getWebmailXsrf(): Promise<{ xsrfToken: string; cookieStr: string }> {
  // GET /api/auth/session-status sets XSRF-TOKEN + mailbux_session cookies (Sanctum pattern)
  const res = await fetch("https://mail.mailbux.com/api/auth/session-status", {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; AddisonsBot/1.0)",
      "Accept": "application/json",
      "Referer": "https://mail.mailbux.com/inbox/login",
    },
  });
  const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookieStr = rawCookies.map((c: string) => c.split(";")[0]).join("; ");
  const xsrfCookie = rawCookies.find((c: string) => c.startsWith("XSRF-TOKEN"));
  const xsrfEncoded = xsrfCookie ? xsrfCookie.split("=").slice(1).join("=").split(";")[0] : "";
  const xsrfToken = decodeURIComponent(xsrfEncoded);
  return { xsrfToken, cookieStr };
}

export async function registerBizMailWebmail(email: string, password: string, displayName: string): Promise<boolean> {
  try {
    const { xsrfToken, cookieStr } = await getWebmailXsrf();

    const res = await mailbuxHttpPost("https://mail.mailbux.com/api/auth/register", {
      email,
      password,
      name: displayName,
    }, {
      "X-XSRF-TOKEN": xsrfToken,
      "Cookie": cookieStr,
      "Referer": "https://mail.mailbux.com/inbox/login",
      "Origin": "https://mail.mailbux.com",
    });

    let json: any;
    try { json = JSON.parse(res.body); } catch { json = {}; }

    if (res.status >= 200 && res.status < 300) {
      console.log(`[BizMail] Webmail account registered: ${email}`);
      return true;
    }
    // Already registered = also fine
    const msg = (json.message || json.error || json.detail || "").toLowerCase();
    if (msg.includes("already") || msg.includes("exists") || msg.includes("taken")) {
      console.log(`[BizMail] Webmail account already exists: ${email}`);
      return true;
    }
    console.log(`[BizMail] Webmail register failed (${res.status}):`, res.body.substring(0, 200));
    return false;
  } catch (err: any) {
    console.log(`[BizMail] registerBizMailWebmail error: ${err.message}`);
    return false;
  }
}

// ── Poll mailbux webmail API for incoming business mail ───────────────────────
// Uses the webmail's own REST API (/api/auth/login → /api/search)

async function webmailLogin(email: string, password: string): Promise<{ token: string; cookie: string } | null> {
  try {
    // Get Sanctum XSRF token first — required for all webmail POST requests
    const { xsrfToken, cookieStr: sessionCookies } = await getWebmailXsrf();

    const res = await fetch("https://mail.mailbux.com/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; AddisonsBot/1.0)",
        "X-XSRF-TOKEN": xsrfToken,
        "Cookie": sessionCookies,
        "Referer": "https://mail.mailbux.com/inbox/login",
        "Origin": "https://mail.mailbux.com",
      },
      body: JSON.stringify({ email, password }),
    });
    const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const cookieStr = [...sessionCookies.split("; "), ...rawCookies.map((c: string) => c.split(";")[0])]
      .filter(Boolean).join("; ");
    const body = await res.text();
    let data: any;
    try { data = JSON.parse(body); } catch { return null; }
    if (res.status >= 200 && res.status < 300) {
      const token = data?.access_token || data?.token || data?.data?.access_token || "";
      console.log(`[BizMail] Webmail login OK for ${email}, token: ${token ? "yes" : "cookie-only"}`);
      return { token, cookie: cookieStr };
    }
    console.log(`[BizMail] Webmail login failed (${res.status}): ${body.substring(0, 100)}`);
    return null;
  } catch (err: any) {
    console.log(`[BizMail] webmailLogin error: ${err.message}`);
    return null;
  }
}

async function webmailSearch(auth: { token: string; cookie: string }, query = "", limit = 50): Promise<any[]> {
  try {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; AddisonsBot/1.0)",
    };
    if (auth.cookie) headers["Cookie"] = auth.cookie;
    if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`;
    const url = `https://mail.mailbux.com/api/search?q=${encodeURIComponent(query)}&limit=${limit}&folder=INBOX`;
    const res = await fetch(url, { method: "GET", headers });
    const body = await res.text();
    let data: any;
    try { data = JSON.parse(body); } catch { return []; }
    // May return { data: [...] } or an array directly
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.messages)) return data.messages;
    return [];
  } catch {
    return [];
  }
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
  const seenIds  = new Set<string | number>();

  // Login to webmail
  let auth = await webmailLogin(email, password);
  if (!auth) {
    console.log(`[BizMail] Could not log into webmail for ${email} — skipping poll`);
    return;
  }

  let tokenExpiry = Date.now() + 14 * 60 * 1000; // refresh login every 14 min

  while (!shouldStop() && Date.now() < deadline) {
    // Re-login periodically
    if (Date.now() > tokenExpiry) {
      const fresh = await webmailLogin(email, password);
      if (fresh) { auth = fresh; tokenExpiry = Date.now() + 14 * 60 * 1000; }
    }

    try {
      const messages = await webmailSearch(auth, "", 50);
      for (const m of messages) {
        const id   = m.id || m.uid || m.messageId || JSON.stringify(m).slice(0, 30);
        const date = new Date(m.date || m.receivedAt || m.createdAt || since);
        if (date < since) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const from    = m.from?.address || m.from?.email || m.from || "unknown";
        const subject = m.subject || "(no subject)";
        const body    = (m.snippet || m.preview || m.body || m.text || m.html || "")
          .toString()
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 800);

        await onMessage({ uid: typeof id === "number" ? id : 0, from, subject, date, body });
      }
    } catch (err: any) {
      console.log(`[BizMail] webmail poll error: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 20_000));
  }
}

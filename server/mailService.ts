import { ImapFlow } from "imapflow";

const PROVIDERS = {
  "mail.tm": "https://api.mail.tm",
  "mail.gw": "https://api.mail.gw",
} as const;

type Provider = keyof typeof PROVIDERS;

const MAIL_TM_DOMAINS = new Set<string>();
const MAIL_GW_DOMAINS = new Set<string>();

let _gmailAddress: string | null = null;
let _gmailAppPassword: string | null = null;

export function setGmailCredentials(email: string | null, appPassword: string | null): void {
  _gmailAddress = email || null;
  _gmailAppPassword = appPassword || null;
  if (_gmailAddress && _gmailAppPassword) {
    console.log(`[Gmail] Credentials configured for ${_gmailAddress}`);
  }
}

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
  const tag = Math.random().toString(36).substring(2, 10);
  return `${base}+la28_${tag}@gmail.com`;
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
    const lock = await client.getMailboxLock("INBOX");

    try {
      for (let i = 0; i < maxAttempts; i++) {
        console.log(`[Gmail] Polling for code to ${targetAddress}... attempt ${i + 1}/${maxAttempts}`);

        try {
          const uids = await client.search({ to: targetAddress, since: startTime }, { uid: true });
          console.log(`[Gmail] Found ${uids.length} matching message(s)`);

          if (uids.length > 0) {
            const range = uids.join(",");
            for await (const msg of client.fetch(range, { source: true }, { uid: true })) {
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
  let token = await getAuthToken(address, password, provider).catch(() => null);
  if (!token) {
    console.log(`[Mail] Failed to get initial token for ${address}, aborting poll`);
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

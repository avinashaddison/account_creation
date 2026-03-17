const BASE_URL = "https://api.mail.tm";

let activeProvider: "mail.tm" | "mail.gw" = "mail.tm";

function getBaseUrl(): string {
  return activeProvider === "mail.gw" ? "https://api.mail.gw" : BASE_URL;
}

export async function getAvailableDomain(): Promise<string> {
  for (const provider of ["mail.tm", "mail.gw"] as const) {
    try {
      const url = provider === "mail.gw" ? "https://api.mail.gw" : BASE_URL;
      const res = await fetch(`${url}/domains`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const members = data["hydra:member"];
      if (members && members.length > 0) {
        activeProvider = provider;
        console.log(`[Mail] Using provider: ${provider}, domain: ${members[0].domain}`);
        return members[0].domain;
      }
    } catch (err: any) {
      console.log(`[Mail] Provider ${provider} failed: ${err.message}`);
    }
  }
  throw new Error("No email domains available from any provider");
}

export async function createTempEmail(address: string, password: string): Promise<{ id: string; address: string }> {
  const maxRetries = 5;
  const baseUrl = getBaseUrl();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, password }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return res.json();
      const text = await res.text();
      if (res.status === 422 && text.includes("already")) {
        console.log(`[Mail] Account ${address} already exists, continuing...`);
        return { id: "existing", address };
      }
      if (res.status === 429 && attempt < maxRetries) {
        const delay = Math.min(attempt * 3000, 15000);
        console.log(`[Mail] Rate limited (429) creating ${address}, retry ${attempt}/${maxRetries} in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        console.log(`[Mail] Server error (${res.status}) creating ${address}, retry ${attempt}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw new Error(`Failed to create email account: ${res.status} - ${text}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" && attempt < maxRetries) {
        console.log(`[Mail] Timeout creating ${address}, retry ${attempt}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (attempt >= maxRetries) throw err;
    }
  }
  throw new Error(`Failed to create email account after ${maxRetries} retries`);
}

export async function getAuthToken(address: string, password: string): Promise<string> {
  const maxRetries = 4;
  const baseUrl = getBaseUrl();
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
        return data.token;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = Math.min(attempt * 2000, 10000);
        console.log(`[Mail] Token request ${res.status} for ${address}, retry ${attempt}/${maxRetries} in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      const text = await res.text();
      throw new Error(`Failed to get token: ${res.status} - ${text}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" && attempt < maxRetries) {
        console.log(`[Mail] Token timeout for ${address}, retry ${attempt}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (attempt >= maxRetries) throw err;
    }
  }
  throw new Error(`Failed to get token after ${maxRetries} retries`);
}

export async function fetchMessages(token: string): Promise<any[]> {
  const baseUrl = getBaseUrl();
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
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      if (res.status === 401) {
        console.log(`[Mail] Token expired (401), cannot fetch messages`);
        return [];
      }
      throw new Error(`Failed to fetch messages: ${res.status}`);
    } catch (err: any) {
      if (err.name === "TimeoutError" && attempt < 3) {
        console.log(`[Mail] Fetch timeout, retry ${attempt}/3...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (attempt >= 3) throw err;
    }
  }
  return [];
}

export async function fetchMessageContent(token: string, messageId: string): Promise<string> {
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Failed to fetch message: ${res.status}`);
  const data = await res.json();
  let content: string = "";
  if (typeof data.text === 'string' && data.text.length > 0) {
    content = data.text;
  } else if (data.html) {
    if (Array.isArray(data.html)) {
      content = data.html.join("\n");
    } else if (typeof data.html === 'string') {
      content = data.html;
    } else {
      content = JSON.stringify(data.html);
    }
  }
  console.log(`[Mail] Content length: ${content.length}, preview: ${content.substring(0, 200)}`);
  return content;
}

export async function pollForVerificationCode(token: string, maxAttempts: number = 30, intervalMs: number = 3000): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`[Mail] Polling for verification email... attempt ${i + 1}/${maxAttempts}`);
    try {
      const messages = await fetchMessages(token);

      if (messages.length > 0) {
        const latestId = messages[0].id;
        const content = await fetchMessageContent(token, latestId);
        console.log(`[Mail] Got email with subject: ${messages[0].subject}`);

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
    } catch (err: any) {
      console.log(`[Mail] Poll error (attempt ${i + 1}): ${err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.log("[Mail] Timed out waiting for verification email");
  return null;
}

export async function pollForDrawConfirmation(token: string, maxAttempts: number = 20, intervalMs: number = 5000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`[Mail] Polling for draw confirmation email... attempt ${i + 1}/${maxAttempts}`);
    try {
      const messages = await fetchMessages(token);
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

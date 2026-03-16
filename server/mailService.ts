const BASE_URL = "https://api.mail.tm";

export async function getAvailableDomain(): Promise<string> {
  const res = await fetch(`${BASE_URL}/domains`);
  if (!res.ok) throw new Error(`Failed to get domains: ${res.status}`);
  const data = await res.json();
  const members = data["hydra:member"];
  if (!members || members.length === 0) throw new Error("No domains available");
  return members[0].domain;
}

export async function createTempEmail(address: string, password: string): Promise<{ id: string; address: string }> {
  const res = await fetch(`${BASE_URL}/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create email account: ${res.status} - ${text}`);
  }
  return res.json();
}

export async function getAuthToken(address: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get token: ${res.status} - ${text}`);
  }
  const data = await res.json();
  return data.token;
}

export async function fetchMessages(token: string): Promise<any[]> {
  const res = await fetch(`${BASE_URL}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`);
  const data = await res.json();
  return data["hydra:member"] || [];
}

export async function fetchMessageContent(token: string, messageId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` },
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

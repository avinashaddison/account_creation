import { db } from "./db";
import { sql } from "drizzle-orm";

const BASE_URL = "https://5sim.net/v1";

async function getFivesimApiKey(): Promise<string> {
  const result = await db.execute(sql`SELECT value FROM settings WHERE key = 'fivesim_api_key'`);
  return result.rows.length > 0 ? (result.rows[0].value as string) : "";
}

export interface FivesimOrderResult {
  success: boolean;
  id?: number;
  phone?: string;
  operator?: string;
  product?: string;
  price?: number;
  country?: string;
  error?: string;
}

export interface FivesimCheckResult {
  status: "pending" | "received" | "finished" | "canceled" | "timeout" | "banned" | "error";
  code?: string;
  fullSms?: string;
}

export async function getFivesimBalance(): Promise<{ balance: string; configured: boolean; error?: string }> {
  const apiKey = await getFivesimApiKey();
  if (!apiKey) return { balance: "0", configured: false, error: "5sim API key not configured" };

  try {
    const res = await fetch(`${BASE_URL}/user/profile`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await res.json() as any;
    if (data.balance !== undefined) {
      return { balance: String(parseFloat(data.balance).toFixed(2)), configured: true };
    }
    return { balance: "0", configured: true, error: data.message || "Unknown error" };
  } catch (err: any) {
    console.log("[5sim] Balance check error:", err.message);
    return { balance: "0", configured: true, error: err.message };
  }
}

// Buy a number for a product. country = "usa", operator = "any", product = "ticketmaster"
export async function orderFivesimNumber(
  country: string = "usa",
  product: string = "ticketmaster",
  operator: string = "any"
): Promise<FivesimOrderResult> {
  const apiKey = await getFivesimApiKey();
  if (!apiKey) return { success: false, error: "5sim API key not configured" };

  try {
    console.log(`[5sim] Ordering number: country=${country} product=${product} operator=${operator}`);
    const res = await fetch(`${BASE_URL}/user/buy/activation/${country}/${operator}/${product}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });

    const data = await res.json() as any;
    console.log("[5sim] Order response:", JSON.stringify(data).substring(0, 300));

    if (data.id && data.phone) {
      return {
        success: true,
        id: data.id,
        phone: data.phone,
        operator: data.operator,
        product: data.product,
        price: data.price,
        country: data.country,
      };
    }

    return { success: false, error: data.message || data.detail || JSON.stringify(data).substring(0, 100) };
  } catch (err: any) {
    console.log("[5sim] Order error:", err.message);
    return { success: false, error: err.message };
  }
}

// Check SMS status for an order
export async function checkFivesimSMS(id: number): Promise<FivesimCheckResult> {
  const apiKey = await getFivesimApiKey();
  if (!apiKey) return { status: "error" };

  try {
    const res = await fetch(`${BASE_URL}/user/check/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });

    const data = await res.json() as any;
    const rawStatus = (data.status || "").toUpperCase();

    if (rawStatus === "RECEIVED" || rawStatus === "FINISHED") {
      const smsArr = data.sms;
      if (smsArr && smsArr.length > 0) {
        const latest = smsArr[smsArr.length - 1];
        const code = latest.code || extractCode(latest.text || "");
        return { status: "received", code, fullSms: latest.text };
      }
    }

    if (rawStatus === "CANCELED") return { status: "canceled" };
    if (rawStatus === "TIMEOUT") return { status: "timeout" };
    if (rawStatus === "BANNED") return { status: "banned" };

    return { status: "pending" };
  } catch (err: any) {
    console.log("[5sim] Check error:", err.message);
    return { status: "error" };
  }
}

function extractCode(smsText: string): string | undefined {
  if (!smsText) return undefined;
  const match = smsText.match(/\b(\d{4,8})\b/);
  return match ? match[1] : undefined;
}

// Poll until code arrives
export async function pollFivesimSMS(
  id: number,
  maxAttempts: number = 60,
  intervalMs: number = 3000
): Promise<string | null> {
  console.log(`[5sim] Polling for SMS code (id: ${id}), max ${maxAttempts} attempts...`);

  for (let i = 0; i < maxAttempts; i++) {
    const result = await checkFivesimSMS(id);

    if (result.code) {
      console.log(`[5sim] Got SMS code: ${result.code} (attempt ${i + 1})`);
      await finishFivesimOrder(id);
      return result.code;
    }

    if (result.status === "canceled" || result.status === "timeout" || result.status === "banned") {
      console.log(`[5sim] Order ${id} ended with status: ${result.status}`);
      return null;
    }

    if (i % 10 === 0 && i > 0) {
      console.log(`[5sim] Still waiting for SMS code (attempt ${i + 1}/${maxAttempts})...`);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  console.log("[5sim] Timed out waiting for SMS code");
  await cancelFivesimOrder(id);
  return null;
}

export async function cancelFivesimOrder(id: number): Promise<boolean> {
  const apiKey = await getFivesimApiKey();
  if (!apiKey) return false;

  try {
    const res = await fetch(`${BASE_URL}/user/cancel/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await res.json() as any;
    console.log(`[5sim] Cancel ${id}:`, JSON.stringify(data).substring(0, 100));
    return true;
  } catch (err: any) {
    console.log("[5sim] Cancel error:", err.message);
    return false;
  }
}

export async function finishFivesimOrder(id: number): Promise<boolean> {
  const apiKey = await getFivesimApiKey();
  if (!apiKey) return false;

  try {
    const res = await fetch(`${BASE_URL}/user/finish/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await res.json() as any;
    console.log(`[5sim] Finish ${id}:`, JSON.stringify(data).substring(0, 100));
    return true;
  } catch (err: any) {
    console.log("[5sim] Finish error:", err.message);
    return false;
  }
}

export async function isFivesimConfigured(): Promise<boolean> {
  const key = await getFivesimApiKey();
  return !!key;
}

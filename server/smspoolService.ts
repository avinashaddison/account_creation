const SMSPOOL_API_KEY = process.env.SMSPOOL_API_KEY || "";
const SMSPOOL_BASE_URL = "https://api.smspool.net";

interface OrderSMSResponse {
  success: boolean;
  number?: string;
  orderId?: string;
  expiresIn?: number;
  error?: string;
}

interface CheckSMSResponse {
  status: string;
  code?: string;
  fullCode?: string;
  number?: string;
}

export async function getSMSPoolBalance(): Promise<{ balance: string; configured: boolean; error?: string }> {
  if (!SMSPOOL_API_KEY) {
    return { balance: "0", configured: false, error: "SMSPOOL_API_KEY not configured" };
  }
  try {
    const res = await fetch(`${SMSPOOL_BASE_URL}/request/balance`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `key=${SMSPOOL_API_KEY}`,
    });
    const data = await res.json() as any;
    if (data.balance !== undefined) {
      return { balance: String(data.balance), configured: true };
    }
    return { balance: "0", configured: true, error: data.message || "Unknown error" };
  } catch (err: any) {
    console.log("[SMSPool] Balance check error:", err.message);
    return { balance: "0", configured: true, error: err.message };
  }
}

export async function orderSMSNumber(
  country: number = 1,
  service: string = "Ticketmaster",
  pool: string = "1"
): Promise<OrderSMSResponse> {
  if (!SMSPOOL_API_KEY) {
    return { success: false, error: "SMSPOOL_API_KEY not configured" };
  }

  try {
    console.log(`[SMSPool] Ordering SMS number for ${service} in country ${country} (pool ${pool})...`);
    const params = new URLSearchParams({
      key: SMSPOOL_API_KEY,
      country: String(country),
      service: service,
      pool: pool,
    });

    const res = await fetch(`${SMSPOOL_BASE_URL}/purchase/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json() as any;
    console.log("[SMSPool] Order response:", JSON.stringify(data));

    if (data.success === 1 || data.order_id) {
      return {
        success: true,
        number: String(data.phonenumber || data.number),
        orderId: data.order_id || data.orderid,
        expiresIn: data.expires_in,
      };
    }

    return { success: false, error: data.message || "Failed to order SMS number" };
  } catch (err: any) {
    console.log("[SMSPool] Order error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function checkSMSCode(orderId: string): Promise<CheckSMSResponse> {
  try {
    const params = new URLSearchParams({
      key: SMSPOOL_API_KEY,
      orderid: orderId,
    });

    const res = await fetch(`${SMSPOOL_BASE_URL}/sms/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json() as any;

    if (data.status === 3 || data.sms) {
      const smsCode = extractCodeFromSMS(data.sms || data.full_code || data.code || "");
      return {
        status: "completed",
        code: smsCode || data.code,
        fullCode: data.sms || data.full_code,
        number: data.phonenumber,
      };
    }

    return {
      status: data.status === 1 ? "pending" : data.status === 2 ? "expired" : String(data.status),
      number: data.phonenumber,
    };
  } catch (err: any) {
    console.log("[SMSPool] Check SMS error:", err.message);
    return { status: "error" };
  }
}

function extractCodeFromSMS(smsText: string): string | null {
  if (!smsText) return null;
  const match = smsText.match(/\b(\d{4,8})\b/);
  return match ? match[1] : null;
}

export async function pollForSMSCode(
  orderId: string,
  maxAttempts: number = 60,
  intervalMs: number = 3000
): Promise<string | null> {
  console.log(`[SMSPool] Polling for SMS code (order: ${orderId}), max ${maxAttempts} attempts...`);

  for (let i = 0; i < maxAttempts; i++) {
    const result = await checkSMSCode(orderId);

    if (result.code) {
      console.log(`[SMSPool] Got SMS code: ${result.code} (attempt ${i + 1})`);
      return result.code;
    }

    if (result.status === "expired" || result.status === "6") {
      console.log("[SMSPool] Order expired");
      return null;
    }

    if (i % 10 === 0 && i > 0) {
      console.log(`[SMSPool] Still waiting for SMS code (attempt ${i + 1}/${maxAttempts})...`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.log("[SMSPool] Timed out waiting for SMS code");
  return null;
}

export async function cancelSMSOrder(orderId: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      key: SMSPOOL_API_KEY,
      orderid: orderId,
    });

    const res = await fetch(`${SMSPOOL_BASE_URL}/sms/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json() as any;
    console.log("[SMSPool] Cancel response:", JSON.stringify(data));
    return data.success === 1;
  } catch (err: any) {
    console.log("[SMSPool] Cancel error:", err.message);
    return false;
  }
}

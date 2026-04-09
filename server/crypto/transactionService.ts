import { logger } from "./logger";

export interface BinanceTransaction {
  transactionId: string;
  amount:        string;   // exact string e.g. "20.00000000"
  asset:         string;   // e.g. "USDT"
  note:          string;   // memo / note provided by sender
  timestamp:     number;   // Unix ms
  fromUid?:      string;   // sender Binance UID (optional)
  status:        "SUCCESS" | "PROCESSING" | "FAILED";
}

/**
 * Fetch recent incoming transactions from Binance.
 *
 * MOCK implementation — replace the body of this function with real Binance API
 * calls when credentials are available.
 *
 * Real Binance Pay history endpoint:
 *   POST https://bpay.binanceapi.com/binancepay/openapi/v2/mgs/query
 *   Headers: BinancePay-Timestamp, BinancePay-Nonce, BinancePay-Signature, BinancePay-Certificate-SN
 *   Body: { merchantId, startTime, endTime }
 *
 * Alternatively for spot/deposit tracking:
 *   GET https://api.binance.com/sapi/v1/pay/transactions
 *   Signed with API key + secret
 */
export async function getRecentTransactions(
  lookbackMinutes = 60
): Promise<BinanceTransaction[]> {
  const BINANCE_API_KEY    = process.env.BINANCE_API_KEY;
  const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;

  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    logger.debug("TransactionService", "No Binance API keys — returning mock transactions");
    return getMockTransactions();
  }

  // ── Real Binance Pay history integration ──────────────────────────────────
  // Uncomment and complete when you have Binance Pay merchant credentials:
  //
  // const now       = Date.now();
  // const startTime = now - lookbackMinutes * 60 * 1000;
  // const nonce     = crypto.randomUUID().replace(/-/g, "");
  // const timestamp = now.toString();
  // const payload   = JSON.stringify({ startTime, endTime: now, limit: 100 });
  // const signature = createHmac("sha512", BINANCE_API_SECRET)
  //   .update(timestamp + "\n" + nonce + "\n" + payload + "\n")
  //   .digest("hex").toUpperCase();
  //
  // const res = await fetch("https://bpay.binanceapi.com/binancepay/openapi/v2/mgs/query", {
  //   method:  "POST",
  //   headers: {
  //     "Content-Type":             "application/json",
  //     "BinancePay-Timestamp":     timestamp,
  //     "BinancePay-Nonce":         nonce,
  //     "BinancePay-Signature":     signature,
  //     "BinancePay-Certificate-SN": BINANCE_API_KEY,
  //   },
  //   body: payload,
  // });
  // const json = await res.json();
  // return mapBinancePayResponse(json);
  // ─────────────────────────────────────────────────────────────────────────

  logger.debug("TransactionService", "Binance API keys present but real integration not active — returning mock");
  return getMockTransactions();
}

function getMockTransactions(): BinanceTransaction[] {
  return [];
}

export function mapBinanceTransactionAmount(raw: string): string {
  return parseFloat(raw).toFixed(8);
}

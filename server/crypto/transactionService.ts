import { createHmac } from "crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import { logger } from "./logger";

export interface BinanceTransaction {
  transactionId: string;
  amount:        string;   // exact string e.g. "20.00000000"
  asset:         string;   // e.g. "USDT"
  note:          string;   // remarks / memo provided by sender
  timestamp:     number;   // Unix ms
  fromUid?:      string;   // sender Binance UID (optional)
  status:        "SUCCESS" | "PROCESSING" | "FAILED";
}

const BINANCE_API_BASE = "https://api.binance.com";

/**
 * Fetch recent incoming Binance Pay transactions.
 *
 * Uses: GET /sapi/v1/pay/transactions
 * Signed with HMAC-SHA256 using your API Key + Secret.
 * Requires "Enable Reading" permission on the API key.
 *
 * Falls back to empty array on error so the checker loop never crashes.
 */
export async function getRecentTransactions(
  lookbackMinutes = 60
): Promise<BinanceTransaction[]> {
  const apiKey    = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !apiSecret) {
    logger.debug("TransactionService", "Binance API keys not configured — returning empty");
    return [];
  }

  try {
    const now       = Date.now();
    const startTime = now - lookbackMinutes * 60 * 1000;

    const params = new URLSearchParams({
      startTime:   startTime.toString(),
      endTime:     now.toString(),
      limit:       "100",
      timestamp:   now.toString(),
    });

    const signature = createHmac("sha256", apiSecret)
      .update(params.toString())
      .digest("hex");

    params.append("signature", signature);

    const proxyUrl = process.env.BINANCE_PROXY_URL;
    const fetchOpts: RequestInit & { agent?: unknown } = {
      headers: { "X-MBX-APIKEY": apiKey },
    };
    if (proxyUrl) {
      fetchOpts.agent = new HttpsProxyAgent(proxyUrl);
      logger.debug("TransactionService", "Using proxy for Binance API", { proxy: proxyUrl.replace(/:[^:@]+@/, ":***@") });
    }

    const res = await fetch(`${BINANCE_API_BASE}/sapi/v1/pay/transactions?${params}`, fetchOpts);

    const rawText = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(rawText);
    } catch {
      logger.error("TransactionService", "Binance API non-JSON response", {
        httpStatus: res.status,
        body:       rawText.slice(0, 500),
      });
      return [];
    }

    // HTTP 451 = geo-blocked (Binance.com blocks US-based servers)
    if (res.status === 451) {
      logger.warn("TransactionService",
        "Binance API geo-blocked (HTTP 451) — Binance.com is unavailable from US servers. " +
        "Deploy to a non-US server or use a proxy to enable live transaction fetching."
      );
      return [];
    }

    // Binance Pay uses "000000" (string); spot API uses 0 or negative numbers
    const code    = json["code"];
    const success = code === "000000" || code === 0 || code === "0";

    if (!success) {
      const errMsg = json["message"] ?? json["msg"] ?? "(no message)";
      logger.error("TransactionService", "Binance API error", {
        httpStatus: res.status,
        code,
        message:    errMsg,
        hint:       code === -2015 || code === "-2015"
          ? "Invalid API key, IP not whitelisted, or missing Pay permissions"
          : undefined,
      });
      return [];
    }

    const data = (json["data"] as RawBinanceTx[] | undefined) ?? [];
    const txs  = data.map(mapTx).filter(Boolean) as BinanceTransaction[];
    logger.info("TransactionService", `Fetched ${txs.length} transaction(s) from Binance`, {
      httpStatus: res.status,
    });
    return txs;

  } catch (err: unknown) {
    logger.error("TransactionService", "Failed to fetch Binance transactions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

interface RawBinanceTx {
  transId:         string;
  orderAmount:     string;
  currency:        string;
  transactionTime: number;
  status:          string;
  remarks?:        string;
  note?:           string;
  memo?:           string;
  payerInfo?: {
    binanceId?: string;
    accountId?: string;
  };
}

function mapTx(tx: RawBinanceTx): BinanceTransaction | null {
  if (!tx.transId || !tx.orderAmount) return null;

  const status = tx.status === "SUCCESS" ? "SUCCESS"
               : tx.status === "PROCESSING" ? "PROCESSING"
               : "FAILED";

  return {
    transactionId: tx.transId,
    amount:        parseFloat(tx.orderAmount).toFixed(8),
    asset:         tx.currency ?? "USDT",
    note:          tx.remarks ?? tx.note ?? tx.memo ?? "",
    timestamp:     tx.transactionTime,
    fromUid:       tx.payerInfo?.binanceId ?? tx.payerInfo?.accountId,
    status,
  };
}

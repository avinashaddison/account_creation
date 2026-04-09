import { createHmac } from "crypto";
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

    const res = await fetch(`${BINANCE_API_BASE}/sapi/v1/pay/transactions?${params}`, {
      headers: { "X-MBX-APIKEY": apiKey },
    });

    const json = await res.json() as {
      code:    string;
      message: string;
      data?:   RawBinanceTx[];
    };

    if (json.code !== "000000") {
      logger.error("TransactionService", "Binance API returned error", {
        code:    json.code,
        message: json.message,
      });
      return [];
    }

    const txs = (json.data ?? []).map(mapTx).filter(Boolean) as BinanceTransaction[];
    logger.debug("TransactionService", `Fetched ${txs.length} transaction(s) from Binance`);
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

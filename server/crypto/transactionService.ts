import { createHmac }    from "crypto";
import https              from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { logger }          from "./logger";

/** Minimal GET helper that works with or without a proxy agent. */
function httpsGet(url: string, headers: Record<string, string>, agent?: https.AgentOptions | any): Promise<{ status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts: https.RequestOptions = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers,
      method:   "GET",
      ...(agent ? { agent } : {}),
    };
    const req = https.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode ?? 0,
          text:   () => Promise.resolve(body),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

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

    const proxyUrl  = process.env.BINANCE_PROXY_URL;
    let proxyAgent: any | undefined;
    if (proxyUrl) {
      const isSocks = proxyUrl.startsWith("socks5://") || proxyUrl.startsWith("socks4://") || proxyUrl.startsWith("socks://");
      proxyAgent = isSocks ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
      logger.debug("TransactionService", `Using ${isSocks ? "SOCKS" : "HTTP"} proxy for Binance API`, {
        proxy: proxyUrl.replace(/:[^:@]+@/, ":***@"),
      });
    }

    const res = await httpsGet(
      `${BINANCE_API_BASE}/sapi/v1/pay/transactions?${params}`,
      { "X-MBX-APIKEY": apiKey },
      proxyAgent
    );

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
  transactionId:   string;
  amount:          string;   // negative = outgoing, positive = incoming
  currency:        string;
  transactionTime: number;
  note?:           string;   // memo/note provided by sender
  orderType?:      string;
  payerInfo?: {
    binanceId?: number | string;
    accountId?: number | string;
  };
  receiverInfo?: {
    binanceId?: number | string;
    accountId?: number | string;
  };
}

function mapTx(tx: RawBinanceTx): BinanceTransaction | null {
  if (!tx.transactionId || tx.amount === undefined) return null;

  // Only track INCOMING payments (positive amount = someone paid us)
  if (parseFloat(tx.amount) <= 0) return null;

  return {
    transactionId: tx.transactionId,
    amount:        parseFloat(tx.amount).toFixed(8),
    asset:         tx.currency ?? "USDT",
    note:          tx.note ?? "",
    timestamp:     tx.transactionTime,
    fromUid:       String(tx.payerInfo?.binanceId ?? tx.payerInfo?.accountId ?? ""),
    status:        "SUCCESS", // only completed txs appear in Pay history
  };
}

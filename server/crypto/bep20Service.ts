import { logger } from "./logger";

const BEP20_ADDRESS  = "0x107fc554bba4cadd5c4e9f1e189d7dd93770202e";
const USDT_CONTRACT  = "0x55d398326f99059fF775485246999027B3197955";
const BSCSCAN_API    = "https://api.bscscan.com/api";
const FETCH_LIMIT    = 50;
const USDT_DECIMALS  = 18;

export interface Bep20Transaction {
  transactionId: string;
  from:          string;
  to:            string;
  amount:        number; // in USDT (human-readable)
  timestamp:     number; // Unix ms
}

export async function getRecentBep20Transactions(): Promise<Bep20Transaction[]> {
  const url = `${BSCSCAN_API}?module=account&action=tokentx` +
    `&contractaddress=${USDT_CONTRACT}` +
    `&address=${BEP20_ADDRESS}` +
    `&sort=desc&offset=${FETCH_LIMIT}&page=1`;

  logger.debug("Bep20Service", "Fetching BEP20 USDT transactions", { address: BEP20_ADDRESS });

  const res = await fetch(url, { headers: { "Accept": "application/json" } });

  if (!res.ok) {
    logger.error("Bep20Service", "BSCScan API error", { status: res.status });
    return [];
  }

  const json = await res.json() as {
    status:  string;
    message: string;
    result:  Array<{
      hash:         string;
      from:         string;
      to:           string;
      value:        string;
      tokenDecimal: string;
      timeStamp:    string;
    }> | string; // BSCScan returns string "No transactions found" when empty
  };

  if (json.status !== "1" || !Array.isArray(json.result)) {
    logger.debug("Bep20Service", "No BEP20 transactions or API limit", { message: json.message });
    return [];
  }

  const txs: Bep20Transaction[] = (json.result)
    .filter(tx => tx.to.toLowerCase() === BEP20_ADDRESS.toLowerCase())
    .map(tx => {
      const decimals = parseInt(tx.tokenDecimal, 10) || USDT_DECIMALS;
      const amount   = parseInt(tx.value, 10) / Math.pow(10, decimals);
      return {
        transactionId: tx.hash,
        from:          tx.from,
        to:            tx.to,
        amount,
        timestamp:     parseInt(tx.timeStamp, 10) * 1000, // Convert to ms
      };
    });

  logger.info("Bep20Service", `Fetched ${txs.length} incoming BEP20 USDT transaction(s)`);
  return txs;
}

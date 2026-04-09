import { logger } from "./logger";

const TRC20_ADDRESS    = "TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB";
const USDT_CONTRACT    = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TRONGRID_API     = "https://api.trongrid.io";
const FETCH_LIMIT      = 50;
const USDT_DECIMALS    = 6;

export interface Trc20Transaction {
  transactionId: string;
  from:          string;
  to:            string;
  amount:        number; // in USDT (human-readable)
  timestamp:     number; // Unix ms
}

export async function getRecentTrc20Transactions(): Promise<Trc20Transaction[]> {
  const url = `${TRONGRID_API}/v1/accounts/${TRC20_ADDRESS}/transactions/trc20` +
    `?contract_address=${USDT_CONTRACT}&only_confirmed=true&limit=${FETCH_LIMIT}`;

  logger.debug("Trc20Service", "Fetching TRC20 USDT transactions", { address: TRC20_ADDRESS });

  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    logger.error("Trc20Service", "TronGrid API error", { status: res.status });
    return [];
  }

  const json = await res.json() as {
    data?: Array<{
      transaction_id:  string;
      from:            string;
      to:              string;
      value:           string;
      block_timestamp: number;
      token_info?:     { decimals?: number };
    }>;
  };

  const txs: Trc20Transaction[] = (json.data ?? [])
    .filter(tx => tx.to.toLowerCase() === TRC20_ADDRESS.toLowerCase())
    .map(tx => {
      const decimals = tx.token_info?.decimals ?? USDT_DECIMALS;
      const amount   = parseInt(tx.value, 10) / Math.pow(10, decimals);
      return {
        transactionId: tx.transaction_id,
        from:          tx.from,
        to:            tx.to,
        amount,
        timestamp:     tx.block_timestamp,
      };
    });

  logger.info("Trc20Service", `Fetched ${txs.length} incoming TRC20 USDT transaction(s)`);
  return txs;
}

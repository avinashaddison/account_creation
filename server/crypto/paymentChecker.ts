import { getPendingOrders, expireStaleOrders, isTransactionUsed } from "./database";
import { getRecentTransactions }    from "./transactionService";
import { matchAllPendingOrders }    from "./matchingService";
import { getRecentTrc20Transactions } from "./trc20Service";
import { getRecentBep20Transactions } from "./bep20Service";
import { fulfillOrder }             from "./orderService";
import { logger }                   from "./logger";
import type { CryptoOrder }         from "@shared/schema";

const CHECK_INTERVAL_MS  = 25_000; // 25 seconds
const AMOUNT_TOLERANCE   = 0.005;  // ±0.005 USDT for on-chain matching
let   checkerRunning     = false;
let   intervalHandle: ReturnType<typeof setInterval> | null = null;

// ── On-chain matching (no note field — match by amount + time window) ─────────
async function matchOnChainOrders(
  orders: CryptoOrder[],
  transactions: Array<{ transactionId: string; amount: number; timestamp: number }>,
): Promise<Map<string, string>> {
  const results   = new Map<string, string>();
  const usedTxIds = new Set<string>();

  for (const order of orders) {
    const orderAmount  = parseFloat(order.amount);
    const orderCreated = order.createdAt.getTime();

    for (const tx of transactions) {
      if (usedTxIds.has(tx.transactionId)) continue;
      if (Math.abs(tx.amount - orderAmount) > AMOUNT_TOLERANCE) continue;
      if (tx.timestamp < orderCreated) continue; // tx must arrive after order

      const alreadyUsed = await isTransactionUsed(tx.transactionId);
      if (alreadyUsed) {
        logger.warn("PaymentChecker", "On-chain: duplicate tx skipped", {
          transactionId: tx.transactionId,
        });
        continue;
      }

      logger.info("PaymentChecker", "On-chain match found", {
        orderId:       order.orderId,
        transactionId: tx.transactionId,
        amount:        tx.amount,
        chain:         order.chain,
      });
      results.set(order.orderId, tx.transactionId);
      usedTxIds.add(tx.transactionId);
      break;
    }
  }
  return results;
}

// ── Main checker cycle ────────────────────────────────────────────────────────
async function runCheckerCycle(): Promise<void> {
  try {
    const expired = await expireStaleOrders();
    if (expired > 0) logger.info("PaymentChecker", `Expired ${expired} stale order(s)`);

    const pending = await getPendingOrders();
    if (pending.length === 0) return;

    logger.debug("PaymentChecker", `Scanning ${pending.length} pending order(s)`);

    // Separate by chain
    const binanceOrders = pending.filter(o => (o.chain ?? "BINANCE_PAY") === "BINANCE_PAY");
    const trc20Orders   = pending.filter(o => o.chain === "TRC20");
    const bep20Orders   = pending.filter(o => o.chain === "BEP20");

    const allMatches = new Map<string, string>();
    const orderMap   = new Map(pending.map(o => [o.orderId, o]));

    // ── Binance Pay ──────────────────────────────────────────────────────────
    if (binanceOrders.length > 0) {
      const transactions = await getRecentTransactions();
      if (transactions.length > 0) {
        const matches = await matchAllPendingOrders(binanceOrders, transactions);
        matches.forEach((txId, orderId) => allMatches.set(orderId, txId));
      }
    }

    // ── TRC20 ────────────────────────────────────────────────────────────────
    if (trc20Orders.length > 0) {
      const txs = await getRecentTrc20Transactions();
      if (txs.length > 0) {
        const matches = await matchOnChainOrders(trc20Orders, txs);
        matches.forEach((txId, orderId) => allMatches.set(orderId, txId));
      }
    }

    // ── BEP20 ────────────────────────────────────────────────────────────────
    if (bep20Orders.length > 0) {
      const txs = await getRecentBep20Transactions();
      if (txs.length > 0) {
        const matches = await matchOnChainOrders(bep20Orders, txs);
        matches.forEach((txId, orderId) => allMatches.set(orderId, txId));
      }
    }

    if (allMatches.size === 0) return;

    logger.info("PaymentChecker", `Found ${allMatches.size} payment match(es)`, {
      orders: [...allMatches.keys()],
    });

    await Promise.allSettled(
      [...allMatches.entries()].map(([orderId, transactionId]) => {
        const order = orderMap.get(orderId);
        if (!order) return Promise.resolve();
        return fulfillOrder(order, transactionId, "auto-checker").catch(err => {
          logger.error("PaymentChecker", "fulfillOrder failed", {
            orderId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }),
    );
  } catch (err: unknown) {
    logger.error("PaymentChecker", "Cycle error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startPaymentChecker(): void {
  if (checkerRunning) {
    logger.warn("PaymentChecker", "Already running — skipping duplicate start");
    return;
  }
  checkerRunning = true;
  intervalHandle = setInterval(runCheckerCycle, CHECK_INTERVAL_MS);
  logger.info("PaymentChecker", `Started — scanning every ${CHECK_INTERVAL_MS / 1000}s`);
}

export function stopPaymentChecker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle  = null;
    checkerRunning  = false;
    logger.info("PaymentChecker", "Stopped");
  }
}

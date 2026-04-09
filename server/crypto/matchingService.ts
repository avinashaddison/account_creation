import type { CryptoOrder } from "@shared/schema";
import type { BinanceTransaction } from "./transactionService";
import { isTransactionUsed } from "./database";
import { logger } from "./logger";

const AMOUNT_TOLERANCE = 0.00000001; // negligible float tolerance

export interface MatchResult {
  matched:       boolean;
  transactionId?: string;
  reason?:       string;
}

/**
 * Try to match a single pending order against a list of recent transactions.
 * Anti-fraud rules:
 *   1. Amount must match exactly (within AMOUNT_TOLERANCE)
 *   2. Note must match exactly (case-sensitive)
 *   3. Transaction must have status = SUCCESS
 *   4. Transaction must not already be claimed by another order
 */
export async function matchOrderToTransaction(
  order:        CryptoOrder,
  transactions: BinanceTransaction[],
): Promise<MatchResult> {
  const orderAmount = parseFloat(order.amount);
  const orderNote   = order.note.trim();

  for (const tx of transactions) {
    if (tx.status !== "SUCCESS") continue;

    const txAmount = parseFloat(tx.amount);
    if (Math.abs(txAmount - orderAmount) > AMOUNT_TOLERANCE) continue;
    if (tx.note.trim() !== orderNote) continue;

    const alreadyUsed = await isTransactionUsed(tx.transactionId);
    if (alreadyUsed) {
      logger.warn("MatchingService", "Duplicate transaction attempt blocked", {
        transactionId: tx.transactionId,
        orderId:       order.orderId,
      });
      continue;
    }

    logger.info("MatchingService", "Match found", {
      orderId:       order.orderId,
      transactionId: tx.transactionId,
      amount:        tx.amount,
      note:          tx.note,
    });
    return { matched: true, transactionId: tx.transactionId };
  }

  return { matched: false, reason: "No matching transaction found" };
}

/**
 * Batch-match all pending orders against transactions.
 * Returns a map of orderId → transactionId for all matches found.
 */
export async function matchAllPendingOrders(
  orders:       CryptoOrder[],
  transactions: BinanceTransaction[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const usedTxIds = new Set<string>();

  for (const order of orders) {
    const orderAmount = parseFloat(order.amount);
    const orderNote   = order.note.trim();

    for (const tx of transactions) {
      if (tx.status !== "SUCCESS")                                     continue;
      if (usedTxIds.has(tx.transactionId))                             continue;
      if (Math.abs(parseFloat(tx.amount) - orderAmount) > AMOUNT_TOLERANCE) continue;
      if (tx.note.trim() !== orderNote)                                continue;

      const alreadyUsed = await isTransactionUsed(tx.transactionId);
      if (alreadyUsed) {
        logger.warn("MatchingService", "Batch: duplicate transaction skipped", {
          transactionId: tx.transactionId,
        });
        continue;
      }

      results.set(order.orderId, tx.transactionId);
      usedTxIds.add(tx.transactionId);
      break;
    }
  }

  return results;
}

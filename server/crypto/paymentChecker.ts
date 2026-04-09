import { getPendingOrders, expireStaleOrders } from "./database";
import { getRecentTransactions }               from "./transactionService";
import { matchAllPendingOrders }               from "./matchingService";
import { fulfillOrder }                        from "./orderService";
import { logger }                              from "./logger";

const CHECK_INTERVAL_MS = 25_000; // 25 seconds
let   checkerRunning    = false;
let   intervalHandle: ReturnType<typeof setInterval> | null = null;

async function runCheckerCycle(): Promise<void> {
  try {
    const expired = await expireStaleOrders();
    if (expired > 0) logger.info("PaymentChecker", `Expired ${expired} stale order(s)`);

    const pending = await getPendingOrders();
    if (pending.length === 0) return;

    logger.debug("PaymentChecker", `Scanning ${pending.length} pending order(s)`);

    const transactions = await getRecentTransactions();
    if (transactions.length === 0) return;

    const matches = await matchAllPendingOrders(pending, transactions);
    if (matches.size === 0) return;

    logger.info("PaymentChecker", `Found ${matches.size} payment match(es)`, {
      orders: [...matches.keys()],
    });

    const orderMap = new Map(pending.map(o => [o.orderId, o]));

    await Promise.allSettled(
      [...matches.entries()].map(([orderId, transactionId]) => {
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

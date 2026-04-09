import { randomUUID }              from "crypto";
import { insertOrder, getOrderById, markOrderPaid, markOrderExpired } from "./database";
import { getRecentTransactions }   from "./transactionService";
import { matchOrderToTransaction } from "./matchingService";
import { notifyUser, buildPaymentSuccessMessage } from "./notifications";
import { logger }                  from "./logger";
import type { CryptoOrder }        from "@shared/schema";

// ── Payment-confirmed callback ─────────────────────────────────────────────────
// Register a handler (e.g. from the shop bot) to credit balance and send a
// custom confirmation message when a payment is verified.
type PaymentPaidCallback = (order: CryptoOrder) => Promise<void>;
let onPaymentPaid: PaymentPaidCallback | null = null;

export function setOnPaymentPaid(cb: PaymentPaidCallback): void {
  onPaymentPaid = cb;
}

const ORDER_EXPIRY_MINUTES = 30;

function generateNote(userId: string): string {
  const rand = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `AX-${userId}-${rand}`;
}

export interface CreateOrderInput {
  userId: string;
  amount: number;
}

export interface CreateOrderResult {
  orderId:    string;
  amount:     number;
  binanceUID: string;
  note:       string;
  expiresAt:  Date;
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const { userId, amount } = input;

  const orderId   = randomUUID();
  const note      = generateNote(userId);
  const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000);
  const binanceUID = process.env.BINANCE_UID ?? "";

  await insertOrder({
    orderId,
    userId,
    amount: amount.toFixed(8) as unknown as string,
    note,
    expiresAt,
  });

  logger.info("OrderService", "Order created", { orderId, userId, amount, note });

  return { orderId, amount, binanceUID, note, expiresAt };
}

export type CheckStatusResult =
  | { status: "PAID";    orderId: string; transactionId: string; paidAt: Date }
  | { status: "EXPIRED"; orderId: string }
  | { status: "PENDING"; orderId: string; note: string; amount: string; expiresAt: Date }
  | { status: "NOT_FOUND" };

export async function checkOrderStatus(orderId: string): Promise<CheckStatusResult> {
  const order = await getOrderById(orderId);
  if (!order) return { status: "NOT_FOUND" };

  if (order.status === "PAID") {
    return {
      status:        "PAID",
      orderId:       order.orderId,
      transactionId: order.transactionId!,
      paidAt:        order.paidAt!,
    };
  }

  if (order.status === "EXPIRED" || new Date() > order.expiresAt) {
    if (order.status !== "EXPIRED") {
      await markOrderExpired(order.orderId);
      logger.info("OrderService", "Order expired on status check", { orderId });
    }
    return { status: "EXPIRED", orderId: order.orderId };
  }

  const transactions = await getRecentTransactions();
  const match        = await matchOrderToTransaction(order, transactions);

  if (match.matched && match.transactionId) {
    return await fulfillOrder(order, match.transactionId, "check-status");
  }

  return {
    status:    "PENDING",
    orderId:   order.orderId,
    note:      order.note,
    amount:    order.amount,
    expiresAt: order.expiresAt,
  };
}

export async function fulfillOrder(
  order:         CryptoOrder,
  transactionId: string,
  trigger:       string,
): Promise<{ status: "PAID"; orderId: string; transactionId: string; paidAt: Date }> {
  const updated = await markOrderPaid(order.orderId, transactionId);

  if (!updated) {
    logger.warn("OrderService", "fulfillOrder: order already claimed (race condition)", {
      orderId: order.orderId, transactionId, trigger,
    });
  } else {
    logger.info("OrderService", "Order PAID", {
      orderId: order.orderId, transactionId, trigger, userId: order.userId,
    });

    if (onPaymentPaid) {
      // Shop bot (or other) callback — handles balance credit + custom notification
      try {
        await onPaymentPaid({ ...order, status: "PAID", transactionId, paidAt: updated!.paidAt });
      } catch (err: unknown) {
        logger.error("OrderService", "onPaymentPaid callback threw", {
          orderId: order.orderId,
          error:   err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // No callback registered — fall back to generic Telegram message
      await notifyUser(
        order.userId,
        buildPaymentSuccessMessage({
          orderId: order.orderId,
          amount:  order.amount,
          note:    order.note,
        }),
      );
    }
  }

  return {
    status:        "PAID",
    orderId:       order.orderId,
    transactionId,
    paidAt:        updated?.paidAt ?? new Date(),
  };
}

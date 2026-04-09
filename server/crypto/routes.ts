import { Router, type Request, type Response, type NextFunction } from "express";
import { z }                from "zod";
import { createOrder, checkOrderStatus } from "./orderService";
import { logger }           from "./logger";

export const cryptoRouter = Router();

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
interface RLEntry { count: number; resetAt: number }
const rlStore = new Map<string, RLEntry>();

function rateLimit(maxPerWindow: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = (req.ip ?? "unknown") + ":" + req.path;
    const now = Date.now();
    let entry = rlStore.get(key);

    if (!entry || entry.resetAt < now) {
      entry = { count: 1, resetAt: now + windowMs };
      rlStore.set(key, entry);
      return next();
    }

    entry.count++;
    if (entry.count > maxPerWindow) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.status(429).json({
        error:      "Too many requests",
        retryAfter: retryAfter,
      });
      return;
    }
    next();
  };
}

// Prune stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rlStore) {
    if (v.resetAt < now) rlStore.delete(k);
  }
}, 5 * 60 * 1000);

// ── Input validation schemas ───────────────────────────────────────────────────
const createOrderSchema = z.object({
  userId: z.string().min(1, "userId is required").max(64),
  amount: z.number().positive("amount must be > 0").max(100_000),
});

const checkStatusSchema = z.object({
  orderId: z.string().uuid("orderId must be a valid UUID"),
});

// ── POST /api/crypto/create-order ─────────────────────────────────────────────
cryptoRouter.post(
  "/create-order",
  rateLimit(10, 60_000), // 10 requests / min / IP
  async (req: Request, res: Response): Promise<void> => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const { userId, amount } = parsed.data;

    try {
      const result = await createOrder({ userId, amount });
      logger.info("Routes", "POST /create-order success", { orderId: result.orderId, userId });

      res.status(201).json({
        success:    true,
        orderId:    result.orderId,
        amount:     result.amount,
        binanceUID: result.binanceUID,
        note:       result.note,
        expiresAt:  result.expiresAt.toISOString(),
        instructions: `Send exactly ${amount} USDT to Binance ID ${result.binanceUID} with NOTE: ${result.note}`,
      });
    } catch (err: unknown) {
      logger.error("Routes", "POST /create-order error", {
        userId, amount,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to create order" });
    }
  },
);

// ── GET /api/crypto/check-status/:orderId ─────────────────────────────────────
cryptoRouter.get(
  "/check-status/:orderId",
  rateLimit(60, 60_000), // 60 requests / min / IP
  async (req: Request, res: Response): Promise<void> => {
    const parsed = checkStatusSchema.safeParse({ orderId: req.params.orderId });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid orderId", details: parsed.error.flatten() });
      return;
    }

    const { orderId } = parsed.data;

    try {
      const result = await checkOrderStatus(orderId);
      logger.info("Routes", "GET /check-status", { orderId, status: result.status });

      if (result.status === "NOT_FOUND") {
        res.status(404).json({ error: "Order not found" });
        return;
      }

      res.status(200).json({ success: true, ...result });
    } catch (err: unknown) {
      logger.error("Routes", "GET /check-status error", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Failed to check order status" });
    }
  },
);

// ── GET /api/crypto/health ─────────────────────────────────────────────────────
cryptoRouter.get("/health", (_req: Request, res: Response): void => {
  res.json({
    status:    "ok",
    service:   "crypto-payment-tracker",
    timestamp: new Date().toISOString(),
    binanceUID: process.env.BINANCE_UID ? "configured" : "not configured",
  });
});

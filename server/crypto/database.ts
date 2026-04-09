import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, lt } from "drizzle-orm";
import * as schema from "@shared/schema";
import { cryptoOrders } from "@shared/schema";
import type { CryptoOrder, InsertCryptoOrder } from "@shared/schema";
import { logger } from "./logger";

const pool = new pg.Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

export async function ensureCryptoTable(): Promise<void> {
  const client = await pool.connect();
  try {
    // Step 1: create table without chain (safe for existing tables)
    await client.query(`
      CREATE TABLE IF NOT EXISTS crypto_orders (
        id             VARCHAR  PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id       VARCHAR  NOT NULL UNIQUE,
        user_id        TEXT     NOT NULL,
        amount         NUMERIC(18, 8) NOT NULL,
        note           TEXT     NOT NULL UNIQUE,
        status         TEXT     NOT NULL DEFAULT 'PENDING',
        transaction_id TEXT     UNIQUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at     TIMESTAMPTZ NOT NULL,
        paid_at        TIMESTAMPTZ
      );
    `);
    // Step 2: add chain column if it doesn't exist yet (idempotent)
    await client.query(`
      ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'BINANCE_PAY';
    `);
    // Step 3: create indexes (all idempotent)
    await client.query(`
      CREATE INDEX IF NOT EXISTS crypto_orders_status_idx  ON crypto_orders (status);
      CREATE INDEX IF NOT EXISTS crypto_orders_note_idx    ON crypto_orders (note);
      CREATE INDEX IF NOT EXISTS crypto_orders_expires_idx ON crypto_orders (expires_at);
      CREATE INDEX IF NOT EXISTS crypto_orders_chain_idx   ON crypto_orders (chain);
    `);
    logger.info("Database", "crypto_orders table ready");
  } finally {
    client.release();
  }
}

export async function insertOrder(data: InsertCryptoOrder): Promise<CryptoOrder> {
  const [order] = await db.insert(cryptoOrders).values(data).returning();
  return order;
}

export async function getOrderById(orderId: string): Promise<CryptoOrder | null> {
  const [order] = await db.select().from(cryptoOrders)
    .where(eq(cryptoOrders.orderId, orderId));
  return order ?? null;
}

export async function getPendingOrders(): Promise<CryptoOrder[]> {
  return db.select().from(cryptoOrders)
    .where(eq(cryptoOrders.status, "PENDING"));
}

export async function markOrderPaid(
  orderId:       string,
  transactionId: string,
): Promise<CryptoOrder | null> {
  const [updated] = await db.update(cryptoOrders)
    .set({ status: "PAID", transactionId, paidAt: new Date() })
    .where(and(
      eq(cryptoOrders.orderId, orderId),
      eq(cryptoOrders.status,  "PENDING"),
    ))
    .returning();
  return updated ?? null;
}

export async function markOrderExpired(orderId: string): Promise<void> {
  await db.update(cryptoOrders)
    .set({ status: "EXPIRED" })
    .where(and(
      eq(cryptoOrders.orderId, orderId),
      eq(cryptoOrders.status,  "PENDING"),
    ));
}

export async function expireStaleOrders(): Promise<number> {
  const result = await db.update(cryptoOrders)
    .set({ status: "EXPIRED" })
    .where(and(
      eq(cryptoOrders.status, "PENDING"),
      lt(cryptoOrders.expiresAt, new Date()),
    ))
    .returning({ orderId: cryptoOrders.orderId });
  return result.length;
}

export async function isTransactionUsed(transactionId: string): Promise<boolean> {
  const [row] = await db.select({ id: cryptoOrders.id }).from(cryptoOrders)
    .where(eq(cryptoOrders.transactionId, transactionId));
  return row != null;
}

import { db } from "./db";
import { users, accounts, billingRecords, paymentRequests, settings, tempEmails, privateOutlookAccounts, privateZenrowsKeys, privateGmailAccounts, tmTrackedEvents, tmAlerts, replitAccounts, lovableAccounts } from "@shared/schema";
import type { User, InsertUser, Account, InsertAccount, BillingRecord, InsertBilling, PaymentRequest, InsertPaymentRequest, TempEmail, InsertTempEmail, PrivateOutlookAccount, InsertPrivateOutlook, PrivateZenrowsKey, InsertPrivateZenrowsKey, PrivateGmailAccount, InsertPrivateGmail, TmTrackedEvent, InsertTmTrackedEvent, TmAlert, InsertTmAlert, ReplitAccount, InsertReplitAccount, LovableAccount, InsertLovableAccount } from "@shared/schema";
import { eq, desc, sql, count, and, or } from "drizzle-orm";
import pg from "pg";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserFreeAccountsUsed(id: string, count: number): Promise<void>;
  updateUserWalletBalance(id: string, balance: string): Promise<void>;
  updateUserPassword(id: string, hashedPassword: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  createAccount(data: InsertAccount): Promise<Account>;
  updateAccount(id: string, updates: Partial<Account>): Promise<Account | undefined>;
  getAccount(id: string): Promise<Account | undefined>;
  getAllAccounts(): Promise<Account[]>;
  getAccountsByOwner(ownerId: string): Promise<Account[]>;
  getAccountsByBatch(batchId: string): Promise<Account[]>;
  getAccountStats(ownerId?: string): Promise<{ total: number; verified: number; failed: number; pending: number }>;
  updateAccountUsed(id: string, isUsed: boolean): Promise<void>;
  createBillingRecord(data: InsertBilling): Promise<BillingRecord>;
  getAllBillingRecords(ownerId?: string): Promise<BillingRecord[]>;
  getBillingTotal(ownerId?: string): Promise<number>;
  createPaymentRequest(data: InsertPaymentRequest): Promise<PaymentRequest>;
  getPaymentRequestsByUser(userId: string): Promise<PaymentRequest[]>;
  getAllPaymentRequests(): Promise<PaymentRequest[]>;
  getPaymentRequest(id: string): Promise<PaymentRequest | undefined>;
  updatePaymentRequest(id: string, updates: Partial<PaymentRequest>): Promise<PaymentRequest | undefined>;
  debitWallet(userId: string, amount: number): Promise<boolean>;
  creditWallet(userId: string, amount: number): Promise<boolean>;
  approvePaymentAtomic(requestId: string): Promise<{ success: boolean; newBalance?: string; error?: string }>;
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  createTempEmail(data: InsertTempEmail): Promise<TempEmail>;
  getTempEmailsByOwner(ownerId: string): Promise<TempEmail[]>;
  getAllTempEmails(): Promise<TempEmail[]>;
  getTempEmail(id: string): Promise<TempEmail | undefined>;
  deleteTempEmail(id: string): Promise<void>;
  createPrivateOutlook(data: InsertPrivateOutlook): Promise<PrivateOutlookAccount>;
  getAllPrivateOutlooks(): Promise<PrivateOutlookAccount[]>;
  deletePrivateOutlook(id: string): Promise<void>;
  createPrivateZenrowsKey(data: InsertPrivateZenrowsKey): Promise<PrivateZenrowsKey>;
  getAllPrivateZenrowsKeys(): Promise<PrivateZenrowsKey[]>;
  deletePrivateZenrowsKey(id: string): Promise<void>;
  updatePrivateZenrowsKeyStatus(id: string, status: string): Promise<void>;
  updatePrivateOutlookStatus(id: string, status: string): Promise<void>;
  createPrivateGmail(data: InsertPrivateGmail): Promise<PrivateGmailAccount>;
  getAllPrivateGmails(): Promise<PrivateGmailAccount[]>;
  deletePrivateGmail(id: string): Promise<void>;
  updatePrivateGmailStatus(id: string, status: string): Promise<void>;
  getTmTrackedEvents(ownerId?: string): Promise<TmTrackedEvent[]>;
  getTmTrackedEventByEventId(eventId: string, ownerId?: string): Promise<TmTrackedEvent | undefined>;
  createTmTrackedEvent(data: InsertTmTrackedEvent): Promise<TmTrackedEvent>;
  updateTmTrackedEvent(id: string, updates: Partial<TmTrackedEvent>): Promise<void>;
  deleteTmTrackedEvent(id: string): Promise<void>;
  getTmAlerts(ownerId?: string, limit?: number): Promise<TmAlert[]>;
  createTmAlert(data: InsertTmAlert): Promise<TmAlert>;
  deleteTmAlertsOlderThan(days: number): Promise<void>;
  createReplitAccount(data: InsertReplitAccount): Promise<ReplitAccount>;
  getAllReplitAccounts(): Promise<ReplitAccount[]>;
  getReplitAccountsByOwner(ownerId: string): Promise<ReplitAccount[]>;
  deleteReplitAccount(id: string): Promise<void>;
  createLovableAccount(data: InsertLovableAccount): Promise<LovableAccount>;
  updateLovableAccount(id: string, data: Partial<InsertLovableAccount>): Promise<LovableAccount>;
  getAllLovableAccounts(): Promise<LovableAccount[]>;
  getLovableAccountsByOwner(ownerId: string): Promise<LovableAccount[]>;
  deleteLovableAccount(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.id));
  }

  async updateUserFreeAccountsUsed(id: string, usedCount: number): Promise<void> {
    await db.update(users).set({ freeAccountsUsed: usedCount }).where(eq(users.id, id));
  }

  async updateUserWalletBalance(id: string, balance: string): Promise<void> {
    await db.update(users).set({ walletBalance: balance }).where(eq(users.id, id));
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async createAccount(data: InsertAccount): Promise<Account> {
    const [account] = await db.insert(accounts).values(data).returning();
    return account;
  }

  async updateAccount(id: string, updates: Partial<Account>): Promise<Account | undefined> {
    const [account] = await db.update(accounts).set(updates).where(eq(accounts.id, id)).returning();
    return account;
  }

  async getAccount(id: string): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    return account;
  }

  async getAllAccounts(): Promise<Account[]> {
    return db.select().from(accounts).orderBy(desc(accounts.createdAt));
  }

  async getAccountsByOwner(ownerId: string): Promise<Account[]> {
    return db.select().from(accounts).where(eq(accounts.ownerId, ownerId)).orderBy(desc(accounts.createdAt));
  }

  async getAccountsByBatch(batchId: string): Promise<Account[]> {
    return db.select().from(accounts).where(eq(accounts.batchId, batchId)).orderBy(desc(accounts.createdAt));
  }

  async getAccountStats(ownerId?: string): Promise<{ total: number; verified: number; failed: number; pending: number }> {
    const condition = ownerId ? eq(accounts.ownerId, ownerId) : undefined;
    const [totalResult] = await db.select({ count: count() }).from(accounts).where(condition);
    const [verifiedResult] = await db.select({ count: count() }).from(accounts).where(condition ? and(condition, or(eq(accounts.status, "verified"), eq(accounts.status, "completed"))) : or(eq(accounts.status, "verified"), eq(accounts.status, "completed")));
    const [failedResult] = await db.select({ count: count() }).from(accounts).where(condition ? and(condition, eq(accounts.status, "failed")) : eq(accounts.status, "failed"));
    const total = totalResult?.count || 0;
    const verified = verifiedResult?.count || 0;
    const failed = failedResult?.count || 0;
    return { total, verified, failed, pending: total - verified - failed };
  }

  async updateAccountUsed(id: string, isUsed: boolean): Promise<void> {
    await db.update(accounts).set({ isUsed }).where(eq(accounts.id, id));
  }

  async createBillingRecord(data: InsertBilling): Promise<BillingRecord> {
    const [record] = await db.insert(billingRecords).values(data).returning();
    return record;
  }

  async getAllBillingRecords(ownerId?: string): Promise<BillingRecord[]> {
    if (ownerId) {
      return db.select().from(billingRecords).where(eq(billingRecords.ownerId, ownerId)).orderBy(desc(billingRecords.createdAt));
    }
    return db.select().from(billingRecords).orderBy(desc(billingRecords.createdAt));
  }

  async getBillingTotal(ownerId?: string): Promise<number> {
    const condition = ownerId ? eq(billingRecords.ownerId, ownerId) : undefined;
    const [result] = await db.select({ total: sql<string>`COALESCE(SUM(${billingRecords.amount}), 0)` }).from(billingRecords).where(condition);
    return parseFloat(result?.total || "0");
  }

  async createPaymentRequest(data: InsertPaymentRequest): Promise<PaymentRequest> {
    const [record] = await db.insert(paymentRequests).values(data).returning();
    return record;
  }

  async getPaymentRequestsByUser(userId: string): Promise<PaymentRequest[]> {
    return db.select().from(paymentRequests).where(eq(paymentRequests.userId, userId)).orderBy(desc(paymentRequests.createdAt));
  }

  async getAllPaymentRequests(): Promise<PaymentRequest[]> {
    return db.select().from(paymentRequests).orderBy(desc(paymentRequests.createdAt));
  }

  async getPaymentRequest(id: string): Promise<PaymentRequest | undefined> {
    const [record] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id));
    return record;
  }

  async updatePaymentRequest(id: string, updates: Partial<PaymentRequest>): Promise<PaymentRequest | undefined> {
    const [record] = await db.update(paymentRequests).set(updates).where(eq(paymentRequests.id, id)).returning();
    return record;
  }

  async debitWallet(userId: string, amount: number): Promise<boolean> {
    const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2 AND wallet_balance >= $1 RETURNING wallet_balance`,
        [amount.toFixed(2), userId]
      );
      if (res.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("COMMIT");
      return true;
    } catch {
      await client.query("ROLLBACK");
      return false;
    } finally {
      client.release();
      pool.end();
    }
  }

  async creditWallet(userId: string, amount: number): Promise<boolean> {
    const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2 RETURNING wallet_balance`,
        [amount.toFixed(2), userId]
      );
      if (res.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query("COMMIT");
      return true;
    } catch {
      await client.query("ROLLBACK");
      return false;
    } finally {
      client.release();
      pool.end();
    }
  }

  async approvePaymentAtomic(requestId: string): Promise<{ success: boolean; newBalance?: string; error?: string }> {
    const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const reqRes = await client.query(
        `SELECT * FROM payment_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [requestId]
      );
      if (reqRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return { success: false, error: "Request not found or already processed" };
      }
      const request = reqRes.rows[0];
      const balRes = await client.query(
        `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2 RETURNING wallet_balance`,
        [request.amount, request.user_id]
      );
      if (balRes.rowCount === 0) {
        await client.query("ROLLBACK");
        return { success: false, error: "User not found" };
      }
      await client.query(
        `UPDATE payment_requests SET status = 'approved', admin_note = 'Approved' WHERE id = $1`,
        [requestId]
      );
      await client.query("COMMIT");
      return { success: true, newBalance: balRes.rows[0].wallet_balance };
    } catch (err: any) {
      await client.query("ROLLBACK");
      return { success: false, error: err.message };
    } finally {
      client.release();
      pool.end();
    }
  }
  async getSetting(key: string): Promise<string | undefined> {
    const [row] = await db.select().from(settings).where(eq(settings.key, key));
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }

  async createTempEmail(data: InsertTempEmail): Promise<TempEmail> {
    const [row] = await db.insert(tempEmails).values(data).returning();
    return row;
  }

  async getTempEmailsByOwner(ownerId: string): Promise<TempEmail[]> {
    return db.select().from(tempEmails).where(eq(tempEmails.ownerId, ownerId)).orderBy(desc(tempEmails.createdAt));
  }

  async getAllTempEmails(): Promise<TempEmail[]> {
    return db.select().from(tempEmails).orderBy(desc(tempEmails.createdAt));
  }

  async getTempEmail(id: string): Promise<TempEmail | undefined> {
    const [row] = await db.select().from(tempEmails).where(eq(tempEmails.id, id));
    return row;
  }

  async deleteTempEmail(id: string): Promise<void> {
    await db.delete(tempEmails).where(eq(tempEmails.id, id));
  }

  async createPrivateOutlook(data: InsertPrivateOutlook): Promise<PrivateOutlookAccount> {
    const [row] = await db.insert(privateOutlookAccounts).values(data).returning();
    return row;
  }

  async getAllPrivateOutlooks(): Promise<PrivateOutlookAccount[]> {
    return db.select().from(privateOutlookAccounts).orderBy(desc(privateOutlookAccounts.createdAt));
  }

  async deletePrivateOutlook(id: string): Promise<void> {
    await db.delete(privateOutlookAccounts).where(eq(privateOutlookAccounts.id, id));
  }

  async updatePrivateOutlookStatus(id: string, status: string): Promise<void> {
    await db.update(privateOutlookAccounts).set({ status }).where(eq(privateOutlookAccounts.id, id));
  }

  async createPrivateZenrowsKey(data: InsertPrivateZenrowsKey): Promise<PrivateZenrowsKey> {
    const [row] = await db.insert(privateZenrowsKeys).values(data).returning();
    return row;
  }

  async getAllPrivateZenrowsKeys(): Promise<PrivateZenrowsKey[]> {
    return db.select().from(privateZenrowsKeys).orderBy(desc(privateZenrowsKeys.createdAt));
  }

  async deletePrivateZenrowsKey(id: string): Promise<void> {
    await db.delete(privateZenrowsKeys).where(eq(privateZenrowsKeys.id, id));
  }

  async updatePrivateZenrowsKeyStatus(id: string, status: string): Promise<void> {
    await db.update(privateZenrowsKeys).set({ status }).where(eq(privateZenrowsKeys.id, id));
  }

  async createPrivateGmail(data: InsertPrivateGmail): Promise<PrivateGmailAccount> {
    const [row] = await db.insert(privateGmailAccounts).values(data).returning();
    return row;
  }

  async getAllPrivateGmails(): Promise<PrivateGmailAccount[]> {
    return db.select().from(privateGmailAccounts).orderBy(desc(privateGmailAccounts.createdAt));
  }

  async deletePrivateGmail(id: string): Promise<void> {
    await db.delete(privateGmailAccounts).where(eq(privateGmailAccounts.id, id));
  }

  async updatePrivateGmailStatus(id: string, status: string): Promise<void> {
    await db.update(privateGmailAccounts).set({ status }).where(eq(privateGmailAccounts.id, id));
  }

  async getTmTrackedEvents(ownerId?: string): Promise<TmTrackedEvent[]> {
    if (ownerId) {
      return db.select().from(tmTrackedEvents).where(eq(tmTrackedEvents.ownerId, ownerId)).orderBy(desc(tmTrackedEvents.createdAt));
    }
    return db.select().from(tmTrackedEvents).orderBy(desc(tmTrackedEvents.createdAt));
  }

  async getTmTrackedEventByEventId(eventId: string, ownerId?: string): Promise<TmTrackedEvent | undefined> {
    const conditions = ownerId
      ? and(eq(tmTrackedEvents.eventId, eventId), eq(tmTrackedEvents.ownerId, ownerId))
      : eq(tmTrackedEvents.eventId, eventId);
    const [row] = await db.select().from(tmTrackedEvents).where(conditions);
    return row;
  }

  async createTmTrackedEvent(data: InsertTmTrackedEvent): Promise<TmTrackedEvent> {
    const [row] = await db.insert(tmTrackedEvents).values(data).returning();
    return row;
  }

  async updateTmTrackedEvent(id: string, updates: Partial<TmTrackedEvent>): Promise<void> {
    await db.update(tmTrackedEvents).set(updates).where(eq(tmTrackedEvents.id, id));
  }

  async deleteTmTrackedEvent(id: string): Promise<void> {
    await db.delete(tmTrackedEvents).where(eq(tmTrackedEvents.id, id));
  }

  async getTmAlerts(ownerId?: string, limit = 100): Promise<TmAlert[]> {
    if (ownerId) {
      return db.select().from(tmAlerts).where(eq(tmAlerts.ownerId, ownerId)).orderBy(desc(tmAlerts.createdAt)).limit(limit);
    }
    return db.select().from(tmAlerts).orderBy(desc(tmAlerts.createdAt)).limit(limit);
  }

  async createTmAlert(data: InsertTmAlert): Promise<TmAlert> {
    const [row] = await db.insert(tmAlerts).values(data).returning();
    return row;
  }

  async deleteTmAlertsOlderThan(days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await db.delete(tmAlerts).where(sql`${tmAlerts.createdAt} < ${cutoff}`);
  }

  async createReplitAccount(data: InsertReplitAccount): Promise<ReplitAccount> {
    const [row] = await db.insert(replitAccounts).values(data).returning();
    return row;
  }

  async getAllReplitAccounts(): Promise<ReplitAccount[]> {
    return db.select().from(replitAccounts).orderBy(desc(replitAccounts.createdAt));
  }

  async getReplitAccountsByOwner(ownerId: string): Promise<ReplitAccount[]> {
    return db.select().from(replitAccounts).where(eq(replitAccounts.createdBy, ownerId)).orderBy(desc(replitAccounts.createdAt));
  }

  async deleteReplitAccount(id: string): Promise<void> {
    await db.delete(replitAccounts).where(eq(replitAccounts.id, id));
  }

  async createLovableAccount(data: InsertLovableAccount): Promise<LovableAccount> {
    const [row] = await db.insert(lovableAccounts).values(data).returning();
    return row;
  }

  async updateLovableAccount(id: string, data: Partial<InsertLovableAccount>): Promise<LovableAccount> {
    const [row] = await db.update(lovableAccounts).set(data).where(eq(lovableAccounts.id, id)).returning();
    return row;
  }

  async getAllLovableAccounts(): Promise<LovableAccount[]> {
    return db.select().from(lovableAccounts).orderBy(desc(lovableAccounts.createdAt));
  }

  async getLovableAccountsByOwner(ownerId: string): Promise<LovableAccount[]> {
    return db.select().from(lovableAccounts).where(eq(lovableAccounts.createdBy, ownerId)).orderBy(desc(lovableAccounts.createdAt));
  }

  async deleteLovableAccount(id: string): Promise<void> {
    await db.delete(lovableAccounts).where(eq(lovableAccounts.id, id));
  }
}

export const storage = new DatabaseStorage();

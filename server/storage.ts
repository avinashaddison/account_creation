import { db } from "./db";
import { users, accounts, billingRecords, paymentRequests, settings, tempEmails, privateOutlookAccounts, privateZenrowsKeys, privateGmailAccounts, tmTrackedEvents, tmAlerts, replitAccounts, lovableAccounts, v0Accounts, savedCards, adobeAccounts, elevenLabsAccounts, chatgptAccounts, bizMailAccounts } from "@shared/schema";
import type { User, InsertUser, Account, InsertAccount, BillingRecord, InsertBilling, PaymentRequest, InsertPaymentRequest, TempEmail, InsertTempEmail, PrivateOutlookAccount, InsertPrivateOutlook, PrivateZenrowsKey, InsertPrivateZenrowsKey, PrivateGmailAccount, InsertPrivateGmail, TmTrackedEvent, InsertTmTrackedEvent, TmAlert, InsertTmAlert, ReplitAccount, InsertReplitAccount, LovableAccount, InsertLovableAccount, V0Account, InsertV0Account, SavedCard, InsertSavedCard, AdobeAccount, InsertAdobeAccount, ElevenLabsAccount, InsertElevenLabsAccount, ChatGptAccount, InsertChatGptAccount, BizMailAccount } from "@shared/schema";
import { eq, desc, sql, count, and, or, inArray, isNull, isNotNull } from "drizzle-orm";
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
  getRandomActivePrivateOutlook(): Promise<PrivateOutlookAccount | null>;
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
  getReplitAccount(id: string): Promise<ReplitAccount | undefined>;
  getReplitAccountsByOwner(ownerId: string): Promise<ReplitAccount[]>;
  deleteReplitAccount(id: string): Promise<void>;
  updateReplitAccountStatus(id: string, status: string): Promise<ReplitAccount>;
  bulkUpdateReplitAccountStatus(status: string, ids?: string[], ownerId?: string): Promise<number>;
  markReplitAccountWarmed(id: string): Promise<ReplitAccount>;
  markReplitCouponExtracted(id: string, couponCode: string): Promise<ReplitAccount>;
  setReplitCheckoutUrl(id: string, checkoutUrl: string): Promise<ReplitAccount>;
  clearReplitCheckoutUrl(id: string): Promise<ReplitAccount>;
  createLovableAccount(data: InsertLovableAccount): Promise<LovableAccount>;
  updateLovableAccount(id: string, data: Partial<InsertLovableAccount>): Promise<LovableAccount>;
  bulkUpdateLovableStatus(ids: string[], status: string): Promise<number>;
  getAllLovableAccounts(): Promise<LovableAccount[]>;
  getLovableAccountsByOwner(ownerId: string): Promise<LovableAccount[]>;
  getLovableAccountsPendingVerification(): Promise<LovableAccount[]>;
  deleteLovableAccount(id: string): Promise<void>;
  createV0Account(data: InsertV0Account): Promise<V0Account>;
  getAllV0Accounts(): Promise<V0Account[]>;
  getV0AccountsByOwner(ownerId: string): Promise<V0Account[]>;
  deleteV0Account(id: string): Promise<void>;
  createSavedCard(data: InsertSavedCard): Promise<SavedCard>;
  getSavedCardsByOwner(ownerId: string): Promise<SavedCard[]>;
  getSavedCard(id: string): Promise<SavedCard | undefined>;
  updateSavedCard(id: string, data: Partial<InsertSavedCard>): Promise<SavedCard>;
  deleteSavedCard(id: string): Promise<void>;
  createAdobeAccount(data: InsertAdobeAccount): Promise<AdobeAccount>;
  getAllAdobeAccounts(): Promise<AdobeAccount[]>;
  getAdobeAccountsByOwner(ownerId: string): Promise<AdobeAccount[]>;
  deleteAdobeAccount(id: string): Promise<void>;
  createElevenLabsAccount(data: InsertElevenLabsAccount): Promise<ElevenLabsAccount>;
  getAllElevenLabsAccounts(): Promise<ElevenLabsAccount[]>;
  getElevenLabsAccountsByOwner(ownerId: string): Promise<ElevenLabsAccount[]>;
  updateElevenLabsAccount(id: string, data: Partial<InsertElevenLabsAccount>): Promise<ElevenLabsAccount>;
  deleteElevenLabsAccount(id: string): Promise<void>;
  createChatGptAccount(data: InsertChatGptAccount): Promise<ChatGptAccount>;
  getAllChatGptAccounts(): Promise<ChatGptAccount[]>;
  getChatGptAccountsByOwner(ownerId: string): Promise<ChatGptAccount[]>;
  deleteChatGptAccount(id: string): Promise<void>;
  // Biz mail registry
  getAllBizMailAccounts(): Promise<BizMailAccount[]>;
  getUsedBizMailNums(): Promise<number[]>;
  getBizMailByNum(accountNum: number): Promise<BizMailAccount | undefined>;
  getBizMailByEmail(email: string): Promise<BizMailAccount | undefined>;
  registerBizMailAccount(accountNum: number | null, email: string, password: string): Promise<BizMailAccount>;
  markBizMailDeleted(accountNum: number): Promise<void>;
  markBizMailDeletedByEmail(email: string): Promise<void>;
  reactivateBizMailAccount(accountNum: number, password: string): Promise<void>;
  reactivateBizMailAccountByEmail(email: string, password: string): Promise<void>;
  getDeletedBizMailAccounts(): Promise<BizMailAccount[]>;
  getActiveBizMailAccounts(): Promise<BizMailAccount[]>;
  getOldestActiveBizMailAccounts(limit: number): Promise<BizMailAccount[]>;
  getUnusedBizMailForReplit(): Promise<BizMailAccount | undefined>;
  markBizMailUsedForReplit(email: string): Promise<void>;
  countUnusedBizMailForReplit(): Promise<number>;
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

  async getRandomActivePrivateOutlook(): Promise<PrivateOutlookAccount | null> {
    const rows = await db.select().from(privateOutlookAccounts)
      .where(eq(privateOutlookAccounts.status, "active"))
      .orderBy(sql`RANDOM()`)
      .limit(1);
    return rows[0] ?? null;
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

  async getReplitAccount(id: string): Promise<ReplitAccount | undefined> {
    const [row] = await db.select().from(replitAccounts).where(eq(replitAccounts.id, id));
    return row;
  }

  async getReplitAccountsByOwner(ownerId: string): Promise<ReplitAccount[]> {
    return db.select().from(replitAccounts).where(eq(replitAccounts.createdBy, ownerId)).orderBy(desc(replitAccounts.createdAt));
  }

  async deleteReplitAccount(id: string): Promise<void> {
    await db.delete(replitAccounts).where(eq(replitAccounts.id, id));
  }

  async updateReplitAccountStatus(id: string, status: string): Promise<ReplitAccount> {
    const [row] = await db.update(replitAccounts).set({ status }).where(eq(replitAccounts.id, id)).returning();
    return row;
  }

  /**
   * Atomically claims accounts for processing: sets status "generating" only on accounts
   * that are still in "processing" state at the moment of the UPDATE. Returns the IDs
   * that were actually claimed (subset of requested IDs). Any IDs already claimed by a
   * concurrent job will be absent from the returned array.
   */
  async claimReplitAccountsForProcessing(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .update(replitAccounts)
      .set({ status: "generating" })
      .where(and(inArray(replitAccounts.id, ids), eq(replitAccounts.status, "processing")))
      .returning({ id: replitAccounts.id });
    return rows.map(r => r.id);
  }

  async bulkUpdateReplitAccountStatus(status: string, ids?: string[], ownerId?: string): Promise<number> {
    let q = db.update(replitAccounts).set({ status });
    if (ids && ids.length > 0 && ownerId) {
      // Non-superadmin with specific IDs: must own every account in the list
      q = q.where(and(inArray(replitAccounts.id, ids), eq(replitAccounts.createdBy, ownerId)));
    } else if (ids && ids.length > 0) {
      // Superadmin with specific IDs: no ownership constraint
      q = q.where(inArray(replitAccounts.id, ids));
    } else if (ownerId) {
      // No IDs provided: update all accounts owned by this user
      q = q.where(eq(replitAccounts.createdBy, ownerId));
    }
    // No ids + no ownerId = superadmin "update all" (unchanged behaviour)
    const rows = await q.returning();
    return rows.length;
  }

  async markReplitAccountWarmed(id: string): Promise<ReplitAccount> {
    const [row] = await db.update(replitAccounts)
      .set({ warmedAt: new Date() })
      .where(eq(replitAccounts.id, id))
      .returning();
    return row;
  }

  async markReplitCouponExtracted(id: string, couponCode: string): Promise<ReplitAccount> {
    const [row] = await db.update(replitAccounts)
      .set({ couponExtracted: true, couponCode })
      .where(eq(replitAccounts.id, id))
      .returning();
    return row;
  }

  async setReplitCheckoutUrl(id: string, checkoutUrl: string): Promise<ReplitAccount> {
    const [row] = await db.update(replitAccounts)
      .set({ checkoutUrl })
      .where(eq(replitAccounts.id, id))
      .returning();
    return row;
  }

  async clearReplitCheckoutUrl(id: string): Promise<ReplitAccount> {
    const [row] = await db.update(replitAccounts)
      .set({ checkoutUrl: null, status: "sold_out" })
      .where(eq(replitAccounts.id, id))
      .returning();
    return row;
  }

  async createLovableAccount(data: InsertLovableAccount): Promise<LovableAccount> {
    const [row] = await db.insert(lovableAccounts).values(data).returning();
    return row;
  }

  async updateLovableAccount(id: string, data: Partial<InsertLovableAccount>): Promise<LovableAccount> {
    const [row] = await db.update(lovableAccounts).set(data).where(eq(lovableAccounts.id, id)).returning();
    return row;
  }

  async bulkUpdateLovableStatus(ids: string[], status: string): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await db
      .update(lovableAccounts)
      .set({ status } as Partial<InsertLovableAccount>)
      .where(inArray(lovableAccounts.id, ids))
      .returning({ id: lovableAccounts.id });
    return rows.length;
  }

  async getAllLovableAccounts(): Promise<LovableAccount[]> {
    return db.select().from(lovableAccounts).orderBy(desc(lovableAccounts.createdAt));
  }

  async getLovableAccountsByOwner(ownerId: string): Promise<LovableAccount[]> {
    return db.select().from(lovableAccounts).where(eq(lovableAccounts.createdBy, ownerId)).orderBy(desc(lovableAccounts.createdAt));
  }

  async getLovableAccountsPendingVerification(): Promise<LovableAccount[]> {
    return db.select().from(lovableAccounts)
      .where(eq(lovableAccounts.status, "pending_verification"))
      .orderBy(desc(lovableAccounts.createdAt));
  }

  async deleteLovableAccount(id: string): Promise<void> {
    await db.delete(lovableAccounts).where(eq(lovableAccounts.id, id));
  }

  async createV0Account(data: InsertV0Account): Promise<V0Account> {
    const [row] = await db.insert(v0Accounts).values(data).returning();
    return row;
  }

  async getAllV0Accounts(): Promise<V0Account[]> {
    return db.select().from(v0Accounts).orderBy(desc(v0Accounts.createdAt));
  }

  async getV0AccountsByOwner(ownerId: string): Promise<V0Account[]> {
    return db.select().from(v0Accounts).where(eq(v0Accounts.createdBy, ownerId)).orderBy(desc(v0Accounts.createdAt));
  }

  async deleteV0Account(id: string): Promise<void> {
    await db.delete(v0Accounts).where(eq(v0Accounts.id, id));
  }

  async createSavedCard(data: InsertSavedCard): Promise<SavedCard> {
    const [row] = await db.insert(savedCards).values(data).returning();
    return row;
  }

  async getSavedCardsByOwner(ownerId: string): Promise<SavedCard[]> {
    return db.select().from(savedCards).where(eq(savedCards.ownerId, ownerId)).orderBy(desc(savedCards.createdAt));
  }

  async getSavedCard(id: string): Promise<SavedCard | undefined> {
    const [row] = await db.select().from(savedCards).where(eq(savedCards.id, id));
    return row;
  }

  async updateSavedCard(id: string, data: Partial<InsertSavedCard>): Promise<SavedCard> {
    const [row] = await db.update(savedCards).set(data).where(eq(savedCards.id, id)).returning();
    return row;
  }

  async deleteSavedCard(id: string): Promise<void> {
    await db.delete(savedCards).where(eq(savedCards.id, id));
  }

  async createAdobeAccount(data: InsertAdobeAccount): Promise<AdobeAccount> {
    const [row] = await db.insert(adobeAccounts).values(data).returning();
    return row;
  }

  async getAllAdobeAccounts(): Promise<AdobeAccount[]> {
    return db.select().from(adobeAccounts).orderBy(desc(adobeAccounts.createdAt));
  }

  async getAdobeAccountsByOwner(ownerId: string): Promise<AdobeAccount[]> {
    return db.select().from(adobeAccounts).where(eq(adobeAccounts.createdBy, ownerId)).orderBy(desc(adobeAccounts.createdAt));
  }

  async deleteAdobeAccount(id: string): Promise<void> {
    await db.delete(adobeAccounts).where(eq(adobeAccounts.id, id));
  }

  async createElevenLabsAccount(data: InsertElevenLabsAccount): Promise<ElevenLabsAccount> {
    const [row] = await db.insert(elevenLabsAccounts).values(data).returning();
    return row;
  }

  async getAllElevenLabsAccounts(): Promise<ElevenLabsAccount[]> {
    return db.select().from(elevenLabsAccounts).orderBy(desc(elevenLabsAccounts.createdAt));
  }

  async getElevenLabsAccountsByOwner(ownerId: string): Promise<ElevenLabsAccount[]> {
    return db.select().from(elevenLabsAccounts).where(eq(elevenLabsAccounts.createdBy, ownerId)).orderBy(desc(elevenLabsAccounts.createdAt));
  }

  async updateElevenLabsAccount(id: string, data: Partial<InsertElevenLabsAccount>): Promise<ElevenLabsAccount> {
    const [row] = await db.update(elevenLabsAccounts).set(data).where(eq(elevenLabsAccounts.id, id)).returning();
    return row;
  }

  async deleteElevenLabsAccount(id: string): Promise<void> {
    await db.delete(elevenLabsAccounts).where(eq(elevenLabsAccounts.id, id));
  }

  async createChatGptAccount(data: InsertChatGptAccount): Promise<ChatGptAccount> {
    const [row] = await db.insert(chatgptAccounts).values(data).returning();
    return row;
  }

  async getAllChatGptAccounts(): Promise<ChatGptAccount[]> {
    return db.select().from(chatgptAccounts).orderBy(desc(chatgptAccounts.createdAt));
  }

  async getChatGptAccountsByOwner(ownerId: string): Promise<ChatGptAccount[]> {
    return db.select().from(chatgptAccounts).where(eq(chatgptAccounts.createdBy, ownerId)).orderBy(desc(chatgptAccounts.createdAt));
  }

  async deleteChatGptAccount(id: string): Promise<void> {
    await db.delete(chatgptAccounts).where(eq(chatgptAccounts.id, id));
  }

  async getAllBizMailAccounts(): Promise<BizMailAccount[]> {
    return db.select().from(bizMailAccounts).orderBy(bizMailAccounts.id);
  }

  async getUsedBizMailNums(): Promise<number[]> {
    const rows = await db.select({ accountNum: bizMailAccounts.accountNum }).from(bizMailAccounts);
    return rows.map(r => r.accountNum).filter((n): n is number => n !== null);
  }

  async getBizMailByNum(accountNum: number): Promise<BizMailAccount | undefined> {
    const [row] = await db.select().from(bizMailAccounts).where(eq(bizMailAccounts.accountNum, accountNum));
    return row;
  }

  async getBizMailByEmail(email: string): Promise<BizMailAccount | undefined> {
    const [row] = await db.select().from(bizMailAccounts).where(eq(bizMailAccounts.email, email));
    return row;
  }

  async registerBizMailAccount(accountNum: number | null, email: string, password: string): Promise<BizMailAccount> {
    const [row] = await db.insert(bizMailAccounts)
      .values({ accountNum, email, password, isActive: true })
      .returning();
    return row;
  }

  async markBizMailDeleted(accountNum: number): Promise<void> {
    await db.update(bizMailAccounts)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(bizMailAccounts.accountNum, accountNum));
  }

  async markBizMailDeletedByEmail(email: string): Promise<void> {
    await db.update(bizMailAccounts)
      .set({ isActive: false, deletedAt: new Date() })
      .where(eq(bizMailAccounts.email, email));
  }

  async reactivateBizMailAccount(accountNum: number, password: string): Promise<void> {
    await db.update(bizMailAccounts)
      .set({ isActive: true, deletedAt: null, password })
      .where(eq(bizMailAccounts.accountNum, accountNum));
  }

  async reactivateBizMailAccountByEmail(email: string, password: string): Promise<void> {
    await db.update(bizMailAccounts)
      .set({ isActive: true, deletedAt: null, password })
      .where(eq(bizMailAccounts.email, email));
  }

  async getDeletedBizMailAccounts(): Promise<BizMailAccount[]> {
    return db.select().from(bizMailAccounts)
      .where(isNotNull(bizMailAccounts.deletedAt))
      .orderBy(desc(bizMailAccounts.deletedAt));
  }

  async getActiveBizMailAccounts(): Promise<BizMailAccount[]> {
    return db.select().from(bizMailAccounts)
      .where(isNull(bizMailAccounts.deletedAt))
      .orderBy(bizMailAccounts.createdAt);
  }

  async getOldestActiveBizMailAccounts(limit: number): Promise<BizMailAccount[]> {
    return db.select().from(bizMailAccounts)
      .where(isNull(bizMailAccounts.deletedAt))
      .orderBy(bizMailAccounts.createdAt)
      .limit(limit);
  }

  async getUnusedBizMailForReplit(): Promise<BizMailAccount | undefined> {
    const [row] = await db.select().from(bizMailAccounts)
      .where(and(isNull(bizMailAccounts.deletedAt), eq(bizMailAccounts.usedForReplit, false), eq(bizMailAccounts.isActive, true)))
      .orderBy(bizMailAccounts.createdAt)
      .limit(1);
    return row;
  }

  async markBizMailUsedForReplit(email: string): Promise<void> {
    await db.update(bizMailAccounts)
      .set({ usedForReplit: true })
      .where(eq(bizMailAccounts.email, email));
  }

  async countUnusedBizMailForReplit(): Promise<number> {
    const rows = await db.select({ id: bizMailAccounts.id }).from(bizMailAccounts)
      .where(and(isNull(bizMailAccounts.deletedAt), eq(bizMailAccounts.usedForReplit, false), eq(bizMailAccounts.isActive, true)));
    return rows.length;
  }
}

export const storage = new DatabaseStorage();

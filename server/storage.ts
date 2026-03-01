import { db } from "./db";
import { users, accounts, billingRecords } from "@shared/schema";
import type { User, InsertUser, Account, InsertAccount, BillingRecord, InsertBilling } from "@shared/schema";
import { eq, desc, sql, count, and } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUsersByCreator(creatorId: string): Promise<User[]>;
  updateUserFreeAccountsUsed(id: string, count: number): Promise<void>;
  deleteUser(id: string): Promise<void>;
  createAccount(data: InsertAccount): Promise<Account>;
  updateAccount(id: string, updates: Partial<Account>): Promise<Account | undefined>;
  getAccount(id: string): Promise<Account | undefined>;
  getAllAccounts(): Promise<Account[]>;
  getAccountsByOwner(ownerId: string): Promise<Account[]>;
  getAccountsByBatch(batchId: string): Promise<Account[]>;
  getAccountStats(ownerId?: string): Promise<{ total: number; verified: number; failed: number; pending: number }>;
  createBillingRecord(data: InsertBilling): Promise<BillingRecord>;
  getAllBillingRecords(ownerId?: string): Promise<BillingRecord[]>;
  getBillingTotal(ownerId?: string): Promise<number>;
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

  async getUsersByCreator(creatorId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.createdBy, creatorId)).orderBy(desc(users.id));
  }

  async updateUserFreeAccountsUsed(id: string, usedCount: number): Promise<void> {
    await db.update(users).set({ freeAccountsUsed: usedCount }).where(eq(users.id, id));
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
    const [verifiedResult] = await db.select({ count: count() }).from(accounts).where(condition ? and(condition, eq(accounts.status, "verified")) : eq(accounts.status, "verified"));
    const [failedResult] = await db.select({ count: count() }).from(accounts).where(condition ? and(condition, eq(accounts.status, "failed")) : eq(accounts.status, "failed"));
    const total = totalResult?.count || 0;
    const verified = verifiedResult?.count || 0;
    const failed = failedResult?.count || 0;
    return { total, verified, failed, pending: total - verified - failed };
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
}

export const storage = new DatabaseStorage();

import { db } from "./db";
import { users, accounts, billingRecords } from "@shared/schema";
import type { User, InsertUser, Account, InsertAccount, BillingRecord, InsertBilling } from "@shared/schema";
import { eq, desc, sql, count } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createAccount(data: InsertAccount): Promise<Account>;
  updateAccount(id: string, updates: Partial<Account>): Promise<Account | undefined>;
  getAccount(id: string): Promise<Account | undefined>;
  getAllAccounts(): Promise<Account[]>;
  getAccountsByBatch(batchId: string): Promise<Account[]>;
  getAccountStats(): Promise<{ total: number; verified: number; failed: number; pending: number }>;
  createBillingRecord(data: InsertBilling): Promise<BillingRecord>;
  getAllBillingRecords(): Promise<BillingRecord[]>;
  getBillingTotal(): Promise<number>;
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
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

  async getAccountsByBatch(batchId: string): Promise<Account[]> {
    return db.select().from(accounts).where(eq(accounts.batchId, batchId)).orderBy(desc(accounts.createdAt));
  }

  async getAccountStats(): Promise<{ total: number; verified: number; failed: number; pending: number }> {
    const [totalResult] = await db.select({ count: count() }).from(accounts);
    const [verifiedResult] = await db.select({ count: count() }).from(accounts).where(eq(accounts.status, "verified"));
    const [failedResult] = await db.select({ count: count() }).from(accounts).where(eq(accounts.status, "failed"));
    const total = totalResult?.count || 0;
    const verified = verifiedResult?.count || 0;
    const failed = failedResult?.count || 0;
    return { total, verified, failed, pending: total - verified - failed };
  }

  async createBillingRecord(data: InsertBilling): Promise<BillingRecord> {
    const [record] = await db.insert(billingRecords).values(data).returning();
    return record;
  }

  async getAllBillingRecords(): Promise<BillingRecord[]> {
    return db.select().from(billingRecords).orderBy(desc(billingRecords.createdAt));
  }

  async getBillingTotal(): Promise<number> {
    const [result] = await db.select({ total: sql<string>`COALESCE(SUM(${billingRecords.amount}), 0)` }).from(billingRecords);
    return parseFloat(result?.total || "0");
  }
}

export const storage = new DatabaseStorage();

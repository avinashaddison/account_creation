import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", ["admin", "user"]);
export const accountStatusEnum = pgEnum("account_status", ["pending", "registering", "waiting_code", "verifying", "verified", "failed"]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: roleEnum("role").notNull().default("user"),
});

export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tempEmail: text("temp_email").notNull(),
  tempEmailPassword: text("temp_email_password").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  la28Password: text("la28_password").notNull(),
  country: text("country").notNull().default("India"),
  language: text("language").notNull().default("English"),
  status: accountStatusEnum("status").notNull().default("pending"),
  verificationCode: text("verification_code"),
  errorMessage: text("error_message"),
  batchId: text("batch_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const billingRecords = pgTable("billing_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull().default("0.11"),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
  role: true,
});

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
});

export const insertBillingSchema = createInsertSchema(billingRecords).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type BillingRecord = typeof billingRecords.$inferSelect;
export type InsertBilling = z.infer<typeof insertBillingSchema>;

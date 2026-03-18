import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", ["superadmin", "admin", "user"]);
export const accountStatusEnum = pgEnum("account_status", ["pending", "registering", "waiting_code", "verifying", "verified", "profile_saving", "draw_registering", "completed", "failed", "filling_form", "selecting_events", "submitting", "presale_loading", "presale_filling", "presale_events", "presale_submitting"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "approved", "rejected"]);

export const ALL_SERVICES = ["la28", "ticketmaster", "uefa", "brunomars", "outlook", "zenrows"] as const;
export type ServiceId = typeof ALL_SERVICES[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: roleEnum("role").notNull().default("admin"),
  freeAccountsUsed: integer("free_accounts_used").notNull().default(0),
  walletBalance: numeric("wallet_balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
  panelName: text("panel_name").notNull().default("Addison Panel"),
  createdBy: varchar("created_by"),
  allowedServices: text("allowed_services").array().notNull().default(sql`ARRAY['la28','ticketmaster','uefa','brunomars','outlook','zenrows']::text[]`),
});

export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("temp_email").notNull(),
  emailPassword: text("temp_email_password").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  la28Password: text("la28_password").notNull(),
  country: text("country").notNull().default("United States"),
  language: text("language").notNull().default("English"),
  status: accountStatusEnum("status").notNull().default("pending"),
  verificationCode: text("verification_code"),
  errorMessage: text("error_message"),
  batchId: text("batch_id"),
  ownerId: varchar("owner_id"),
  zipCode: text("zip_code"),
  platform: text("platform").notNull().default("la28"),
  isUsed: boolean("is_used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const billingRecords = pgTable("billing_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull().default("0.11"),
  description: text("description").notNull(),
  ownerId: varchar("owner_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const paymentRequests = pgTable("payment_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  txHash: text("tx_hash"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  adminNote: text("admin_note"),
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

export const insertPaymentRequestSchema = createInsertSchema(paymentRequests).omit({
  id: true,
  createdAt: true,
});

export const tempEmails = pgTable("temp_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  address: text("address").notNull(),
  password: text("password").notNull(),
  label: text("label"),
  ownerId: varchar("owner_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const privateOutlookAccounts = pgTable("private_outlook_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  password: text("password").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const privateZenrowsKeys = pgTable("private_zenrows_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  apiKey: text("api_key").notNull(),
  outlookEmail: text("outlook_email"),
  outlookPassword: text("outlook_password"),
  status: text("status").notNull().default("active"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const privateGmailAccounts = pgTable("private_gmail_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  password: text("password").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Setting = typeof settings.$inferSelect;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type BillingRecord = typeof billingRecords.$inferSelect;
export type InsertBilling = z.infer<typeof insertBillingSchema>;
export type PaymentRequest = typeof paymentRequests.$inferSelect;
export type InsertPaymentRequest = z.infer<typeof insertPaymentRequestSchema>;

export const insertTempEmailSchema = createInsertSchema(tempEmails).omit({
  id: true,
  createdAt: true,
});
export type TempEmail = typeof tempEmails.$inferSelect;
export type InsertTempEmail = z.infer<typeof insertTempEmailSchema>;

export const insertPrivateOutlookSchema = createInsertSchema(privateOutlookAccounts).omit({
  id: true,
  createdAt: true,
});
export type PrivateOutlookAccount = typeof privateOutlookAccounts.$inferSelect;
export type InsertPrivateOutlook = z.infer<typeof insertPrivateOutlookSchema>;

export const insertPrivateZenrowsKeySchema = createInsertSchema(privateZenrowsKeys).omit({
  id: true,
  createdAt: true,
});
export type PrivateZenrowsKey = typeof privateZenrowsKeys.$inferSelect;
export type InsertPrivateZenrowsKey = z.infer<typeof insertPrivateZenrowsKeySchema>;

export const insertPrivateGmailSchema = createInsertSchema(privateGmailAccounts).omit({
  id: true,
  createdAt: true,
});
export type PrivateGmailAccount = typeof privateGmailAccounts.$inferSelect;
export type InsertPrivateGmail = z.infer<typeof insertPrivateGmailSchema>;

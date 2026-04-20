import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, integer, serial, pgEnum, boolean, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", ["superadmin", "admin", "user"]);
export const accountStatusEnum = pgEnum("account_status", ["pending", "registering", "waiting_code", "verifying", "verified", "profile_saving", "draw_registering", "completed", "failed", "filling_form", "selecting_events", "submitting", "presale_loading", "presale_filling", "presale_events", "presale_submitting"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "approved", "rejected"]);

export const ALL_SERVICES = ["la28", "ticketmaster", "uefa", "brunomars", "outlook", "zenrows", "replit", "lovable", "v0"] as const;
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
  panelName: true,
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

export const replitAccounts = pgTable("replit_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull(),
  email: text("email").notNull(),
  password: text("password").notNull(),
  outlookEmail: text("outlook_email"),
  status: text("status").notNull().default("processing"),
  credits: text("credits"),
  error: text("error"),
  couponExtracted: boolean("coupon_extracted").notNull().default(false),
  couponCode: text("coupon_code"),
  checkoutUrl: text("checkout_url"),
  warmedAt: timestamp("warmed_at"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReplitAccountSchema = createInsertSchema(replitAccounts).omit({ id: true, createdAt: true });
export type ReplitAccount = typeof replitAccounts.$inferSelect;
export type InsertReplitAccount = z.infer<typeof insertReplitAccountSchema>;

export const lovableAccounts = pgTable("lovable_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  password: text("password"),
  outlookEmail: text("outlook_email"),
  status: text("status").notNull().default("created"),
  credits: integer("credits").default(5),
  error: text("error"),
  refreshToken: text("refresh_token"),
  firebaseUid: text("firebase_uid"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLovableAccountSchema = createInsertSchema(lovableAccounts).omit({ id: true, createdAt: true });
export type LovableAccount = typeof lovableAccounts.$inferSelect;
export type InsertLovableAccount = z.infer<typeof insertLovableAccountSchema>;

export const v0Accounts = pgTable("v0_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  password: text("password"),
  outlookEmail: text("outlook_email"),
  promoRedeemed: text("promo_redeemed"),
  status: text("status").notNull().default("created"),
  error: text("error"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertV0AccountSchema = createInsertSchema(v0Accounts).omit({ id: true, createdAt: true });
export type V0Account = typeof v0Accounts.$inferSelect;
export type InsertV0Account = z.infer<typeof insertV0AccountSchema>;

export const adobeAccounts = pgTable("adobe_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  password: text("password"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  outlookEmail: text("outlook_email"),
  status: text("status").notNull().default("created"),
  error: text("error"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAdobeAccountSchema = createInsertSchema(adobeAccounts).omit({ id: true, createdAt: true });
export type AdobeAccount = typeof adobeAccounts.$inferSelect;
export type InsertAdobeAccount = z.infer<typeof insertAdobeAccountSchema>;

export const tmTrackedEvents = pgTable("tm_tracked_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: text("event_id").notNull(),
  name: text("name").notNull(),
  date: text("date"),
  venue: text("venue"),
  city: text("city"),
  priceMin: text("price_min"),
  priceMax: text("price_max"),
  currency: text("currency").default("USD"),
  url: text("url"),
  status: text("status").notNull().default("active"),
  ownerId: varchar("owner_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const tmAlerts = pgTable("tm_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: text("event_id").notNull(),
  eventName: text("event_name").notNull(),
  alertType: text("alert_type").notNull(),
  message: text("message").notNull(),
  oldPrice: text("old_price"),
  newPrice: text("new_price"),
  sentViaTelegram: boolean("sent_via_telegram").notNull().default(false),
  ownerId: varchar("owner_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTmTrackedEventSchema = createInsertSchema(tmTrackedEvents).omit({ id: true, createdAt: true });
export const insertTmAlertSchema = createInsertSchema(tmAlerts).omit({ id: true, createdAt: true });
export type TmTrackedEvent = typeof tmTrackedEvents.$inferSelect;
export type InsertTmTrackedEvent = z.infer<typeof insertTmTrackedEventSchema>;
export type TmAlert = typeof tmAlerts.$inferSelect;
export type InsertTmAlert = z.infer<typeof insertTmAlertSchema>;

export const savedCards = pgTable("saved_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: varchar("owner_id").notNull(),
  label: text("label").notNull(),
  cardholderName: text("cardholder_name").notNull(),
  cardNumber: text("card_number").notNull(),
  expiryMonth: text("expiry_month").notNull(),
  expiryYear: text("expiry_year").notNull(),
  cvv: text("cvv").notNull(),
  cardType: text("card_type").notNull().default("visa"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  otpEmail: text("otp_email"),
  otpEmailPassword: text("otp_email_password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSavedCardSchema = createInsertSchema(savedCards).omit({ id: true, createdAt: true });
export type SavedCard = typeof savedCards.$inferSelect;
export type InsertSavedCard = z.infer<typeof insertSavedCardSchema>;

export const elevenLabsAccounts = pgTable("eleven_labs_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  password: text("password").notNull(),
  apiKey: text("api_key"),
  status: text("status").notNull().default("created"),
  error: text("error"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertElevenLabsAccountSchema = createInsertSchema(elevenLabsAccounts).omit({ id: true, createdAt: true });
export type ElevenLabsAccount = typeof elevenLabsAccounts.$inferSelect;
export type InsertElevenLabsAccount = z.infer<typeof insertElevenLabsAccountSchema>;

export const chatgptAccounts = pgTable("chatgpt_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  password: text("password").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  outlookEmail: text("outlook_email"),
  status: text("status").notNull().default("created"),
  error: text("error"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertChatGptAccountSchema = createInsertSchema(chatgptAccounts).omit({ id: true, createdAt: true });
export type ChatGptAccount = typeof chatgptAccounts.$inferSelect;
export type InsertChatGptAccount = z.infer<typeof insertChatGptAccountSchema>;

// ── Shop Bot (Project Addison v2) ─────────────────────────────────────────────

export const shopCustomers = pgTable("shop_customers", {
  telegramId:           bigint("telegram_id", { mode: "number" }).primaryKey(),
  username:             text("username"),
  firstName:            text("first_name"),
  balance:              numeric("balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
  createdAt:            timestamp("created_at").notNull().defaultNow(),
  ref3MilestoneClaimed: boolean("ref3_milestone_claimed").notNull().default(false),
});

export const shopProducts = pgTable("shop_products", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name:         text("name").notNull(),
  description:  text("description"),
  price:        numeric("price", { precision: 10, scale: 2 }).notNull(),
  accountType:  text("account_type").notNull(),
  statusFilter: text("status_filter").notNull().default("available"),
  active:       boolean("active").notNull().default(true),
  sortOrder:    integer("sort_order").notNull().default(0),
  sticky:       boolean("sticky").notNull().default(false),
  stickyLabel:  text("sticky_label"),
  deliveryMode: text("delivery_mode").notNull().default("auto"),
  manualStock:  integer("manual_stock"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export const shopOrders = pgTable("shop_orders", {
  id:              varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  telegramId:      bigint("telegram_id", { mode: "number" }).notNull(),
  productId:       varchar("product_id").notNull(),
  productName:     text("product_name").notNull(),
  accountId:       text("account_id").notNull(),
  accountEmail:    text("account_email").notNull(),
  accountPassword: text("account_password").notNull(),
  amount:          numeric("amount", { precision: 10, scale: 2 }).notNull(),
  deliveryStatus:  text("delivery_status").notNull().default("delivered"),
  fulfillmentNote: text("fulfillment_note"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export const insertShopCustomerSchema = createInsertSchema(shopCustomers).omit({ createdAt: true });
export const insertShopProductSchema  = createInsertSchema(shopProducts).omit({ id: true, createdAt: true });
export const insertShopOrderSchema    = createInsertSchema(shopOrders).omit({ id: true, createdAt: true });

export type ShopCustomer      = typeof shopCustomers.$inferSelect;
export type InsertShopCustomer = z.infer<typeof insertShopCustomerSchema>;
export type ShopProduct       = typeof shopProducts.$inferSelect;
export type InsertShopProduct  = z.infer<typeof insertShopProductSchema>;
export type ShopOrder         = typeof shopOrders.$inferSelect;
export type InsertShopOrder    = z.infer<typeof insertShopOrderSchema>;

// ── Business Mail Account Registry ───────────────────────────────────────────
// Once a slot (account1, account2, …) is used it is remembered forever so the
// same number is never accidentally reused.  isActive=false means the mailbox
// was deleted from Stalwart but the slot is still reserved.
export const bizMailAccounts = pgTable("biz_mail_accounts", {
  id:            serial("id").primaryKey(),
  accountNum:    integer("account_num").unique(),          // null for custom-named accounts
  email:         text("email").notNull().unique(),
  password:      text("password").notNull(),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  deletedAt:     timestamp("deleted_at"),
  // Shop bot allocation — links a mail exclusively to a Telegram user
  allocatedTo:   bigint("allocated_to_telegram_id", { mode: "number" }),   // Telegram user ID
  smtpAccountId: text("smtp_dev_id"),                                       // smtp.dev account ID for polling
  allocatedAt:   timestamp("allocated_at"),
  sourceBot:     text("source_bot").default("bot2"),                        // 'bot2' | 'bot3'
});

export const insertBizMailAccountSchema = createInsertSchema(bizMailAccounts).omit({ id: true, createdAt: true, deletedAt: true });
export type BizMailAccount       = typeof bizMailAccounts.$inferSelect;
export type InsertBizMailAccount = z.infer<typeof insertBizMailAccountSchema>;

// ── Crypto Payment Orders ─────────────────────────────────────────────────────
export const cryptoOrders = pgTable("crypto_orders", {
  id:            varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId:       varchar("order_id").notNull().unique(),
  userId:        text("user_id").notNull(),
  amount:        numeric("amount", { precision: 18, scale: 8 }).notNull(),
  note:          text("note").notNull().unique(),
  chain:         text("chain").notNull().default("BINANCE_PAY"), // BINANCE_PAY | TRC20 | BEP20
  status:        text("status").notNull().default("PENDING"), // PENDING | PAID | EXPIRED
  transactionId: text("transaction_id").unique(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  expiresAt:     timestamp("expires_at").notNull(),
  paidAt:        timestamp("paid_at"),
});

export const insertCryptoOrderSchema = createInsertSchema(cryptoOrders).omit({
  id: true, status: true, transactionId: true, createdAt: true, paidAt: true,
});
export type InsertCryptoOrder = z.infer<typeof insertCryptoOrderSchema>;
export type CryptoOrder       = typeof cryptoOrders.$inferSelect;

// ── UPI Payment Orders ─────────────────────────────────────────────────────────
export const upiOrders = pgTable("upi_orders", {
  id:         varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  utr:        text("utr").notNull().unique(),
  userId:     text("user_id").notNull(),
  amountInr:  numeric("amount_inr", { precision: 12, scale: 2 }).notNull(),
  amountUsd:  numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
  senderName: text("sender_name"),
  senderBank: text("sender_bank"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

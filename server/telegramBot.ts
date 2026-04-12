import { Telegraf, Markup } from "telegraf";
import { Pool } from "pg";
import { EMOJI_SLOTS, getEmojiId, setEmojiId, resetEmojiId, loadEmojiSettings, type EmojiKey } from "./emojiSettings";
import {
  getAvailableDomain, createTempEmail, getAuthToken,
  fetchMessages, fetchMessageContent, generateRandomUsername,
  detectProviderFromDomain,
  pollBizMailViaGmail, getGmailAddress, type BizMailMessage,
} from "./mailService";
import {
  createAccount as smtpDevCreate,
  deleteAccount as smtpDevDelete,
  getFullInbox as smtpDevInbox,
} from "./smtpDevService";
import {
  pendingActivations, adminApprovalStates,
  startActivationCountdown,
  ACTIVATION_LABEL, ACTIVATION_EMOJI,
} from "./activationStore";
import { getBotMenuConfig, getBotMenuDefaults, reloadBotMenu } from "./shopBot";

const SERVER_PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

// ── Service configs ───────────────────────────────────────────────────────────
interface ServiceConfig {
  label: string;
  emoji: string;
  endpoint: string;
  outlookTable?: string;   // DB table to check used emails
  hasCard?: boolean;
  hasCoupon?: boolean;
  hasReferral?: boolean;
}
const SERVICE_CONFIGS: Record<string, ServiceConfig> = {
  replit:  { label: "Replit",   emoji: "🔵", endpoint: "/api/replit-create/bulk",  outlookTable: "replit_accounts" },
  lovable: { label: "Lovable",  emoji: "💜", endpoint: "/api/lovable-create/bulk", outlookTable: "lovable_accounts",  hasReferral: true },
  v0:      { label: "v0.dev",   emoji: "⚡", endpoint: "/api/v0-create/bulk",      outlookTable: "v0_accounts" },
  adobe:   { label: "Adobe",    emoji: "🅰️", endpoint: "/api/adobe-create/bulk",   outlookTable: "adobe_accounts" },
  chatgpt_biz: { label: "ChatGPT", emoji: "🤖", endpoint: "/api/chatgpt-create-biz/bulk", outlookTable: "chatgpt_accounts" },
};

// ── Account type browser configs ──────────────────────────────────────────────
interface AccountTypeConfig {
  label: string;
  emoji: string;
  table: string;
  statusCol: boolean;          // table has a `status` column
  extraCols: string[];         // extra columns to show in listing
  statuses: Array<{ label: string; emoji: string; value: string | null }>; // null = all
}
const ACCOUNT_TYPE_CONFIGS: Record<string, AccountTypeConfig> = {
  outlook: {
    label: "Outlook", emoji: "📧", table: "private_outlook_accounts", statusCol: true,
    extraCols: [],
    statuses: [
      { label: "All",            emoji: "📋", value: null },
      { label: "Active",         emoji: "🟢", value: "active" },
      { label: "Blocked",        emoji: "🚫", value: "proofs_blocked" },
    ],
  },
  replit: {
    label: "Replit", emoji: "🔵", table: "replit_accounts", statusCol: true,
    extraCols: ["checkout_url", "coupon_code"],
    statuses: [
      { label: "All",        emoji: "📋", value: null },
      { label: "Processing", emoji: "⏳", value: "processing" },
      { label: "Sold Out",   emoji: "✅", value: "sold_out" },
      { label: "Working",    emoji: "🔗", value: "working" },
      { label: "Available",  emoji: "🟢", value: "available" },
      { label: "Error",      emoji: "❌", value: "error" },
    ],
  },
  lovable: {
    label: "Lovable", emoji: "💜", table: "lovable_accounts", statusCol: true,
    extraCols: ["credits"],
    statuses: [
      { label: "All",                 emoji: "📋", value: null },
      { label: "Created",             emoji: "✅", value: "created" },
      { label: "Sold Out",            emoji: "🟡", value: "sold_out" },
      { label: "Pending Verify",      emoji: "⏳", value: "pending_verification" },
    ],
  },
  gmail: {
    label: "Gmail", emoji: "📩", table: "private_gmail_accounts", statusCol: true,
    extraCols: [],
    statuses: [
      { label: "All",    emoji: "📋", value: null },
      { label: "Active", emoji: "🟢", value: "active" },
    ],
  },
  adobe: {
    label: "Adobe", emoji: "🅰️", table: "adobe_accounts", statusCol: true,
    extraCols: [],
    statuses: [
      { label: "All",    emoji: "📋", value: null },
      { label: "Active", emoji: "🟢", value: "active" },
      { label: "Error",  emoji: "❌", value: "error" },
    ],
  },
};

// ── Per-user state ────────────────────────────────────────────────────────────
interface CreateFlow {
  service?: string;
  count?: number;
  couponCode?: string;     // "" = no coupon, undefined = not set yet
  cardId?: string;         // "" = no card, undefined = not set yet
  cardLabel?: string;
  referralUrl?: string;    // "" = no referral, used for Lovable
}
interface MailSession {
  email: string;
  password: string;
  provider: string;
  token: string;
  seenIds: Set<string>;
  stopped: boolean;
  statusMsgId: number;
  chatId: number;
}
interface BizMailSession {
  email: string;
  password: string;
  accountId: string;       // smtp.dev account ID for deletion
  accountNum: number | null;
  isCustom: boolean;
  stopped: boolean;
  statusMsgId: number;
  chatId: number;
  receivedCount: number;
  checkInbox: () => Promise<number>; // returns count of new messages found
}

interface ShopAdminFlow {
  step?: "name" | "description" | "price" | "account_type" | "status_filter"
       | "topup_uid" | "topup_amount"
       | "edit_name" | "edit_description" | "edit_price" | "edit_account_type" | "edit_status_filter" | "edit_sort_order" | "edit_sticky_label" | "edit_custom_emoji"
       | "activation_time" | "refer_amount"
       | "broadcast_text" | "search_uid"
       | "promo_code" | "promo_discount" | "promo_maxuses"
       | "dep_approve_amount"
       | "stock_add_creds"
       | "stock_add_links"
       | "stock_set_override"
       | "stock_set_manual_stock"
       | "manual_fulfill"
       | "fulfill_email"
       | "fulfill_password"
       | "fulfill_link"
       | "menu_btn_label";
  menuEditKey?: string;
  name?: string;
  description?: string;
  price?: string;
  accountType?: string;
  statusFilter?: string;
  topupUid?: number;
  editProductId?: string;
  activationOrderId?: string;
  promoCode?: string;
  promoDiscount?: string;
  depRequestId?: number;
  depUserId?: number;
  stockProductId?: string;
  stockTableName?: string;
  stockStatusFilter?: string;
  stockOverrideProductId?: string;
  manualStockProductId?: string;
  fulfillOrderId?: string;
  fulfillCustomerId?: number;
  fulfillEmail?: string;
}
interface UserState {
  lastCopiedIds?: string[];
  lastBatchAccountIds?: string[];
  lastBatchTable?: string;
  awaitingText?: "proxy" | "custom_copy" | "coupon_code" | "create_count" | "referral_url" | "checkout_count" | "biz_mail_recover" | "biz_mail_restore_username" | "biz_bulk_count" | "emoji_edit";
  emojiEditKey?: string;
  createFlow?: CreateFlow;
  accountType?: string;    // currently browsing account type (Accounts section)
  copyType?: string;       // currently selected type for Copy Accounts
  mailSession?: MailSession;
  bizMailSession?: BizMailSession;
  shopAdminFlow?: ShopAdminFlow;
  shopMenuMsgId?: number;
}
// ── Create flow helpers ───────────────────────────────────────────────────────
async function getAvailableCount(svc: ServiceConfig): Promise<number> {
  if (!svc.outlookTable) return 0;
  const r = await dbQuery(
    `SELECT COUNT(*) as cnt FROM private_outlook_accounts WHERE email NOT IN (SELECT COALESCE(outlook_email,'') FROM ${svc.outlookTable})`
  );
  return parseInt(r.rows[0]?.cnt || "0");
}

async function showCountPicker(ctx: any, uid: number, gs: (n: number) => UserState) {
  const flow = gs(uid).createFlow!;
  const svc = SERVICE_CONFIGS[flow.service!];
  const availLine = svc.outlookTable
    ? `\n<code>◈ Outlook pool  →  ${await getAvailableCount(svc)} available</code>\n`
    : "\n";

  await ctx.reply(
    `\n🔷 <b>🏗 CREATE · ${svc.label.toUpperCase()}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        availLine +
    `› How many accounts?`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("1", "cn_1"), Markup.button.callback("5", "cn_5"), Markup.button.callback("10", "cn_10")],
        [Markup.button.callback("20", "cn_20"), Markup.button.callback("30", "cn_30"), Markup.button.callback("50", "cn_50")],
        [Markup.button.callback("✍ Custom", "cn_custom")],
        [Markup.button.callback("✖ Cancel", "create_cancel")],
      ]),
    }
  );
}

async function showCouponStep(ctx: any) {
  await ctx.reply(
    `\n🔷 <b>🎟 COUPON CODE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `› Apply a coupon during account creation?`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✍ Enter Coupon Code", "create_enter_coupon")],
        [Markup.button.callback("⏭ Skip — No Coupon", "create_skip_coupon")],
        [Markup.button.callback("✖ Cancel", "create_cancel")],
      ]),
    }
  );
}

async function showCardStep(ctx: any, uid: number, gs: (n: number) => UserState) {
  const cards = await dbQuery(`SELECT id, cardholder_name, card_number FROM saved_cards ORDER BY created_at DESC LIMIT 10`);
  const state = gs(uid);

  if (cards.rows.length === 0) {
    state.createFlow!.cardId = "";
    state.createFlow!.cardLabel = "none";
    await showCreateSummary(ctx, uid, gs);
    return;
  }

  const cardButtons = cards.rows.map((c: any) => {
    const masked = `*${c.card_number?.slice(-4) || "????"}`;
    const label = `💳 ${c.cardholder_name || "Card"} ${masked}`;
    return [Markup.button.callback(label, `ccard_${c.id}`)];
  });

  await ctx.reply(
    `\n🔷 <b>💳 SELECT CARD</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `› Choose a saved card or skip:`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        ...cardButtons,
        [Markup.button.callback("⏭ No Card", "create_skip_card")],
        [Markup.button.callback("✖ Cancel", "create_cancel")],
      ]),
    }
  );
}

async function showReferralStep(ctx: any) {
  await ctx.reply(
    `\n🔷 <b>🔗 REFERRAL URL</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `› Enter a Lovable referral URL or skip:\n` +
    `<code>  must start with https://lovable.dev/</code>`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✍ Enter Referral URL", "create_enter_referral")],
        [Markup.button.callback("⏭ Skip", "create_skip_referral")],
        [Markup.button.callback("✖ Cancel", "create_cancel")],
      ]),
    }
  );
}

async function showCreateSummary(ctx: any, uid: number, gs: (n: number) => UserState) {
  const flow = gs(uid).createFlow!;
  const svc = SERVICE_CONFIGS[flow.service!];
  const infoLines: string[] = [`📦  ${flow.count} account${flow.count === 1 ? "" : "s"}`];
  if (svc.outlookTable) {
    infoLines.push(`📬  Outlook pool  ·  ${await getAvailableCount(svc)} available`);
  }
  if (svc.hasCoupon)  infoLines.push(`🎟  Coupon  ·  ${flow.couponCode  || "none"}`);
  if (svc.hasCard)    infoLines.push(`💳  Card    ·  ${flow.cardLabel   || "none"}`);
  if (svc.hasReferral) infoLines.push(`🔗  Referral  ·  ${flow.referralUrl ? flow.referralUrl.slice(0, 35) + "…" : "none"}`);

  const lines: string[] = [
    `\n🔷 <b>JOB SUMMARY</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
    `${svc.emoji}  <b>${svc.label}</b>\n`,
    infoLines.join("\n"),
    `\n<i>Ready to launch — confirm below.</i>`,
  ];

  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("⚡ Confirm & Create", "create_confirm")],
      [Markup.button.callback("✏ Change Count", "create_change_count"), Markup.button.callback("✏ Back to Services", "create_back_svc")],
      [Markup.button.callback("✖ Cancel", "create_cancel")],
    ]),
  });
}

// ── DB — persistent pool (never recreate on every query) ─────────────────────
const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on("error", (err) => console.error("[Bot] DB pool error:", err.message));

async function dbQuery(sql: string, params: any[] = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusEmoji(s: string) {
  return { processing: "⏳", sold_out: "✅", working: "🔗", available: "🟢", error: "❌", banned: "🚫" }[s] ?? "❓";
}

// ── Reply keyboard — shown on /start and after completing actions ──────────────
const KB = {
  STATS:    "📡  𝗗𝗔𝗧𝗔𝗕𝗔𝗦𝗘",
  ACCOUNTS: "🔑  𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦",
  COPY:     "📋  𝗖𝗢𝗣𝗬",
  CHECKOUT: "🛒  𝗖𝗛𝗘𝗖𝗞𝗢𝗨𝗧",
  CREATE:   "⚡  𝗖𝗥𝗘𝗔𝗧𝗘  𝗔𝗖𝗖𝗢𝗨𝗡𝗧𝗦",
  MAIL:     "📬  𝗠𝗔𝗜𝗟  𝗚𝗘𝗡",
  MOVIES:   "🎬  𝗠𝗢𝗩𝗜𝗘𝗦",
  SHOP:     "🛍  𝗦𝗛𝗢𝗣",
  PAYMENT:  "💳  𝗣𝗔𝗬𝗠𝗘𝗡𝗧",
  ADDRESS:  "📍  𝗔𝗗𝗗𝗥𝗘𝗦𝗦",
} as const;

const MAIN_KEYBOARD = Markup.keyboard([
  [KB.CREATE],
  [KB.STATS,    KB.ACCOUNTS],
  [KB.COPY,     KB.CHECKOUT],
  [KB.MAIL,     KB.MOVIES],
  [KB.SHOP,     KB.PAYMENT],
  [KB.ADDRESS],
]).resize().oneTime();

const SHOP_KB = {
  PRODUCTS:      "📦  PRODUCTS",
  ADD_PRODUCT:   "➕  ADD PRODUCT",
  CUSTOMER:      "👥  CUSTOMER",
  FUND_ACCOUNT:  "💰  FUND ACCOUNT",
  ACT_ORDERS:    "📋  ACTIVATION ORDERS",
  DEPOSITS:      "📸  DEPOSITS",
  BROADCAST:     "📢  BROADCAST",
  ANALYTICS:     "📊  ANALYTICS",
  SEARCH:        "🔍  SEARCH CUSTOMER",
  REFER_REWARD:  "🔗  REFER REWARD",
  PROMO_CODES:   "🏷️  PROMO CODES",
  RESTOCK:       "🔔  RESTOCK NOTIFY",
  STOCK:         "🗄  STOCK MANAGER",
  MANUAL_ORDERS: "📬  MANUAL ORDERS",
  EMOJI:         "✨  EMOJI SETTINGS",
  MENU_MGMT:     "🎛  MENU MANAGEMENT",
  BACK:          "↩  BACK",
} as const;

const SHOP_KEYBOARD = Markup.keyboard([
  [SHOP_KB.PRODUCTS,      SHOP_KB.ADD_PRODUCT],
  [SHOP_KB.CUSTOMER,      SHOP_KB.FUND_ACCOUNT],
  [SHOP_KB.ACT_ORDERS,    SHOP_KB.DEPOSITS],
  [SHOP_KB.BROADCAST,     SHOP_KB.ANALYTICS],
  [SHOP_KB.SEARCH,        SHOP_KB.REFER_REWARD],
  [SHOP_KB.PROMO_CODES,   SHOP_KB.RESTOCK],
  [SHOP_KB.STOCK,         SHOP_KB.MANUAL_ORDERS],
  [SHOP_KB.EMOJI,         SHOP_KB.MENU_MGMT],
  [SHOP_KB.BACK],
]).resize();

// ── Inline sub-menus (shown in chat, not bottom bar) ─────────────────────────

/** Step 1 — account type picker */
async function inlineAccountTypes() {
  // Fetch counts for each type so user can see them at a glance
  const types = Object.entries(ACCOUNT_TYPE_CONFIGS);
  const counts = await Promise.all(
    types.map(([, cfg]) =>
      dbQuery(`SELECT COUNT(*) as cnt FROM ${cfg.table}`).then((r: any) => parseInt(r.rows[0]?.cnt || "0")).catch(() => 0)
    )
  );
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < types.length; i += 2) {
    const pair = types.slice(i, i + 2).map(([key, cfg], j) => {
      const cnt = counts[i + j];
      return Markup.button.callback(`${cfg.emoji} ${cfg.label} (${cnt})`, `at_${key}`);
    });
    rows.push(pair);
  }
  return Markup.inlineKeyboard(rows);
}

/** Step 2 — status filter for a given account type */
function inlineAccountStatus(acctType: string) {
  const cfg = ACCOUNT_TYPE_CONFIGS[acctType];
  if (!cfg) return Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "show_account_types")]]);
  const statusRows: ReturnType<typeof Markup.button.callback>[][] = [];
  const statuses = cfg.statuses;
  for (let i = 0; i < statuses.length; i += 2) {
    statusRows.push(
      statuses.slice(i, i + 2).map((s) =>
        Markup.button.callback(`${s.emoji} ${s.label}`, `as_${acctType}_${s.value ?? "all"}`)
      )
    );
  }
  statusRows.push([Markup.button.callback("🔙 Back to Types", "show_account_types")]);
  return Markup.inlineKeyboard(statusRows);
}

/** Legacy replit-only account list (kept for backward compat with "list_processing" in create completion) */
function inlineAccounts() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 All", "list_all"), Markup.button.callback("⏳ Processing", "list_processing")],
    [Markup.button.callback("✅ Sold Out", "list_sold_out"), Markup.button.callback("🔗 Working", "list_working")],
    [Markup.button.callback("🟢 Available", "list_available"), Markup.button.callback("❌ Error", "list_error")],
  ]);
}

/** Step 1 — account type picker for Copy Accounts */
async function inlineCopyTypes() {
  const types = Object.entries(ACCOUNT_TYPE_CONFIGS);
  const counts = await Promise.all(
    types.map(([, cfg]) =>
      dbQuery(`SELECT COUNT(*) as cnt FROM ${cfg.table}`).then((r: any) => parseInt(r.rows[0]?.cnt || "0")).catch(() => 0)
    )
  );
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < types.length; i += 2) {
    const pair = types.slice(i, i + 2).map(([key, cfg], j) => {
      const cnt = counts[i + j];
      return Markup.button.callback(`${cfg.emoji} ${cfg.label} (${cnt})`, `ct_${key}`);
    });
    rows.push(pair);
  }
  return Markup.inlineKeyboard(rows);
}

/** Step 2 — count/status options per account type (queries DB for real counts) */
async function inlineCopyOptions(acctType: string) {
  const cfg = ACCOUNT_TYPE_CONFIGS[acctType];
  if (!cfg) return Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "show_copy_types")]]);

  // Query actual distinct statuses with counts from the database
  const dbResult = await dbQuery(
    `SELECT status, COUNT(*) as cnt FROM ${cfg.table} GROUP BY status ORDER BY cnt DESC`
  ).catch(() => ({ rows: [] as any[] }));

  // Build a map of status → count from the DB
  const dbCounts: Record<string, number> = {};
  for (const row of dbResult.rows) {
    dbCounts[row.status] = parseInt(row.cnt || "0");
  }

  // Keep only statuses that actually exist in the DB with at least 1 account
  // Sort by count DESC so the largest status gets the 4-count treatment
  const nonAll = cfg.statuses
    .filter((st) => st.value !== null && (dbCounts[st.value] ?? 0) > 0)
    .sort((a, b) => (dbCounts[b.value!] ?? 0) - (dbCounts[a.value!] ?? 0));

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];

  if (nonAll.length === 0) {
    // No statuses in DB — just offer counts for "all"
    const total = Object.values(dbCounts).reduce((a, b) => a + b, 0);
    rows.push([
      Markup.button.callback("5",   `copy_all_5`),
      Markup.button.callback("10",  `copy_all_10`),
      Markup.button.callback("25",  `copy_all_25`),
    ]);
    if (total > 25) {
      rows.push([
        Markup.button.callback("50",  `copy_all_50`),
        Markup.button.callback("100", `copy_all_100`),
      ]);
    }
  } else {
    // First status — show 4 count options scaled by available count
    const first = nonAll[0];
    const firstCnt = dbCounts[first.value!] ?? 0;
    const firstCounts = [5, 10, 25, 50].filter((n) => n <= firstCnt + 4); // always show at least up to nearest tier
    const firstRow1 = firstCounts.slice(0, 2).map((n) =>
      Markup.button.callback(`${first.emoji} ${n} ${first.label}  (${firstCnt})`, `copy_${first.value}_${n}`)
    );
    const firstRow2 = firstCounts.slice(2, 4).map((n) =>
      Markup.button.callback(`${first.emoji} ${n} ${first.label}`, `copy_${first.value}_${n}`)
    );
    if (firstRow1.length) rows.push(firstRow1);
    if (firstRow2.length) rows.push(firstRow2);

    // Remaining statuses — pair them up with 5 and 10 options side by side
    const rest = nonAll.slice(1);
    for (let i = 0; i < rest.length; i += 2) {
      const pair = rest.slice(i, i + 2).map((st) => {
        const cnt = dbCounts[st.value!] ?? 0;
        return Markup.button.callback(`${st.emoji} 5 ${st.label}  (${cnt})`, `copy_${st.value}_5`);
      });
      rows.push(pair);
    }
  }

  rows.push([Markup.button.callback("✍️ Custom…", "copy_custom")]);
  rows.push([Markup.button.callback("🔙 Back to Types", "show_copy_types")]);
  return Markup.inlineKeyboard(rows);
}

/** Legacy replit-only copy inline (kept for backward compat) */
function inlineCopy() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⏳ 5 Processing", "copy_processing_5"), Markup.button.callback("⏳ 10 Processing", "copy_processing_10")],
    [Markup.button.callback("⏳ 25 Processing", "copy_processing_25"), Markup.button.callback("⏳ 50 Processing", "copy_processing_50")],
    [Markup.button.callback("✅ 5 Sold Out", "copy_sold_out_5"), Markup.button.callback("✅ 10 Sold Out", "copy_sold_out_10")],
    [Markup.button.callback("🔗 5 Working", "copy_working_5"), Markup.button.callback("✍️ Custom…", "copy_custom")],
  ]);
}

function inlineCreate() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("1", "create_1"), Markup.button.callback("5", "create_5"), Markup.button.callback("10", "create_10")],
    [Markup.button.callback("20", "create_20"), Markup.button.callback("30", "create_30"), Markup.button.callback("50", "create_50")],
  ]);
}

function inlineWarm() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("5", "warm_5"), Markup.button.callback("10", "warm_10"), Markup.button.callback("25", "warm_25")],
    [Markup.button.callback("50", "warm_50"), Markup.button.callback("All processing", "warm_all")],
  ]);
}

function inlineApplyStatus() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Sold Out", "apply_sold_out"), Markup.button.callback("🔗 Working", "apply_working")],
    [Markup.button.callback("⏳ Processing", "apply_processing"), Markup.button.callback("🟢 Available", "apply_available")],
    [Markup.button.callback("🚫 No Change", "apply_dismiss")],
  ]);
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function buildStatsText(): Promise<{ text: string; mode: "HTML" }> {
  const q = (sql: string, p: any[] = []) => dbQuery(sql, p).then((r: any) => r.rows).catch(() => [] as any[]);
  const n = (rows: any[], col = "cnt") => parseInt(rows[0]?.[col] || "0");

  // Run all queries in parallel
  const [
    replitStatus, replitToday, replitWeek, replitCoupons, replitCheckout,
    lovableStatus, lovableToday, lovableWeek,
    v0Status, v0Today,
    adobeStatus, adobeToday,
    chatgptStatus, chatgptToday,
    elevenStatus, elevenToday,
    outlookTotal, outlookAvail,
    gmailTotal,
  ] = await Promise.all([
    q(`SELECT status, COUNT(*) as cnt FROM replit_accounts GROUP BY status ORDER BY cnt DESC`),
    q(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`),
    q(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE created_at > NOW() - INTERVAL '7 days'`),
    q(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE coupon_extracted = true AND coupon_code IS NOT NULL AND coupon_code != ''`),
    q(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE checkout_url IS NOT NULL AND checkout_url != ''`),
    q(`SELECT status, COUNT(*) as cnt FROM lovable_accounts GROUP BY status ORDER BY cnt DESC`),
    q(`SELECT COUNT(*) as cnt FROM lovable_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`),
    q(`SELECT COUNT(*) as cnt FROM lovable_accounts WHERE created_at > NOW() - INTERVAL '7 days'`),
    q(`SELECT status, COUNT(*) as cnt FROM v0_accounts GROUP BY status ORDER BY cnt DESC`),
    q(`SELECT COUNT(*) as cnt FROM v0_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`),
    q(`SELECT status, COUNT(*) as cnt FROM adobe_accounts GROUP BY status ORDER BY cnt DESC`),
    q(`SELECT COUNT(*) as cnt FROM adobe_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`),
    q(`SELECT status, COUNT(*) as cnt FROM chatgpt_accounts GROUP BY status ORDER BY cnt DESC`),
    q(`SELECT COUNT(*) as cnt FROM chatgpt_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`),
    q(`SELECT status, COUNT(*) as cnt FROM eleven_labs_accounts GROUP BY status ORDER BY cnt DESC`),
    q(`SELECT COUNT(*) as cnt FROM eleven_labs_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`),
    q(`SELECT COUNT(*) as cnt FROM private_outlook_accounts`),
    q(`SELECT COUNT(*) as cnt FROM private_outlook_accounts WHERE email NOT IN (SELECT COALESCE(outlook_email,'') FROM replit_accounts)`),
    q(`SELECT COUNT(*) as cnt FROM private_gmail_accounts`),
  ]);

  const STAT_EMOJIS: Record<string, string> = {
    available: "🟢", sold_out: "✅", processing: "⏳", error: "❌",
    working: "🔗", created: "✨", pending_verification: "📨",
    active: "🟢", banned: "🚫", suspended: "🔴", verified: "✅",
  };
  const se = (s: string) => STAT_EMOJIS[s] ?? "▪️";

  function serviceBlock(
    emoji: string, label: string,
    statusRows: any[],
    extras: string[] = [],
    todayCnt = 0, weekCnt = -1
  ): string {
    const total = statusRows.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
    if (total === 0 && todayCnt === 0) return "";
    let b = `\n${emoji} <b>${label}</b>  <code>${total}</code>\n`;
    // Status pills
    const pills = statusRows.map((r: any) => `${se(r.status)} ${r.status.replace(/_/g, " ")}: <b>${r.cnt}</b>`);
    if (pills.length) b += pills.join("  ·  ") + "\n";
    if (extras.length) b += extras.join("  ·  ") + "\n";
    const timeInfo: string[] = [];
    if (todayCnt > 0) timeInfo.push(`📅 today: <b>${todayCnt}</b>`);
    if (weekCnt >= 0) timeInfo.push(`📆 week: <b>${weekCnt}</b>`);
    if (timeInfo.length) b += timeInfo.join("  ·  ") + "\n";
    return b;
  }

  const replitTotal = replitStatus.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const lovableTotal = lovableStatus.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const v0Total = v0Status.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const adobeTotal = adobeStatus.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const chatgptTotal = chatgptStatus.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const elevenTotal = elevenStatus.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const grandTotal = replitTotal + lovableTotal + v0Total + adobeTotal + chatgptTotal + elevenTotal;

  const now = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  function svcLine(emoji: string, label: string, statusRows: any[], todayCnt: number, weekCnt = -1, extras: string[] = []): string {
    const total = statusRows.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
    if (total === 0 && todayCnt === 0) return "";

    let b = `\n${emoji}  <b>${label}</b>  <code>${total}</code>\n`;

    // Pair status items 2-per-line so lines stay short on mobile
    const items = statusRows
      .filter((r: any) => parseInt(r.cnt) > 0)
      .map((r: any) => `${se(r.status)} ${r.status.replace(/_/g, " ")}: ${r.cnt}`);
    if (items.length === 0) {
      b += `<code>  —</code>\n`;
    } else {
      for (let i = 0; i < items.length; i += 2) {
        const left = items[i];
        const right = items[i + 1] ? `  ·  ${items[i + 1]}` : "";
        b += `<code>  ${left}${right}</code>\n`;
      }
    }

    // Pair extras 2-per-line too
    if (extras.length) {
      for (let i = 0; i < extras.length; i += 2) {
        const left = extras[i];
        const right = extras[i + 1] ? `  ·  ${extras[i + 1]}` : "";
        b += `<code>  ${left}${right}</code>\n`;
      }
    }

    const timeParts = [
      todayCnt > 0 ? `+${todayCnt} today` : "",
      weekCnt >= 0 ? `+${weekCnt} week` : "",
    ].filter(Boolean).join("  ·  ");
    if (timeParts) b += `<code>  ${timeParts}</code>\n`;
    return b;
  }

  let t = `\n🔷 <b>⚡ ACCOUNT TRACKER</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  t += ``;
  t += `<code>◈ Snapshot  →  ${now}\n`;
  t += `◈ Total     →  ${grandTotal} accounts</code>\n`;

  t += `\n─────────────────────────────────────────\n`;

  t += svcLine("🔵", "REPLIT", replitStatus, n(replitToday), n(replitWeek),
    [`coupons: ${n(replitCoupons)}`, `checkout: ${n(replitCheckout)}`]);
  t += svcLine("💜", "LOVABLE",  lovableStatus,  n(lovableToday), n(lovableWeek));
  t += svcLine("⚡", "V0.DEV",   v0Status,       n(v0Today));
  t += svcLine("🅰️", "ADOBE",   adobeStatus,    n(adobeToday));
  t += svcLine("🤖", "CHATGPT", chatgptStatus,  n(chatgptToday));
  t += svcLine("🎙", "11LABS",  elevenStatus,   n(elevenToday));

  t += `\n─────────────────────────────────────────\n`;
  t += `\n📬  <b>OUTLOOK POOL</b>\n`;
  t += `<code>  total: ${n(outlookTotal)}  ·  unused: ${n(outlookAvail)}</code>\n`;
  t += `\n📩  <b>GMAIL POOL</b>\n`;
  t += `<code>  total: ${n(gmailTotal)}</code>\n`;

  return { text: t, mode: "HTML" };
}

// ── Copy + apply ──────────────────────────────────────────────────────────────
async function doCopy(ctx: any, status: string, count: number, acctType: string | undefined, gs: (n: number) => UserState) {
  const uid = ctx.from?.id;
  // Resolve which table to query
  const type = acctType || gs(uid).copyType || "replit";
  const cfg = ACCOUNT_TYPE_CONFIGS[type];
  const table = cfg?.table || "replit_accounts";
  const typeEmoji = cfg?.emoji || "🔵";
  const typeLabel = cfg?.label || "Replit";

  // Build query — "all" status means no WHERE clause on status
  let rows: any[];
  const hasStatus = status && status !== "all";
  if (hasStatus) {
    rows = (await dbQuery(
      `SELECT id, email, password${table === "replit_accounts" ? ", credits, coupon_code, checkout_url" : ""} FROM ${table} WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
      [status, count]
    )).rows;
  } else {
    rows = (await dbQuery(
      `SELECT id, email, password${table === "replit_accounts" ? ", credits, coupon_code, checkout_url" : ""} FROM ${table} ORDER BY created_at DESC LIMIT $1`,
      [count]
    )).rows;
  }

  if (rows.length === 0) {
    return ctx.reply(`No ${typeEmoji} ${typeLabel} accounts found${hasStatus ? ` with status *${status.replace(/_/g, " ")}*` : ""}.`, { parse_mode: "Markdown" });
  }

  gs(uid).lastCopiedIds = rows.map((r: any) => String(r.id));

  for (const row of rows) {
    const email = row.email || "";
    const pass = row.password || "";
    let card = `${typeEmoji} *${typeLabel} Account*\n`;
    card += `📧 \`${email}\`\n`;
    card += `🔑 \`${pass}\`\n`;
    if (row.credits != null) card += `💰 Credits: ${row.credits || "20"}\n`;
    if (row.coupon_code) card += `🎟 Coupon: \`${row.coupon_code}\`\n`;
    card += `\n📋 \`${email}:${pass}\``;
    await ctx.reply(card, { parse_mode: "Markdown" });
  }

  const statusLabel = hasStatus ? ` (${status.replace(/_/g, " ")})` : "";
  await ctx.reply(
    `✅ *${rows.length}* ${typeEmoji} ${typeLabel}${statusLabel} accounts sent.\n\nApply a status to these accounts?`,
    { parse_mode: "Markdown", ...inlineApplyStatus() }
  );
}

async function applyStatus(ctx: any, status: string, gs: (n: number) => UserState) {
  const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
  const ids = gs(uid).lastCopiedIds;
  if (!ids?.length) {
    return ctx.answerCbQuery ? ctx.answerCbQuery("No accounts selected.") : ctx.reply("No accounts selected.");
  }
  const ph = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
  // Use the table for whichever type was last copied; default to replit_accounts
  const copyType = gs(uid).copyType || "replit";
  const table = ACCOUNT_TYPE_CONFIGS[copyType]?.table || "replit_accounts";
  const r = await dbQuery(`UPDATE ${table} SET status = $1 WHERE id IN (${ph}) RETURNING id`, [status, ...ids]);
  gs(uid).lastCopiedIds = undefined;
  if (ctx.answerCbQuery) await ctx.answerCbQuery(`Updated ${r.rowCount} accounts`);
  await ctx.reply(`✅ *${r.rowCount}* accounts → \`${status}\``, { parse_mode: "Markdown" });
}

// ── Production helpers ────────────────────────────────────────────────────────

/** Allowed Telegram user IDs — comma-separated in the given env var.
 *  Falls back to TELEGRAM_ALLOWED_IDS if no envKey is provided.
 *  If the env var is not set, the bot is open to anyone (dev mode). */
function getAllowedIds(envKey = "TELEGRAM_ALLOWED_IDS"): Set<number> {
  const raw = process.env[envKey] || "";
  if (!raw.trim()) return new Set();
  return new Set(raw.split(",").map((s) => parseInt(s.trim())).filter(Boolean));
}

// ── Multi-bot registry — used by MoviesDrive monitor to broadcast across all bots ──
interface BotEntry { getAllowedIds: () => Set<number>; tg: any; stop: (sig: string) => void }
const activeBots: BotEntry[] = [];

// ── Single shared shutdown — registered once, stops all bots and closes pool ─
let _shutdownRegistered = false;
function registerShutdown() {
  if (_shutdownRegistered) return;
  _shutdownRegistered = true;
  const doShutdown = (sig: string) => {
    if (mdInterval) { clearInterval(mdInterval); mdInterval = null; }
    for (const entry of activeBots) { try { entry.stop(sig); } catch {} }
    pool.end().catch(() => {});
  };
  process.once("SIGINT",  () => doShutdown("SIGINT"));
  process.once("SIGTERM", () => doShutdown("SIGTERM"));
  process.on("unhandledRejection", (reason: any) => {
    console.error("[Bot] Unhandled promise rejection:", reason?.message || reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[Bot] Uncaught exception:", err.message);
  });
}

/** Truncate a message to Telegram's 4096-char hard limit. */
function truncate(text: string, limit = 4000): string {
  return text.length > limit ? text.slice(0, limit - 3) + "…" : text;
}

/** Safe reply — never throws, truncates, returns sent message or null. */
async function safeReply(ctx: any, text: string, extra: any = {}) {
  try {
    return await ctx.reply(truncate(text), extra);
  } catch (e: any) {
    console.error("[Bot] safeReply failed:", e.message);
    return null;
  }
}

/** Safe edit — falls back to a new reply if edit fails. */
async function safeEdit(ctx: any, text: string, extra: any = {}) {
  try {
    return await ctx.editMessageText(truncate(text), extra);
  } catch {
    return safeReply(ctx, text, extra);
  }
}

/** Per-user rate limiter: key → last action timestamp. */
const rateLimitMap = new Map<string, number>();
function isRateLimited(uid: number, action: string, cooldownMs = 2000): boolean {
  const key = `${uid}:${action}`;
  const last = rateLimitMap.get(key) || 0;
  if (Date.now() - last < cooldownMs) return true;
  rateLimitMap.set(key, Date.now());
  return false;
}

/** Clean up stale rate limit entries every 5 minutes. */
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, ts] of rateLimitMap) if (ts < cutoff) rateLimitMap.delete(k);
}, 300_000);

const botLog = (...args: any[]) => console.log("[Bot]", ...args);
const botErr = (...args: any[]) => console.error("[Bot]", ...args);

// ── MoviesDrive monitor state (module-level) ──────────────────────────────────
const MD_URL = "https://new1.moviesdrives.my/";
const MD_UA  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MD_POLL_MS = 3 * 60_000; // 3 minutes

let mdSeenLinks   = new Set<string>();
let mdLastChecked : Date | null = null;
let mdNewCountSession = 0;
let mdMonitorEnabled  = true;
let mdInterval        : ReturnType<typeof setInterval> | null = null;

type MDMovie = { title: string; image: string; link: string };

async function fetchMDMovies(): Promise<MDMovie[]> {
  try {
    const r = await fetch(MD_URL, {
      headers: { "User-Agent": MD_UA, "Accept": "text/html,*/*" },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await r.text();
    const movies: MDMovie[] = [];
    const seen = new Set<string>();
    const rx = /<a\s+href="(https:\/\/new1\.moviesdrives\.my\/[^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<p[^>]*class="[^"]*poster-title[^"]*"[^>]*>([\s\S]*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(html)) !== null) {
      const link = m[1];
      if (seen.has(link)) continue;
      seen.add(link);
      const image = m[2];
      const title = m[3]
        .replace(/<[^>]+>/g, "").replace(/&#038;/g, "&").replace(/&#8217;/g, "'")
        .replace(/&#8211;/g, "-").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
        .replace(/&#8230;/g, "...").trim();
      movies.push({ title, image, link });
    }
    return movies;
  } catch {
    return [];
  }
}

async function mdBroadcast(movies: MDMovie[], tg: any, allowed: Set<number>) {
  for (const m of movies) {
    const caption =
      `<b>New on MoviesDrive</b>\n\n` +
      `<b>${escapeHtml(m.title)}</b>\n\n` +
      `<a href="${m.link}">View Post</a>`;
    for (const uid of allowed) {
      try {
        await tg.sendPhoto(uid, m.image, { caption, parse_mode: "HTML" });
      } catch {
        await tg.sendMessage(uid,
          `<b>New on MoviesDrive</b>\n\n<b>${escapeHtml(m.title)}</b>\n\n<a href="${m.link}">View Post</a>`,
          { parse_mode: "HTML", disable_web_page_preview: false }
        ).catch(() => {});
      }
    }
  }
}

/** Collect all allowed IDs across all registered bots (union, deduplicated). */
function getAllBotAllowedIds(): Set<number> {
  const combined = new Set<number>();
  for (const entry of activeBots) {
    for (const uid of entry.getAllowedIds()) combined.add(uid);
  }
  return combined;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─────────────────────────────────────────────────────────────────────────────
export interface BotConfig {
  token: string;
  allowedIdsEnv?: string;  // env var name for allowed IDs, defaults to TELEGRAM_ALLOWED_IDS
  label?: string;           // human-readable label for logs, e.g. "Bot1" or "Bot2"
}

export function startTelegramBot(config: BotConfig) {
  const { token, allowedIdsEnv = "TELEGRAM_ALLOWED_IDS", label = "Bot" } = config;
  if (!token) { console.warn(`[TelegramBot:${label}] No token provided — skipping`); return; }
  const bot = new Telegraf(token);
  const ALLOWED = getAllowedIds(allowedIdsEnv);

  // ── Per-bot isolated state ────────────────────────────────────────────────
  const userState = new Map<number, UserState>();
  const runningScans = new Map<number, boolean>();
  function getState(uid: number): UserState {
    if (!userState.has(uid)) userState.set(uid, {});
    return userState.get(uid)!;
  }

  // ── Internal API — authenticated with this bot's own token ───────────────
  async function botApi(path: string, method = "GET", body?: object) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-bot-token": token },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  // Register this bot in the multi-bot registry for MoviesDrive broadcast and shared shutdown
  const botEntry: BotEntry = {
    getAllowedIds: () => getAllowedIds(allowedIdsEnv),
    tg: bot.telegram,
    stop: (sig: string) => { botLog(`[${label}] Received ${sig} — stopping`); bot.stop(sig); },
  };
  activeBots.push(botEntry);
  registerShutdown();

  // ── Global error handler — never crash the process ────────────────────────
  bot.catch((err: any, ctx: any) => {
    botErr("Unhandled handler error:", err?.message || err);
    try {
      ctx?.answerCbQuery?.("An error occurred. Please try again.").catch(() => {});
    } catch {}
  });

  // ── /id — always allowed, returns the caller's Telegram user ID ──────────
  bot.command("id", async (ctx) => {
    const uid = ctx.from?.id;
    await ctx.reply(
      `\n🔷 <b>IDENTITY</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>◈ Telegram ID  →  ${uid}\n` +
      `◈ Username     →  @${ctx.from?.username || "—"}</code>\n\n` +
      `→ Add ID to <b>TELEGRAM_ALLOWED_IDS</b> to grant access.`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  });

  // ── Auth middleware — block unauthorized users ────────────────────────────
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    if (ALLOWED.size > 0 && !ALLOWED.has(uid)) {
      botLog(`Blocked unauthorized user ${uid} (@${ctx.from?.username || "unknown"})`);
      await ctx.reply(
        `\n🔷 <b>ACCESS DENIED</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔴  UNAUTHORIZED\n\n` +
        `<code>◈ Your ID  →  ${uid}</code>\n\n` +
        `→ Contact admin to be added to the allowlist.`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }
    return next();
  });

  // ── Global callback_query answer guard (prevent "query too old" spinners) ─
  bot.use(async (ctx, next) => {
    await next();
  });

  // ── Set bot commands (slash-command list) ─────────────────────────────────
  bot.telegram.setMyCommands([
    { command: "id",     description: "Show your Telegram user ID" },
    { command: "start",  description: "Open main menu" },
    { command: "menu",   description: "Open main keyboard" },
    { command: "stats",  description: "Account statistics" },
    { command: "cancel", description: "Cancel running scan" },
  ]).catch(() => {});

  // ── /start ── welcome only, no keyboard (keyboard only shown via /menu) ───
  bot.start(async (ctx) => {
    const dismiss = await ctx.reply("\u200B", { ...Markup.removeKeyboard() }).catch(() => null);
    if (dismiss) {
      await ctx.telegram.deleteMessage(ctx.chat.id, dismiss.message_id).catch(() => {});
    }
    await ctx.reply(
      `\n🔷 <b>ADDISON PANEL</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤  <b>${ctx.from.first_name || ctx.from.username || "Admin"}</b>  <code>#${ctx.from.id}</code>\n\n` +
      `✅  Auth verified\n` +
      `✅  Database connected\n` +
      `✅  All systems operational\n\n` +
      `Tap <b>Menu</b> below to open the command panel.`,
      { parse_mode: "HTML" }
    );
  });

  // ── /menu ── show keyboard on demand (triggered by tapping Menu button) ───
  bot.command("menu", async (ctx) => {
    const dismiss = await ctx.reply("\u200B", { ...Markup.removeKeyboard() }).catch(() => null);
    if (dismiss) {
      await ctx.telegram.deleteMessage(ctx.chat.id, dismiss.message_id).catch(() => {});
    }
    await ctx.reply(
      `\n🔷 <b>COMMAND PANEL</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Select a module from the keyboard below.`,
      { parse_mode: "HTML", ...MAIN_KEYBOARD }
    );
  });

  // ── /cancel ───────────────────────────────────────────────────────────────
  bot.command("cancel", (ctx) => {
    const uid = ctx.from.id;
    const st = getState(uid);
    st.awaitingText = undefined;
    if (runningScans.has(uid)) {
      runningScans.set(uid, false);
      ctx.reply(`🔴  SCAN ABORT SIGNAL SENT\n<code>◈ Status  →  stopping after current account</code>`, { parse_mode: "HTML" });
    } else {
      ctx.reply(`🔴  OPERATION CANCELLED`, { parse_mode: "HTML" });
    }
  });

  // ── /getemoji — extract custom animated emoji IDs from a message ─────────
  bot.command("getemoji", async (ctx) => {
    const msg = ctx.message;
    const entities = msg.entities ?? [];
    const customEmojis = entities.filter((e: any) => e.type === "custom_emoji");

    if (customEmojis.length === 0) {
      return ctx.reply(
        `⚠️ <b>No custom emoji found.</b>\n\n` +
        `Send the command in the same message as your animated emoji.\n` +
        `Example: type <code>/getemoji</code> then paste your emoji right after it.`,
        { parse_mode: "HTML" }
      );
    }

    const lines = customEmojis.map((e: any, i: number) => {
      const char = msg.text?.slice(e.offset, e.offset + e.length) ?? "?";
      return `<code>${i + 1}. ${char}  →  ${e.custom_emoji_id}</code>`;
    });

    return ctx.reply(
      `<tg-emoji emoji-id="5368324170671202286">⚡</tg-emoji> <b>Custom Emoji IDs</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      lines.join("\n") + "\n\n" +
      `Add to <b>ANIM_EMOJI</b> in <code>server/shopBot.ts</code>:\n` +
      `<code>myEmoji: "${customEmojis[0].custom_emoji_id}",</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── /emoji — Animated emoji settings panel ───────────────────────────────
  function emojiPanelText(): string {
    const lines = (Object.keys(EMOJI_SLOTS) as EmojiKey[]).map(key => {
      const slot   = EMOJI_SLOTS[key];
      const id     = getEmojiId(key);
      const custom = id !== slot.default ? " ✏️" : "";
      return `${slot.fallback}  <b>${slot.label}</b>${custom}\n<code>${id}</code>`;
    });
    return (
      `✨ <b>ANIMATED EMOJI SETTINGS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      lines.join("\n\n") + "\n\n" +
      `<i>Tap a slot below to change its animated emoji ID.\nCustomised slots show ✏️</i>`
    );
  }

  function emojiPanelKeyboard() {
    const keys = Object.keys(EMOJI_SLOTS) as EmojiKey[];
    const rows = [];
    for (let i = 0; i < keys.length; i += 3) {
      rows.push(keys.slice(i, i + 3).map(k =>
        Markup.button.callback(`${EMOJI_SLOTS[k].fallback} ${k}`, `emoji_edit_${k}`)
      ));
    }
    rows.push([Markup.button.callback("🔄 Reload settings", "emoji_reload")]);
    return Markup.inlineKeyboard(rows);
  }

  bot.command("emoji", async (ctx) => {
    await ctx.reply(emojiPanelText(), {
      parse_mode: "HTML",
      ...emojiPanelKeyboard(),
    });
  });

  bot.action("emoji_reload", async (ctx) => {
    await ctx.answerCbQuery("Reloading…").catch(() => {});
    await loadEmojiSettings();
    await safeEdit(ctx, emojiPanelText(), {
      parse_mode: "HTML",
      ...emojiPanelKeyboard(),
    });
  });

  // Edit a specific emoji slot
  const emojiKeys = Object.keys(EMOJI_SLOTS) as EmojiKey[];
  for (const key of emojiKeys) {
    bot.action(`emoji_edit_${key}`, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const uid  = ctx.from.id;
      const slot = EMOJI_SLOTS[key];
      const cur  = getEmojiId(key);
      const st   = getState(uid);
      st.awaitingText = "emoji_edit";
      st.emojiEditKey = key;
      await ctx.reply(
        `✏️ <b>Edit emoji: ${slot.fallback} ${key}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${slot.label}\n\n` +
        `<b>Current ID:</b> <code>${cur}</code>\n\n` +
        `Send a message containing your animated emoji (use /getemoji to find its ID first), <b>or</b> paste the numeric ID directly:\n\n` +
        `<i>Example: <code>5368324170671202286</code></i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("↩️ Reset to default", `emoji_reset_${key}`)],
            [Markup.button.callback("❌ Cancel",           "emoji_cancel")],
          ]),
        }
      );
    });

    bot.action(`emoji_reset_${key}`, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const uid  = ctx.from.id;
      const st   = getState(uid);
      st.awaitingText = undefined;
      st.emojiEditKey = undefined;
      await resetEmojiId(key);
      await ctx.reply(
        `✅ <b>${key}</b> reset to default: <code>${EMOJI_SLOTS[key].default}</code>`,
        { parse_mode: "HTML" }
      );
    });
  }

  bot.action("emoji_cancel", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const st = getState(ctx.from.id);
    st.awaitingText = undefined;
    st.emojiEditKey = undefined;
    await ctx.reply("❌ Cancelled.", { parse_mode: "HTML" });
  });

  // ── /stats ────────────────────────────────────────────────────────────────
  bot.command("stats", async (ctx) => {
    const { text, mode } = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: mode,
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    });
  });

  // ── Helper: dismiss reply keyboard then run handler ───────────────────────
  // Telegram's one_time_keyboard doesn't fully hide on desktop; sending
  // RemoveKeyboard is the only guaranteed way to clear it.
  async function handleMenu(ctx: any, fn: () => Promise<void>) {
    const d = await ctx.reply("\u200B", { ...Markup.removeKeyboard() }).catch(() => null);
    if (d) ctx.telegram.deleteMessage(ctx.chat.id, d.message_id).catch(() => {});
    await fn();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REPLY KEYBOARD handlers (hears)
  // ──────────────────────────────────────────────────────────────────────────

  const handleStats = (ctx: any) => handleMenu(ctx, async () => {
    const { text, mode } = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: mode,
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    });
  });
  bot.hears(KB.STATS, handleStats);
  bot.hears(/^statistics$/i, handleStats);

  const handleAccounts = (ctx: any) => handleMenu(ctx, async () => {
    await ctx.reply(
      `\n🔷 <b>ACCOUNTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Select a platform to view available accounts:`,
      { parse_mode: "HTML", ...(await inlineAccountTypes()) }
    );
  });
  bot.hears(KB.ACCOUNTS, handleAccounts);
  bot.hears(/^accounts$/i, handleAccounts);

  bot.hears(KB.COPY, (ctx) => handleMenu(ctx, async () => {
    getState(ctx.from.id).copyType = undefined;
    await ctx.reply(
      `\n🔷 <b>COPY ACCOUNTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Select a platform to export credentials for:`,
      { parse_mode: "HTML", ...(await inlineCopyTypes()) }
    );
  }));

  bot.hears(KB.CHECKOUT, (ctx) => handleMenu(ctx, async () => {
    const ready   = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    const sources = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'sold_out' AND coupon_extracted = false`);
    const processing = parseInt(ready.rows[0]?.cnt || "0");
    const sourceCnt  = parseInt(sources.rows[0]?.cnt || "0");
    const maxPossible = Math.min(sourceCnt * 3, processing, 100);
    getState(ctx.from.id).awaitingText = "checkout_count";
    await ctx.reply(
      `\n🔷 <b>CHECKOUT LINKS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📋  Processing targets  ·  <b>${processing}</b>\n` +
      `🔗  Coupon sources      ·  <b>${sourceCnt}</b>\n` +
      `📊  Max possible        ·  <b>${maxPossible}</b>\n\n` +
      `How many checkout links to generate? <i>(1–100)</i>\n` +
      `Each referral yields up to 3 links, sources chain automatically.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("3",  "chain_co_3"),
            Markup.button.callback("6",  "chain_co_6"),
            Markup.button.callback("9",  "chain_co_9"),
            Markup.button.callback("12", "chain_co_12"),
          ],
          [
            Markup.button.callback("15", "chain_co_15"),
            Markup.button.callback("30", "chain_co_30"),
            Markup.button.callback("50", "chain_co_50"),
            Markup.button.callback("100","chain_co_100"),
          ],
          [Markup.button.callback("✖ Cancel", "dismiss")],
        ]),
      }
    );
  }));

  bot.hears(KB.CREATE, (ctx) => handleMenu(ctx, async () => {
    getState(ctx.from.id).createFlow = {};
    await ctx.reply(
      `\n🔷 <b>CREATE ACCOUNTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Choose a platform to create accounts on:`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔵  Replit",   "cs_replit"),  Markup.button.callback("💜  Lovable",  "cs_lovable")],
          [Markup.button.callback("⚡  v0.dev",   "cs_v0"),      Markup.button.callback("🅰️  Adobe",    "cs_adobe")],
          [Markup.button.callback("🤖  ChatGPT",  "cs_chatgpt_biz")],
          [Markup.button.callback("✖  Cancel",    "create_cancel")],
        ]),
      }
    );
  }));

  bot.hears("🔄 Auto-Scan", (ctx) => handleMenu(ctx, async () => {
    const uid = ctx.from.id;
    if (runningScans.get(uid) === true) {
      return ctx.reply("A scan is already running. Send /cancel to stop it.");
    }
    const unchecked = await dbQuery(
      `SELECT COUNT(*) as cnt FROM replit_accounts WHERE coupon_extracted = false AND email != '' AND password IS NOT NULL AND password != ''`
    );
    const cnt = parseInt(unchecked.rows[0]?.cnt || "0");
    await ctx.reply(
      `*🔄 Auto-Scan Coupons*\n\n${cnt} unscanned accounts found.\n\nThis will log into each and check for a Replit coupon.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅ Start Scan (${cnt})`, "confirm_scan"), Markup.button.callback("❌ Cancel", "dismiss")],
        ]),
      }
    );
  }));

  bot.hears("🔥 Warm Accounts", (ctx) => handleMenu(ctx, async () => {
    const processing = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    await ctx.reply(
      `*🔥 Warm Accounts*\n\n⏳ Processing accounts: *${processing.rows[0]?.cnt || 0}*\n\nHow many to warm?`,
      { parse_mode: "Markdown", ...inlineWarm() }
    );
  }));

  bot.hears("🗑 Purge Banned", (ctx) => handleMenu(ctx, async () => {
    const processing = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    await ctx.reply(
      `*🗑 Purge Banned Accounts*\n\nWill scan *${processing.rows[0]?.cnt || 0}* processing accounts and permanently delete any that are banned.\n\n⚠️ Cannot be undone.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Confirm Purge", "confirm_purge"), Markup.button.callback("❌ Cancel", "dismiss")],
        ]),
      }
    );
  }));

  // ── Mail Generator ────────────────────────────────────────────────────────
  async function startMailSession(chatId: number, uid: number) {
    // Stop any existing session for this user
    const state = getState(uid);
    if (state.mailSession) state.mailSession.stopped = true;

    // Show loading message
    const loadMsg = await bot.telegram.sendMessage(chatId,
      `⏳ <b>Generating temp email...</b>`, { parse_mode: "HTML" }
    );

    let email: string, password: string, token: string, provider: string;
    try {
      const domain = await getAvailableDomain(true);
      const username = generateRandomUsername();
      email = `${username}@${domain}`;
      password = Math.random().toString(36).slice(2, 14) + "A1!";
      provider = detectProviderFromDomain(domain);
      await createTempEmail(email, password);
      token = await getAuthToken(email, password, provider as any);
    } catch (err: any) {
      await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
        `❌ <b>Failed to create temp email</b>\n<code>${esc(err.message?.substring(0, 100))}</code>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }

    const mailKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🔄 New Address", "mail_new"), Markup.button.callback("⏹ Stop", "mail_stop")],
    ]);

    // Edit loading message → inbox status card
    const statusText = () =>
      `📧 <b>Temp Inbox Active</b>\n\n` +
      `<code>${esc(email)}</code>\n` +
      `📋 <code>${esc(email)}</code>\n\n` +
      `⏳ <i>Waiting for emails... (auto-expires in 10 min)</i>`;

    await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
      statusText(), { parse_mode: "HTML", ...mailKeyboard }
    ).catch(() => {});

    const session: MailSession = {
      email, password, provider, token,
      seenIds: new Set(),
      stopped: false,
      statusMsgId: loadMsg.message_id,
      chatId,
    };
    state.mailSession = session;

    // Poll loop — every 5s for up to 10 minutes (120 polls)
    let polls = 0;
    const MAX_POLLS = 120;
    async function pollInbox() {
      if (session.stopped || polls++ >= MAX_POLLS) {
        if (!session.stopped) {
          await bot.telegram.editMessageText(chatId, session.statusMsgId, undefined,
            `📧 <b>Inbox Expired</b>\n\n<code>${esc(email)}</code>\n\n<i>Session timed out after 10 minutes.</i>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
        return;
      }
      try {
        const messages = await fetchMessages(token, provider as any);
        for (const msg of messages) {
          const id = msg.id || msg["@id"];
          if (!id || session.seenIds.has(id)) continue;
          session.seenIds.add(id);

          // Fetch full body
          let body = "";
          try { body = await fetchMessageContent(token, id, provider as any); } catch {}

          // Strip HTML tags and trim
          const plainBody = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 600);
          const from = msg.from?.address || msg.from?.name || "unknown";
          const subject = msg.subject || "(no subject)";
          const preview = plainBody || "(no text content)";

          await bot.telegram.sendMessage(chatId,
            `📬 <b>New Email!</b>\n\n` +
            `📧 <b>Inbox:</b> <code>${esc(email)}</code>\n` +
            `👤 <b>From:</b> <code>${esc(from)}</code>\n` +
            `📌 <b>Subject:</b> ${esc(subject)}\n\n` +
            `<pre>${esc(preview)}</pre>`,
            { parse_mode: "HTML" }
          ).catch(() => {});

          // Update status card with received count
          const count = session.seenIds.size;
          await bot.telegram.editMessageText(chatId, session.statusMsgId, undefined,
            `📧 <b>Temp Inbox Active</b>\n\n` +
            `<code>${esc(email)}</code>\n` +
            `📋 <code>${esc(email)}</code>\n\n` +
            `✅ <b>${count}</b> email${count === 1 ? "" : "s"} received so far`,
            { parse_mode: "HTML", ...mailKeyboard }
          ).catch(() => {});
        }
      } catch {}
      setTimeout(pollInbox, 5000);
    }
    setTimeout(pollInbox, 5000);
  }

  bot.hears(KB.MAIL, (ctx) => handleMenu(ctx, async () => {
    await ctx.reply(
      `📧 <b>MAIL</b>\n\nChoose a mail type:`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📨 Temp Mail", "mail_temp"), Markup.button.callback("💼 Business Mail", "biz_mail_new")],
          [Markup.button.callback("📦 Bulk Create", "biz_bulk_create"), Markup.button.callback("♻️ Restore Biz Mail", "biz_mail_restore")],
        ]),
      }
    );
  }));

  bot.action("mail_temp", async (ctx) => {
    await ctx.answerCbQuery("Generating temp address...").catch(() => {});
    const uid    = ctx.from!.id;
    const chatId = ctx.chat!.id;
    await startMailSession(chatId, uid);
  });

  // ── Business Mail (smtp.dev) ───────────────────────────────────────────────
  function genBizPassword(len = 14): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  function genRealisticUsername(): string {
    const first = ["james","john","robert","michael","william","david","richard","joseph","thomas","charles",
      "emma","olivia","ava","isabella","sophia","mia","charlotte","amelia","harper","evelyn",
      "noah","liam","mason","ethan","oliver","aiden","lucas","elijah","logan","jackson",
      "emily","abigail","madison","chloe","grace","lily","zoey","claire","layla","natalie",
      "daniel","matthew","samuel","henry","alexander","sebastian","jack","owen","ryan","nathan",
      "sarah","hannah","brooklyn","aaliyah","alexa","savannah","anna","stella","victoria","aria"];
    const last  = ["smith","johnson","williams","brown","jones","garcia","miller","davis","wilson","moore",
      "taylor","anderson","thomas","jackson","white","harris","martin","thompson","young","lee",
      "walker","allen","king","wright","scott","green","baker","adams","nelson","carter",
      "mitchell","perez","roberts","turner","phillips","campbell","parker","evans","edwards","collins",
      "stewart","morris","nguyen","rogers","reed","cook","morgan","bell","murphy","bailey"];
    const sep   = [".", "_", ""][Math.floor(Math.random() * 3)];
    const f     = first[Math.floor(Math.random() * first.length)];
    const l     = last[Math.floor(Math.random() * last.length)];
    // Occasionally add a short number suffix for uniqueness
    const suffix = Math.random() < 0.45 ? String(Math.floor(Math.random() * 99) + 1) : "";
    return `${f}${sep}${l}${suffix}`;
  }

  async function startBizMailSession(chatId: number, uid: number, opts: {
    requestedNum?: number;
    customUsername?: string;
  } = {}) {
    const state = getState(uid);
    if (state.bizMailSession) {
      state.bizMailSession.stopped = true;
    }

    const loadMsg = await bot.telegram.sendMessage(chatId,
      `⏳ <b>Creating business email account...</b>`,
      { parse_mode: "HTML" }
    );

    // Determine username & address
    let username: string;
    let isCustom = false;
    let accountNum: number | null = null;

    if (opts.customUsername) {
      username  = opts.customUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "");
      isCustom  = true;
    } else if (opts.requestedNum != null) {
      username   = `account${opts.requestedNum}`;
      accountNum = opts.requestedNum;
    } else {
      // Generate a realistic-looking name
      username   = genRealisticUsername();
      accountNum = null;
    }

    const address  = `${username}@addison.asia`;
    const password = genBizPassword();

    let accountId: string;
    try {
      const { account } = await smtpDevCreate(address, password);
      accountId = account.id;
    } catch (err: any) {
      await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
        `❌ <b>Failed to create business mail</b>\n<code>${esc(err.message?.substring(0, 300))}</code>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }

    const bizKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🔄 New Account", "biz_mail_new"),
       Markup.button.callback("✏️ Custom Name", "biz_mail_custom"),
       Markup.button.callback("⏹ Stop & Delete", "biz_mail_stop")],
      [Markup.button.callback("📬 Refresh Inbox", "biz_mail_refresh")],
    ]);

    const title = isCustom
      ? `💼 <b>Business Mail — Custom: ${esc(address)}</b>`
      : accountNum != null
        ? `💼 <b>Business Mail — Account #${accountNum}</b>`
        : `💼 <b>Business Mail — ${esc(address)}</b>`;

    const bizStatusCard =
      `${title}\n\n` +
      `📧 <b>Email:</b> <code>${esc(address)}</code>\n` +
      `🔑 <b>Password:</b> <code>${esc(password)}</code>\n\n` +
      `🌐 <b>Webmail:</b> <a href="https://app.smtp.dev">app.smtp.dev</a>\n` +
      `📮 <b>IMAP:</b> <code>imap.smtp.dev:993 (SSL)</code>\n` +
      `📤 <b>SMTP:</b> <code>smtp.smtp.dev:587 (STARTTLS)</code>\n\n` +
      `📬 <i>Inbox monitoring active — new emails will be forwarded here</i>`;

    await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
      bizStatusCard, { parse_mode: "HTML", ...bizKeyboard }
    ).catch(() => {});

    const seen = new Set<string>();

    const checkInbox = async (): Promise<number> => {
      let newCount = 0;
      const msgs = await smtpDevInbox(accountId);
      for (const msg of msgs) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        session.receivedCount++;
        newCount++;
        const body = (msg.text || msg.subject || "(no text content)").substring(0, 3000);
        await bot.telegram.sendMessage(chatId,
          `📬 <b>New Business Email!</b>\n\n` +
          `💼 <b>To:</b> <code>${esc(address)}</code>\n` +
          `👤 <b>From:</b> <code>${esc(msg.from)}</code>\n` +
          `📌 <b>Subject:</b> ${esc(msg.subject)}\n` +
          `📅 <b>Date:</b> ${new Date(msg.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n\n` +
          `<pre>${esc(body)}</pre>`,
          { parse_mode: "HTML" }
        ).catch((e: any) => console.error("[BizMail] Telegram send error:", e.message));
      }
      return newCount;
    };

    const session: BizMailSession = {
      email: address, password, accountId,
      accountNum, isCustom,
      stopped: false,
      statusMsgId: loadMsg.message_id,
      chatId,
      receivedCount: 0,
      checkInbox,
    };
    state.bizMailSession = session;

    // Auto-poll smtp.dev inbox every 1 second
    (async () => {
      while (!session.stopped) {
        try {
          await checkInbox();
        } catch (e: any) {
          console.error("[BizMail] Inbox poll error:", e.message);
        }
        await new Promise(r => setTimeout(r, 1_000));
      }
    })();
  }

  bot.action("biz_mail_new", async (ctx) => {
    await ctx.answerCbQuery("Creating account...").catch(() => {});
    await startBizMailSession(ctx.chat!.id, ctx.from!.id);
  });

  bot.action("biz_mail_refresh", async (ctx) => {
    const uid = ctx.from!.id;
    const state = getState(uid);
    const session = state.bizMailSession;
    if (!session || session.stopped) {
      await ctx.answerCbQuery("No active session.").catch(() => {});
      return;
    }
    try {
      await ctx.answerCbQuery("Checking inbox...").catch(() => {});
      const found = await session.checkInbox();
      if (found === 0) {
        await ctx.answerCbQuery("No new emails.").catch(() => {});
      } else {
        await ctx.answerCbQuery(`📬 ${found} new email${found > 1 ? "s" : ""} found!`).catch(() => {});
      }
    } catch (e: any) {
      await ctx.answerCbQuery("Error checking inbox.").catch(() => {});
      console.error("[BizMail] Manual refresh error:", e.message);
    }
  });

  // ── Bulk Business Mail Creation ───────────────────────────────────────────
  bot.action("biz_bulk_create", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid    = ctx.from!.id;
    const chatId = ctx.chat!.id;
    getState(uid).awaitingText = "biz_bulk_count";
    await bot.telegram.sendMessage(chatId,
      `📦 <b>Bulk Business Mail Creator</b>\n\n` +
      `How many <code>@addison.asia</code> email accounts do you want to create?\n\n` +
      `• Min: <b>1</b> &nbsp;•&nbsp; Max: <b>100,000</b>\n` +
      `• Accounts are created in parallel (10 at a time)\n` +
      `• Results delivered as a <code>.txt</code> file\n\n` +
      `<i>Reply with a number, e.g.</i> <code>50</code>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  });

  async function runBizBulkCreate(chatId: number, uid: number, total: number) {
    const progressMsg = await bot.telegram.sendMessage(chatId,
      `📦 <b>Bulk Creating ${total} Business Email(s)...</b>\n\n⏳ Starting...`,
      { parse_mode: "HTML" }
    ).catch(() => null);

    const BATCH = 10;
    const results: { email: string; password: string; ok: boolean; err?: string }[] = [];
    let done = 0;

    const updateProgress = async () => {
      if (!progressMsg) return;
      const ok  = results.filter(r => r.ok).length;
      const fail = results.filter(r => !r.ok).length;
      const pct  = Math.round((done / total) * 100);
      const bar  = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
      await bot.telegram.editMessageText(chatId, progressMsg.message_id, undefined,
        `📦 <b>Bulk Creating ${total} Business Email(s)...</b>\n\n` +
        `${bar} ${pct}%\n\n` +
        `✅ Created: <b>${ok}</b>\n` +
        `❌ Failed: <b>${fail}</b>\n` +
        `⏳ Remaining: <b>${total - done}</b>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    };

    // Process in batches of BATCH
    for (let i = 0; i < total; i += BATCH) {
      const batchSize = Math.min(BATCH, total - i);
      await Promise.all(
        Array.from({ length: batchSize }, async (_, j) => {
          const username = genRealisticUsername();
          const address  = `${username}@addison.asia`;
          const password = genBizPassword();
          try {
            await smtpDevCreate(address, password);
            results.push({ email: address, password, ok: true });
          } catch (err: any) {
            results.push({ email: address, password, ok: false, err: err.message?.substring(0, 80) });
          }
          done++;
        })
      );
      await updateProgress();
    }

    // Build result file
    const okList   = results.filter(r => r.ok);
    const failList = results.filter(r => !r.ok);
    const lines: string[] = [
      `# Bulk Business Mail — ${new Date().toISOString()}`,
      `# Total: ${total} | Created: ${okList.length} | Failed: ${failList.length}`,
      ``,
      `# ── Credentials (email:password) ──`,
      ...okList.map(r => `${r.email}:${r.password}`),
    ];
    if (failList.length > 0) {
      lines.push(``, `# ── Failed ──`);
      failList.forEach(r => lines.push(`# ${r.email} — ${r.err || "unknown error"}`));
    }
    const fileContent = lines.join("\n");
    const fileBuffer  = Buffer.from(fileContent, "utf8");

    // Edit progress to final summary
    if (progressMsg) {
      await bot.telegram.editMessageText(chatId, progressMsg.message_id, undefined,
        `✅ <b>Bulk Create Complete!</b>\n\n` +
        `📧 Total requested: <b>${total}</b>\n` +
        `✅ Successfully created: <b>${okList.length}</b>\n` +
        `❌ Failed: <b>${failList.length}</b>\n\n` +
        `<i>Sending credentials file...</i>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    }

    // Send the credentials as a file
    await bot.telegram.sendDocument(chatId, {
      source: fileBuffer,
      filename: `biz_mail_bulk_${total}_${Date.now()}.txt`,
    }, {
      caption: `📦 <b>${okList.length} Business Email Account(s) Created</b>\n` +
               `🌐 Webmail: <a href="https://app.smtp.dev">app.smtp.dev</a>\n` +
               `📮 IMAP: <code>imap.smtp.dev:993 (SSL)</code>\n` +
               `📤 SMTP: <code>smtp.smtp.dev:587 (STARTTLS)</code>`,
      parse_mode: "HTML",
    }).catch(async (e: any) => {
      // Fallback: send as plain text if file send fails
      console.error("[BizBulk] File send error:", e.message);
      const chunk = okList.slice(0, 50).map(r => `<code>${r.email}:${r.password}</code>`).join("\n");
      await bot.telegram.sendMessage(chatId,
        `📦 <b>Created ${okList.length} accounts</b> (showing first 50):\n\n${chunk}`,
        { parse_mode: "HTML" }
      ).catch(() => {});
    });
  }

  bot.action("biz_mail_custom", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid    = ctx.from!.id;
    const chatId = ctx.chat!.id;
    getState(uid).awaitingText = "biz_mail_custom_user";
    await bot.telegram.sendMessage(chatId,
      `✏️ <b>Enter a custom username</b> for the email\n\n` +
      `Example: type <code>john</code> to create <code>john@addison.asia</code>\n` +
      `Or type <code>myshop</code> to get <code>myshop@addison.asia</code>\n\n` +
      `<i>Allowed: letters, numbers, dots (.), hyphens (-), underscores (_)</i>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  });

  // ── Recreate / Restore biz mail account ──────────────────────────────────
  bot.action("biz_mail_restore", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid    = ctx.from!.id;
    const chatId = ctx.chat!.id;
    getState(uid).awaitingText = "biz_mail_restore_username";
    await bot.telegram.sendMessage(chatId,
      `♻️ <b>Recreate a Business Mail Account</b>\n\n` +
      `Type the username you want to create at <b>@addison.asia</b>.\n\n` +
      `Example: type <code>myshop</code> → <code>myshop@addison.asia</code>\n` +
      `Or type <code>account42</code> to recreate a numbered account.\n\n` +
      `<i>Allowed: letters, numbers, dots (.), hyphens (-), underscores (_)</i>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  });

  bot.action("biz_mail_stop", async (ctx) => {
    await ctx.answerCbQuery("Stopping session...").catch(() => {});
    const uid     = ctx.from!.id;
    const state   = getState(uid);
    const session = state.bizMailSession;
    if (session && !session.stopped) {
      session.stopped = true;
      await smtpDevDelete(session.accountId).catch(() => {});

      const username = session.email.split("@")[0];
      const recoverKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`♻️ Recreate ${username}`, `biz_recover_email_${encodeURIComponent(session.email)}`),
         Markup.button.callback("🆕 New Account", "biz_mail_new"),
         Markup.button.callback("✏️ Custom Name", "biz_mail_custom")],
      ]);

      await bot.telegram.editMessageText(session.chatId, session.statusMsgId, undefined,
        `💼 <b>Business Mail Stopped</b>\n\n` +
        `📧 <code>${esc(session.email)}</code>\n` +
        `📥 Total received: <b>${session.receivedCount}</b>\n\n` +
        `<i>Deleted from smtp.dev — address is free to recreate.</i>`,
        { parse_mode: "HTML", ...recoverKeyboard }
      ).catch(() => {});
      state.bizMailSession = undefined;
    }
  });

  // Recover by email (covers both numbered and custom accounts)
  bot.action(/^biz_recover_email_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Recovering...").catch(() => {});
    const uid      = ctx.from!.id;
    const chatId   = ctx.chat!.id;
    const rawEmail = decodeURIComponent(ctx.match[1]);
    const username = rawEmail.split("@")[0];
    // Numbered accounts: "account5" → requestedNum=5; custom: pass as customUsername
    const numMatch = username.match(/^account(\d+)$/i);
    if (numMatch) {
      await startBizMailSession(chatId, uid, { requestedNum: parseInt(numMatch[1], 10) });
    } else {
      await startBizMailSession(chatId, uid, { customUsername: username });
    }
  });

  // Recover a specific deleted numbered account by typing "account5"
  bot.hears(/^account(\d+)$/i, async (ctx) => {
    if (!ALLOWED.has(ctx.from!.id)) return;
    const uid    = ctx.from!.id;
    const chatId = ctx.chat!.id;
    const num    = parseInt(ctx.match[1], 10);
    await startBizMailSession(chatId, uid, { requestedNum: num });
  });

  // ── MoviesDrive ────────────────────────────────────────────────────────────
  bot.hears(KB.MOVIES, (ctx) => handleMenu(ctx, async () => {
    const lastStr = mdLastChecked
      ? mdLastChecked.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })
      : "Never";
    const statusLine = mdMonitorEnabled
      ? `<b>Monitor:</b> ON — every 3 min`
      : `<b>Monitor:</b> OFF`;
    const text =
      `<b>MoviesDrive Server</b>\n\n` +
      `${statusLine}\n` +
      `<b>Last Checked:</b> ${lastStr}\n` +
      `<b>New (this session):</b> ${mdNewCountSession}\n` +
      `<b>Seen total:</b> ${mdSeenLinks.size}\n\n` +
      `<i>Notifications are sent as photos when new movies appear.</i>`;
    await ctx.reply(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Latest Movies", "md_latest"), Markup.button.callback("Check Now", "md_check_now")],
        [Markup.button.callback(mdMonitorEnabled ? "Turn OFF Monitor" : "Turn ON Monitor", "md_toggle")],
        [Markup.button.url("Open Website", "https://new1.moviesdrives.my/")],
      ]),
    });
  }));

  bot.action("md_toggle", async (ctx) => {
    await ctx.answerCbQuery(mdMonitorEnabled ? "Monitor paused." : "Monitor resumed.").catch(() => {});
    mdMonitorEnabled = !mdMonitorEnabled;
    const lastStr = mdLastChecked
      ? mdLastChecked.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })
      : "Never";
    const text =
      `<b>MoviesDrive Server</b>\n\n` +
      `<b>Monitor:</b> ${mdMonitorEnabled ? "ON — every 3 min" : "OFF"}\n` +
      `<b>Last Checked:</b> ${lastStr}\n` +
      `<b>New (this session):</b> ${mdNewCountSession}\n` +
      `<b>Seen total:</b> ${mdSeenLinks.size}\n\n` +
      `<i>Notifications are sent as photos when new movies appear.</i>`;
    await safeEdit(ctx, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Latest Movies", "md_latest"), Markup.button.callback("Check Now", "md_check_now")],
        [Markup.button.callback(mdMonitorEnabled ? "Turn OFF Monitor" : "Turn ON Monitor", "md_toggle")],
        [Markup.button.url("Open Website", "https://new1.moviesdrives.my/")],
      ]),
    });
  });

  bot.action("md_check_now", async (ctx) => {
    await ctx.answerCbQuery("Checking MoviesDrive...").catch(() => {});
    const movies = await fetchMDMovies();
    if (!movies.length) {
      await safeEdit(ctx, "<b>MoviesDrive</b>\n\nFailed to fetch movies. Site may be down.", { parse_mode: "HTML" });
      return;
    }
    mdLastChecked = new Date();
    const newMovies = movies.filter(m => !mdSeenLinks.has(m.link));
    newMovies.forEach(m => mdSeenLinks.add(m.link));
    if (newMovies.length > 0) {
      mdNewCountSession += newMovies.length;
      // Broadcast to all bots' allowed users
      for (const entry of activeBots) {
        await mdBroadcast(newMovies, entry.tg, entry.getAllowedIds());
      }
    }
    const lastStr = mdLastChecked.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
    await safeEdit(ctx,
      `<b>MoviesDrive — Checked</b>\n\n` +
      `<b>Checked:</b> ${lastStr}\n` +
      `<b>New found:</b> ${newMovies.length}\n` +
      `<b>Total on page:</b> ${movies.length}\n\n` +
      (newMovies.length > 0 ? `Sent ${newMovies.length} notification(s).` : `No new movies since last check.`),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Latest Movies", "md_latest"), Markup.button.callback("Check Now", "md_check_now")],
          [Markup.button.callback(mdMonitorEnabled ? "Turn OFF Monitor" : "Turn ON Monitor", "md_toggle")],
          [Markup.button.url("Open Website", "https://new1.moviesdrives.my/")],
        ]),
      }
    );
  });

  bot.action("md_latest", async (ctx) => {
    await ctx.answerCbQuery("Fetching latest...").catch(() => {});
    const movies = await fetchMDMovies();
    if (!movies.length) {
      await safeEdit(ctx, "<b>MoviesDrive</b>\n\nFailed to fetch movies.", { parse_mode: "HTML" });
      return;
    }
    const top = movies.slice(0, 15);
    const lines = top.map((m, i) =>
      `<b>${i + 1}.</b> <a href="${m.link}">${escapeHtml(m.title.length > 80 ? m.title.slice(0, 80) + "…" : m.title)}</a>`
    );
    await safeEdit(ctx,
      `<b>MoviesDrive — Latest ${top.length}</b>\n\n${lines.join("\n\n")}`,
      {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Refresh", "md_latest"), Markup.button.callback("Check New", "md_check_now")],
          [Markup.button.url("Open Website", "https://new1.moviesdrives.my/")],
        ]),
      }
    );
  });

  bot.action("mail_new", async (ctx) => {
    await ctx.answerCbQuery("Generating new address...").catch(() => {});
    const uid = ctx.from!.id;
    const chatId = ctx.chat!.id;
    // Stop old session
    const state = getState(uid);
    if (state.mailSession) state.mailSession.stopped = true;
    await startMailSession(chatId, uid);
  });

  bot.action("mail_stop", async (ctx) => {
    await ctx.answerCbQuery("Inbox stopped.").catch(() => {});
    const uid = ctx.from!.id;
    const state = getState(uid);
    const session = state.mailSession;
    if (session) {
      session.stopped = true;
      await bot.telegram.editMessageText(session.chatId, session.statusMsgId, undefined,
        `📧 <b>Inbox Stopped</b>\n\n<code>${esc(session.email)}</code>\n\n<i>Session ended by user.</i>`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      state.mailSession = undefined;
    }
  });

  bot.hears("⚙ Settings", (ctx) => handleMenu(ctx, async () => {
    const rows = await dbQuery(`SELECT key, value FROM settings WHERE key IN ('residential_proxy_url','capsolver_api_key','zenrows_api_key','fivesim_api_key')`);
    const map: Record<string, string> = {};
    rows.rows.forEach((r: any) => { map[r.key] = r.value; });
    const mask = (v: string) => v ? `${v.slice(0, 16)}…` : "not set";
    await ctx.reply(
      `\n🔷 <b>⚙ SETTINGS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>◈ Proxy      →  ${mask(map["residential_proxy_url"] || "")}\n` +
      `◈ Capsolver  →  ${mask(map["capsolver_api_key"] || "")}\n` +
      `◈ ZenRows    →  ${mask(map["zenrows_api_key"] || "")}\n` +
      `◈ 5sim       →  ${mask(map["fivesim_api_key"] || "")}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🌐 Update Proxy", "update_proxy")],
        ]),
      }
    );
  }));

  bot.hears("❓ Help", (ctx) => handleMenu(ctx, async () => {
    await ctx.reply(
      `\n🔷 <b>❓ HELP</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Use <b>/menu</b> to open the command panel\n\n` +
      `<code>⚡ Database Status          →  live account counts\n` +
      `🗄 Available Accounts       →  browse by status\n` +
      `📋 Copy Accounts            →  export credentials to chat\n` +
      `🔗 Checkout Link Generator  →  generate Stripe links\n` +
      `🏗 Create New Accounts      →  spin up new accounts\n` +
      `📧 Mail Generator           →  temporary email generator\n` +
      `🎬 Movies Server            →  MoviesDrive scraper\n` +
      `🛒 Marketplace              →  shop admin panel\n` +
      `💳 Payment Gateway          →  payment methods & addresses</code>\n\n` +
      `› /cancel — abort a running scan`,
      { parse_mode: "HTML" }
    );
  }));

  // ──────────────────────────────────────────────────────────────────────────
  // INLINE KEYBOARD callbacks
  // ──────────────────────────────────────────────────────────────────────────

  bot.action("refresh_stats", async (ctx) => {
    await ctx.answerCbQuery("Refreshing...").catch(() => {});
    const { text, mode } = await buildStatsText();
    await ctx.editMessageText(text, {
      parse_mode: mode,
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    }).catch(() => {});
  });

  bot.action("dismiss", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  // Accounts list
  const LIST_STATUSES: Record<string, string | null> = {
    list_all: null, list_processing: "processing", list_sold_out: "sold_out",
    list_working: "working", list_available: "available", list_error: "error",
  };
  for (const [action, status] of Object.entries(LIST_STATUSES)) {
    bot.action(action, async (ctx) => {
      await ctx.answerCbQuery();
      const rows = status
        ? (await dbQuery(`SELECT email, status, checkout_url, coupon_code FROM replit_accounts WHERE status = $1 ORDER BY created_at DESC LIMIT 40`, [status])).rows
        : (await dbQuery(`SELECT email, status, checkout_url, coupon_code FROM replit_accounts ORDER BY created_at DESC LIMIT 40`)).rows;

      const label = status ? status.replace("_", " ") : "All";
      let msg = `*👥 ${label}* (${rows.length}${rows.length === 40 ? "+" : ""})\n\n`;
      for (const row of rows) {
        const extras = [row.checkout_url ? "🔗" : "", row.coupon_code ? "🎟" : ""].filter(Boolean).join("");
        msg += `${statusEmoji(row.status)} \`${row.email}\` ${extras}\n`;
      }
      if (rows.length === 0) msg += "_No accounts._";

      // Edit or send new
      try {
        await ctx.editMessageText(msg, { parse_mode: "Markdown", ...inlineAccounts() });
      } catch {
        await ctx.reply(msg, { parse_mode: "Markdown", ...inlineAccounts() });
      }
    });
  }

  // ── Account type browser (new flow) ────────────────────────────────────────

  // Back button — show type picker again
  bot.action("show_account_types", async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText("*👥 Accounts* — select an account type:", {
        parse_mode: "Markdown",
        ...(await inlineAccountTypes()),
      });
    } catch {
      await ctx.reply("*👥 Accounts* — select an account type:", {
        parse_mode: "Markdown",
        ...(await inlineAccountTypes()),
      });
    }
  });

  // Step 1: account type selected → show status filter
  bot.action(/^at_([a-z]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const acctType = (ctx.match as RegExpMatchArray)[1];
    const cfg = ACCOUNT_TYPE_CONFIGS[acctType];
    if (!cfg) return;
    getState(ctx.from.id).accountType = acctType;
    try {
      await ctx.editMessageText(`*${cfg.emoji} ${cfg.label} Accounts* — select a status:`, {
        parse_mode: "Markdown",
        ...inlineAccountStatus(acctType),
      });
    } catch {
      await ctx.reply(`*${cfg.emoji} ${cfg.label} Accounts* — select a status:`, {
        parse_mode: "Markdown",
        ...inlineAccountStatus(acctType),
      });
    }
  });

  // Step 2: status selected → list accounts with passwords
  bot.action(/^as_([a-z]+)_([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery("Loading...");
    const m = ctx.match as RegExpMatchArray;
    const acctType = m[1];
    const statusKey = m[2];
    const cfg = ACCOUNT_TYPE_CONFIGS[acctType];
    if (!cfg) return;

    const status = statusKey === "all" ? null : statusKey.replace(/_/g, "_"); // keep underscores as-is

    // Build query based on type
    let rows: any[];
    if (status) {
      rows = (await dbQuery(
        `SELECT email, password, status${cfg.extraCols.length ? ", " + cfg.extraCols.join(", ") : ""} FROM ${cfg.table} WHERE status = $1 ORDER BY created_at DESC LIMIT 30`,
        [status]
      )).rows;
    } else {
      rows = (await dbQuery(
        `SELECT email, password, status${cfg.extraCols.length ? ", " + cfg.extraCols.join(", ") : ""} FROM ${cfg.table} ORDER BY created_at DESC LIMIT 30`
      )).rows;
    }

    const statusLabel = status ? status.replace(/_/g, " ") : "All";
    const header = `*${cfg.emoji} ${cfg.label} — ${statusLabel}* (${rows.length}${rows.length === 30 ? "+" : ""})\n\n`;

    if (rows.length === 0) {
      try {
        await ctx.editMessageText(header + "_No accounts found._", {
          parse_mode: "Markdown",
          ...inlineAccountStatus(acctType),
        });
      } catch {
        await ctx.reply(header + "_No accounts found._", {
          parse_mode: "Markdown",
          ...inlineAccountStatus(acctType),
        });
      }
      return;
    }

    // Send individual credential cards (one per account) — each copyable
    await ctx.deleteMessage().catch(() => {});
    let sentCount = 0;
    for (const row of rows) {
      const email = row.email || "";
      const pass = row.password || "";
      let card = `${cfg.emoji} *${cfg.label} Account*\n`;
      card += `📧 \`${email}\`\n`;
      card += `🔑 \`${pass}\`\n`;
      if (row.status) card += `📊 Status: \`${row.status}\`\n`;
      if (row.coupon_code) card += `🎟 Coupon: \`${row.coupon_code}\`\n`;
      if (row.credits != null) card += `💰 Credits: ${row.credits}\n`;
      card += `\n📋 \`${email}:${pass}\``;
      await ctx.reply(card, { parse_mode: "Markdown" });
      sentCount++;
    }

    // Footer with navigation back
    await ctx.reply(
      `✅ *${sentCount}* ${cfg.emoji} ${cfg.label} accounts shown.`,
      { parse_mode: "Markdown", ...inlineAccountStatus(acctType) }
    );
  });

  // ── Copy Accounts: type → options flow ──────────────────────────────────────

  // Back to type picker for copy
  bot.action("show_copy_types", async (ctx) => {
    await ctx.answerCbQuery();
    getState(ctx.from.id).copyType = undefined;
    try {
      await ctx.editMessageText("*📋 Copy Accounts* — select an account type:", {
        parse_mode: "Markdown",
        ...(await inlineCopyTypes()),
      });
    } catch {
      await ctx.reply("*📋 Copy Accounts* — select an account type:", {
        parse_mode: "Markdown",
        ...(await inlineCopyTypes()),
      });
    }
  });

  // Type selected → show count/status picker
  bot.action(/^ct_([a-z]+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const acctType = (ctx.match as RegExpMatchArray)[1];
    const cfg = ACCOUNT_TYPE_CONFIGS[acctType];
    if (!cfg) return;
    getState(ctx.from.id).copyType = acctType;
    try {
      await ctx.editMessageText(
        `*${cfg.emoji} Copy ${cfg.label} Accounts* — choose status and count:`,
        { parse_mode: "Markdown", ...(await inlineCopyOptions(acctType)) }
      );
    } catch {
      await ctx.reply(
        `*${cfg.emoji} Copy ${cfg.label} Accounts* — choose status and count:`,
        { parse_mode: "Markdown", ...(await inlineCopyOptions(acctType)) }
      );
    }
  });

  // Copy callbacks — use stored copyType to query the right table
  bot.action(/^copy_(.+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Copying...");
    await ctx.deleteMessage().catch(() => {});
    const m = ctx.match as RegExpMatchArray;
    await doCopy(ctx, m[1], parseInt(m[2]), undefined, getState);
  });

  bot.action("copy_custom", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    const type = getState(uid).copyType || "replit";
    const cfg = ACCOUNT_TYPE_CONFIGS[type];
    getState(uid).awaitingText = "custom_copy";
    const statusHints = cfg?.statuses.filter(s => s.value).map(s => s.value).join(", ") || "processing, sold_out";
    await ctx.reply(
      `*${cfg?.emoji || "📋"} ${cfg?.label || "Replit"} — Custom Copy*\n\nSend: \`count status\`\nExample: \`15 ${cfg?.statuses.find(s=>s.value)?.value || "processing"}\`\nAvailable statuses: \`${statusHints}\``,
      { parse_mode: "Markdown" }
    );
  });

  // Apply status
  bot.action("apply_sold_out", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "sold_out", getState); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_working", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "working", getState); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_processing", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "processing", getState); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_available", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "available", getState); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_dismiss", async (ctx) => {
    await ctx.answerCbQuery();
    getState(ctx.from.id).lastCopiedIds = undefined;
    await ctx.deleteMessage().catch(() => {});
  });

  // ── Create flow: service selection ───────────────────────────────────────
  bot.action(/^cs_(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const svcKey = (ctx.match as RegExpMatchArray)[1];
    if (!SERVICE_CONFIGS[svcKey]) return ctx.reply("Unknown service.");
    const uid = ctx.from.id;
    const st = getState(uid);
    if (!st.createFlow) st.createFlow = {};
    st.createFlow.service = svcKey;
    await ctx.deleteMessage().catch(() => {});
    await showCountPicker(ctx, uid, getState);
  });

  bot.action("create_back_svc", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).createFlow = {};
    await ctx.editMessageText(
      `*🏗 Create Accounts*\n\nWhich service?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔵 Replit",  "cs_replit"),  Markup.button.callback("💜 Lovable", "cs_lovable")],
          [Markup.button.callback("⚡ v0.dev",  "cs_v0"),      Markup.button.callback("🅰️ Adobe",   "cs_adobe")],
          [Markup.button.callback("🤖 ChatGPT", "cs_chatgpt_biz")],
          [Markup.button.callback("❌ Cancel",  "create_cancel")],
        ]),
      }
    );
  });

  // ── Create flow: count selection ─────────────────────────────────────────
  async function afterCountChosen(ctx: any, uid: number) {
    const flow = getState(uid).createFlow!;
    const svc = SERVICE_CONFIGS[flow.service!];
    await ctx.deleteMessage().catch(() => {});
    if (svc.hasCoupon) {
      await showCouponStep(ctx);
    } else if (svc.hasReferral) {
      await showReferralStep(ctx);
    } else {
      // No extra options — skip to summary
      if (svc.hasCard) { flow.cardId = ""; flow.cardLabel = "none"; }
      await showCreateSummary(ctx, uid, getState);
    }
  }

  bot.action(/^cn_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    const uid = ctx.from.id;
    const st = getState(uid);
    if (!st.createFlow) st.createFlow = {};
    st.createFlow.count = count;
    await afterCountChosen(ctx, uid);
  });

  bot.action("cn_custom", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).awaitingText = "create_count";
    await ctx.editMessageText(`› Type the custom <b>count</b>:`, { parse_mode: "HTML" });
  });

  // ── Create flow: coupon step ──────────────────────────────────────────────
  bot.action("create_enter_coupon", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).awaitingText = "coupon_code";
    await ctx.editMessageText(`› Type the <b>coupon code</b>:`, { parse_mode: "HTML" });
  });

  bot.action("create_skip_coupon", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    const st = getState(uid);
    st.createFlow!.couponCode = "";
    await ctx.deleteMessage().catch(() => {});
    await showCardStep(ctx, uid, getState);
  });

  bot.action("create_change_coupon", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    await showCouponStep(ctx);
  });

  bot.action("create_change_count", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    await ctx.deleteMessage().catch(() => {});
    await showCountPicker(ctx, uid, getState);
  });

  // ── Create flow: referral URL step (Lovable) ──────────────────────────────
  bot.action("create_enter_referral", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).awaitingText = "referral_url";
    await ctx.editMessageText(
      `› Type the <b>referral URL</b>:\n<code>  must start with https://lovable.dev/</code>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action("create_skip_referral", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).createFlow!.referralUrl = "";
    await ctx.deleteMessage().catch(() => {});
    await showCreateSummary(ctx, uid, getState);
  });

  // ── Create flow: card step ────────────────────────────────────────────────
  bot.action("create_skip_card", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    const st = getState(uid);
    st.createFlow!.cardId = "";
    st.createFlow!.cardLabel = "none";
    await ctx.deleteMessage().catch(() => {});
    await showCreateSummary(ctx, uid, getState);
  });

  bot.action(/^ccard_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    const cardId = (ctx.match as RegExpMatchArray)[1];
    // Look up display label
    const row = await dbQuery(`SELECT cardholder_name, card_number FROM saved_cards WHERE id = $1`, [cardId]);
    const c = row.rows[0];
    const label = c ? `${c.cardholder_name || "Card"} *${c.card_number?.slice(-4) || "????"}` : cardId;
    const st = getState(uid);
    st.createFlow!.cardId = cardId;
    st.createFlow!.cardLabel = label;
    await ctx.deleteMessage().catch(() => {});
    await showCreateSummary(ctx, uid, getState);
  });

  // ── Live log streaming ────────────────────────────────────────────────────
  // All messages use HTML parse_mode — Markdown silently fails on log lines
  // that contain underscores (emails), box-drawing chars (━ │ └), etc.
  function esc(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function streamBatchLogs(
    chatId: number, msgId: number,
    batchId: string, svc: ServiceConfig, totalCount: number, startTime: number,
    adminUid: number
  ) {
    let since = 0;
    let allLines: string[] = [];
    let pollCount = 0;
    const MAX_POLLS = 240; // 240 × 3s = 12 min max
    const sentCheckoutUrls = new Set<string>(); // track already-sent checkout links

    function elapsed() {
      const s = Math.round((Date.now() - startTime) / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    }

    const completionKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback("👁 View This Batch", "view_last_batch"), Markup.button.callback("🏗 Create More", "create_more")],
    ]);

    async function poll() {
      try {
        if (pollCount++ > MAX_POLLS) {
          await bot.telegram.editMessageText(chatId, msgId, undefined,
            `⏱ <b>Timed out</b> — batch may still be running in the panel.\n<code>${esc(batchId)}</code>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
          return;
        }

        const r = await botApi(`/api/batch-logs/${batchId}?since=${since}`);
        if (!r.ok) { setTimeout(poll, 3000); return; }

        const { logs, nextSince } = r.data;
        since = nextSince;

        let seenBatchComplete = false;
        for (const l of (logs as Array<{message: string}> || [])) {
          if (!l.message) continue;
          if (l.message === "Batch complete") { seenBatchComplete = true; continue; }
          allLines.push(l.message);
        }

        // ── Real-time checkout URL delivery ──
        // Send each new CHECKOUT_URL immediately as it appears (don't wait for batch end)
        const newCheckouts = allLines
          .filter(l => l.startsWith("CHECKOUT_URL|"))
          .map(l => { const parts = l.split("|"); return { email: parts[1], url: parts[2], accountId: parts[3] || "" }; })
          .filter(c => c.email && c.url && !sentCheckoutUrls.has(c.url));
        for (const c of newCheckouts) {
          sentCheckoutUrls.add(c.url);
          const kbd = Markup.inlineKeyboard([
            [Markup.button.url(`🔗 Open Checkout Link`, c.url)],
            ...(c.accountId ? [[
              Markup.button.callback(`📊 Status: working`, `link_status_${c.accountId}`),
              Markup.button.callback(`✅ Completed`, `link_done_${c.accountId}`),
            ]] : []),
          ]);
          await bot.telegram.sendMessage(chatId,
            `🔗 <b>Checkout Link Ready!</b>\n\n` +
            `📧 <code>${esc(c.email)}</code>\n` +
            `<code>${esc(c.url)}</code>`,
            { parse_mode: "HTML", disable_web_page_preview: true, ...kbd }
          ).catch(() => {});
        }

        // Only mark done when we see the 🏁 summary line or "Batch complete"
        // sentinel — never trust isComplete alone ([].every() is always true)
        const hasDoneLine = allLines.some(l => l.startsWith("🏁"));
        const done = hasDoneLine || seenBatchComplete;

        if (done) {
          const doneLog = allLines.find(l => l.startsWith("🏁")) || "";
          const created = parseInt(doneLog.match(/(\d+) created/)?.[1] || "0");
          const failed  = parseInt(doneLog.match(/(\d+) failed/)?.[1] || "0");
          const time = elapsed();

          // Use real total (created+failed) — don't use totalCount for checkout (it's 1)
          const displayTotal = totalCount > 1 ? totalCount : (created + failed) || 1;
          const successRate = Math.round((created / displayTotal) * 100);
          const bars = created > 0
            ? "█".repeat(Math.min(created, 10)) + (failed > 0 ? "░".repeat(Math.min(failed, 5)) : "")
            : (failed > 0 ? "░".repeat(Math.min(failed, 10)) : "");

          // Extract any CHECKOUT_URL|email|url markers from all accumulated lines
          const checkoutLinks = allLines
            .filter(l => l.startsWith("CHECKOUT_URL|"))
            .map(l => { const [, email, url] = l.split("|"); return { email, url }; })
            .filter(c => c.email && c.url);

          // Step 1: flash
          await bot.telegram.editMessageText(chatId, msgId, undefined,
            `⚡ <b>Finalising results...</b>`, { parse_mode: "HTML" }
          ).catch(() => {});

          await new Promise(res => setTimeout(res, 500));

          // Step 2: polished completion card (edit the live-log message)
          await bot.telegram.editMessageText(chatId, msgId, undefined,
            `🎉 <b>Batch Complete!</b>\n\n` +
            `${svc.emoji} <b>${esc(svc.label)}</b> — ${displayTotal} processed\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `✅  Created: <b>${created}</b>\n` +
            `❌  Failed:  <b>${failed}</b>\n` +
            `📊  Success: <b>${successRate}%</b>  <code>${esc(bars || "—")}</code>\n` +
            `⏱   Time:    <b>${time}</b>`,
            { parse_mode: "HTML", ...completionKeyboard }
          ).catch(() => {});

          // Step 2.5: send credential cards for every account created in this batch
          if (created > 0 && !isNaN(created) && svc.outlookTable) {
            const acctTable = svc.outlookTable;
            try {
              const batchStart = new Date(startTime).toISOString();
              const newAccounts = (await dbQuery(
                `SELECT id, email, password, coupon_code FROM ${acctTable}
                 WHERE created_at >= $1 AND (error IS NULL OR error = '')
                 ORDER BY created_at DESC LIMIT $2`,
                [batchStart, created]
              )).rows;

              // Store batch IDs so "View This Batch" shows only these accounts
              getState(adminUid).lastBatchAccountIds = newAccounts.map((r: any) => String(r.id));
              getState(adminUid).lastBatchTable = acctTable;

              for (const row of newAccounts) {
                const em = row.email || "";
                const pw = row.password || "";
                let card = `${svc.emoji} <b>${esc(svc.label)} Account</b>\n`;
                card += `📧 <code>${esc(em)}</code>\n`;
                card += `🔑 <code>${esc(pw)}</code>\n`;
                if (row.coupon_code) card += `🎟 <code>${esc(row.coupon_code)}</code>\n`;
                card += `\n📋 <code>${esc(em + ":" + pw)}</code>`;
                await bot.telegram.sendMessage(chatId, card, { parse_mode: "HTML" }).catch(() => {});
              }
            } catch (e: any) {
              console.error("[Bot] failed to fetch new accounts:", e.message);
            }
          }

          // Step 3: alert at bottom of chat
          const isCheckout = checkoutLinks.length > 0;
          await bot.telegram.sendMessage(chatId,
            isCheckout
              ? `🔔 <b>Checkout links ready!</b>\n\n` +
                `${svc.emoji} <b>${esc(svc.label)}</b> — ` +
                `✅ <b>${created}</b> generated  ❌ <b>${failed}</b> failed  ⏱ ${time}`
              : `🔔 <b>Account creation done!</b>\n\n` +
                `${svc.emoji} <b>${esc(svc.label)}</b> — ` +
                `✅ <b>${created}</b> created  ❌ <b>${failed}</b> failed  ⏱ ${time}`,
            { parse_mode: "HTML", ...completionKeyboard }
          ).catch(() => {});

          // Step 4: for checkout — only send links not already delivered in real-time
          if (checkoutLinks.length > 0) {
            const unsentLinks = checkoutLinks.filter(c => !sentCheckoutUrls.has(c.url));
            if (unsentLinks.length > 0) {
              const linkLines = unsentLinks
                .map((c, i) =>
                  `<b>${i + 1}. ${esc(c.email)}</b>\n` +
                  `<a href="${esc(c.url)}">🔗 Open Checkout</a>\n` +
                  `<code>${esc(c.url)}</code>`
                )
                .join("\n\n");
              await bot.telegram.sendMessage(chatId,
                `🔗 <b>Checkout Links (${unsentLinks.length} remaining)</b>\n\n${linkLines}`,
                { parse_mode: "HTML", disable_web_page_preview: true }
              ).catch(() => {});
            } else if (sentCheckoutUrls.size > 0) {
              await bot.telegram.sendMessage(chatId,
                `✅ All ${sentCheckoutUrls.size} checkout link(s) already delivered above.`,
                { parse_mode: "HTML" }
              ).catch(() => {});
            }
          }

          return;
        }

        // Rolling live log view — last 15 lines (skip internal CHECKOUT_URL markers)
        const display = allLines.filter(l => !l.startsWith("CHECKOUT_URL|")).slice(-15).map(esc).join("\n");
        const time = elapsed();

        await bot.telegram.editMessageText(chatId, msgId, undefined,
          `⏳ <b>${svc.emoji} ${esc(svc.label)} × ${totalCount}</b> — ⏱ ${time}\n\n<pre>${display}</pre>`,
          { parse_mode: "HTML" }
        ).catch((err) => console.error("[Bot] edit failed:", err.message));

        setTimeout(poll, 3000);
      } catch (err: any) {
        console.error("[Bot] poll error:", err.message);
        setTimeout(poll, 4000);
      }
    }

    setTimeout(poll, 2000);
  }

  // ── Create flow: confirm ──────────────────────────────────────────────────
  bot.action("create_confirm", async (ctx) => {
    const uid = ctx.from.id;
    if (isRateLimited(uid, "create_confirm", 10_000)) {
      await ctx.answerCbQuery("⏳ Please wait before starting another batch.").catch(() => {});
      return;
    }
    await ctx.answerCbQuery("Starting...");
    const flow = getState(uid).createFlow;
    if (!flow?.count || !flow.service) return ctx.reply("Flow lost — start again with 🏗 Create Accounts.");

    const svc = SERVICE_CONFIGS[flow.service];
    const body: any = { count: flow.count };
    if (svc.hasCoupon && flow.couponCode) body.couponCode = flow.couponCode;
    if (svc.hasCard && flow.cardId) body.cardId = flow.cardId;
    if (svc.hasReferral && flow.referralUrl) body.referralUrl = flow.referralUrl;

    const r = await botApi(svc.endpoint, "POST", body);
    getState(uid).createFlow = undefined;

    if (!r.ok) {
      await ctx.editMessageText(`🔴  <b>Failed:</b> <code>${r.data?.error || "Unknown error"}</code>`, { parse_mode: "HTML" });
      return;
    }

    const batchId = r.data.batchId as string;
    const startTime = Date.now();

    // Replace summary message with live log view (HTML mode — Markdown breaks on emails/box chars)
    await ctx.editMessageText(
      `⏳ <b>${svc.emoji} ${esc(svc.label)} × ${flow.count}</b> — starting up...\n\n<pre>Connecting to batch...</pre>`,
      { parse_mode: "HTML" }
    );

    const chatId = ctx.chat!.id;
    const msgId = ctx.callbackQuery.message!.message_id;
    await streamBatchLogs(chatId, msgId, batchId, svc, flow.count, startTime, uid);
  });

  bot.action("create_more", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
    const uid = ctx.from.id;
    getState(uid).createFlow = {};
    await ctx.reply(
      `*🏗 Create Accounts*\n\nWhich service?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔵 Replit",  "cs_replit"),  Markup.button.callback("💜 Lovable", "cs_lovable")],
          [Markup.button.callback("⚡ v0.dev",  "cs_v0"),      Markup.button.callback("🅰️ Adobe",   "cs_adobe")],
          [Markup.button.callback("🤖 ChatGPT", "cs_chatgpt_biz")],
          [Markup.button.callback("❌ Cancel",  "create_cancel")],
        ]),
      }
    );
  });

  // ── View last batch accounts ──────────────────────────────────────────────
  bot.action("view_last_batch", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    const st  = getState(uid);
    const ids   = st.lastBatchAccountIds;
    const table = st.lastBatchTable;

    if (!ids || ids.length === 0 || !table) {
      return ctx.reply(`⚠️ No batch data found. It may have expired — use Copy Accounts to browse all.`, { parse_mode: "HTML" });
    }

    const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(",");
    const res = await dbQuery(
      `SELECT id, email, password, coupon_code FROM ${table}
       WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
      ids
    );

    if (res.rows.length === 0) {
      return ctx.reply(`⚠️ Could not retrieve accounts for this batch.`, { parse_mode: "HTML" });
    }

    const svcEntry = Object.values(SERVICE_CONFIGS).find((s: any) => s.outlookTable === table) as any;
    const svcEmoji = svcEntry?.emoji ?? "🔵";
    const svcLabel = svcEntry?.label ?? table;

    const header = `${svcEmoji}  <b>${escapeHtml(svcLabel)} — Batch (${res.rows.length} account${res.rows.length !== 1 ? "s" : ""})</b>\n\n`;
    const cards = res.rows.map((row: any, i: number) => {
      const em = row.email || "";
      const pw = row.password || "";
      let card = `<b>#${i + 1}</b>  <code>${escapeHtml(em)}</code>\n`;
      card += `🔑  <code>${escapeHtml(pw)}</code>`;
      if (row.coupon_code) card += `\n🎟  <code>${escapeHtml(row.coupon_code)}</code>`;
      return card;
    }).join("\n\n");

    const chunks = [];
    let current = header;
    for (const card of cards.split("\n\n")) {
      if ((current + "\n\n" + card).length > 3800) {
        chunks.push(current);
        current = card;
      } else {
        current += (current === header ? "" : "\n\n") + card;
      }
    }
    chunks.push(current);

    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "HTML" });
    }
  });

  bot.action("create_cancel", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).createFlow = undefined;
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply("Cancelled.");
  });

  // ── Chain checkout helper (shared by quick-pick buttons + free-text input) ──
  async function startChainCheckout(ctx: any, count: number) {
    const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
    getState(uid).awaitingText = undefined;
    if (isRateLimited(uid, "chain_checkout", 5_000)) {
      await ctx.reply("⏳ Please wait a moment before starting another batch.").catch(() => {});
      return;
    }
    const r = await botApi("/api/replit-chain-links", "POST", { totalLinks: count, successStatus: "working" });
    if (!r.ok) {
      await ctx.reply(`❌ <b>Error:</b> ${esc(r.data?.error || "Unknown")}`, { parse_mode: "HTML" });
      return;
    }
    const batchId = r.data.batchId as string;
    const chatId: number = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const startTime = Date.now();

    // Send a fixed status message we'll keep editing (not using streamBatchLogs which can time-out)
    const statusMsg = await bot.telegram.sendMessage(chatId,
      `⏳ <b>🔗 Checkout Links — 0 / ${count} ready</b>\n<code>Batch started... each link takes ~3–5 min</code>`,
      { parse_mode: "HTML" }
    );
    const statusMsgId = statusMsg.message_id;
    const sentUrls = new Set<string>();
    let allLines: string[] = [];
    let since = 0;
    let found = 0;
    let done = false;
    // Allow up to 60 min (1200 polls × 3 s) — never cut off mid-batch
    const MAX_CHECKOUT_POLLS = 1200;
    let pollCount = 0;

    function elapsed() {
      const s = Math.round((Date.now() - startTime) / 1000);
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    }

    async function checkoutPoll() {
      try {
        if (pollCount++ > MAX_CHECKOUT_POLLS) {
          await bot.telegram.editMessageText(chatId, statusMsgId, undefined,
            `⏱ <b>Session expired</b> — batch still running server-side.\n<code>${esc(batchId)}</code>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
          return;
        }

        const resp = await botApi(`/api/batch-logs/${batchId}?since=${since}`);
        if (!resp.ok) { setTimeout(checkoutPoll, 4000); return; }

        const { logs, nextSince } = resp.data;
        since = nextSince;

        for (const l of (logs as Array<{message: string}> || [])) {
          if (!l.message) continue;
          allLines.push(l.message);
        }

        // Deliver each new checkout URL instantly as a separate message
        const newCheckouts = allLines
          .filter(l => l.startsWith("CHECKOUT_URL|"))
          .map(l => { const p = l.split("|"); return { email: p[1], url: p[2], accountId: p[3] || "" }; })
          .filter(c => c.email && c.url && !sentUrls.has(c.url));

        for (const c of newCheckouts) {
          sentUrls.add(c.url);
          found++;
          const kbd = Markup.inlineKeyboard([
            [Markup.button.url(`🔗 Open Checkout Link`, c.url)],
            ...(c.accountId ? [[
              Markup.button.callback(`📊 Status: working`, `link_status_${c.accountId}`),
              Markup.button.callback(`✅ Completed`, `link_done_${c.accountId}`),
            ]] : []),
          ]);
          await bot.telegram.sendMessage(chatId,
            `🔗 <b>Checkout Link #${found} Ready!</b>\n\n` +
            `📧 <code>${esc(c.email)}</code>\n` +
            `<code>${esc(c.url)}</code>`,
            { parse_mode: "HTML", disable_web_page_preview: true, ...kbd }
          ).catch(() => {});
          // Update status message
          await bot.telegram.editMessageText(chatId, statusMsgId, undefined,
            `⏳ <b>🔗 Checkout Links — ${found} / ${count} ready</b> ⏱ ${elapsed()}\n` +
            `<code>Working... each link takes ~3–5 min via browser</code>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }

        // Check for completion
        done = allLines.some(l => l.startsWith("🏁"));
        if (done) {
          const doneLine = allLines.find(l => l.startsWith("🏁")) || "";
          const created = parseInt(doneLine.match(/(\d+) created/)?.[1] || String(found));
          const failed  = parseInt(doneLine.match(/(\d+) failed/)?.[1] || "0");
          await bot.telegram.editMessageText(chatId, statusMsgId, undefined,
            `🎉 <b>Checkout batch done!</b> ⏱ ${elapsed()}\n\n` +
            `✅ Generated: <b>${created}</b>\n` +
            `❌ Failed:    <b>${failed}</b>\n` +
            `📊 Accounts set to <b>working</b> status`,
            { parse_mode: "HTML" }
          ).catch(() => {});
          return;
        }

        setTimeout(checkoutPoll, 3000);
      } catch (err: any) {
        console.error("[checkout poll]", err.message);
        setTimeout(checkoutPoll, 4000);
      }
    }

    setTimeout(checkoutPoll, 2000);
  }

  // ── Checkout link status / completed buttons ──
  bot.action(/^link_status_(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    try {
      const r = await botApi(`/api/replit-accounts/${accountId}`);
      const status = r.ok ? (r.data?.status ?? "unknown") : "unknown";
      await ctx.answerCbQuery(`📊 Current status: ${status}`, { show_alert: true });
    } catch {
      await ctx.answerCbQuery("Could not fetch status", { show_alert: true });
    }
  });

  bot.action(/^link_done_(.+)$/, async (ctx) => {
    const accountId = ctx.match[1];
    try {
      await botApi(`/api/replit-accounts/${accountId}/status`, "PATCH", { status: "available" });
      await ctx.answerCbQuery("✅ Marked as Completed — status set to available");
      await ctx.editMessageReplyMarkup(
        Markup.inlineKeyboard([[
          Markup.button.callback(`📊 Status: available`, `link_status_${accountId}`),
          Markup.button.callback(`✓ Completed`, `link_done_${accountId}`),
        ]]).reply_markup
      ).catch(() => {});
    } catch {
      await ctx.answerCbQuery("Failed to update status").catch(() => {});
    }
  });

  // Quick-pick count buttons (3 / 6 / 9 / 12 / 15 / 30 / 50 / 100)
  for (const n of [3, 6, 9, 12, 15, 30, 50, 100]) {
    bot.action(`chain_co_${n}`, async (ctx) => {
      await ctx.answerCbQuery(`Generating ${n} links...`);
      await ctx.deleteMessage().catch(() => {});
      await startChainCheckout(ctx, n);
    });
  }

  // Checkout
  bot.action("confirm_checkout", async (ctx) => {
    const uid = ctx.from.id;
    if (isRateLimited(uid, "confirm_checkout", 15_000)) {
      await ctx.answerCbQuery("⏳ Please wait before generating more links.").catch(() => {});
      return;
    }
    await ctx.answerCbQuery("Starting...");
    const r = await botApi("/api/replit-auto-coupon-links", "POST", {});
    if (!r.ok) {
      await ctx.editMessageText(`❌ <b>Error:</b> ${esc(r.data?.error || "Unknown")}`, { parse_mode: "HTML" });
      return;
    }
    const batchId = r.data.batchId as string;
    const startTime = Date.now();
    const checkoutSvc: ServiceConfig = { emoji: "🔗", label: "Checkout Links", endpoint: "", outlookTable: "", hasCard: false, hasCoupon: false, hasReferral: false };

    // Switch to live-log view
    await ctx.editMessageText(
      `⏳ <b>🔗 Checkout Links</b> — starting up...\n\n<pre>Connecting to batch...</pre>`,
      { parse_mode: "HTML" }
    );

    const chatId = ctx.chat!.id;
    const msgId = ctx.callbackQuery.message!.message_id;
    await streamBatchLogs(chatId, msgId, batchId, checkoutSvc, 1, startTime);
  });

  // Scan
  bot.action("confirm_scan", async (ctx) => {
    await ctx.answerCbQuery("Starting scan...");
    await ctx.deleteMessage().catch(() => {});
    const uid = ctx.from!.id;

    const unchecked = await dbQuery(
      `SELECT id, email, password FROM replit_accounts WHERE coupon_extracted = false AND email != '' AND password IS NOT NULL AND password != '' ORDER BY created_at ASC`
    );

    if (unchecked.rows.length === 0) {
      return ctx.reply("✅ All accounts already scanned.");
    }

    runningScans.set(uid, true);
    await ctx.reply(`🔄 *Scanning ${unchecked.rows.length} accounts...*\n/cancel to stop.`, { parse_mode: "Markdown" });

    let found = 0, noFeature = 0, errors = 0;
    const { extractCouponFromReplitAccount } = await import("./playwrightService");

    for (let i = 0; i < unchecked.rows.length; i++) {
      if (!runningScans.get(uid)) {
        await ctx.reply(`⛔ Stopped at ${i}/${unchecked.rows.length} — ✅${found} ❌${noFeature} ⚠️${errors}`);
        break;
      }
      const acct = unchecked.rows[i];
      const prefix = `[${i + 1}/${unchecked.rows.length}]`;
      try {
        const result = await extractCouponFromReplitAccount(acct.email, acct.password, () => {});
        if (result.success && result.coupon) {
          await dbQuery(`UPDATE replit_accounts SET coupon_extracted = true, coupon_code = $1 WHERE id = $2`, [result.coupon, acct.id]);
          found++;
          await ctx.reply(`${prefix} ✅ \`${acct.email}\`\n🎟 \`${result.coupon}\``, { parse_mode: "Markdown" });
        } else {
          await dbQuery(`UPDATE replit_accounts SET coupon_extracted = true, coupon_code = '' WHERE id = $1`, [acct.id]);
          const err = result.error || "";
          if (err.includes("__NO_FEATURE__") || err.toLowerCase().includes("banned") || err.toLowerCase().includes("wrong password")) {
            noFeature++;
            await ctx.reply(`${prefix} ❌ \`${acct.email}\` — no panel`, { parse_mode: "Markdown" });
          } else {
            errors++;
            await ctx.reply(`${prefix} ⚠️ \`${acct.email}\` — error`, { parse_mode: "Markdown" });
          }
        }
      } catch {
        errors++;
      }
    }

    runningScans.delete(uid);
    await ctx.reply(
      `*✅ Scan complete!*\n\n✅ Coupons found: ${found}\n❌ No panel: ${noFeature}\n⚠️ Errors: ${errors}`,
      { parse_mode: "Markdown" }
    );
  });

  // Warm
  bot.action(/^warm_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const val = (ctx.match as RegExpMatchArray)[1];
    let count: number;
    if (val === "all") {
      const r = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
      count = parseInt(r.rows[0]?.cnt || "0");
    } else {
      count = parseInt(val);
    }
    if (count === 0) return ctx.editMessageText("No processing accounts to warm.");
    await ctx.editMessageText(
      `*🔥 Warm ${count} account${count > 1 ? "s" : ""}?*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅ Warm ${count}`, `confirm_warm_${count}`), Markup.button.callback("❌ Cancel", "dismiss")],
        ]),
      }
    );
  });

  bot.action(/^confirm_warm_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    const r = await botApi("/api/replit-warm-accounts", "POST", { count });
    const msg = r.ok
      ? `🟢  <b>Warming ${count} accounts</b>\n<code>◈ Batch  →  ${r.data.batchId || "started"}</code>`
      : `🔴  Error: <code>${r.data?.error || "Unknown"}</code>`;
    await ctx.editMessageText(msg, { parse_mode: "HTML" });
  });

  // Purge
  bot.action("confirm_purge", async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const r = await botApi("/api/replit-purge-banned", "POST", {});
    const msg = r.ok
      ? `🟢  <b>Purge started</b>\n<code>◈ Batch  →  ${r.data.batchId || "started"}</code>`
      : `🔴  Error: <code>${r.data?.error || "Unknown"}</code>`;
    await ctx.editMessageText(msg, { parse_mode: "HTML" });
  });

  // Proxy update
  bot.action("update_proxy", async (ctx) => {
    await ctx.answerCbQuery();
    getState(ctx.from.id).awaitingText = "proxy";
    await ctx.reply(`🌐 *Update Proxy*\n\nSend the new proxy URL now:\n_(e.g. http://user:pass@host:port)_`, { parse_mode: "Markdown" });
  });

  // ── Shop admin helpers ────────────────────────────────────────────────────
  const SHOP_ACCOUNT_TYPES = ["replit", "lovable", "v0", "adobe", "chatgpt", "eleven", "outlook", "gmail"];
  const SHOP_TABLE_MAP: Record<string, string> = {
    replit:   "replit_accounts",
    lovable:  "lovable_accounts",
    v0:       "v0_accounts",
    adobe:    "adobe_accounts",
    chatgpt:  "chatgpt_accounts",
    eleven:   "eleven_labs_accounts",
    outlook:  "private_outlook_accounts",
    gmail:    "private_gmail_accounts",
  };

  async function showShopAdminMenu(ctx: any, edit = false) {
    const [prodRes, custRes, orderRes, pendingRes, revenueRes, referSettingRes] = await Promise.all([
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_products WHERE active = true`),
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_customers`),
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_orders`),
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_activation_orders WHERE status = 'pending'`),
      dbQuery(`SELECT COALESCE(SUM(amount),0) as total FROM shop_orders`),
      dbQuery(`SELECT value FROM shop_settings WHERE key = 'referral_reward'`),
    ]);
    const activeProd    = parseInt(prodRes.rows[0]?.cnt ?? "0");
    const totalCust     = parseInt(custRes.rows[0]?.cnt ?? "0");
    const totalOrds     = parseInt(orderRes.rows[0]?.cnt ?? "0");
    const pendingAct    = parseInt(pendingRes.rows[0]?.cnt ?? "0");
    const revenue       = parseFloat(revenueRes.rows[0]?.total ?? "0");
    const referAmount   = parseFloat(referSettingRes.rows[0]?.value ?? "0.50");
    const pendingBadge  = pendingAct > 0 ? ` 🔴 ${pendingAct}` : " ✅ 0";

    const text =
      `\n🛒 <b>SHOP MANAGEMENT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>📊  DASHBOARD</b>\n\n` +
      `<code>` +
      `📦  Active Products      ${String(activeProd).padStart(5)}\n` +
      `👥  Total Customers      ${String(totalCust).padStart(5)}\n` +
      `🧾  Completed Orders     ${String(totalOrds).padStart(5)}\n` +
      `⏳  Pending Activations  ${String(pendingAct).padStart(5)}\n` +
      `💵  Total Revenue      $${revenue.toFixed(2).padStart(7)}\n` +
      `🔗  Refer Reward        $${referAmount.toFixed(2).padStart(6)}` +
      `</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `› Choose a module:`;

    const [depRes, subsRes] = await Promise.all([
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_deposit_requests WHERE status = 'pending'`),
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_restock_subs`),
    ]);
    const pendingDeps   = parseInt(depRes.rows[0]?.cnt ?? "0");
    const restockSubs   = parseInt(subsRes.rows[0]?.cnt ?? "0");
    const depBadge      = pendingDeps > 0 ? ` 🔴 ${pendingDeps}` : "";
    const subsBadge     = restockSubs > 0 ? ` ·  ${restockSubs} subs` : "";

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("📦  PRODUCTS",            "shop_admin_products"),
        Markup.button.callback("➕  ADD PRODUCT",        "shop_admin_add_product"),
      ],
      [
        Markup.button.callback("👥  CUSTOMER",            "shop_admin_customers"),
        Markup.button.callback("💰  FUND ACCOUNT",       "shop_admin_topup"),
      ],
      [
        Markup.button.callback(`📋  ACTIVATION ORDERS${pendingBadge}`, "shop_admin_act_orders"),
        Markup.button.callback(`📸  DEPOSITS${depBadge}`, "shop_admin_deposits"),
      ],
      [
        Markup.button.callback("📢  BROADCAST",           "shop_admin_broadcast"),
        Markup.button.callback("📊  ANALYTICS",           "shop_admin_analytics"),
      ],
      [
        Markup.button.callback("🔍  SEARCH CUSTOMER",    "shop_admin_search"),
        Markup.button.callback(`🔗  REFER REWARD  ·  $${referAmount.toFixed(2)}`, "shop_admin_refer_amount"),
      ],
      [
        Markup.button.callback(`📦  PROMO CODES`,         "shop_admin_promos"),
        Markup.button.callback(`🔔  RESTOCK NOTIFY${subsBadge}`, "shop_admin_restock"),
      ],
      [
        Markup.button.callback("🗄  STOCK MANAGER",       "shop_admin_stock"),
        Markup.button.callback("📬  MANUAL ORDERS",       "shop_admin_manual_orders"),
      ],
      [
        Markup.button.callback("🎛  MENU MANAGEMENT",    "shop_admin_menu_mgmt"),
      ],
    ]);

    if (edit) {
      await safeEdit(ctx, text, { parse_mode: "HTML", ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: "HTML", ...keyboard });
    }
  }

  // Helper: reply or edit depending on context
  function replyOrEdit(ctx: any, edit: boolean, text: string, opts: any = {}) {
    if (edit) return safeEdit(ctx, text, opts);
    return ctx.reply(text, opts);
  }

  bot.hears(KB.SHOP, (ctx) => handleMenu(ctx, async () => {
    const sent = await ctx.reply(
      `\n🛍 <b>SHOP ADMIN</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n› Choose a module:`,
      { parse_mode: "HTML", ...SHOP_KEYBOARD }
    );
    getState(ctx.from.id).shopMenuMsgId = sent.message_id;
  }));

  // Helper: delete the "SHOP ADMIN" intro message (keeps the reply keyboard clean)
  async function clearShopMenu(ctx: any) {
    const st = getState(ctx.from.id);
    if (st.shopMenuMsgId) {
      await ctx.deleteMessage(st.shopMenuMsgId).catch(() => {});
      st.shopMenuMsgId = undefined;
    }
  }

  // ── Shop keyboard: individual section hears ─────────────────────────────
  // NOTE: These do NOT use handleMenu — the shop reply keyboard stays visible
  //       at the bottom while section content is sent as a new chat message.
  //       Only BACK restores the main keyboard.

  bot.hears(SHOP_KB.BACK, async (ctx) => {
    await clearShopMenu(ctx);
    await ctx.reply(`↩ Main menu`, { ...MAIN_KEYBOARD });
  });

  bot.hears(SHOP_KB.PRODUCTS, async (ctx) => {
    await clearShopMenu(ctx);
    const res = await dbQuery(`SELECT * FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    await ctx.reply(buildProductsListMsg(res.rows), { parse_mode: "HTML", ...buildProductsListButtons(res.rows) });
  });

  bot.hears(SHOP_KB.ADD_PRODUCT, async (ctx) => {
    await clearShopMenu(ctx);
    getState(ctx.from.id).shopAdminFlow = { step: "name" };
    await ctx.reply(
      `\n🔷 <b>➕ ADD PRODUCT — 1/5</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Enter the product <b>name</b>:\n<code>  e.g. "Replit Core 1 Month"</code>`,
      { parse_mode: "HTML" }
    );
  });

  bot.hears(SHOP_KB.CUSTOMER, async (ctx) => {
    await clearShopMenu(ctx);
    await showCustomerPage(ctx, 0, false);
  });

  bot.hears(SHOP_KB.FUND_ACCOUNT, async (ctx) => {
    await clearShopMenu(ctx);
    getState(ctx.from.id).shopAdminFlow = { step: "topup_uid" };
    await ctx.reply(
      `\n💰 <b>FUND CUSTOMER ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Enter the customer's <b>Telegram ID</b>:\n<i>  e.g. 123456789</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.hears(SHOP_KB.ACT_ORDERS, async (ctx) => {
    await clearShopMenu(ctx);
    const res = await dbQuery(
      `SELECT id, telegram_id, service, delivery_type, email, amount, status, created_at
       FROM shop_activation_orders ORDER BY created_at DESC LIMIT 20`
    );
    const serviceLabel: Record<string, string> = { chatgpt_plus: "ChatGPT+", replit_core: "Replit Core" };
    if (res.rows.length === 0) {
      return ctx.reply(
        `\n📋 <b>ACTIVATION ORDERS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No activation orders yet.</i>`,
        { parse_mode: "HTML" }
      );
    }
    let t = `\n📋 <b>ACTIVATION ORDERS</b>  <code>last ${res.rows.length}</code>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    for (const r of res.rows) {
      const svc  = serviceLabel[r.service] ?? r.service;
      const type = r.delivery_type === "activate" ? "🔑" : "📦";
      const stat = r.status === "pending" ? "⏳" : r.status === "completed" ? "✅" : "❌";
      const email = r.email ? r.email.slice(0, 20) : "—";
      const date  = new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      t += `${stat} ${type} ${svc.padEnd(10)}  $${parseFloat(r.amount).toFixed(2)}  ${date}\n`;
      if (r.email) t += `   ${email}\n`;
    }
    t += `</code>`;
    await ctx.reply(t, { parse_mode: "HTML" });
  });

  bot.hears(SHOP_KB.DEPOSITS, async (ctx) => {
    await clearShopMenu(ctx);
    const res = await dbQuery(
      `SELECT d.id, d.telegram_id, d.status, d.amount_requested, d.created_at, c.username, c.first_name
       FROM shop_deposit_requests d
       LEFT JOIN shop_customers c ON d.telegram_id = c.telegram_id
       ORDER BY d.created_at DESC LIMIT 20`
    );
    if (res.rows.length === 0) {
      return ctx.reply(
        `\n📸 <b>DEPOSIT REQUESTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No deposit requests yet.</i>`,
        { parse_mode: "HTML" }
      );
    }
    let t = `\n📸 <b>DEPOSIT REQUESTS</b>  <code>last ${res.rows.length}</code>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const r of res.rows) {
      const name = r.username ? `@${r.username}` : (r.first_name ?? `${r.telegram_id}`);
      const stat = r.status === "pending" ? "⏳" : r.status === "approved" ? "✅" : "❌";
      const amt  = r.amount_requested ? `$${parseFloat(r.amount_requested).toFixed(2)}` : "—";
      const date = new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      t += `${stat} #${r.id}  ${name.slice(0, 14).padEnd(14)}  ${amt}  ${date}\n`;
      if (r.status === "pending") {
        buttons.push([
          Markup.button.callback(`✅ #${r.id} Approve`, `dep_approve_${r.id}_${r.telegram_id}`),
          Markup.button.callback(`❌ Deny`, `dep_deny_${r.id}_${r.telegram_id}`),
        ]);
      }
    }
    t += `</code>`;
    await ctx.reply(t, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  bot.hears(SHOP_KB.BROADCAST, async (ctx) => {
    await clearShopMenu(ctx);
    const r = await dbQuery(`SELECT COUNT(*) as cnt FROM shop_customers`);
    const total = parseInt(r.rows[0]?.cnt ?? "0");
    getState(ctx.from.id).shopAdminFlow = { step: "broadcast_text" };
    await ctx.reply(
      `\n📢 <b>BROADCAST MESSAGE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>Recipients:  ${total} customers</code>\n\n` +
      `› Type your <b>broadcast message</b>:\n<i>Supports HTML. Sent to all customers.</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.hears(SHOP_KB.ANALYTICS, async (ctx) => {
    await clearShopMenu(ctx);
    const [todayRes, weekRes, monthRes, bestRes, topCustRes, avgRating] = await Promise.all([
      dbQuery(`SELECT COALESCE(SUM(amount),0) as t FROM shop_orders WHERE created_at >= NOW() - INTERVAL '1 day'`),
      dbQuery(`SELECT COALESCE(SUM(amount),0) as t FROM shop_orders WHERE created_at >= NOW() - INTERVAL '7 days'`),
      dbQuery(`SELECT COALESCE(SUM(amount),0) as t FROM shop_orders WHERE created_at >= NOW() - INTERVAL '30 days'`),
      dbQuery(`SELECT product_name, COUNT(*) as cnt, SUM(amount) as rev FROM shop_orders GROUP BY product_name ORDER BY cnt DESC LIMIT 5`),
      dbQuery(`SELECT c.first_name, c.username, SUM(o.amount) as spent FROM shop_orders o JOIN shop_customers c ON o.telegram_id = c.telegram_id GROUP BY c.telegram_id, c.first_name, c.username ORDER BY spent DESC LIMIT 5`),
      dbQuery(`SELECT ROUND(AVG(rating),1) as avg FROM shop_order_ratings`),
    ]);
    const today = parseFloat(todayRes.rows[0]?.t ?? "0");
    const week  = parseFloat(weekRes.rows[0]?.t ?? "0");
    const month = parseFloat(monthRes.rows[0]?.t ?? "0");
    const avg   = avgRating.rows[0]?.avg ?? "N/A";
    let t = `\n📊 <b>REVENUE ANALYTICS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    t += `<b>💵 Revenue</b>\n<code>Today:   $${today.toFixed(2)}\n7 days:  $${week.toFixed(2)}\n30 days: $${month.toFixed(2)}\nRating:  ${avg} / 5\n</code>\n\n`;
    if (bestRes.rows.length > 0) {
      t += `<b>📦 Top Products</b>\n<code>`;
      for (const r of bestRes.rows) t += `${String(r.cnt).padStart(3)}x  $${parseFloat(r.rev).toFixed(2)}  ${r.product_name.slice(0, 20)}\n`;
      t += `</code>\n\n`;
    }
    if (topCustRes.rows.length > 0) {
      t += `<b>👥 Top Customers</b>\n<code>`;
      for (const r of topCustRes.rows) {
        const name = r.username ? `@${r.username}` : (r.first_name ?? "Unknown");
        t += `$${parseFloat(r.spent).toFixed(2).padStart(7)}  ${name.slice(0, 18)}\n`;
      }
      t += `</code>`;
    }
    await ctx.reply(t, { parse_mode: "HTML" });
  });

  bot.hears(SHOP_KB.SEARCH, async (ctx) => {
    await clearShopMenu(ctx);
    getState(ctx.from.id).shopAdminFlow = { step: "search_uid" };
    await ctx.reply(
      `\n🔍 <b>SEARCH CUSTOMER</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Enter a <b>Telegram ID</b> or <b>@username</b>:`,
      { parse_mode: "HTML" }
    );
  });

  bot.hears(SHOP_KB.REFER_REWARD, async (ctx) => {
    await clearShopMenu(ctx);
    const cur = await dbQuery(`SELECT value FROM shop_settings WHERE key = 'referral_reward'`);
    const current = parseFloat(cur.rows[0]?.value ?? "0.50");
    getState(ctx.from.id).shopAdminFlow = { step: "refer_amount" };
    await ctx.reply(
      `\n🔗 <b>REFER REWARD AMOUNT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>Current reward:  $${current.toFixed(2)}</code>\n\n` +
      `› Enter the new reward amount in USD:\n<code>  e.g. 0.50 · 1.00 · 2.00</code>`,
      { parse_mode: "HTML" }
    );
  });

  bot.hears(SHOP_KB.PROMO_CODES, async (ctx) => {
    await clearShopMenu(ctx);
    const res = await dbQuery(
      `SELECT code, discount_pct, discount_fixed, max_uses, uses_count, active FROM shop_promo_codes ORDER BY created_at DESC LIMIT 20`
    );
    if (res.rows.length === 0) {
      return ctx.reply(
        `\n🏷️ <b>PROMO CODES</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No promo codes created yet.</i>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([
          [Markup.button.callback("➕  Create Code", "shop_admin_promo_create")],
        ]) }
      );
    }
    let t = `\n🏷️ <b>PROMO CODES</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const r of res.rows) {
      const stat = r.active ? "🟢" : "🔴";
      const disc = parseFloat(r.discount_pct) > 0 ? `${parseFloat(r.discount_pct).toFixed(0)}% off` : `$${parseFloat(r.discount_fixed).toFixed(2)} off`;
      const uses = r.max_uses > 0 ? `${r.uses_count}/${r.max_uses}` : `${r.uses_count}/∞`;
      t += `${stat} ${r.code.padEnd(12)} ${disc.padEnd(10)} ${uses}\n`;
      buttons.push([Markup.button.callback(`${r.active ? "⏸ Disable" : "▶ Enable"} ${r.code}`, `shop_promo_toggle_${r.code}`)]);
    }
    t += `</code>`;
    buttons.push([Markup.button.callback("➕  Create Code", "shop_admin_promo_create")]);
    await ctx.reply(t, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  bot.hears(SHOP_KB.RESTOCK, async (ctx) => {
    await clearShopMenu(ctx);
    const res = await dbQuery(
      `SELECT s.product_id, COUNT(*) as sub_count, p.name as product_name
       FROM shop_restock_subs s
       LEFT JOIN shop_products p ON p.id::text = s.product_id
       GROUP BY s.product_id, p.name ORDER BY sub_count DESC`
    );
    if (res.rows.length === 0) {
      return ctx.reply(
        `\n🔔 <b>RESTOCK SUBSCRIBERS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No subscribers yet.</i>`,
        { parse_mode: "HTML" }
      );
    }
    let t = `\n🔔 <b>RESTOCK SUBSCRIBERS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const r of res.rows) {
      const name = r.product_name ?? r.product_id;
      t += `${String(r.sub_count).padStart(3)} subs  ${name.slice(0, 25)}\n`;
      buttons.push([Markup.button.callback(`📢 Notify ${r.sub_count} subs — ${name.slice(0, 20)}`, `shop_notify_restock_${r.product_id}`)]);
    }
    t += `</code>`;
    await ctx.reply(t, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  // ── Shared: build and send stock overview (used by keyboard hears + inline action) ──
  async function renderStockOverview(ctx: any, send: "reply" | "edit") {
    const res = await dbQuery(`SELECT * FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    if (res.rows.length === 0) {
      const msg = `\n🗄 <b>STOCK MANAGER</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No products exist yet. Create a product first.</i>`;
      if (send === "edit") return safeEdit(ctx, msg, { parse_mode: "HTML" });
      return ctx.reply(msg, { parse_mode: "HTML" });
    }
    let text = `\n🗄 <b>STOCK MANAGER</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>  Product                  Avail  Sold  Total\n  ─────────────────────────────────────────────\n`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const p of res.rows) {
      const isManual = (p.delivery_mode ?? "auto") === "manual";
      const info = await getProductStockInfo(p);
      const name = p.name.slice(0, 22).padEnd(22);
      const statusIcon = p.active ? "🟢" : "🔴";
      if (isManual) {
        const manualStk = p.manual_stock ?? 0;
        text += `  ${statusIcon} ${name} 📬  ${String(manualStk).padStart(4)}      —      —\n`;
      } else {
        text += `  ${statusIcon} ${name}  ${String(info.avail).padStart(4)}   ${String(info.sold).padStart(4)}   ${String(info.total).padStart(4)}\n`;
      }
      const displayAvail = isManual ? (p.manual_stock ?? 0) : info.avail;
      buttons.push([Markup.button.callback(
        `${displayAvail > 0 ? "🟢" : "🔴"} ${p.name.slice(0, 25)}${isManual ? " 📬" : ""}  (${displayAvail} avail)`,
        `shop_stock_${p.id}`
      )]);
    }
    text += `</code>`;
    if (send === "edit") {
      buttons.push([Markup.button.callback("↩  Back", "shop_admin_menu")]);
      return safeEdit(ctx, text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
    }
    return ctx.reply(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  }

  // ── Shared: build and send manual orders panel (used by keyboard hears + inline action) ──
  async function renderManualOrdersPanel(ctx: any, send: "reply" | "edit") {
    const res = await dbQuery(
      `SELECT o.id, o.telegram_id, o.product_name, o.amount, o.created_at,
              c.username, c.first_name
       FROM shop_orders o
       LEFT JOIN shop_customers c ON c.telegram_id = o.telegram_id
       WHERE o.delivery_status = 'pending_delivery'
       ORDER BY o.created_at ASC`
    );
    const emptyMsg =
      `\n📬 <b>MANUAL ORDERS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<i>No pending manual orders. All caught up!</i>`;
    const emptyKb = Markup.inlineKeyboard([[Markup.button.callback("↩  Back", "shop_admin_menu")]]);
    if (res.rows.length === 0) {
      if (send === "edit") return safeEdit(ctx, emptyMsg, { parse_mode: "HTML", ...emptyKb });
      return ctx.reply(emptyMsg, { parse_mode: "HTML", ...emptyKb });
    }
    let text = `\n📬 <b>MANUAL ORDERS</b>  <code>${res.rows.length} pending</code>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const o of res.rows) {
      const custName = o.username ? `@${o.username}` : (o.first_name ?? `ID:${o.telegram_id}`);
      const date     = new Date(o.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
      text += `📦 <b>${escapeHtml(o.product_name)}</b>  ·  $${parseFloat(o.amount).toFixed(2)}\n`;
      text += `👤 ${escapeHtml(custName)}  <code>(${o.telegram_id})</code>  ·  ${date}\n`;
      text += `🆔 <code>${o.id}</code>\n\n`;
      buttons.push([Markup.button.callback(`📦  Fulfill — ${o.product_name.slice(0, 20)}`, `shop_fulfill_${o.id}`)]);
    }
    buttons.push([Markup.button.callback("🔄  Refresh", "shop_admin_manual_orders")]);
    buttons.push([Markup.button.callback("↩  Back", "shop_admin_menu")]);
    if (send === "edit") return safeEdit(ctx, text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
    return ctx.reply(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  }

  bot.hears(SHOP_KB.STOCK, async (ctx) => {
    await clearShopMenu(ctx);
    return renderStockOverview(ctx, "reply");
  });

  bot.hears(SHOP_KB.MANUAL_ORDERS, async (ctx) => {
    await clearShopMenu(ctx);
    return renderManualOrdersPanel(ctx, "reply");
  });

  bot.hears(SHOP_KB.EMOJI, async (ctx) => {
    await clearShopMenu(ctx);
    await ctx.reply(emojiPanelText(), {
      parse_mode: "HTML",
      ...emojiPanelKeyboard(),
    });
  });

  bot.hears(SHOP_KB.MENU_MGMT, async (ctx) => {
    await clearShopMenu(ctx);
    const config   = getBotMenuConfig();
    const defaults = getBotMenuDefaults();
    const keys     = Object.keys(defaults) as string[];
    const rows     = keys.map(k => [
      Markup.button.callback(`${config[k] ?? defaults[k]}`, `shop_menu_edit:${k}`),
    ]);
    await ctx.reply(
      `🎛 <b>MENU MANAGEMENT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Tap any button below to rename it.\n` +
      `You can change both the emoji and the text.\n\n` +
      `<i>Changes take effect immediately for new keyboard sends.</i>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) }
    );
  });
  // ─────────────────────────────────────────────────────────────────────────

  bot.hears(KB.PAYMENT, (ctx) => handleMenu(ctx, async () => {
    const msg =
      `\n🔷 <b>💳 PAYMENT METHODS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✨ <b>Send payment to any method below</b>\n` +
      `<i>Tap any address to copy instantly</i>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🟡  <b>BINANCE</b>\n` +
      `<code>510120124</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💎  <b>USDT TRC20</b>\n` +
      `<code>TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔷  <b>USDT BEP20</b>\n` +
      `<code>0x107fc554bba4cadd5c4e9f1e189d7dd93770202e</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🇮🇳  <b>UPI (India)</b>\n` +
      `<code>avinashaddison-8@okaxis</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💫  After payment, contact admin with screenshot`;
    await ctx.replyWithHTML(msg, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🟡 Binance · 510120124", "pay_copy_binance")],
        [Markup.button.callback("💎 USDT TRC20", "pay_copy_trc20")],
        [Markup.button.callback("🔷 USDT BEP20", "pay_copy_bep20")],
        [Markup.button.callback("🇮🇳 UPI India", "pay_copy_upi")],
      ]),
    });
  }));

  bot.action("pay_copy_binance", async (ctx) => {
    await ctx.answerCbQuery("🟡 Binance ID copied! → 510120124", { show_alert: true });
  });
  bot.action("pay_copy_trc20", async (ctx) => {
    await ctx.answerCbQuery("💎 TRC20 copied! → TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB", { show_alert: true });
  });
  bot.action("pay_copy_bep20", async (ctx) => {
    await ctx.answerCbQuery("🔷 BEP20 copied! → 0x107fc554bba4cadd5c4e9f1e189d7dd93770202e", { show_alert: true });
  });
  bot.action("pay_copy_upi", async (ctx) => {
    await ctx.answerCbQuery("🇮🇳 UPI copied! → avinashaddison-8@okaxis", { show_alert: true });
  });

  // ── Fake US Address Generator ─────────────────────────────────────────────
  const US_CITIES = [
    { city: "New York",        state: "New York",        abbr: "NY", zip: "10001", areaCode: "212", lat: 40.7128,  lon: -74.0060  },
    { city: "Los Angeles",     state: "California",      abbr: "CA", zip: "90001", areaCode: "213", lat: 34.0522,  lon: -118.2437 },
    { city: "Chicago",         state: "Illinois",        abbr: "IL", zip: "60601", areaCode: "312", lat: 41.8781,  lon: -87.6298  },
    { city: "Houston",         state: "Texas",           abbr: "TX", zip: "77001", areaCode: "713", lat: 29.7604,  lon: -95.3698  },
    { city: "Phoenix",         state: "Arizona",         abbr: "AZ", zip: "85001", areaCode: "602", lat: 33.4484,  lon: -112.0740 },
    { city: "Philadelphia",    state: "Pennsylvania",    abbr: "PA", zip: "19101", areaCode: "215", lat: 39.9526,  lon: -75.1652  },
    { city: "San Antonio",     state: "Texas",           abbr: "TX", zip: "78201", areaCode: "210", lat: 29.4241,  lon: -98.4936  },
    { city: "San Diego",       state: "California",      abbr: "CA", zip: "92101", areaCode: "619", lat: 32.7157,  lon: -117.1611 },
    { city: "Dallas",          state: "Texas",           abbr: "TX", zip: "75201", areaCode: "214", lat: 32.7767,  lon: -96.7970  },
    { city: "San Jose",        state: "California",      abbr: "CA", zip: "95101", areaCode: "408", lat: 37.3382,  lon: -121.8863 },
    { city: "Austin",          state: "Texas",           abbr: "TX", zip: "78701", areaCode: "512", lat: 30.2672,  lon: -97.7431  },
    { city: "Jacksonville",    state: "Florida",         abbr: "FL", zip: "32099", areaCode: "904", lat: 30.3322,  lon: -81.6557  },
    { city: "Fort Worth",      state: "Texas",           abbr: "TX", zip: "76101", areaCode: "817", lat: 32.7555,  lon: -97.3308  },
    { city: "Columbus",        state: "Ohio",            abbr: "OH", zip: "43085", areaCode: "614", lat: 39.9612,  lon: -82.9988  },
    { city: "Charlotte",       state: "North Carolina",  abbr: "NC", zip: "28201", areaCode: "704", lat: 35.2271,  lon: -80.8431  },
    { city: "Indianapolis",    state: "Indiana",         abbr: "IN", zip: "46201", areaCode: "317", lat: 39.7684,  lon: -86.1581  },
    { city: "San Francisco",   state: "California",      abbr: "CA", zip: "94102", areaCode: "415", lat: 37.7749,  lon: -122.4194 },
    { city: "Seattle",         state: "Washington",      abbr: "WA", zip: "98101", areaCode: "206", lat: 47.6062,  lon: -122.3321 },
    { city: "Denver",          state: "Colorado",        abbr: "CO", zip: "80201", areaCode: "303", lat: 39.7392,  lon: -104.9903 },
    { city: "Nashville",       state: "Tennessee",       abbr: "TN", zip: "37201", areaCode: "615", lat: 36.1627,  lon: -86.7816  },
    { city: "Oklahoma City",   state: "Oklahoma",        abbr: "OK", zip: "73101", areaCode: "405", lat: 35.4676,  lon: -97.5164  },
    { city: "El Paso",         state: "Texas",           abbr: "TX", zip: "79901", areaCode: "915", lat: 31.7619,  lon: -106.4850 },
    { city: "Washington",      state: "District of Columbia", abbr: "DC", zip: "20001", areaCode: "202", lat: 38.9072, lon: -77.0369 },
    { city: "Las Vegas",       state: "Nevada",          abbr: "NV", zip: "89101", areaCode: "702", lat: 36.1699,  lon: -115.1398 },
    { city: "Louisville",      state: "Kentucky",        abbr: "KY", zip: "40201", areaCode: "502", lat: 38.2527,  lon: -85.7585  },
    { city: "Memphis",         state: "Tennessee",       abbr: "TN", zip: "38101", areaCode: "901", lat: 35.1495,  lon: -90.0490  },
    { city: "Portland",        state: "Oregon",          abbr: "OR", zip: "97201", areaCode: "503", lat: 45.5051,  lon: -122.6750 },
    { city: "Baltimore",       state: "Maryland",        abbr: "MD", zip: "21201", areaCode: "410", lat: 39.2904,  lon: -76.6122  },
    { city: "Milwaukee",       state: "Wisconsin",       abbr: "WI", zip: "53201", areaCode: "414", lat: 43.0389,  lon: -87.9065  },
    { city: "Albuquerque",     state: "New Mexico",      abbr: "NM", zip: "87101", areaCode: "505", lat: 35.0844,  lon: -106.6504 },
    { city: "Tucson",          state: "Arizona",         abbr: "AZ", zip: "85701", areaCode: "520", lat: 32.2226,  lon: -110.9747 },
    { city: "Fresno",          state: "California",      abbr: "CA", zip: "93701", areaCode: "559", lat: 36.7378,  lon: -119.7871 },
    { city: "Sacramento",      state: "California",      abbr: "CA", zip: "95814", areaCode: "916", lat: 38.5816,  lon: -121.4944 },
    { city: "Mesa",            state: "Arizona",         abbr: "AZ", zip: "85201", areaCode: "480", lat: 33.4152,  lon: -111.8315 },
    { city: "Atlanta",         state: "Georgia",         abbr: "GA", zip: "30301", areaCode: "404", lat: 33.7490,  lon: -84.3880  },
    { city: "Omaha",           state: "Nebraska",        abbr: "NE", zip: "68101", areaCode: "402", lat: 41.2565,  lon: -95.9345  },
    { city: "Colorado Springs",state: "Colorado",        abbr: "CO", zip: "80901", areaCode: "719", lat: 38.8339,  lon: -104.8214 },
    { city: "Raleigh",         state: "North Carolina",  abbr: "NC", zip: "27601", areaCode: "919", lat: 35.7796,  lon: -78.6382  },
    { city: "Minneapolis",     state: "Minnesota",       abbr: "MN", zip: "55401", areaCode: "612", lat: 44.9778,  lon: -93.2650  },
    { city: "Cleveland",       state: "Ohio",            abbr: "OH", zip: "44101", areaCode: "216", lat: 41.4993,  lon: -81.6944  },
    { city: "Wichita",         state: "Kansas",          abbr: "KS", zip: "67201", areaCode: "316", lat: 37.6872,  lon: -97.3301  },
    { city: "Arlington",       state: "Texas",           abbr: "TX", zip: "76001", areaCode: "817", lat: 32.7357,  lon: -97.1081  },
    { city: "New Orleans",     state: "Louisiana",       abbr: "LA", zip: "70112", areaCode: "504", lat: 29.9511,  lon: -90.0715  },
    { city: "Tampa",           state: "Florida",         abbr: "FL", zip: "33601", areaCode: "813", lat: 27.9506,  lon: -82.4572  },
    { city: "Miami",           state: "Florida",         abbr: "FL", zip: "33101", areaCode: "305", lat: 25.7617,  lon: -80.1918  },
    { city: "Pittsburgh",      state: "Pennsylvania",    abbr: "PA", zip: "15201", areaCode: "412", lat: 40.4406,  lon: -79.9959  },
    { city: "Bakersfield",     state: "California",      abbr: "CA", zip: "93301", areaCode: "661", lat: 35.3733,  lon: -119.0187 },
    { city: "Honolulu",        state: "Hawaii",          abbr: "HI", zip: "96801", areaCode: "808", lat: 21.3069,  lon: -157.8583 },
    { city: "Anchorage",       state: "Alaska",          abbr: "AK", zip: "99501", areaCode: "907", lat: 61.2181,  lon: -149.9003 },
    { city: "St. Louis",       state: "Missouri",        abbr: "MO", zip: "63101", areaCode: "314", lat: 38.6270,  lon: -90.1994  },
    { city: "Stockton",        state: "California",      abbr: "CA", zip: "95201", areaCode: "209", lat: 37.9577,  lon: -121.2908 },
  ];

  const STREET_NAMES = [
    "Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Elm St", "Washington Blvd",
    "Park Ave", "Lake Dr", "Hill Rd", "Valley Way", "Sunset Blvd", "River Rd",
    "Forest Ave", "Meadow Ln", "Lincoln St", "Jefferson Ave", "Madison Dr",
    "Highland Ave", "Brookside Rd", "Willow Way", "Pine St", "Birch Blvd",
    "Cherry Ln", "Walnut Ave", "Hickory Dr", "Spruce St", "Poplar Rd",
    "Magnolia Blvd", "Cypress Dr", "Laurel Ct", "Mulberry St", "Chestnut Ave",
  ];

  function rnd<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
  function rndInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function generateFakeUSAddress() {
    const loc = rnd(US_CITIES);
    const streetNum = rndInt(100, 9999);
    const street = `${streetNum} ${rnd(STREET_NAMES)}`;
    // Vary the zip slightly (last 2 digits)
    const zipBase = loc.zip.slice(0, 3);
    const zip = zipBase + String(rndInt(0, 99)).padStart(2, "0");
    // Generate realistic local phone number
    const exchange = rndInt(200, 999);
    const lineNum = String(rndInt(1000, 9999));
    const phone = `+1 (${loc.areaCode}) ${exchange}-${lineNum}`;
    // Vary lat/lon slightly for realism
    const lat = (loc.lat + (Math.random() - 0.5) * 0.05).toFixed(4);
    const lon = (loc.lon + (Math.random() - 0.5) * 0.05).toFixed(4);

    return { street, city: loc.city, state: loc.state, abbr: loc.abbr, zip, phone, lat, lon };
  }

  function buildAddressMsg(addr: ReturnType<typeof generateFakeUSAddress>): string {
    return (
      `\n🔷 <b>🏠 FAKE US ADDRESS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🏘  <b>Street</b>\n<code>${addr.street}</code>\n\n` +
      `🌆  <b>City / Town</b>\n<code>${addr.city}</code>\n\n` +
      `🗺  <b>State / Region</b>\n<code>${addr.state} (${addr.abbr})</code>\n\n` +
      `📮  <b>Zip / Postal Code</b>\n<code>${addr.zip}</code>\n\n` +
      `📞  <b>Phone Number</b>\n<code>${addr.phone}</code>\n\n` +
      `🌍  <b>Country</b>\n<code>United States</code>\n\n` +
      `📍  <b>Latitude</b>\n<code>${addr.lat}</code>\n\n` +
      `📍  <b>Longitude</b>\n<code>${addr.lon}</code>\n\n` +
      `<i>Tap any field above to copy · Press 🔄 for a new address</i>`
    );
  }

  bot.hears(KB.ADDRESS, (ctx) => handleMenu(ctx, async () => {
    const addr = generateFakeUSAddress();
    await ctx.replyWithHTML(buildAddressMsg(addr), {
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Generate New Address", "addr_regenerate")],
      ]),
    });
  }));

  bot.action("addr_regenerate", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const addr = generateFakeUSAddress();
    await ctx.editMessageText(buildAddressMsg(addr), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Generate New Address", "addr_regenerate")],
      ]),
    }).catch(() => {});
  });

  bot.action("shop_admin_menu", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showShopAdminMenu(ctx, true);
  });

  function buildProductsListMsg(rows: any[]): string {
    if (rows.length === 0) {
      return (
        `\n📦 <b>MANAGE PRODUCTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<i>No products created yet.</i>\n\n` +
        `Tap <b>➕ ADD PRODUCT</b> to add your first listing.`
      );
    }
    let t = `\n📦 <b>MANAGE PRODUCTS</b>  <code>${rows.length} total</code>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    rows.forEach((p: any, i: number) => {
      const badge = p.active ? "🟢" : "🔴";
      const pos = `${i + 1}`;
      t += `${badge}  <b>${p.name}</b>  <code>$${parseFloat(p.price).toFixed(2)}</code>  <code>#${pos}</code>\n`;
      t += `<code>  ${p.account_type}  ·  filter: ${p.status_filter}</code>\n\n`;
    });
    return t.trimEnd();
  }

  function buildProductsListButtons(rows: any[]) {
    const buttons: ReturnType<typeof Markup.button.callback>[][] = rows.map((p: any, i: number) => [
      Markup.button.callback(i === 0 ? `·` : `⬆`, i === 0 ? `shop_noop` : `shop_move_up_${p.id}`),
      Markup.button.callback(i === rows.length - 1 ? `·` : `⬇`, i === rows.length - 1 ? `shop_noop` : `shop_move_down_${p.id}`),
      Markup.button.callback(`✏  ${p.name.slice(0, 18)}`, `shop_edit_${p.id}`),
      Markup.button.callback(p.active ? `⏸` : `▶`, `shop_toggle_${p.id}`),
    ]);
    buttons.push([
      Markup.button.callback("➕  ADD PRODUCT", "shop_admin_add_product"),
      Markup.button.callback("↩  Back", "shop_admin_menu"),
    ]);
    return Markup.inlineKeyboard(buttons);
  }

  bot.action("shop_noop", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
  });

  async function moveProduct(ctx: any, productId: string, direction: "up" | "down") {
    await ctx.answerCbQuery().catch(() => {});
    const all = await dbQuery(`SELECT id FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    const rows: any[] = all.rows;
    const idx = rows.findIndex((r: any) => r.id === productId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return;
    // Swap positions in array
    [rows[idx], rows[swapIdx]] = [rows[swapIdx], rows[idx]];
    // Write normalized sort_order for every product so future queries are stable
    for (let i = 0; i < rows.length; i++) {
      await dbQuery(`UPDATE shop_products SET sort_order = $1 WHERE id = $2`, [i, rows[i].id]);
    }
    const fresh = await dbQuery(`SELECT * FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    await safeEdit(ctx, buildProductsListMsg(fresh.rows), { parse_mode: "HTML", ...buildProductsListButtons(fresh.rows) });
  }

  bot.action(/^shop_move_up_([0-9a-f-]{36})$/, async (ctx) => {
    await moveProduct(ctx, (ctx.match as RegExpExecArray)[1], "up");
  });

  bot.action(/^shop_move_down_([0-9a-f-]{36})$/, async (ctx) => {
    await moveProduct(ctx, (ctx.match as RegExpExecArray)[1], "down");
  });

  bot.action("shop_admin_products", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const res = await dbQuery(`SELECT * FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    await safeEdit(ctx, buildProductsListMsg(res.rows), { parse_mode: "HTML", ...buildProductsListButtons(res.rows) });
  });

  // ── Toggle sticky from product list (quick toggle) ─────────────────────
  bot.action(/^shop_toggle_sticky_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const res = await dbQuery(`UPDATE shop_products SET sticky = NOT sticky WHERE id = $1 RETURNING *`, [productId]);
    const p = res.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.");
    await ctx.answerCbQuery(`${p.sticky ? "✅ Sticky ON" : "🔲 Sticky OFF"}: ${p.name}`).catch(() => {});
    await safeEdit(ctx, editProductText(p), {
      parse_mode: "HTML",
      ...editProductKeyboard(productId, p.active, p.sticky),
    });
  });

  bot.action(/^shop_toggle_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const res = await dbQuery(`SELECT active, name FROM shop_products WHERE id = $1`, [productId]);
    if (!res.rows[0]) return safeEdit(ctx, "Product not found.");
    const newActive = !res.rows[0].active;
    await dbQuery(`UPDATE shop_products SET active = $1 WHERE id = $2`, [newActive, productId]);
    await ctx.answerCbQuery(`${newActive ? "🟢 Activated" : "🔴 Deactivated"}: ${res.rows[0].name}`).catch(() => {});
    const all = await dbQuery(`SELECT * FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    await safeEdit(ctx, buildProductsListMsg(all.rows), { parse_mode: "HTML", ...buildProductsListButtons(all.rows) });
  });

  bot.action("shop_admin_add_product", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "name" };
    await ctx.reply(
      `\n🔷 <b>➕ ADD PRODUCT — 1/5</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Enter the product <b>name</b>:\n<code>  e.g. "Replit Core 1 Month"</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Shared: build edit-product text + keyboard ───────────────────────────
  function editProductText(p: any): string {
    // Build emoji display outside <code> so tg-emoji tags render properly
    let emojiDisplay: string;
    if (!p.custom_emoji) {
      emojiDisplay = "default";
    } else if (p.custom_emoji.startsWith("tg:")) {
      const rest  = p.custom_emoji.slice(3);
      const sep   = rest.indexOf(":");
      const id    = rest.slice(0, sep);
      const fb    = rest.slice(sep + 1);
      emojiDisplay = `<tg-emoji emoji-id="${id}">${fb}</tg-emoji> <i>(animated)</i>`;
    } else {
      emojiDisplay = p.custom_emoji;
    }

    return (
      `\n🔷 <b>EDIT PRODUCT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>${esc(p.name)}</b>\n` +
      `<code>` +
      `◈ Name          →  ${esc(p.name)}\n` +
      `◈ Description   →  ${p.description ? esc(p.description) : "—"}\n` +
      `◈ Price         →  $${parseFloat(p.price).toFixed(2)}\n` +
      `◈ Account type  →  ${p.account_type}\n` +
      `◈ Status filter →  ${p.status_filter}\n` +
      `◈ Sort order    →  ${p.sort_order}\n` +
      `◈ Sticky        →  ${p.sticky ? "Yes" : "No"}\n` +
      `◈ Sticky label  →  ${p.sticky_label ? esc(p.sticky_label) : "—"}\n` +
      `◈ Active        →  ${p.active ? "Yes" : "No"}` +
      `</code>\n` +
      `◈ Emoji  →  ${emojiDisplay}\n\n` +
      `› Tap a field to change it:`
    );
  }

  function editProductKeyboard(productId: string, isActive: boolean, isSticky: boolean) {
    return Markup.inlineKeyboard([
      [Markup.button.callback("✏ Name",          `shop_ef_${productId}_name`),
       Markup.button.callback("✏ Description",   `shop_ef_${productId}_description`)],
      [Markup.button.callback("✏ Price",          `shop_ef_${productId}_price`),
       Markup.button.callback("✏ Account Type",  `shop_ef_${productId}_account_type`)],
      [Markup.button.callback("✏ Status Filter", `shop_ef_${productId}_status_filter`),
       Markup.button.callback("✏ Sort Order",    `shop_ef_${productId}_sort_order`)],
      [Markup.button.callback("✏ Emoji",         `shop_ef_${productId}_custom_emoji`),
       Markup.button.callback("✏ Sticky Label",  `shop_ef_${productId}_sticky_label`)],
      [Markup.button.callback(isSticky ? "✅ Sticky" : "🔲 Sticky", `shop_toggle_sticky_${productId}`)],
      [Markup.button.callback(isActive ? "🔴 Deactivate" : "🟢 Activate", `shop_toggle_active_${productId}`)],
      [Markup.button.callback("🗑  Delete Product", `shop_delete_confirm_${productId}`),
       Markup.button.callback("↩ Products",         "shop_admin_products")],
    ]);
  }

  // ── Product edit: show current fields + per-field edit buttons ─────────────
  bot.action(/^shop_edit_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const res = await dbQuery(`SELECT * FROM shop_products WHERE id = $1`, [productId]);
    const p = res.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.");
    await safeEdit(ctx, editProductText(p), {
      parse_mode: "HTML",
      ...editProductKeyboard(productId, p.active, p.sticky),
    });
  });

  bot.action(/^shop_ef_([0-9a-f-]{36})_(name|description|price|account_type|status_filter|sort_order|sticky_label|custom_emoji)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    const [, productId, field] = ctx.match as RegExpExecArray;
    const stepMap: Record<string, ShopAdminFlow["step"]> = {
      name:          "edit_name",
      description:   "edit_description",
      price:         "edit_price",
      account_type:  "edit_account_type",
      status_filter: "edit_status_filter",
      sort_order:    "edit_sort_order",
      sticky_label:  "edit_sticky_label",
      custom_emoji:  "edit_custom_emoji",
    };
    getState(uid).shopAdminFlow = { step: stepMap[field], editProductId: productId };
    const promptMap: Record<string, string> = {
      name:          `✏ <b>Edit Name</b>\n\n› Send the new product name:`,
      description:   `✏ <b>Edit Description</b>\n\n› Send the new description, or <code>-</code> to clear it:`,
      price:         `✏ <b>Edit Price</b>\n\n› Send the new price in USD:\n<code>  e.g. 1.50</code>`,
      account_type:  `✏ <b>Edit Account Type</b>\n\n<i>Known types (linked to credential tables):</i>\n<code>  ${SHOP_ACCOUNT_TYPES.join(" | ")}</code>\n\n<i>Or type any custom name (e.g. <code>perplexity</code>, <code>cursor</code>) — stock will come from redeem links.</i>`,
      status_filter: `✏ <b>Edit Status Filter</b>\n\n› Send the credential status to match:\n<code>  e.g. available | working | created</code>`,
      sort_order:    `✏ <b>Edit Sort Order</b>\n\n› Send a number (lower = shown first):\n<code>  e.g. 0, 1, 2 …</code>`,
      sticky_label:  `✏ <b>Edit Sticky Label</b>\n\n› Send the text to display on the reply keyboard button, or <code>-</code> to use the product name:`,
      custom_emoji:  `✏ <b>Edit Product Emoji</b>\n\n› Send any emoji to use as this product's icon in the shop list and detail view.\n<i>Paste a Telegram emoji, standard emoji, or send <code>-</code> to reset to the platform default.</i>`,
    };
    await ctx.reply(promptMap[field], { parse_mode: "HTML" });
  });

  // ── Toggle product active/inactive ───────────────────────────────────────
  bot.action(/^shop_toggle_active_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const res = await dbQuery(`UPDATE shop_products SET active = NOT active WHERE id = $1 RETURNING *`, [productId]);
    const p = res.rows[0];
    if (!p) return ctx.reply("Product not found.");
    await ctx.answerCbQuery(`${p.active ? "🟢 Activated" : "🔴 Deactivated"}: ${p.name}`).catch(() => {});
    await safeEdit(ctx, editProductText(p), {
      parse_mode: "HTML",
      ...editProductKeyboard(productId, p.active, p.sticky),
    });
  });

  // ── Delete product: confirmation prompt ───────────────────────────────────
  bot.action(/^shop_delete_confirm_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const res = await dbQuery(`SELECT name, price FROM shop_products WHERE id = $1`, [productId]);
    const p = res.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.");
    await safeEdit(ctx,
      `\n🗑 <b>DELETE PRODUCT?</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>${p.name}</b>  ·  <code>$${parseFloat(p.price).toFixed(2)}</code>\n\n` +
      `⚠️ This removes the product listing permanently.\n` +
      `<i>Credentials in the linked account table are NOT deleted.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅  Yes, delete it", `shop_delete_do_${productId}`)],
          [Markup.button.callback("↩  Cancel", `shop_edit_${productId}`)],
        ]),
      }
    );
  });

  // ── Delete product: execute ───────────────────────────────────────────────
  bot.action(/^shop_delete_do_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery("Deleting…").catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const res = await dbQuery(`DELETE FROM shop_products WHERE id = $1 RETURNING name`, [productId]);
    const name = res.rows[0]?.name ?? "Unknown";
    await safeEdit(ctx,
      `✅ <b>${name}</b> has been deleted.\n\n<i>Returning to product list…</i>`,
      { parse_mode: "HTML" }
    );
    // Navigate back to products list after a short delay
    await new Promise(r => setTimeout(r, 800));
    const prodRes = await dbQuery(`SELECT id, name, price, active FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    if (prodRes.rows.length === 0) {
      return safeEdit(ctx,
        `\n📦 <b>PRODUCTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No products yet. Add your first product!</i>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("➕ Add Product", "shop_admin_addproduct"), Markup.button.callback("↩ Back", "shop_admin_menu")]]) }
      );
    }
    const btns = prodRes.rows.map((prod: any) =>
      [Markup.button.callback(`${prod.active ? "🟢" : "🔴"} ${prod.name}  ·  $${parseFloat(prod.price).toFixed(2)}`, `shop_edit_${prod.id}`)]
    );
    btns.push([Markup.button.callback("➕ Add Product", "shop_admin_addproduct"), Markup.button.callback("↩ Back", "shop_admin_menu")]);
    await safeEdit(ctx,
      `\n📦 <b>PRODUCTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n› Select a product to edit:`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard(btns) }
    );
  });

  // ── Paginated customer list ───────────────────────────────────────────────
  async function showCustomerPage(ctx: any, offset: number, edit = true) {
    const PAGE = 20;
    const [countRes, totalBalRes] = await Promise.all([
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_customers`),
      dbQuery(`SELECT COALESCE(SUM(balance),0) as total FROM shop_customers`),
    ]);
    const total     = parseInt(countRes.rows[0]?.cnt ?? "0");
    const totalBal  = parseFloat(totalBalRes.rows[0]?.total ?? "0");

    if (total === 0) {
      return replyOrEdit(ctx, edit,
        `\n👥 <b>CUSTOMER DATABASE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<i>No customers have used the shop bot yet.</i>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([
          [Markup.button.callback("💰  FUND ACCOUNT", "shop_admin_topup"), Markup.button.callback("↩  Back", "shop_admin_menu")],
        ]) }
      );
    }
    const res = await dbQuery(
      `SELECT telegram_id, username, first_name, balance FROM shop_customers ORDER BY balance DESC LIMIT $1 OFFSET $2`,
      [PAGE, offset]
    );
    const page       = Math.floor(offset / PAGE) + 1;
    const totalPages = Math.ceil(total / PAGE);

    let t =
      `\n👥 <b>CUSTOMER DATABASE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>Customers: ${total}   Held funds: $${totalBal.toFixed(2)}</code>\n` +
      `<code>Page ${page} of ${totalPages}</code>\n\n` +
      `<code>`;
    for (const c of res.rows) {
      const name = c.username ? `@${c.username}` : (c.first_name ? c.first_name : `id:${c.telegram_id}`);
      const bal  = `$${parseFloat(c.balance).toFixed(2)}`;
      t += `${name.slice(0, 18).padEnd(18)}  ${bal.padStart(7)}\n`;
    }
    t += `</code>`;

    const navButtons: ReturnType<typeof Markup.button.callback>[] = [];
    if (offset > 0)               navButtons.push(Markup.button.callback("◀  Prev", `shop_customers_page_${offset - PAGE}`));
    if (offset + PAGE < total)    navButtons.push(Markup.button.callback("Next  ▶", `shop_customers_page_${offset + PAGE}`));
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (navButtons.length) rows.push(navButtons);
    rows.push([
      Markup.button.callback("💰  FUND ACCOUNT", "shop_admin_topup"),
      Markup.button.callback("↩  Back",          "shop_admin_menu"),
    ]);
    await replyOrEdit(ctx, edit, t, { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) });
  }

  bot.action("shop_admin_customers", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showCustomerPage(ctx, 0);
  });

  bot.action(/^shop_customers_page_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const offset = parseInt((ctx.match as RegExpExecArray)[1]);
    await showCustomerPage(ctx, offset);
  });

  bot.action("shop_admin_topup", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "topup_uid" };
    await ctx.reply(
      `\n💰 <b>FUND CUSTOMER ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Enter the customer's <b>Telegram ID</b>:\n` +
      `<i>  e.g. 123456789</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Refer reward amount ───────────────────────────────────────────────────
  bot.action("shop_admin_refer_amount", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    const cur = await dbQuery(`SELECT value FROM shop_settings WHERE key = 'referral_reward'`);
    const current = parseFloat(cur.rows[0]?.value ?? "0.50");
    getState(uid).shopAdminFlow = { step: "refer_amount" };
    await ctx.reply(
      `\n🔗 <b>REFER REWARD AMOUNT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>Current reward:  $${current.toFixed(2)}</code>\n\n` +
      `› Enter the new reward amount in USD:\n<code>  e.g. 0.50 · 1.00 · 2.00</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Activation orders list ────────────────────────────────────────────────
  bot.action("shop_admin_act_orders", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const res = await dbQuery(
      `SELECT id, telegram_id, service, delivery_type, email, amount, status, created_at
       FROM shop_activation_orders ORDER BY created_at DESC LIMIT 20`
    );
    if (res.rows.length === 0) {
      return safeEdit(ctx,
        `\n📋 <b>ACTIVATION ORDERS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<i>No activation orders yet.</i>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("↩  Back", "shop_admin_menu")]]) }
      );
    }
    const serviceLabel: Record<string, string> = { chatgpt_plus: "ChatGPT+", replit_core: "Replit Core" };
    let t = `\n📋 <b>ACTIVATION ORDERS</b>  <code>last ${res.rows.length}</code>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    for (const r of res.rows) {
      const svc   = serviceLabel[r.service] ?? r.service;
      const type  = r.delivery_type === "activate" ? "🔑" : "📦";
      const stat  = r.status === "pending" ? "⏳" : r.status === "completed" ? "✅" : "❌";
      const email = r.email ? r.email.slice(0, 20) : "—";
      const date  = new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      t += `${stat} ${type} ${svc.padEnd(10)}  $${parseFloat(r.amount).toFixed(2)}  ${date}\n`;
      if (r.email) t += `   ${email}\n`;
    }
    t += `</code>`;
    await safeEdit(ctx, t, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("↩  Back", "shop_admin_menu")]]),
    });
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────
  bot.action("shop_admin_broadcast", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    const r = await dbQuery(`SELECT COUNT(*) as cnt FROM shop_customers`);
    const total = parseInt(r.rows[0]?.cnt ?? "0");
    getState(uid).shopAdminFlow = { step: "broadcast_text" };
    await ctx.reply(
      `\n📢 <b>BROADCAST MESSAGE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>Recipients:  ${total} customers</code>\n\n` +
      `› Type your <b>broadcast message</b>:\n<i>Supports HTML. Sent to all customers.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Analytics ─────────────────────────────────────────────────────────────
  bot.action("shop_admin_analytics", async (ctx) => {
    await ctx.answerCbQuery("Loading analytics…").catch(() => {});
    const [todayRes, weekRes, monthRes, bestRes, topCustRes, avgRating] = await Promise.all([
      dbQuery(`SELECT COALESCE(SUM(amount),0) as t FROM shop_orders WHERE created_at >= NOW() - INTERVAL '1 day'`),
      dbQuery(`SELECT COALESCE(SUM(amount),0) as t FROM shop_orders WHERE created_at >= NOW() - INTERVAL '7 days'`),
      dbQuery(`SELECT COALESCE(SUM(amount),0) as t FROM shop_orders WHERE created_at >= NOW() - INTERVAL '30 days'`),
      dbQuery(`SELECT product_name, COUNT(*) as cnt, SUM(amount) as rev FROM shop_orders GROUP BY product_name ORDER BY cnt DESC LIMIT 5`),
      dbQuery(`SELECT c.first_name, c.username, SUM(o.amount) as spent FROM shop_orders o JOIN shop_customers c ON o.telegram_id = c.telegram_id GROUP BY c.telegram_id, c.first_name, c.username ORDER BY spent DESC LIMIT 5`),
      dbQuery(`SELECT ROUND(AVG(rating),1) as avg FROM shop_order_ratings`),
    ]);
    const today = parseFloat(todayRes.rows[0]?.t ?? "0");
    const week  = parseFloat(weekRes.rows[0]?.t ?? "0");
    const month = parseFloat(monthRes.rows[0]?.t ?? "0");
    const avg   = avgRating.rows[0]?.avg ?? "N/A";

    let t = `\n📊 <b>REVENUE ANALYTICS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    t += `<b>💵 Revenue</b>\n<code>`;
    t += `Today:   $${today.toFixed(2)}\n`;
    t += `7 days:  $${week.toFixed(2)}\n`;
    t += `30 days: $${month.toFixed(2)}\n`;
    t += `Rating:  ${avg} / 5\n</code>\n\n`;

    if (bestRes.rows.length > 0) {
      t += `<b>📦 Top Products</b>\n<code>`;
      for (const r of bestRes.rows) {
        t += `${String(r.cnt).padStart(3)}x  $${parseFloat(r.rev).toFixed(2)}  ${r.product_name.slice(0, 20)}\n`;
      }
      t += `</code>\n\n`;
    }
    if (topCustRes.rows.length > 0) {
      t += `<b>👥 Top Customers</b>\n<code>`;
      for (const r of topCustRes.rows) {
        const name = r.username ? `@${r.username}` : (r.first_name ?? "Unknown");
        t += `$${parseFloat(r.spent).toFixed(2).padStart(7)}  ${name.slice(0, 18)}\n`;
      }
      t += `</code>`;
    }
    await safeEdit(ctx, t, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("↩  Back", "shop_admin_menu")]]),
    });
  });

  // ── Customer search ───────────────────────────────────────────────────────
  bot.action("shop_admin_search", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "search_uid" };
    await ctx.reply(
      `\n🔍 <b>SEARCH CUSTOMER</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Enter a <b>Telegram ID</b> or <b>@username</b>:`,
      { parse_mode: "HTML" }
    );
  });

  // ── Deposit requests ──────────────────────────────────────────────────────
  bot.action("shop_admin_deposits", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const res = await dbQuery(
      `SELECT d.id, d.telegram_id, d.status, d.amount_requested, d.created_at, c.username, c.first_name
       FROM shop_deposit_requests d
       LEFT JOIN shop_customers c ON d.telegram_id = c.telegram_id
       ORDER BY d.created_at DESC LIMIT 20`
    );
    if (res.rows.length === 0) {
      return safeEdit(ctx,
        `\n📸 <b>DEPOSIT REQUESTS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No deposit requests yet.</i>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("↩  Back", "shop_admin_menu")]]) }
      );
    }
    let t = `\n📸 <b>DEPOSIT REQUESTS</b>  <code>last ${res.rows.length}</code>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const r of res.rows) {
      const name = r.username ? `@${r.username}` : (r.first_name ?? `${r.telegram_id}`);
      const stat = r.status === "pending" ? "⏳" : r.status === "approved" ? "✅" : "❌";
      const amt  = r.amount_requested ? `$${parseFloat(r.amount_requested).toFixed(2)}` : "—";
      const date = new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      t += `${stat} #${r.id}  ${name.slice(0, 14).padEnd(14)}  ${amt}  ${date}\n`;
      if (r.status === "pending") {
        buttons.push([
          Markup.button.callback(`✅ #${r.id} Approve`, `dep_approve_${r.id}_${r.telegram_id}`),
          Markup.button.callback(`❌ Deny`, `dep_deny_${r.id}_${r.telegram_id}`),
        ]);
      }
    }
    t += `</code>`;
    buttons.push([Markup.button.callback("↩  Back", "shop_admin_menu")]);
    await safeEdit(ctx, t, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^dep_approve_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid     = ctx.from.id;
    const reqId   = parseInt((ctx.match as RegExpExecArray)[1]);
    const custUid = parseInt((ctx.match as RegExpExecArray)[2]);
    getState(uid).shopAdminFlow = { step: "dep_approve_amount", depRequestId: reqId, depUserId: custUid };
    await ctx.reply(
      `\n✅ <b>APPROVE DEPOSIT #${reqId}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Customer ID: <code>${custUid}</code>\n\n` +
      `› Enter the <b>amount to credit</b> in USD:\n<code>  e.g. 5.00</code>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^dep_deny_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Denied").catch(() => {});
    const reqId   = parseInt((ctx.match as RegExpExecArray)[1]);
    const custUid = parseInt((ctx.match as RegExpExecArray)[2]);
    await dbQuery(`UPDATE shop_deposit_requests SET status = 'denied', resolved_at = NOW() WHERE id = $1`, [reqId]);
    // Notify customer via shop bot
    const shopToken = process.env.TELEGRAM_BOT_TOKEN_2;
    if (shopToken) {
      fetch(`https://api.telegram.org/bot${shopToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: custUid,
          text: `❌ <b>Deposit Request #${reqId} Denied</b>\n\nWe could not verify your payment. Please contact support: @avinashaddison`,
          parse_mode: "HTML",
        }),
      }).catch(() => {});
    }
    await ctx.reply(`❌ Deposit #${reqId} denied. Customer notified.`);
  });

  // ── Promo codes ───────────────────────────────────────────────────────────
  bot.action("shop_admin_promos", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const res = await dbQuery(
      `SELECT code, discount_pct, discount_fixed, max_uses, uses_count, active, expires_at
       FROM shop_promo_codes ORDER BY created_at DESC LIMIT 20`
    );
    if (res.rows.length === 0) {
      return safeEdit(ctx,
        `\n🏷️ <b>PROMO CODES</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No promo codes created yet.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("➕  Create Code", "shop_admin_promo_create")],
            [Markup.button.callback("↩  Back", "shop_admin_menu")],
          ]),
        }
      );
    }
    let t = `\n🏷️ <b>PROMO CODES</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const r of res.rows) {
      const stat   = r.active ? "🟢" : "🔴";
      const disc   = parseFloat(r.discount_pct) > 0 ? `${parseFloat(r.discount_pct).toFixed(0)}% off` : `$${parseFloat(r.discount_fixed).toFixed(2)} off`;
      const uses   = r.max_uses > 0 ? `${r.uses_count}/${r.max_uses}` : `${r.uses_count}/∞`;
      t += `${stat} ${r.code.padEnd(12)} ${disc.padEnd(10)} ${uses}\n`;
      buttons.push([
        Markup.button.callback(`${r.active ? "⏸ Disable" : "▶ Enable"} ${r.code}`, `shop_promo_toggle_${r.code}`),
      ]);
    }
    t += `</code>`;
    buttons.push([Markup.button.callback("➕  Create Code", "shop_admin_promo_create"), Markup.button.callback("↩  Back", "shop_admin_menu")]);
    await safeEdit(ctx, t, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  bot.action("shop_admin_promo_create", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "promo_code" };
    await ctx.reply(
      `\n🏷️ <b>CREATE PROMO CODE — 1/3</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `› Enter the <b>promo code</b>:\n<code>  e.g. SAVE20 · WELCOME · LAUNCH10</code>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action(/^shop_promo_toggle_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const code = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT active FROM shop_promo_codes WHERE code = $1`, [code]);
    if (!r.rows[0]) return ctx.answerCbQuery("Code not found", { show_alert: true });
    const newActive = !r.rows[0].active;
    await dbQuery(`UPDATE shop_promo_codes SET active = $1 WHERE code = $2`, [newActive, code]);
    await ctx.answerCbQuery(`${newActive ? "🟢 Enabled" : "🔴 Disabled"}: ${code}`, { show_alert: true });
    // Refresh list
    const res = await dbQuery(`SELECT code, discount_pct, discount_fixed, max_uses, uses_count, active FROM shop_promo_codes ORDER BY created_at DESC LIMIT 20`);
    let t = `\n🏷️ <b>PROMO CODES</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const row of res.rows) {
      const stat = row.active ? "🟢" : "🔴";
      const disc = parseFloat(row.discount_pct) > 0 ? `${parseFloat(row.discount_pct).toFixed(0)}%` : `$${parseFloat(row.discount_fixed).toFixed(2)}`;
      t += `${stat} ${row.code.padEnd(12)} ${disc}\n`;
      buttons.push([Markup.button.callback(`${row.active ? "⏸ Disable" : "▶ Enable"} ${row.code}`, `shop_promo_toggle_${row.code}`)]);
    }
    t += `</code>`;
    buttons.push([Markup.button.callback("➕  Create Code", "shop_admin_promo_create"), Markup.button.callback("↩  Back", "shop_admin_menu")]);
    await safeEdit(ctx, t, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  // ── Restock subscribers ───────────────────────────────────────────────────
  bot.action("shop_admin_restock", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const res = await dbQuery(
      `SELECT s.product_id, p.name as product_name, COUNT(*) as sub_count
       FROM shop_restock_subs s
       LEFT JOIN shop_products p ON p.id::text = s.product_id
       GROUP BY s.product_id, p.name
       ORDER BY sub_count DESC`
    );
    if (res.rows.length === 0) {
      return safeEdit(ctx,
        `\n🔔 <b>RESTOCK SUBSCRIBERS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No subscribers yet.</i>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("↩  Back", "shop_admin_menu")]]) }
      );
    }
    let t = `\n🔔 <b>RESTOCK SUBSCRIBERS</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const r of res.rows) {
      const name = r.product_name ?? r.product_id;
      t += `${String(r.sub_count).padStart(3)} subs  ${name.slice(0, 25)}\n`;
      buttons.push([Markup.button.callback(`📢 Notify ${r.sub_count} subs — ${name.slice(0, 20)}`, `shop_notify_restock_${r.product_id}`)]);
    }
    t += `</code>`;
    buttons.push([Markup.button.callback("↩  Back", "shop_admin_menu")]);
    await safeEdit(ctx, t, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^shop_notify_restock_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Sending notifications…").catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT name FROM shop_products WHERE id::text = $1`, [productId]);
    const productName = r.rows[0]?.name ?? "Unknown";
    const shopToken   = process.env.TELEGRAM_BOT_TOKEN_2;
    if (!shopToken) return ctx.reply("❌ Shop bot token not configured.");
    const subs = await dbQuery(`SELECT telegram_id FROM shop_restock_subs WHERE product_id = $1`, [productId]);
    let sent = 0;
    for (const row of subs.rows) {
      try {
        await fetch(`https://api.telegram.org/bot${shopToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: row.telegram_id,
            text: `🔔 <b>Back in Stock!</b>\n\n📦 <b>${productName}</b> is now available!\n\n<i>Tap below to buy before it sells out!</i>`,
            parse_mode: "HTML",
            reply_markup: JSON.stringify({ inline_keyboard: [[{ text: "⚡  Buy Now", callback_data: `shop_product_${productId}` }]] }),
          }),
        });
        sent++;
        await new Promise(r => setTimeout(r, 50)); // Rate limit
      } catch {}
    }
    await dbQuery(`DELETE FROM shop_restock_subs WHERE product_id = $1`, [productId]);
    await ctx.reply(`✅ Notified <b>${sent}</b> subscriber${sent !== 1 ? "s" : ""} for <b>${productName}</b>. Subscribers cleared.`, { parse_mode: "HTML" });
  });

  // ── Stock Manager ────────────────────────────────────────────────────────

  // Helper: build stock overview for one product
  async function getProductStockInfo(p: any) {
    const table = SHOP_TABLE_MAP[p.account_type];
    if (!table) return { avail: 0, sold: 0, total: 0 };
    const sf = p.status_filter ?? "available";
    const r = await dbQuery(
      `SELECT
         COUNT(*) FILTER (WHERE status = $1) AS avail,
         COUNT(*) FILTER (WHERE status = 'sold_out') AS sold,
         COUNT(*) AS total
       FROM ${table}`,
      [sf]
    );
    return {
      avail: parseInt(r.rows[0]?.avail ?? "0"),
      sold:  parseInt(r.rows[0]?.sold  ?? "0"),
      total: parseInt(r.rows[0]?.total ?? "0"),
    };
  }

  // ── Shared: render product stock detail page and edit message in-place ────────
  async function renderProductStockDetail(ctx: any, productId: string, extraNote?: string) {
    const r = await dbQuery(`SELECT * FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.", { parse_mode: "HTML" });

    const table = SHOP_TABLE_MAP[p.account_type];
    const sf    = p.status_filter ?? "available";
    const isManual  = (p.delivery_mode ?? "auto") === "manual";
    const manualStk = p.manual_stock ?? 0;
    const info  = await getProductStockInfo(p);
    const overrideVal = p.stock_override != null ? p.stock_override : null;
    const displayStock = isManual
      ? `${manualStk}  (manual stock)`
      : overrideVal != null ? `${overrideVal}  (override)` : `${info.avail}  (real count)`;

    const text =
      `\n🗄 <b>STOCK: ${p.name}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>` +
      `Delivery mode  :  ${isManual ? "MANUAL 📬" : "AUTO ⚡"}\n` +
      `Account type   :  ${p.account_type}\n` +
      `DB table       :  ${table ?? "⚠️ unmapped"}\n` +
      `Status filter  :  ${sf}\n` +
      `─────────────────────────────────\n` +
      `Shown to buyer :  ${displayStock}\n` +
      (isManual ? "" : `Real available :  ${info.avail}\nSold out       :  ${info.sold}\nTotal entries  :  ${info.total}\n`) +
      `</code>\n\n` +
      (extraNote ? `${extraNote}\n\n` : "") +
      `› What would you like to do?`;

    const toggleLabel = isManual ? "⚡  Switch to AUTO" : "📬  Switch to MANUAL";
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [
      [Markup.button.callback(toggleLabel, `shop_stock_togglemode_${productId}`)],
    ];
    if (isManual) {
      buttons.push([Markup.button.callback(`📊  Set Manual Stock  (now: ${manualStk})`, `shop_stock_setmanualstock_${productId}`)]);
    } else {
      buttons.push([
        Markup.button.callback("📧  Add Credentials",  `shop_stock_addcreds_${productId}`),
        Markup.button.callback("🔗  Add Redeem Links", `shop_stock_addlinks_${productId}`),
      ]);
      buttons.push([
        Markup.button.callback("📋  View Credentials", `shop_stock_view_${productId}_0`),
        Markup.button.callback("🔗  View Links",       `shop_stock_viewlinks_${productId}_0`),
      ]);
      buttons.push([
        Markup.button.callback("✏️  Set Stock Count",  `shop_stock_setcount_${productId}`),
        Markup.button.callback(overrideVal != null ? "🔄  Real Count" : "🔢  Override",
                               overrideVal != null ? `shop_stock_clearoverride_${productId}` : `shop_stock_setcount_${productId}`),
      ]);
      buttons.push([
        Markup.button.callback("🗑  Clear Sold Out",   `shop_stock_clearsold_${productId}`),
        Markup.button.callback("♻  Reset Available",  `shop_stock_resetavail_${productId}`),
      ]);
    }
    buttons.push([Markup.button.callback("↩  Back to Stock", "shop_admin_stock")]);

    return safeEdit(ctx, text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
  }

  // 🗄 STOCK MANAGER — overview of all products with live counts
  bot.action("shop_admin_stock", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return renderStockOverview(ctx, "edit");
  });

  // Per-product stock management page
  bot.action(/^shop_stock_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    return renderProductStockDetail(ctx, productId);
  });

  // Start set-stock-count flow
  bot.action(/^shop_stock_setcount_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT name FROM shop_products WHERE id = $1`, [productId]);
    if (!r.rows[0]) return safeEdit(ctx, "Product not found.", { parse_mode: "HTML" });
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "stock_set_override", stockOverrideProductId: productId };
    return ctx.reply(
      `\n✏️ <b>SET STOCK COUNT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Product: <b>${r.rows[0].name}</b>\n\n` +
      `› Type the number to display as stock (e.g. <code>100</code>):\n` +
      `<i>This overrides the real DB count shown to customers.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // Clear stock override — revert to real count
  bot.action(/^shop_stock_clearoverride_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    await dbQuery(`UPDATE shop_products SET stock_override = NULL WHERE id = $1`, [productId]);
    // Refresh the stock page
    const r = await dbQuery(`SELECT * FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.", { parse_mode: "HTML" });
    const table = SHOP_TABLE_MAP[p.account_type];
    const sf    = p.status_filter ?? "available";
    const info  = await getProductStockInfo(p);
    const displayStock = `${info.avail}  (real count)`;
    const text =
      `\n🗄 <b>STOCK: ${p.name}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>` +
      `Account type   :  ${p.account_type}\n` +
      `DB table       :  ${table ?? "⚠️ unmapped"}\n` +
      `Status filter  :  ${sf}\n` +
      `─────────────────────────────────\n` +
      `Shown to buyer :  ${displayStock}\n` +
      `Real available :  ${info.avail}\n` +
      `Sold out       :  ${info.sold}\n` +
      `Total entries  :  ${info.total}\n` +
      `</code>\n\n` +
      `✅ Override cleared — now showing real count.\n\n› What would you like to do?`;
    await safeEdit(ctx, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("📧  Add Credentials",    `shop_stock_addcreds_${productId}`),
         Markup.button.callback("🔗  Add Redeem Links",   `shop_stock_addlinks_${productId}`)],
        [Markup.button.callback("📋  View Credentials",   `shop_stock_view_${productId}_0`),
         Markup.button.callback("🔗  View Links",         `shop_stock_viewlinks_${productId}_0`)],
        [Markup.button.callback("✏️  Set Stock Count",    `shop_stock_setcount_${productId}`),
         Markup.button.callback("🔢  Override",           `shop_stock_setcount_${productId}`)],
        [Markup.button.callback("🗑  Clear Sold Out",      `shop_stock_clearsold_${productId}`),
         Markup.button.callback("♻  Reset Available",     `shop_stock_resetavail_${productId}`)],
        [Markup.button.callback("↩  Back to Stock",       "shop_admin_stock")],
      ]),
    });
  });

  // Add credentials (email:password) for a product
  bot.action(/^shop_stock_addcreds_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT name, account_type, status_filter FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.", { parse_mode: "HTML" });

    const table = SHOP_TABLE_MAP[p.account_type];
    if (!table) {
      return ctx.reply(`⚠️ Account type <code>${p.account_type}</code> has no mapped table. Cannot add credentials.`, { parse_mode: "HTML" });
    }

    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = {
      step: "stock_add_creds",
      stockProductId: productId,
      stockTableName: table,
      stockStatusFilter: p.status_filter ?? "available",
    };

    await ctx.reply(
      `\n📧 <b>ADD CREDENTIALS — ${p.name}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>Table:</b> <code>${table}</code>  ·  <b>Status:</b> <code>${p.status_filter ?? "available"}</code>\n\n` +
      `Paste credentials — one per line:\n` +
      `<code>email:password\nemail:password\n...</code>\n\n` +
      `<i>Duplicates are skipped automatically.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // Add redeem links for a product
  bot.action(/^shop_stock_addlinks_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT name FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.", { parse_mode: "HTML" });

    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "stock_add_links", stockProductId: productId };

    await ctx.reply(
      `\n🔗 <b>ADD REDEEM LINKS — ${p.name}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Paste redeem links — one per line:\n` +
      `<code>https://lovable.dev/redeem/abc123\nhttps://lovable.dev/redeem/xyz456\n...</code>\n\n` +
      `<i>Links are delivered to customers on purchase. Duplicates are skipped.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // View redeem links paginated
  bot.action(/^shop_stock_viewlinks_([0-9a-f-]{36})_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const [, productId, offsetStr] = ctx.match as RegExpExecArray;
    const offset = parseInt(offsetStr, 10);
    const PAGE   = 10;

    const r = await dbQuery(`SELECT name FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.", { parse_mode: "HTML" });

    const countRes = await dbQuery(`SELECT COUNT(*) as cnt FROM shop_redeem_links WHERE product_id = $1`, [productId]);
    const total    = parseInt(countRes.rows[0]?.cnt ?? "0");

    if (total === 0) {
      return safeEdit(ctx,
        `\n🔗 <b>REDEEM LINKS — ${p.name}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `<i>No redeem links added yet.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("↩  Back", `shop_stock_${productId}`)]]),
        }
      );
    }

    const rows = await dbQuery(
      `SELECT link, status FROM shop_redeem_links WHERE product_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [productId, PAGE, offset]
    );

    const page = Math.floor(offset / PAGE) + 1;
    const totalPages = Math.ceil(total / PAGE);
    let text = `\n🔗 <b>REDEEM LINKS — ${p.name}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    text += `<code>Page ${page}/${totalPages}  ·  ${total} total\n\n`;
    for (const row of rows.rows) {
      const st = row.status === "sold" ? "✗" : "✓";
      const shortLink = row.link.length > 40 ? row.link.slice(0, 37) + "..." : row.link;
      text += `${st}  ${shortLink}\n`;
    }
    text += `</code>`;

    const nav: ReturnType<typeof Markup.button.callback>[] = [];
    if (offset > 0)               nav.push(Markup.button.callback("◀  Prev", `shop_stock_viewlinks_${productId}_${offset - PAGE}`));
    if (offset + PAGE < total)    nav.push(Markup.button.callback("Next  ▶", `shop_stock_viewlinks_${productId}_${offset + PAGE}`));
    const btns: ReturnType<typeof Markup.button.callback>[][] = [];
    if (nav.length) btns.push(nav);
    btns.push([Markup.button.callback("↩  Back", `shop_stock_${productId}`)]);
    await safeEdit(ctx, text, { parse_mode: "HTML", ...Markup.inlineKeyboard(btns) });
  });

  // View credentials paginated (10 per page)
  bot.action(/^shop_stock_view_([0-9a-f-]{36})_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const [, productId, offsetStr] = ctx.match as RegExpExecArray;
    const offset = parseInt(offsetStr, 10);
    const PAGE   = 10;

    const r = await dbQuery(`SELECT name, account_type, status_filter FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    if (!p) return safeEdit(ctx, "Product not found.", { parse_mode: "HTML" });

    const table = SHOP_TABLE_MAP[p.account_type];
    if (!table) return safeEdit(ctx, `⚠️ No table mapped for <code>${p.account_type}</code>`, { parse_mode: "HTML" });

    const countRes  = await dbQuery(`SELECT COUNT(*) as cnt FROM ${table}`);
    const total     = parseInt(countRes.rows[0]?.cnt ?? "0");
    const rows      = await dbQuery(
      `SELECT email, password, status FROM ${table} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [PAGE, offset]
    );

    if (total === 0) {
      return safeEdit(ctx,
        `\n📋 <b>${p.name} — Credentials</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<i>No credentials in database yet.</i>`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("↩  Back", `shop_stock_${productId}`)]])}
      );
    }

    const page      = Math.floor(offset / PAGE) + 1;
    const totalPages = Math.ceil(total / PAGE);
    let text = `\n📋 <b>${p.name.slice(0, 25)}</b>  (p.${page}/${totalPages})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>`;
    for (const row of rows.rows) {
      const st  = row.status === (p.status_filter ?? "available") ? "✓" : row.status === "sold_out" ? "✗" : "?";
      const em  = (row.email ?? "—").slice(0, 28);
      const pw  = (row.password ?? "—").slice(0, 16);
      text += `${st}  ${em.padEnd(28)}  ${pw}\n`;
    }
    text += `</code>`;

    const nav: ReturnType<typeof Markup.button.callback>[] = [];
    if (offset > 0)             nav.push(Markup.button.callback("◀  Prev", `shop_stock_view_${productId}_${offset - PAGE}`));
    if (offset + PAGE < total)  nav.push(Markup.button.callback("Next  ▶", `shop_stock_view_${productId}_${offset + PAGE}`));

    await safeEdit(ctx, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        ...(nav.length ? [nav] : []),
        [Markup.button.callback("↩  Back", `shop_stock_${productId}`)],
      ]),
    });
  });

  // Clear sold-out entries for a product
  bot.action(/^shop_stock_clearsold_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery("Clearing…").catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT name, account_type FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    const table = p ? SHOP_TABLE_MAP[p.account_type] : null;
    if (!table) return ctx.reply("⚠️ Product or table not found.", { parse_mode: "HTML" });
    const del = await dbQuery(`DELETE FROM ${table} WHERE status = 'sold_out' RETURNING id`);
    await ctx.answerCbQuery(`🗑 Deleted ${del.rowCount} sold-out entries`).catch(() => {});
    await ctx.reply(`✅ Removed <b>${del.rowCount}</b> sold-out entries from <code>${table}</code>.`, { parse_mode: "HTML" });
  });

  // Reset all non-sold entries to "available"
  bot.action(/^shop_stock_resetavail_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery("Resetting…").catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT name, account_type, status_filter FROM shop_products WHERE id = $1`, [productId]);
    const p = r.rows[0];
    const table = p ? SHOP_TABLE_MAP[p.account_type] : null;
    if (!table) return ctx.reply("⚠️ Product or table not found.", { parse_mode: "HTML" });
    const sf = p.status_filter ?? "available";
    const upd = await dbQuery(
      `UPDATE ${table} SET status = $1 WHERE status != 'sold_out' RETURNING id`,
      [sf]
    );
    await ctx.reply(
      `✅ Reset <b>${upd.rowCount}</b> entries to <code>${sf}</code> in <code>${table}</code>.`,
      { parse_mode: "HTML" }
    );
  });

  // ── Delivery mode toggle (AUTO ↔ MANUAL) ─────────────────────────────────
  bot.action(/^shop_stock_togglemode_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT delivery_mode FROM shop_products WHERE id = $1`, [productId]);
    if (!r.rows[0]) return ctx.reply("Product not found.", { parse_mode: "HTML" });
    const current = r.rows[0].delivery_mode ?? "auto";
    const next    = current === "manual" ? "auto" : "manual";
    await dbQuery(`UPDATE shop_products SET delivery_mode = $1 WHERE id = $2`, [next, productId]);
    await ctx.answerCbQuery(`Switched to ${next.toUpperCase()} mode`).catch(() => {});
    return renderProductStockDetail(ctx, productId, `✅ Mode switched to <b>${next.toUpperCase()}</b>.`);
  });

  // ── Set manual stock count ────────────────────────────────────────────────
  bot.action(/^shop_stock_setmanualstock_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(`SELECT name, manual_stock FROM shop_products WHERE id = $1`, [productId]);
    if (!r.rows[0]) return ctx.reply("Product not found.", { parse_mode: "HTML" });
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "stock_set_manual_stock", manualStockProductId: productId };
    return ctx.reply(
      `\n📊 <b>SET MANUAL STOCK</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Product: <b>${r.rows[0].name}</b>\n` +
      `Current manual stock: <b>${r.rows[0].manual_stock ?? 0}</b>\n\n` +
      `› Type the new stock count (e.g. <code>50</code>):\n` +
      `<i>This is the number customers see and buy against.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Manual Orders panel ───────────────────────────────────────────────────
  bot.action("shop_admin_manual_orders", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return renderManualOrdersPanel(ctx, "edit");
  });

  // ── Fulfill a manual order ────────────────────────────────────────────────
  bot.action(/^shop_fulfill_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const orderId = (ctx.match as RegExpExecArray)[1];
    const r = await dbQuery(
      `SELECT o.id, o.telegram_id, o.product_name, o.amount, o.delivery_status,
              c.username, c.first_name
       FROM shop_orders o
       LEFT JOIN shop_customers c ON c.telegram_id = o.telegram_id
       WHERE o.id = $1`,
      [orderId]
    );
    const o = r.rows[0];
    if (!o) return ctx.reply("Order not found.", { parse_mode: "HTML" });
    if (o.delivery_status !== "pending_delivery") {
      return ctx.reply(
        `⚠️ This order is already <b>${o.delivery_status}</b>. No action needed.`,
        { parse_mode: "HTML" }
      );
    }
    const custName = o.username ? `@${o.username}` : (o.first_name ?? `ID:${o.telegram_id}`);
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = {
      step: "manual_fulfill",
      fulfillOrderId: orderId,
      fulfillCustomerId: parseInt(o.telegram_id),
    };
    return ctx.reply(
      `📦  <b>FULFILL ORDER</b>\n\n` +
      `<code>Product   ${escapeHtml(o.product_name)}\n` +
      `Amount    $${parseFloat(o.amount).toFixed(2)}\n` +
      `Customer  ${escapeHtml(custName)} (${o.telegram_id})\n` +
      `Order ID  ${orderId}</code>\n\n` +
      `Choose the delivery type:`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔐  Login Credentials", `shop_fulfill_type_creds_${orderId}`)],
          [Markup.button.callback("🔗  Redeem Link",       `shop_fulfill_type_link_${orderId}`)],
        ]),
      }
    );
  });

  // ── Fulfill type: Login Credentials ──────────────────────────────────────
  bot.action(/^shop_fulfill_type_creds_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const orderId = (ctx.match as RegExpExecArray)[1];
    const uid = ctx.from.id;
    const st  = getState(uid);
    if (!st.shopAdminFlow?.fulfillOrderId) return ctx.reply("⚠️ Session expired. Please click Fulfill again.");
    st.shopAdminFlow = { ...st.shopAdminFlow, step: "fulfill_email", fulfillOrderId: orderId };
    return ctx.reply(
      `🔐  <b>Login Credentials</b>\n\n` +
      `Step 1 of 2 — Send the <b>email address</b>:`,
      { parse_mode: "HTML" }
    );
  });

  // ── Fulfill type: Redeem Link ─────────────────────────────────────────────
  bot.action(/^shop_fulfill_type_link_([0-9a-f-]{36})$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const orderId = (ctx.match as RegExpExecArray)[1];
    const uid = ctx.from.id;
    const st  = getState(uid);
    if (!st.shopAdminFlow?.fulfillOrderId) return ctx.reply("⚠️ Session expired. Please click Fulfill again.");
    st.shopAdminFlow = { ...st.shopAdminFlow, step: "fulfill_link", fulfillOrderId: orderId };
    return ctx.reply(
      `🔗  <b>Redeem Link</b>\n\n` +
      `Send the <b>redeem link</b> for this order:`,
      { parse_mode: "HTML" }
    );
  });

  // ── Quick topup from search results ──────────────────────────────────────
  bot.action(/^topup_found_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid     = ctx.from.id;
    const custUid = parseInt((ctx.match as RegExpExecArray)[1]);
    const r = await dbQuery(`SELECT username, first_name, balance FROM shop_customers WHERE telegram_id = $1`, [custUid]);
    if (!r.rows[0]) return ctx.reply("Customer not found.");
    const c    = r.rows[0];
    const name = c.username ? `@${c.username}` : (c.first_name ?? `${custUid}`);
    getState(uid).shopAdminFlow = { step: "topup_amount", topupUid: custUid };
    await ctx.reply(
      `\n💰 <b>FUND CUSTOMER ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<code>Customer:  ${name}\nBalance:   $${parseFloat(c.balance).toFixed(2)}</code>\n\n` +
      `› Enter the <b>amount to add</b> in USD:\n<code>  e.g. 5.00</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Activation order approval from admin ─────────────────────────────────
  bot.action(/^approve_act_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid     = ctx.from.id;
    const orderId = (ctx.match as RegExpExecArray)[1];
    const pending = pendingActivations.get(orderId);

    if (!pending) {
      return ctx.reply(
        `\n🔷 <b>ACTIVATION ORDER</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚠️ Order <code>${orderId}</code> not found.\n` +
        `It may have already been processed or expired.`,
        { parse_mode: "HTML" }
      );
    }

    const emoji = ACTIVATION_EMOJI[pending.service];
    const name  = ACTIVATION_LABEL[pending.service];

    getState(uid).shopAdminFlow = { step: "activation_time", activationOrderId: orderId };

    await ctx.reply(
      `\n🔷 <b>APPROVE ACTIVATION</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${emoji} <b>${name}</b>\n` +
      `📧 <code>${pending.email}</code>\n` +
      `👤 User ID: <code>${pending.userId}</code>\n\n` +
      `› How many <b>minutes</b> will this take?\n` +
      `<i>e.g. type  2  for 2 minutes</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Entities → HTML helper ────────────────────────────────────────────────
  // Converts a Telegram message (text + entities) to an HTML string that
  // Telegram will render correctly with parse_mode:"HTML".
  // Supports: bold, italic, underline, strikethrough, code, pre,
  //           text_link, custom_emoji (animated stickers).
  function tgEntitiesToHtml(rawText: string, entities?: any[]): string {
    function escapeHtml(s: string) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    if (!entities || entities.length === 0) return escapeHtml(rawText);

    type Evt = { pos: number; isOpen: boolean; tag: string };
    const events: Evt[] = [];
    for (const e of entities) {
      const s = e.offset, en = e.offset + e.length;
      if      (e.type === "bold")          { events.push({pos:s,isOpen:true,tag:"<b>"});         events.push({pos:en,isOpen:false,tag:"</b>"}); }
      else if (e.type === "italic")        { events.push({pos:s,isOpen:true,tag:"<i>"});         events.push({pos:en,isOpen:false,tag:"</i>"}); }
      else if (e.type === "underline")     { events.push({pos:s,isOpen:true,tag:"<u>"});         events.push({pos:en,isOpen:false,tag:"</u>"}); }
      else if (e.type === "strikethrough") { events.push({pos:s,isOpen:true,tag:"<s>"});         events.push({pos:en,isOpen:false,tag:"</s>"}); }
      else if (e.type === "code")          { events.push({pos:s,isOpen:true,tag:"<code>"});      events.push({pos:en,isOpen:false,tag:"</code>"}); }
      else if (e.type === "pre")           { events.push({pos:s,isOpen:true,tag:"<pre>"});       events.push({pos:en,isOpen:false,tag:"</pre>"}); }
      else if (e.type === "text_link")     { events.push({pos:s,isOpen:true,tag:`<a href="${e.url}">`}); events.push({pos:en,isOpen:false,tag:"</a>"}); }
      else if (e.type === "custom_emoji")  { events.push({pos:s,isOpen:true,tag:`<tg-emoji emoji-id="${e.custom_emoji_id}">`}); events.push({pos:en,isOpen:false,tag:"</tg-emoji>"}); }
    }
    events.sort((a, b) => a.pos !== b.pos ? a.pos - b.pos : (a.isOpen ? -1 : 1));

    let html = "", pos = 0;
    for (const evt of events) {
      if (evt.pos > pos) { html += escapeHtml(rawText.substring(pos, evt.pos)); pos = evt.pos; }
      html += evt.tag;
    }
    if (pos < rawText.length) html += escapeHtml(rawText.substring(pos));
    return html;
  }

  // ── Menu Management actions ───────────────────────────────────────────────
  bot.action("shop_admin_menu_mgmt", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const config   = getBotMenuConfig();
    const defaults = getBotMenuDefaults();
    const keys = Object.keys(defaults) as string[];
    const rows = keys.map(k => [
      Markup.button.callback(
        `${config[k] ?? defaults[k]}`,
        `shop_menu_edit:${k}`
      ),
    ]);
    rows.push([Markup.button.callback("↩  Back to Shop", "shop_admin_back")]);
    await safeEdit(ctx,
      `🎛 <b>MENU MANAGEMENT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Tap any button below to rename it.\n` +
      `You can change both the emoji and the text.\n\n` +
      `<i>Changes take effect immediately for new keyboard sends.</i>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) }
    );
  });

  bot.action(/^shop_menu_edit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid  = ctx.from!.id;
    const key  = (ctx.match as RegExpMatchArray)[1];
    const st   = getState(uid);
    const config   = getBotMenuConfig();
    const defaults = getBotMenuDefaults();
    const current  = config[key] ?? defaults[key] ?? key;
    st.shopAdminFlow = { step: "menu_btn_label", menuEditKey: key };
    await ctx.reply(
      `🎛 <b>Editing button:</b> <code>${key}</code>\n\n` +
      `Current label:\n<code>${current}</code>\n\n` +
      `Send the new label now.\n` +
      `<i>You can include any emoji at the start, e.g.:\n💳  ADD FUNDS</i>`,
      { parse_mode: "HTML" }
    );
  });

  bot.action("shop_admin_back", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showShopAdminMenu(ctx, true);
  });

  // ── Text message handler ──────────────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const uid = ctx.from.id;
    const text = ctx.message.text.trim();
    const st = getState(uid);

    // ── Shop admin multi-step text flows ─────────────────────────────────
    if (st.shopAdminFlow?.step) {
      const flow = st.shopAdminFlow;

      // Activation time approval
      if (flow.step === "activation_time") {
        const mins = parseInt(text, 10);
        if (isNaN(mins) || mins < 1 || mins > 120) {
          return ctx.reply(`🔴  Enter a valid number of minutes (1–120):`, { parse_mode: "HTML" });
        }
        const orderId = flow.activationOrderId ?? "";
        const pending = pendingActivations.get(orderId);
        st.shopAdminFlow = undefined;

        if (!pending) {
          return ctx.reply(`⚠️ Order not found or already handled.`, { parse_mode: "HTML" });
        }

        const shopBotToken = process.env.TELEGRAM_BOT_TOKEN_2;
        if (!shopBotToken) {
          return ctx.reply(`⚠️ Shop bot token not configured.`, { parse_mode: "HTML" });
        }

        const emoji = ACTIVATION_EMOJI[pending.service];
        const name  = ACTIVATION_LABEL[pending.service];

        await ctx.reply(
          `✅ <b>Approved!</b> Starting ${mins}-minute countdown for ${name} activation of <code>${pending.email}</code>.`,
          { parse_mode: "HTML" }
        );

        startActivationCountdown(shopBotToken, pending, mins).catch((e) =>
          console.error("[TelegramBot] Countdown error:", e.message)
        );
        return;
      }

      // ── Menu Management: save new button label ───────────────────────────
      if (flow.step === "menu_btn_label" && flow.menuEditKey) {
        const key = flow.menuEditKey;
        st.shopAdminFlow = undefined;
        const label = text.trim();
        if (!label) return ctx.reply("🔴 Label cannot be empty.");
        // Load current config, update key, save
        const defaults = getBotMenuDefaults();
        const current  = getBotMenuConfig();
        const merged: Record<string, string> = { ...defaults, ...current, [key]: label };
        await dbQuery(
          `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
          ["shop_bot_menu_config", JSON.stringify(merged)]
        );
        await reloadBotMenu();
        return ctx.reply(
          `✅ <b>Button updated!</b>\n\n` +
          `🔑 Key: <code>${key}</code>\n` +
          `🏷 New label: <code>${label}</code>\n\n` +
          `<i>Users will see the new label next time the keyboard is sent to them.</i>`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "name") {
        flow.name = text;
        flow.step = "description";
        return ctx.reply(
          `\n🔷 <b>➕ ADD PRODUCT — 2/5</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `› Enter a short <b>description</b>\n<code>  or send - to skip</code>`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "description") {
        flow.description = text === "-" ? "" : tgEntitiesToHtml(ctx.message.text, (ctx.message as any).entities);
        flow.step = "price";
        return ctx.reply(
          `\n🔷 <b>➕ ADD PRODUCT — 3/5</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `› Enter the <b>price</b> in USD:\n<code>  e.g. 1.00</code>`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "price") {
        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) {
          return ctx.reply(`🔴  Invalid price. Enter a positive number like <code>1.00</code>:`, { parse_mode: "HTML" });
        }
        flow.price = price.toFixed(2);
        flow.step = "account_type";
        return ctx.reply(
          `\n🔷 <b>➕ ADD PRODUCT — 4/5</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `› Enter the <b>account type</b>:\n` +
          `<i>Known types (linked to credential tables):</i>\n<code>  ${SHOP_ACCOUNT_TYPES.join(" | ")}</code>\n\n` +
          `<i>Or type any custom name (e.g. <code>perplexity</code>, <code>cursor</code>) — stock will come from redeem links.</i>`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "account_type") {
        const at = text.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
        if (!at) {
          return ctx.reply(
            `🔴  Account type cannot be empty. Enter a type name (known: <code>${SHOP_ACCOUNT_TYPES.join(" | ")}</code>) or any custom name:`,
            { parse_mode: "HTML" }
          );
        }
        flow.accountType = at;
        flow.step = "status_filter";
        return ctx.reply(
          `\n🔷 <b>➕ ADD PRODUCT — 5/5</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `› Enter the <b>status filter</b>:\n` +
          `<code>  accounts with this status will be sold\n` +
          `  e.g. available | working | created</code>`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "status_filter") {
        flow.statusFilter = text.toLowerCase().trim();
        try {
          await dbQuery(
            `INSERT INTO shop_products (name, description, price, account_type, status_filter)
             VALUES ($1, $2, $3, $4, $5)`,
            [flow.name, flow.description || null, flow.price, flow.accountType, flow.statusFilter]
          );
          st.shopAdminFlow = undefined;
          return ctx.reply(
            `🟢  <b>PRODUCT ADDED</b>\n\n` +
            `<code>◈ Name    →  ${flow.name}\n` +
            `◈ Price   →  $${flow.price}\n` +
            `◈ Type    →  ${flow.accountType}\n` +
            `◈ Filter  →  ${flow.statusFilter}</code>`,
            { parse_mode: "HTML" }
          );
        } catch (err: any) {
          st.shopAdminFlow = undefined;
          return ctx.reply(`🔴  Failed to save product: <code>${err.message}</code>`, { parse_mode: "HTML" });
        }
      }

      // ── Edit product field flows ────────────────────────────────────────────
      const isEditStep = (flow.step ?? "").startsWith("edit_") && !!flow.editProductId;
      if (isEditStep) {
        const pid = flow.editProductId!;

        if (flow.step === "edit_name") {
          const val = text.trim();
          if (!val) return ctx.reply(`🔴 Name cannot be empty. Send the new name:`, { parse_mode: "HTML" });
          await dbQuery(`UPDATE shop_products SET name = $1 WHERE id = $2`, [val, pid]);
        }

        else if (flow.step === "edit_description") {
          const raw = ctx.message.text.trim();
          const val = raw === "-" ? null : tgEntitiesToHtml(ctx.message.text, (ctx.message as any).entities);
          await dbQuery(`UPDATE shop_products SET description = $1 WHERE id = $2`, [val, pid]);
        }

        else if (flow.step === "edit_price") {
          const price = parseFloat(text.trim());
          if (isNaN(price) || price <= 0) {
            return ctx.reply(`🔴 Invalid price. Send a positive number like <code>1.50</code>:`, { parse_mode: "HTML" });
          }
          await dbQuery(`UPDATE shop_products SET price = $1 WHERE id = $2`, [price.toFixed(2), pid]);
        }

        else if (flow.step === "edit_account_type") {
          const at = text.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "_");
          if (!at) {
            return ctx.reply(
              `🔴 Account type cannot be empty. Send a known type or any custom name:\n<code>  ${SHOP_ACCOUNT_TYPES.join(" | ")}</code>`,
              { parse_mode: "HTML" }
            );
          }
          await dbQuery(`UPDATE shop_products SET account_type = $1 WHERE id = $2`, [at, pid]);
        }

        else if (flow.step === "edit_status_filter") {
          const sf = text.toLowerCase().trim();
          await dbQuery(`UPDATE shop_products SET status_filter = $1 WHERE id = $2`, [sf, pid]);
        }

        else if (flow.step === "edit_sort_order") {
          const n = parseInt(text.trim(), 10);
          if (isNaN(n)) {
            return ctx.reply(`🔴 Must be a whole number. Send a number like <code>0</code>, <code>1</code>, <code>2</code>…`, { parse_mode: "HTML" });
          }
          await dbQuery(`UPDATE shop_products SET sort_order = $1 WHERE id = $2`, [n, pid]);
        }

        else if (flow.step === "edit_sticky_label") {
          const val = text.trim() === "-" ? null : text.trim();
          await dbQuery(`UPDATE shop_products SET sticky_label = $1 WHERE id = $2`, [val, pid]);
        }

        else if (flow.step === "edit_custom_emoji") {
          if (text.trim() === "-") {
            await dbQuery(`UPDATE shop_products SET custom_emoji = NULL WHERE id = $1`, [pid]);
          } else {
            // Check for Telegram animated custom emoji entity in the message
            const entities: any[] = (ctx.message as any)?.entities ?? [];
            const tgEnt = entities.find((e: any) => e.type === "custom_emoji");
            let val: string;
            if (tgEnt) {
              // Extract the fallback Unicode character(s) at the entity's position
              const fallback = text.slice(tgEnt.offset, tgEnt.offset + tgEnt.length);
              val = `tg:${tgEnt.custom_emoji_id}:${fallback}`;
            } else {
              val = text.trim();
            }
            await dbQuery(`UPDATE shop_products SET custom_emoji = $1 WHERE id = $2`, [val, pid]);
          }
        }

        st.shopAdminFlow = undefined;
        const upd = await dbQuery(`SELECT * FROM shop_products WHERE id = $1`, [pid]);
        const up = upd.rows[0];
        if (!up) return ctx.reply("✅ Updated. (Product no longer found — may have been deleted.)", { parse_mode: "HTML" });
        return ctx.reply(`✅ <b>Saved!</b>\n\n` + editProductText(up), {
          parse_mode: "HTML",
          ...editProductKeyboard(pid, up.active, up.sticky),
        });
      }
      // ── End edit product field flows ────────────────────────────────────────

      if (flow.step === "topup_uid") {
        const telegramId = parseInt(text.trim());
        if (isNaN(telegramId)) {
          return ctx.reply(`🔴  Invalid Telegram ID. Please enter a numeric ID:`, { parse_mode: "HTML" });
        }
        const custRes = await dbQuery(
          `SELECT telegram_id, username, first_name, balance FROM shop_customers WHERE telegram_id = $1`,
          [telegramId]
        );
        if (!custRes.rows[0]) {
          st.shopAdminFlow = undefined;
          return ctx.reply(`🔴  Customer <code>${telegramId}</code> not found in database.`, { parse_mode: "HTML" });
        }
        const c    = custRes.rows[0];
        const name = c.username ? `@${c.username}` : (c.first_name ?? `ID:${c.telegram_id}`);
        flow.topupUid = telegramId;
        flow.step = "topup_amount";
        return ctx.reply(
          `\n💰 <b>FUND CUSTOMER ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<code>Customer:  ${name}\n` +
          `Balance:   $${parseFloat(c.balance).toFixed(2)}</code>\n\n` +
          `› Enter the <b>amount to add</b> in USD:\n<code>  e.g. 5.00</code>`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "topup_amount") {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply(`🔴  Invalid amount. Enter a positive number like <code>5.00</code>:`, { parse_mode: "HTML" });
        }
        try {
          await dbQuery(
            `UPDATE shop_customers SET balance = balance + $1 WHERE telegram_id = $2`,
            [amount.toFixed(2), flow.topupUid]
          );
          const after   = await dbQuery(
            `SELECT balance, username, first_name FROM shop_customers WHERE telegram_id = $1`,
            [flow.topupUid]
          );
          const afterRow = after.rows[0];
          const name     = afterRow?.username ? `@${afterRow.username}` : (afterRow?.first_name ?? `ID:${flow.topupUid}`);
          st.shopAdminFlow = undefined;
          return ctx.reply(
            `\n🟢 <b>ACCOUNT FUNDED</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `<code>Customer:      ${name}\n` +
            `Amount added:  +$${amount.toFixed(2)}\n` +
            `New balance:   $${parseFloat(afterRow?.balance ?? "0").toFixed(2)}</code>`,
            { parse_mode: "HTML" }
          );
        } catch (err: any) {
          st.shopAdminFlow = undefined;
          return ctx.reply(`🔴  Top-up failed: <code>${err.message}</code>`, { parse_mode: "HTML" });
        }
      }

      if (flow.step === "refer_amount") {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount < 0) {
          return ctx.reply(`🔴  Invalid amount. Enter a number like <code>0.50</code>:`, { parse_mode: "HTML" });
        }
        await dbQuery(
          `INSERT INTO shop_settings (key, value) VALUES ('referral_reward', $1)
           ON CONFLICT (key) DO UPDATE SET value = $1`,
          [amount.toFixed(2)]
        );
        st.shopAdminFlow = undefined;
        return ctx.reply(
          `\n🟢 <b>REFER REWARD UPDATED</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<code>New reward per referral:  $${amount.toFixed(2)}</code>\n\n` +
          `<i>All new referrals will now earn $${amount.toFixed(2)} per invite.</i>`,
          { parse_mode: "HTML" }
        );
      }

      // ── Broadcast ───────────────────────────────────────────────────────────
      if (flow.step === "broadcast_text") {
        st.shopAdminFlow = undefined;
        const shopToken = process.env.TELEGRAM_BOT_TOKEN_2;
        if (!shopToken) return ctx.reply("❌ Shop bot token not configured.");
        const custs = await dbQuery(`SELECT telegram_id FROM shop_customers`);
        const total = custs.rows.length;
        await ctx.reply(`📢 Sending broadcast to <b>${total}</b> customers…`, { parse_mode: "HTML" });
        // Use sendMessage with entities array to preserve all formatting
        // (animated emoji, bold, links, etc.) without cross-bot access issues
        const rawText     = ctx.message.text;
        const rawEntities = (ctx.message as any).entities ?? [];
        let sent = 0, failed = 0;
        for (const row of custs.rows) {
          try {
            const res = await fetch(`https://api.telegram.org/bot${shopToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id:  row.telegram_id,
                text:     rawText,
                entities: rawEntities,
              }),
            });
            const json = await res.json() as any;
            if (json.ok) sent++; else failed++;
            await new Promise(r => setTimeout(r, 35)); // ~28 msg/s max
          } catch { failed++; }
        }
        return ctx.reply(`✅ Broadcast done.\n<code>Sent: ${sent}  Failed: ${failed}</code>`, { parse_mode: "HTML" });
      }

      // ── Customer search ─────────────────────────────────────────────────────
      if (flow.step === "search_uid") {
        st.shopAdminFlow = undefined;
        const q = text.trim().replace(/^@/, "");
        const isNum = /^\d+$/.test(q);
        const res = isNum
          ? await dbQuery(`SELECT * FROM shop_customers WHERE telegram_id = $1`, [parseInt(q)])
          : await dbQuery(`SELECT * FROM shop_customers WHERE LOWER(username) = LOWER($1) OR first_name ILIKE $2 LIMIT 5`, [q, `%${q}%`]);
        if (res.rows.length === 0) {
          return ctx.reply(`🔴 No customer found for <code>${text.trim()}</code>`, { parse_mode: "HTML" });
        }
        for (const c of res.rows) {
          const name   = c.username ? `@${c.username}` : (c.first_name ?? "—");
          const vip    = c.vip ? " 👑 VIP" : "";
          const orders = await dbQuery(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as t FROM shop_orders WHERE telegram_id = $1`, [c.telegram_id]);
          const oRow   = orders.rows[0];
          await ctx.reply(
            `\n👤 <b>CUSTOMER</b>${vip}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>` +
            `Name:       ${name}\n` +
            `ID:         ${c.telegram_id}\n` +
            `Balance:    $${parseFloat(c.balance ?? "0").toFixed(2)}\n` +
            `Spend:      $${parseFloat(c.total_spend ?? "0").toFixed(2)}\n` +
            `Orders:     ${oRow?.cnt ?? 0}\n` +
            `Revenue:    $${parseFloat(oRow?.t ?? "0").toFixed(2)}\n` +
            `Joined:     ${new Date(c.created_at).toLocaleDateString("en-GB")}\n` +
            `</code>`,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([[Markup.button.callback(`💰 Fund Account`, `topup_found_${c.telegram_id}`)]]),
            }
          );
        }
        return;
      }

      // ── Promo code creation ─────────────────────────────────────────────────
      if (flow.step === "promo_code") {
        const code = text.trim().toUpperCase().replace(/\s+/g, "_").slice(0, 20);
        if (!code) return ctx.reply(`🔴 Invalid code. Try again:`);
        flow.promoCode = code;
        flow.step = "promo_discount";
        return ctx.reply(
          `\n🏷️ <b>CREATE PROMO — 2/3</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Code: <code>${code}</code>\n\n` +
          `› Enter the <b>discount</b>:\n<code>  e.g. 20%  ·  1.00  ·  20%+1.00</code>\n` +
          `<i>Use % for percentage, plain number for fixed $, or both.</i>`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "promo_discount") {
        const raw = text.trim();
        const pctMatch   = raw.match(/(\d+(?:\.\d+)?)%/);
        const fixedMatch = raw.match(/\$?(\d+(?:\.\d+)?)(?!%)/);
        const pct   = pctMatch   ? parseFloat(pctMatch[1])   : 0;
        const fixed = fixedMatch ? parseFloat(fixedMatch[1]) : 0;
        if (pct === 0 && fixed === 0) return ctx.reply(`🔴 Could not parse discount. Try <code>20%</code> or <code>1.50</code>:`, { parse_mode: "HTML" });
        flow.promoDiscount = JSON.stringify({ pct, fixed });
        flow.step = "promo_maxuses";
        return ctx.reply(
          `\n🏷️ <b>CREATE PROMO — 3/3</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `Discount: <code>${pct > 0 ? pct + "%" : ""}${pct > 0 && fixed > 0 ? " + " : ""}${fixed > 0 ? "$" + fixed.toFixed(2) : ""}</code>\n\n` +
          `› Enter <b>max uses</b> (0 = unlimited):`,
          { parse_mode: "HTML" }
        );
      }

      if (flow.step === "promo_maxuses") {
        const maxUses = parseInt(text.trim());
        if (isNaN(maxUses) || maxUses < 0) return ctx.reply(`🔴 Enter a number (0 for unlimited):`);
        const disc = JSON.parse(flow.promoDiscount ?? "{}");
        const code = flow.promoCode!;
        await dbQuery(
          `INSERT INTO shop_promo_codes (code, discount_pct, discount_fixed, max_uses, active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (code) DO UPDATE SET discount_pct=$2, discount_fixed=$3, max_uses=$4, active=true`,
          [code, disc.pct ?? 0, disc.fixed ?? 0, maxUses]
        );
        st.shopAdminFlow = undefined;
        return ctx.reply(
          `\n🟢 <b>PROMO CODE CREATED</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<code>` +
          `Code:      ${code}\n` +
          `Discount:  ${disc.pct > 0 ? disc.pct + "%" : ""}${disc.pct > 0 && disc.fixed > 0 ? " + " : ""}${disc.fixed > 0 ? "$" + disc.fixed.toFixed(2) : ""}\n` +
          `Max uses:  ${maxUses === 0 ? "Unlimited" : maxUses}\n` +
          `</code>`,
          { parse_mode: "HTML" }
        );
      }

      // ── Stock: Add credentials (bulk paste) ─────────────────────────────────
      if (flow.step === "stock_add_creds") {
        const table   = flow.stockTableName!;
        const sf      = flow.stockStatusFilter ?? "available";
        const prodId  = flow.stockProductId!;
        st.shopAdminFlow = undefined;

        // Parse lines — accept "email:password" or "email password"
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const parsed: { email: string; password: string }[] = [];
        const skipped: string[] = [];

        for (const line of lines) {
          const sep = line.includes(":") ? ":" : " ";
          const parts = line.split(sep);
          if (parts.length < 2) { skipped.push(line.slice(0, 30)); continue; }
          const email    = parts[0].trim().toLowerCase();
          const password = parts.slice(1).join(sep).trim();
          if (!email.includes("@") || !password) { skipped.push(line.slice(0, 30)); continue; }
          parsed.push({ email, password });
        }

        if (parsed.length === 0) {
          return ctx.reply(
            `🔴 No valid credentials found.\n\nFormat required:\n<code>email:password\nemail:password</code>`,
            { parse_mode: "HTML" }
          );
        }

        let added = 0, dupes = 0;
        for (const cred of parsed) {
          try {
            const res2 = await dbQuery(
              `INSERT INTO ${table} (email, password, status)
               VALUES ($1, $2, $3)
               ON CONFLICT (email) DO NOTHING`,
              [cred.email, cred.password, sf]
            );
            if ((res2.rowCount ?? 0) > 0) added++;
            else dupes++;
          } catch {
            dupes++;
          }
        }

        // Get new stock count
        const countRes = await dbQuery(
          `SELECT COUNT(*) as cnt FROM ${table} WHERE status = $1`,
          [sf]
        );
        const newStock = parseInt(countRes.rows[0]?.cnt ?? "0");

        // ── Broadcast new stock to all customers (fire-and-forget) ──────────────
        if (added > 0) {
          const shopToken2 = process.env.TELEGRAM_BOT_TOKEN_2;
          const pRes = await dbQuery(`SELECT name, price FROM shop_products WHERE id = $1`, [prodId]);
          const prod = pRes.rows[0];
          if (shopToken2 && prod) {
            const custs = await dbQuery(`SELECT telegram_id FROM shop_customers`);
            const broadMsg =
              `📢 <b>${added} new stock added for ${esc(prod.name)}!</b>\n\n` +
              `🌀 Available: <b>${newStock} items</b>\n` +
              `💰 Price: <b>${parseFloat(prod.price).toFixed(2)} USDT</b>`;
            const broadKb = JSON.stringify({ inline_keyboard: [[{ text: `${prod.name} (${added})`, callback_data: `shop_product_${prodId}` }]] });
            (async () => {
              for (const c of custs.rows) {
                try {
                  await fetch(`https://api.telegram.org/bot${shopToken2}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: c.telegram_id, text: broadMsg, parse_mode: "HTML", reply_markup: broadKb }),
                  });
                } catch {}
                await new Promise(r => setTimeout(r, 35));
              }
            })().catch(() => {});
          }
        }

        return ctx.reply(
          `\n✅ <b>CREDENTIALS ADDED</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<code>` +
          `Parsed          :  ${lines.length}\n` +
          `Added           :  ${added}\n` +
          `Skipped/invalid :  ${skipped.length + dupes}\n` +
          `New stock count :  ${newStock}\n` +
          `</code>` +
          (skipped.length ? `\n⚠️ Skipped:\n<code>${skipped.join("\n")}</code>` : ""),
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📊  View Stock", `shop_stock_${prodId}`)]]),
          }
        );
      }

      // ── Stock: Add redeem links (bulk paste) ─────────────────────────────────
      if (flow.step === "stock_add_links") {
        const prodId = flow.stockProductId!;
        st.shopAdminFlow = undefined;

        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) {
          return ctx.reply(`🔴 No links found. Paste one link per line.`, { parse_mode: "HTML" });
        }

        let added = 0, dupes = 0, invalid = 0;
        for (const line of lines) {
          if (!line.startsWith("http")) { invalid++; continue; }
          try {
            const res2 = await dbQuery(
              `INSERT INTO shop_redeem_links (product_id, link) VALUES ($1, $2) ON CONFLICT (link) DO NOTHING`,
              [prodId, line]
            );
            if ((res2.rowCount ?? 0) > 0) added++;
            else dupes++;
          } catch { dupes++; }
        }

        const countRes = await dbQuery(
          `SELECT COUNT(*) as cnt FROM shop_redeem_links WHERE product_id = $1 AND status = 'available'`,
          [prodId]
        );
        const newStock = parseInt(countRes.rows[0]?.cnt ?? "0");

        // ── Broadcast new stock to all customers (fire-and-forget) ──────────────
        if (added > 0) {
          const shopToken2 = process.env.TELEGRAM_BOT_TOKEN_2;
          const pRes = await dbQuery(`SELECT name, price FROM shop_products WHERE id = $1`, [prodId]);
          const prod = pRes.rows[0];
          if (shopToken2 && prod) {
            const custs = await dbQuery(`SELECT telegram_id FROM shop_customers`);
            const broadMsg =
              `📢 <b>${added} new stock added for ${esc(prod.name)}!</b>\n\n` +
              `🌀 Available: <b>${newStock} items</b>\n` +
              `💰 Price: <b>${parseFloat(prod.price).toFixed(2)} USDT</b>`;
            const broadKb = JSON.stringify({ inline_keyboard: [[{ text: `${prod.name} (${added})`, callback_data: `shop_product_${prodId}` }]] });
            (async () => {
              for (const c of custs.rows) {
                try {
                  await fetch(`https://api.telegram.org/bot${shopToken2}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: c.telegram_id, text: broadMsg, parse_mode: "HTML", reply_markup: broadKb }),
                  });
                } catch {}
                await new Promise(r => setTimeout(r, 35));
              }
            })().catch(() => {});
          }
        }

        return ctx.reply(
          `\n✅ <b>REDEEM LINKS ADDED</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `<code>` +
          `Parsed          :  ${lines.length}\n` +
          `Added           :  ${added}\n` +
          `Skipped/dupes   :  ${dupes + invalid}\n` +
          `Links available :  ${newStock}\n` +
          `</code>`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📊  View Stock", `shop_stock_${prodId}`)]]),
          }
        );
      }

      // ── Stock: Set override count ────────────────────────────────────────────
      if (flow.step === "stock_set_override") {
        const productId = flow.stockOverrideProductId!;
        st.shopAdminFlow = undefined;
        const n = parseInt(text.trim(), 10);
        if (isNaN(n) || n < 0) {
          return ctx.reply(
            `🔴 Invalid number. Enter a whole number like <code>100</code> or <code>0</code>:`,
            { parse_mode: "HTML" }
          );
        }
        await dbQuery(`UPDATE shop_products SET stock_override = $1 WHERE id = $2`, [n, productId]);
        return ctx.reply(
          `✅ Stock count set to <b>${n}</b>. Customers will now see this number.\n\n` +
          `Tap below to go back to the stock page.`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📊  View Stock", `shop_stock_${productId}`)]]),
          }
        );
      }

      // ── Stock: Set manual stock count ────────────────────────────────────────
      if (flow.step === "stock_set_manual_stock") {
        const productId = flow.manualStockProductId!;
        const n = parseInt(text.trim(), 10);
        if (isNaN(n) || n < 0) {
          // Keep flow active so admin can type again without pressing the button again
          return ctx.reply(
            `🔴 Invalid number. Please enter a whole number like <code>50</code> or <code>0</code>:`,
            { parse_mode: "HTML" }
          );
        }
        st.shopAdminFlow = undefined;
        await dbQuery(`UPDATE shop_products SET manual_stock = $1 WHERE id = $2`, [n, productId]);
        return ctx.reply(
          `✅ Manual stock set to <b>${n}</b>.\n\nCustomers will be able to purchase up to this quantity.`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📊  View Stock", `shop_stock_${productId}`)]]),
          }
        );
      }

      // ── Shared deliver helper ────────────────────────────────────────────────
      async function deliverOrder(orderId: string, customerId: number, deliveryText: string, noteText: string): Promise<"ok" | string> {
        const shopToken2 = process.env.TELEGRAM_BOT_TOKEN_2;
        if (!shopToken2) return "Shop bot token not configured.";
        const claimRes = await dbQuery(
          `UPDATE shop_orders SET delivery_status = 'fulfilling'
           WHERE id = $1 AND delivery_status = 'pending_delivery' RETURNING id`,
          [orderId]
        );
        if (!claimRes.rows[0]) {
          const s = await dbQuery(`SELECT delivery_status FROM shop_orders WHERE id = $1`, [orderId]);
          return `Order status is already <b>${s.rows[0]?.delivery_status ?? "not found"}</b>.`;
        }
        let tgOk = false; let tgErr = "";
        try {
          const r = await fetch(`https://api.telegram.org/bot${shopToken2}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: customerId, text: deliveryText }),
          });
          const j = await r.json() as { ok: boolean; description?: string };
          tgOk = j.ok === true; tgErr = j.description ?? "Unknown Telegram error";
        } catch (e) { tgErr = (e as Error).message; }
        if (!tgOk) {
          await dbQuery(`UPDATE shop_orders SET delivery_status = 'pending_delivery' WHERE id = $1`, [orderId]);
          return `Telegram error: ${tgErr}`;
        }
        await dbQuery(
          `UPDATE shop_orders SET delivery_status = 'delivered', fulfillment_note = $1 WHERE id = $2`,
          [noteText, orderId]
        );
        return "ok";
      }

      // ── fulfill_email: received email, ask for password ───────────────────────
      if (flow.step === "fulfill_email") {
        if (!text || !text.includes("@")) {
          return ctx.reply(`⚠️ That doesn't look like a valid email. Send the <b>email address</b> again:`, { parse_mode: "HTML" });
        }
        st.shopAdminFlow = { ...flow, step: "fulfill_password", fulfillEmail: text.trim() };
        return ctx.reply(
          `✅ Email saved: <code>${escapeHtml(text.trim())}</code>\n\n` +
          `Step 2 of 2 — Send the <b>password</b>:`,
          { parse_mode: "HTML" }
        );
      }

      // ── fulfill_password: received password, send credentials to buyer ────────
      if (flow.step === "fulfill_password") {
        const orderId    = flow.fulfillOrderId!;
        const customerId = flow.fulfillCustomerId!;
        const email      = flow.fulfillEmail!;
        const password   = text.trim();
        st.shopAdminFlow = undefined;
        const deliveryText =
          `✅ ORDER DELIVERED!\n\nHere are your login credentials:\n\nEmail: ${email}\nPassword: ${password}\n\nThank you for your purchase!`;
        const result = await deliverOrder(orderId, customerId, deliveryText, `Email: ${email}\nPassword: ${password}`);
        if (result !== "ok") {
          return ctx.reply(`⚠️ <b>Delivery failed</b>\n\n${result}\n\nPlease try fulfilling the order again.`, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📬  Back to Manual Orders", "shop_admin_manual_orders")]]),
          });
        }
        return ctx.reply(
          `✅  <b>ORDER FULFILLED</b>\n\n` +
          `<code>Credentials sent to ${customerId}\nOrder ${orderId} → delivered</code>`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("📬  Back to Manual Orders", "shop_admin_manual_orders")]]) }
        );
      }

      // ── fulfill_link: received redeem link, send to buyer ────────────────────
      if (flow.step === "fulfill_link") {
        const orderId    = flow.fulfillOrderId!;
        const customerId = flow.fulfillCustomerId!;
        const link       = text.trim();
        st.shopAdminFlow = undefined;
        if (!link.startsWith("http")) {
          st.shopAdminFlow = flow;
          return ctx.reply(`⚠️ That doesn't look like a valid link. Send a URL starting with <code>http</code>:`, { parse_mode: "HTML" });
        }
        const deliveryText =
          `✅ ORDER DELIVERED!\n\nHere is your redeem link:\n\n${link}\n\nThank you for your purchase!`;
        const result = await deliverOrder(orderId, customerId, deliveryText, `Link: ${link}`);
        if (result !== "ok") {
          return ctx.reply(`⚠️ <b>Delivery failed</b>\n\n${result}\n\nPlease try fulfilling the order again.`, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📬  Back to Manual Orders", "shop_admin_manual_orders")]]),
          });
        }
        return ctx.reply(
          `✅  <b>ORDER FULFILLED</b>\n\n` +
          `<code>Redeem link sent to ${customerId}\nOrder ${orderId} → delivered</code>`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("📬  Back to Manual Orders", "shop_admin_manual_orders")]]) }
        );
      }

      // ── Manual order fulfillment (legacy free-text fallback) ──────────────────
      if (flow.step === "manual_fulfill") {
        const orderId    = flow.fulfillOrderId!;
        const customerId = flow.fulfillCustomerId!;
        if (!text || text.trim().length === 0) {
          return ctx.reply(`⚠️ Content cannot be empty. Send the delivery text:`, { parse_mode: "HTML" });
        }
        st.shopAdminFlow = undefined;
        const result = await deliverOrder(orderId, customerId,
          `✅ ORDER DELIVERED!\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${text}\n\nThank you for your purchase!`,
          text
        );
        if (result !== "ok") {
          return ctx.reply(`⚠️ <b>Delivery failed</b>\n\n${escapeHtml(result)}\n\nPlease try again.`, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("📬  Back to Manual Orders", "shop_admin_manual_orders")]]),
          });
        }
        return ctx.reply(
          `✅  <b>ORDER FULFILLED</b>\n\n` +
          `<code>Delivery sent to ${customerId}\nOrder ${orderId} → delivered</code>`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("📬  Back to Manual Orders", "shop_admin_manual_orders")]]) }
        );
      }

      // ── Deposit approval amount ─────────────────────────────────────────────
      if (flow.step === "dep_approve_amount") {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) return ctx.reply(`🔴 Enter a valid amount like <code>5.00</code>:`, { parse_mode: "HTML" });
        const reqId   = flow.depRequestId!;
        const custUid = flow.depUserId!;
        st.shopAdminFlow = undefined;
        try {
          await dbQuery(`UPDATE shop_deposit_requests SET status = 'approved', amount_requested = $1, resolved_at = NOW() WHERE id = $2`, [amount.toFixed(2), reqId]);
          await dbQuery(`UPDATE shop_customers SET balance = balance + $1 WHERE telegram_id = $2`, [amount.toFixed(2), custUid]);
          // Notify customer
          const shopToken = process.env.TELEGRAM_BOT_TOKEN_2;
          if (shopToken) {
            fetch(`https://api.telegram.org/bot${shopToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: custUid,
                text: `✅ <b>Deposit Approved!</b>\n\n<code>+$${amount.toFixed(2)}</code> has been added to your wallet.\n\n<i>Thank you for your payment!</i>`,
                parse_mode: "HTML",
              }),
            }).catch(() => {});
          }
          return ctx.reply(`✅ Deposit #${reqId} approved · <code>+$${amount.toFixed(2)}</code> credited to <code>${custUid}</code>`, { parse_mode: "HTML" });
        } catch (err: any) {
          return ctx.reply(`🔴 Failed: <code>${err.message}</code>`, { parse_mode: "HTML" });
        }
      }

      return;
    }

    if (!st.awaitingText) return;

    // ── Emoji edit flow ────────────────────────────────────────────────────
    if (st.awaitingText === "emoji_edit") {
      const key = st.emojiEditKey as EmojiKey | undefined;
      if (!key || !(key in EMOJI_SLOTS)) {
        st.awaitingText = undefined;
        return ctx.reply("❌ No emoji slot selected. Use /emoji to start again.");
      }

      // Try to extract custom emoji ID from message entities first
      const entities = (ctx.message as any).entities ?? [];
      const customEmojiEntity = entities.find((e: any) => e.type === "custom_emoji");
      let newId: string | undefined;

      if (customEmojiEntity?.custom_emoji_id) {
        newId = customEmojiEntity.custom_emoji_id;
      } else if (/^\d{15,25}$/.test(text.trim())) {
        newId = text.trim();
      }

      if (!newId) {
        return ctx.reply(
          `⚠️ Couldn't detect an emoji ID.\n\nEither paste the animated emoji directly, or enter its numeric ID (15–25 digits).\nUse /getemoji to find IDs.`,
          { parse_mode: "HTML" }
        );
      }

      await setEmojiId(key, newId);
      st.awaitingText = undefined;
      st.emojiEditKey = undefined;

      return ctx.reply(
        `✅ <b>${key}</b> updated!\n\n` +
        `<tg-emoji emoji-id="${newId}">${EMOJI_SLOTS[key].fallback}</tg-emoji>  New ID: <code>${newId}</code>\n\n` +
        `<i>The shop bot will use this emoji immediately. Use /emoji to manage all slots.</i>`,
        { parse_mode: "HTML" }
      );
    }

    if (st.awaitingText === "proxy") {
      if (!text.startsWith("http")) return ctx.reply("URL must start with http. Try again.");
      await dbQuery(`INSERT INTO settings (key, value) VALUES ('residential_proxy_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [text]);
      st.awaitingText = undefined;
      return ctx.reply(`✅ Proxy updated!\n\n\`${text.slice(0, 60)}...\``, { parse_mode: "Markdown" });
    }

    if (st.awaitingText === "custom_copy") {
      const parts = text.split(/\s+/);
      const count = parseInt(parts[0]);
      const status = parts[1] || "processing";
      if (isNaN(count) || count < 1) return ctx.reply("Format: `15 processing`", { parse_mode: "Markdown" });
      st.awaitingText = undefined;
      await doCopy(ctx, status, count, undefined, getState);
      return;
    }

    if (st.awaitingText === "create_count") {
      const count = parseInt(text);
      if (isNaN(count) || count < 1 || count > 200) {
        return ctx.reply("Please enter a number between 1 and 200.");
      }
      if (!st.createFlow) st.createFlow = {};
      st.createFlow.count = count;
      st.awaitingText = undefined;
      await afterCountChosen(ctx, uid);
      return;
    }

    if (st.awaitingText === "coupon_code") {
      const code = text.trim();
      if (!st.createFlow) st.createFlow = {};
      st.createFlow.couponCode = code;
      st.awaitingText = undefined;
      await ctx.reply(`✅ Coupon set: \`${code}\``, { parse_mode: "Markdown" });
      await showCardStep(ctx, uid, getState);
      return;
    }

    if (st.awaitingText === "referral_url") {
      const url = text.trim();
      if (!url.startsWith("https://lovable.dev/")) {
        return ctx.reply("URL must start with `https://lovable.dev/` — try again:", { parse_mode: "Markdown" });
      }
      if (!st.createFlow) st.createFlow = {};
      st.createFlow.referralUrl = url;
      st.awaitingText = undefined;
      await ctx.reply(`✅ Referral URL set.`, { parse_mode: "Markdown" });
      await showCreateSummary(ctx, uid, getState);
      return;
    }

    if (st.awaitingText === "checkout_count") {
      const count = parseInt(text.trim());
      if (isNaN(count) || count < 1 || count > 100) {
        return ctx.reply("Please enter a number between 1 and 100.");
      }
      st.awaitingText = undefined;
      await startChainCheckout(ctx, count);
      return;
    }

    if (st.awaitingText === "biz_mail_custom_user") {
      st.awaitingText = undefined;
      // Strip @domain if user typed full email
      const raw = text.trim().replace(/@.*$/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (!raw) {
        await ctx.reply("⚠️ Invalid username. Use letters, numbers, dots, hyphens, or underscores only.").catch(() => {});
        return;
      }
      await startBizMailSession(ctx.chat!.id, uid, { customUsername: raw });
      return;
    }

    if (st.awaitingText === "biz_mail_restore_username") {
      st.awaitingText = undefined;
      const raw = text.trim().replace(/@.*$/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (!raw) {
        await ctx.reply("⚠️ Invalid username. Use letters, numbers, dots, hyphens, or underscores only.").catch(() => {});
        return;
      }
      const numMatch = raw.match(/^account(\d+)$/i);
      if (numMatch) {
        await startBizMailSession(ctx.chat!.id, uid, { requestedNum: parseInt(numMatch[1], 10) });
      } else {
        await startBizMailSession(ctx.chat!.id, uid, { customUsername: raw });
      }
      return;
    }

    if (st.awaitingText === "biz_bulk_count") {
      st.awaitingText = undefined;
      const count = parseInt(text.trim());
      if (isNaN(count) || count < 1 || count > 100000) {
        await ctx.reply("⚠️ Please enter a number between <b>1</b> and <b>100,000</b>.", { parse_mode: "HTML" }).catch(() => {});
        return;
      }
      await runBizBulkCreate(ctx.chat!.id, uid, count);
      return;
    }
  });

  // ── Launch with auto-retry on transient polling errors ───────────────────
  async function launch(attempt = 1) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      botLog(`✅ [${label}] polling started` + (ALLOWED.size ? ` (${ALLOWED.size} allowed users from ${allowedIdsEnv})` : " (open access)"));
    } catch (err: any) {
      const delay = Math.min(attempt * 5000, 60_000);
      botErr(`[${label}] Launch attempt ${attempt} failed: ${err.message} — retrying in ${delay / 1000}s`);
      setTimeout(() => launch(attempt + 1), delay);
    }
  }
  launch();

  // ── MoviesDrive monitor startup — only start on the first bot ────────────
  if (!mdInterval) {
    // Initial fetch: populate seen set without notifying (no spam on restart)
    fetchMDMovies().then(movies => {
      mdSeenLinks = new Set(movies.map(m => m.link));
      mdLastChecked = new Date();
      botLog(`[MoviesDrive] Monitor ready — ${mdSeenLinks.size} movies indexed`);
    }).catch(() => botLog("[MoviesDrive] Initial fetch failed — will retry on next poll"));

    mdInterval = setInterval(async () => {
      if (!mdMonitorEnabled) return;
      try {
        const movies = await fetchMDMovies();
        if (!movies.length) return;
        mdLastChecked = new Date();
        const newMovies = movies.filter(m => !mdSeenLinks.has(m.link));
        newMovies.forEach(m => mdSeenLinks.add(m.link));
        if (newMovies.length > 0) {
          mdNewCountSession += newMovies.length;
          const totalUsers = getAllBotAllowedIds().size;
          botLog(`[MoviesDrive] ${newMovies.length} new movie(s) — notifying across ${activeBots.length} bot(s), ${totalUsers} user(s)`);
          for (const entry of activeBots) {
            await mdBroadcast(newMovies, entry.tg, entry.getAllowedIds());
          }
        }
      } catch (e: any) {
        botErr("[MoviesDrive] Poll error:", e.message);
      }
    }, MD_POLL_MS);
  }

}

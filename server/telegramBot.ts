import { Telegraf, Markup } from "telegraf";
import { Pool } from "pg";
import {
  getAvailableDomain, createTempEmail, getAuthToken,
  fetchMessages, fetchMessageContent, generateRandomUsername,
  detectProviderFromDomain,
} from "./mailService";

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
  chatgpt: { label: "ChatGPT",  emoji: "🤖", endpoint: "/api/chatgpt-create/bulk", outlookTable: "chatgpt_accounts" },
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
interface ShopAdminFlow {
  step?: "name" | "description" | "price" | "account_type" | "status_filter" | "topup_uid" | "topup_amount";
  name?: string;
  description?: string;
  price?: string;
  accountType?: string;
  statusFilter?: string;
  topupUid?: number;
}
interface UserState {
  lastCopiedIds?: string[];
  awaitingText?: "proxy" | "custom_copy" | "coupon_code" | "create_count" | "referral_url";
  createFlow?: CreateFlow;
  accountType?: string;    // currently browsing account type (Accounts section)
  copyType?: string;       // currently selected type for Copy Accounts
  mailSession?: MailSession;
  shopAdminFlow?: ShopAdminFlow;
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
  const availMsg = svc.outlookTable
    ? `\n📊 Available Outlook emails: *${await getAvailableCount(svc)}*\n`
    : "\n";

  await ctx.reply(
    `*${svc.emoji} Create ${svc.label} Accounts*${availMsg}\nHow many accounts?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("1", "cn_1"), Markup.button.callback("5", "cn_5"), Markup.button.callback("10", "cn_10")],
        [Markup.button.callback("20", "cn_20"), Markup.button.callback("30", "cn_30"), Markup.button.callback("50", "cn_50")],
        [Markup.button.callback("✍️ Custom Number", "cn_custom")],
        [Markup.button.callback("❌ Cancel", "create_cancel")],
      ]),
    }
  );
}

async function showCouponStep(ctx: any) {
  await ctx.reply(
    `*🎟 Coupon Code*\n\nApply a coupon during account creation?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✍️ Enter Coupon Code", "create_enter_coupon")],
        [Markup.button.callback("⏭ Skip — No Coupon", "create_skip_coupon")],
        [Markup.button.callback("❌ Cancel", "create_cancel")],
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
    `*💳 Select a Card*\n\nChoose a saved card or skip:`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        ...cardButtons,
        [Markup.button.callback("⏭ No Card", "create_skip_card")],
        [Markup.button.callback("❌ Cancel", "create_cancel")],
      ]),
    }
  );
}

async function showReferralStep(ctx: any) {
  await ctx.reply(
    `*🔗 Referral URL (optional)*\n\nEnter a Lovable referral URL or skip:\n_Must start with_ \`https://lovable.dev/\``,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✍️ Enter Referral URL", "create_enter_referral")],
        [Markup.button.callback("⏭ Skip", "create_skip_referral")],
        [Markup.button.callback("❌ Cancel", "create_cancel")],
      ]),
    }
  );
}

async function showCreateSummary(ctx: any, uid: number, gs: (n: number) => UserState) {
  const flow = gs(uid).createFlow!;
  const svc = SERVICE_CONFIGS[flow.service!];
  const lines: string[] = [];

  lines.push(`*🏗 Create ${svc.emoji} ${svc.label} Accounts — Summary*\n`);
  lines.push(`🔢 *Accounts to create:* ${flow.count}`);

  if (svc.outlookTable) {
    const avail = await getAvailableCount(svc);
    lines.push(`📊 *Available Outlook emails:* ${avail}`);
  }
  if (svc.hasCoupon) {
    lines.push(`🎟 *Coupon:* ${flow.couponCode ? `\`${flow.couponCode}\`` : "_none_"}`);
  }
  if (svc.hasCard) {
    lines.push(`💳 *Card:* ${flow.cardLabel || "_none_"}`);
  }
  if (svc.hasReferral) {
    lines.push(`🔗 *Referral URL:* ${flow.referralUrl ? `\`${flow.referralUrl.slice(0, 40)}...\`` : "_none_"}`);
  }
  lines.push(`\nReady to start?`);

  await ctx.reply(lines.join("\n"), {
    parse_mode: "Markdown",
    ...Markup.inlineKeyboard([
      [Markup.button.callback("✅ Confirm & Create", "create_confirm")],
      [Markup.button.callback("✏️ Change Count", "create_change_count"), Markup.button.callback("✏️ Back to Services", "create_back_svc")],
      [Markup.button.callback("❌ Cancel", "create_cancel")],
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
const MAIN_KEYBOARD = Markup.keyboard([
  ["📊 Statistics", "👥 Accounts"],
  ["📋 Copy Accounts", "🔗 Checkout Links"],
  ["🏗 Create Accounts", "📧 Mail Generator"],
  ["🎬 MoviesDrive", "🛒 Shop"],
]).resize().oneTime();

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

  let t = `📊 <b>ACCOUNT TRACKER</b>\n`;
  t += `<i>Updated ${now}</i>\n`;
  t += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  t += serviceBlock("🔵", "REPLIT", replitStatus,
    [`🎟 coupons: <b>${n(replitCoupons)}</b>`, `🔗 checkout: <b>${n(replitCheckout)}</b>`],
    n(replitToday), n(replitWeek));

  t += serviceBlock("💜", "LOVABLE", lovableStatus, [], n(lovableToday), n(lovableWeek));
  t += serviceBlock("⚡", "V0.DEV", v0Status, [], n(v0Today));
  t += serviceBlock("🅰️", "ADOBE", adobeStatus, [], n(adobeToday));
  t += serviceBlock("🤖", "CHATGPT", chatgptStatus, [], n(chatgptToday));
  t += serviceBlock("🎙", "11LABS", elevenStatus, [], n(elevenToday));

  t += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  t += `📬 <b>OUTLOOK POOL</b>  <code>${n(outlookTotal)}</code> total · <b>${n(outlookAvail)}</b> unused\n`;
  t += `📩 <b>GMAIL POOL</b>  <code>${n(gmailTotal)}</code> total\n`;

  t += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  t += `🌐 <b>GRAND TOTAL</b>: <code>${grandTotal}</code> accounts across all services`;

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
      `🪪 <b>Your Telegram ID:</b> <code>${uid}</code>\n\nAdd this to <b>TELEGRAM_ALLOWED_IDS</b> to grant access.`,
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
        `⛔ <b>Unauthorized.</b>\n\n🪪 Your ID: <code>${uid}</code>\n<i>Ask the admin to add it to TELEGRAM_ALLOWED_IDS.</i>`,
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
    // Dismiss any existing keyboard permanently
    const dismiss = await ctx.reply("\u200B", { ...Markup.removeKeyboard() }).catch(() => null);
    if (dismiss) {
      await ctx.telegram.deleteMessage(ctx.chat.id, dismiss.message_id).catch(() => {});
    }
    await ctx.reply(
      `👋 *Replit Admin Bot*\n\nPress the *Menu* button below to open the keyboard.`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /menu ── show keyboard on demand (triggered by tapping Menu button) ───
  bot.command("menu", async (ctx) => {
    // Remove any stale keyboard first, then re-show fresh one-time keyboard
    const dismiss = await ctx.reply("\u200B", { ...Markup.removeKeyboard() }).catch(() => null);
    if (dismiss) {
      await ctx.telegram.deleteMessage(ctx.chat.id, dismiss.message_id).catch(() => {});
    }
    await ctx.reply(
      `📋 *Main Menu*\n\nChoose an option:`,
      { parse_mode: "Markdown", ...MAIN_KEYBOARD }
    );
  });

  // ── /cancel ───────────────────────────────────────────────────────────────
  bot.command("cancel", (ctx) => {
    const uid = ctx.from.id;
    const st = getState(uid);
    st.awaitingText = undefined;
    if (runningScans.has(uid)) {
      runningScans.set(uid, false);
      ctx.reply("⛔ Stopping scan after current account...");
    } else {
      ctx.reply("Cancelled.");
    }
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

  bot.hears("📊 Statistics", (ctx) => handleMenu(ctx, async () => {
    const { text, mode } = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: mode,
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    });
  }));

  bot.hears("👥 Accounts", (ctx) => handleMenu(ctx, async () => {
    await ctx.reply("*👥 Accounts* — select an account type:", {
      parse_mode: "Markdown",
      ...(await inlineAccountTypes()),
    });
  }));

  bot.hears("📋 Copy Accounts", (ctx) => handleMenu(ctx, async () => {
    getState(ctx.from.id).copyType = undefined; // reset
    await ctx.reply("*📋 Copy Accounts* — select an account type:", {
      parse_mode: "Markdown",
      ...(await inlineCopyTypes()),
    });
  }));

  bot.hears("🔗 Checkout Links", (ctx) => handleMenu(ctx, async () => {
    const ready = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    const sources = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'sold_out' AND coupon_extracted = false`);
    await ctx.reply(
      `*🔗 Generate Checkout Links*\n\n⏳ Processing (targets): *${ready.rows[0]?.cnt || 0}*\n✅ Source accounts: *${sources.rows[0]?.cnt || 0}*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("✅ Generate Now", "confirm_checkout"), Markup.button.callback("❌ Cancel", "dismiss")],
        ]),
      }
    );
  }));

  bot.hears("🏗 Create Accounts", (ctx) => handleMenu(ctx, async () => {
    getState(ctx.from.id).createFlow = {};
    await ctx.reply(
      `*🏗 Create Accounts*\n\nWhich service?`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔵 Replit",  "cs_replit"),  Markup.button.callback("💜 Lovable", "cs_lovable")],
          [Markup.button.callback("⚡ v0.dev",  "cs_v0"),      Markup.button.callback("🅰️ Adobe",   "cs_adobe")],
          [Markup.button.callback("🤖 ChatGPT", "cs_chatgpt")],
          [Markup.button.callback("❌ Cancel",  "create_cancel")],
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

  bot.hears("📧 Mail Generator", (ctx) => handleMenu(ctx, async () => {
    const uid = ctx.from!.id;
    const chatId = ctx.chat!.id;
    await startMailSession(chatId, uid);
  }));

  // ── MoviesDrive ────────────────────────────────────────────────────────────
  bot.hears("🎬 MoviesDrive", (ctx) => handleMenu(ctx, async () => {
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

  bot.hears("⚙️ Settings", (ctx) => handleMenu(ctx, async () => {
    const rows = await dbQuery(`SELECT key, value FROM settings WHERE key IN ('residential_proxy_url','capsolver_api_key','zenrows_api_key','fivesim_api_key')`);
    const map: Record<string, string> = {};
    rows.rows.forEach((r: any) => { map[r.key] = r.value; });
    const mask = (v: string) => v ? `${v.slice(0, 16)}...` : "_not set_";
    await ctx.reply(
      `*⚙️ Settings*\n\n` +
      `🌐 *Proxy:*\n\`${mask(map["residential_proxy_url"] || "")}\`\n\n` +
      `🔑 *Capsolver:* ${mask(map["capsolver_api_key"] || "")}\n` +
      `🔑 *ZenRows:* ${mask(map["zenrows_api_key"] || "")}\n` +
      `📱 *5sim:* ${mask(map["fivesim_api_key"] || "")}`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🌐 Update Proxy", "update_proxy")],
        ]),
      }
    );
  }));

  bot.hears("❓ Help", (ctx) => handleMenu(ctx, async () => {
    await ctx.reply(
      `*❓ Help*\n\n` +
      `Use /menu to open the keyboard, then tap any option:\n\n` +
      `📊 *Statistics* — live account counts\n` +
      `👥 *Accounts* — browse by status\n` +
      `📋 *Copy Accounts* — send credentials to chat\n` +
      `🔗 *Checkout Links* — generate Stripe links\n` +
      `🏗 *Create Accounts* — create new Replit accounts\n` +
      `🔄 *Auto-Scan* — extract coupons from accounts\n` +
      `🔥 *Warm Accounts* — simulate Replit activity\n` +
      `🗑 *Purge Banned* — remove permanently banned accounts\n` +
      `⚙️ *Settings* — view/update proxy & API keys\n\n` +
      `/cancel — stop a running scan`,
      { parse_mode: "Markdown" }
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
          [Markup.button.callback("🤖 ChatGPT", "cs_chatgpt")],
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
    await ctx.editMessageText(`*✍️ Custom Count*\n\nType how many accounts to create:`, { parse_mode: "Markdown" });
  });

  // ── Create flow: coupon step ──────────────────────────────────────────────
  bot.action("create_enter_coupon", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).awaitingText = "coupon_code";
    await ctx.editMessageText(`*🎟 Enter Coupon Code*\n\nType the coupon code now:`, { parse_mode: "Markdown" });
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
      `*🔗 Enter Referral URL*\n\nType the Lovable referral URL now:\n_(must start with https://lovable.dev/)_`,
      { parse_mode: "Markdown" }
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
    batchId: string, svc: ServiceConfig, totalCount: number, startTime: number
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
      [Markup.button.callback("👥 View Accounts", "list_processing"), Markup.button.callback("🏗 Create More", "create_more")],
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
          .map(l => { const parts = l.split("|"); return { email: parts[1], url: parts[2] }; })
          .filter(c => c.email && c.url && !sentCheckoutUrls.has(c.url));
        for (const c of newCheckouts) {
          sentCheckoutUrls.add(c.url);
          await bot.telegram.sendMessage(chatId,
            `🔗 <b>Checkout Link Ready!</b>\n\n` +
            `📧 <code>${esc(c.email)}</code>\n` +
            `<a href="${esc(c.url)}">Open Checkout</a>\n` +
            `<code>${esc(c.url)}</code>`,
            { parse_mode: "HTML", disable_web_page_preview: true }
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
                `SELECT email, password, coupon_code FROM ${acctTable}
                 WHERE created_at >= $1 AND (error IS NULL OR error = '')
                 ORDER BY created_at DESC LIMIT $2`,
                [batchStart, created]
              )).rows;

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
      await ctx.editMessageText(`❌ Failed: ${r.data?.error || "Unknown error"}`, { parse_mode: "Markdown" });
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
    await streamBatchLogs(chatId, msgId, batchId, svc, flow.count, startTime);
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
          [Markup.button.callback("🤖 ChatGPT", "cs_chatgpt")],
          [Markup.button.callback("❌ Cancel",  "create_cancel")],
        ]),
      }
    );
  });

  bot.action("create_cancel", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).createFlow = undefined;
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply("Cancelled.");
  });

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
      ? `✅ *Warming ${count} accounts*\n\nBatch: \`${r.data.batchId || "started"}\``
      : `❌ Error: ${r.data?.error || "Unknown"}`;
    await ctx.editMessageText(msg, { parse_mode: "Markdown" });
  });

  // Purge
  bot.action("confirm_purge", async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const r = await botApi("/api/replit-purge-banned", "POST", {});
    const msg = r.ok
      ? `✅ *Purge started!*\n\nBatch: \`${r.data.batchId || "started"}\``
      : `❌ Error: ${r.data?.error || "Unknown"}`;
    await ctx.editMessageText(msg, { parse_mode: "Markdown" });
  });

  // Proxy update
  bot.action("update_proxy", async (ctx) => {
    await ctx.answerCbQuery();
    getState(ctx.from.id).awaitingText = "proxy";
    await ctx.reply(`🌐 *Update Proxy*\n\nSend the new proxy URL now:\n_(e.g. http://user:pass@host:port)_`, { parse_mode: "Markdown" });
  });

  // ── Shop admin helpers ────────────────────────────────────────────────────
  const SHOP_ACCOUNT_TYPES = ["replit", "lovable", "v0", "adobe", "chatgpt", "eleven", "outlook", "gmail"];

  async function showShopAdminMenu(ctx: any) {
    const [prodRes, custRes] = await Promise.all([
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_products WHERE active = true`),
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_customers`),
    ]);
    const activeProd = parseInt(prodRes.rows[0]?.cnt ?? "0");
    const totalCust  = parseInt(custRes.rows[0]?.cnt ?? "0");
    await ctx.reply(
      `*🛒 Shop Admin*\n\nActive products: *${activeProd}*\nTotal customers: *${totalCust}*`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📦 Products", "shop_admin_products"), Markup.button.callback("➕ Add Product", "shop_admin_add_product")],
          [Markup.button.callback("👥 Customers", "shop_admin_customers"), Markup.button.callback("💰 Top Up", "shop_admin_topup")],
        ]),
      }
    );
  }

  bot.hears("🛒 Shop", (ctx) => handleMenu(ctx, async () => {
    await showShopAdminMenu(ctx);
  }));

  bot.action("shop_admin_menu", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showShopAdminMenu(ctx);
  });

  bot.action("shop_admin_products", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const res = await dbQuery(`SELECT * FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    if (res.rows.length === 0) {
      return safeEdit(ctx,
        `*📦 Products*\n\nNo products yet. Use "Add Product" to create one.`,
        { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("➕ Add Product", "shop_admin_add_product"), Markup.button.callback("🔙 Back", "shop_admin_menu")]]) }
      );
    }
    const lines: string[] = [`*📦 Products* (${res.rows.length})\n`];
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const p of res.rows) {
      const status = p.active ? "🟢 Active" : "🔴 Off";
      lines.push(`${status} *${p.name}* — $${parseFloat(p.price).toFixed(2)}\n  Type: ${p.account_type} | Filter: ${p.status_filter}`);
      buttons.push([
        Markup.button.callback(p.active ? `Deactivate: ${p.name}` : `Activate: ${p.name}`, `shop_toggle_${p.id}`),
      ]);
    }
    buttons.push([Markup.button.callback("➕ Add Product", "shop_admin_add_product"), Markup.button.callback("🔙 Back", "shop_admin_menu")]);
    await safeEdit(ctx, lines.join("\n"), { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/^shop_toggle_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    const res = await dbQuery(`SELECT active, name FROM shop_products WHERE id = $1`, [productId]);
    if (!res.rows[0]) return safeEdit(ctx, "Product not found.");
    const newActive = !res.rows[0].active;
    await dbQuery(`UPDATE shop_products SET active = $1 WHERE id = $2`, [newActive, productId]);
    await ctx.answerCbQuery(`${newActive ? "Activated" : "Deactivated"}: ${res.rows[0].name}`).catch(() => {});
    // Refresh products list
    const all = await dbQuery(`SELECT * FROM shop_products ORDER BY sort_order ASC, created_at ASC`);
    const lines: string[] = [`*📦 Products* (${all.rows.length})\n`];
    const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
    for (const p of all.rows) {
      const st = p.active ? "🟢 Active" : "🔴 Off";
      lines.push(`${st} *${p.name}* — $${parseFloat(p.price).toFixed(2)}\n  Type: ${p.account_type} | Filter: ${p.status_filter}`);
      buttons.push([Markup.button.callback(p.active ? `Deactivate: ${p.name}` : `Activate: ${p.name}`, `shop_toggle_${p.id}`)]);
    }
    buttons.push([Markup.button.callback("➕ Add Product", "shop_admin_add_product"), Markup.button.callback("🔙 Back", "shop_admin_menu")]);
    await safeEdit(ctx, lines.join("\n"), { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
  });

  bot.action("shop_admin_add_product", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "name" };
    await ctx.reply(
      `*➕ Add Product — Step 1/5*\n\nEnter the product *name*:\n_(e.g. "Replit Core 1 Month")_`,
      { parse_mode: "Markdown" }
    );
  });

  bot.action("shop_admin_customers", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const res = await dbQuery(
      `SELECT telegram_id, username, first_name, balance FROM shop_customers ORDER BY balance DESC LIMIT 15`
    );
    if (res.rows.length === 0) {
      return safeEdit(ctx, "*👥 Customers*\n\nNo customers yet.", { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Back", "shop_admin_menu")]]) });
    }
    const lines: string[] = [`*👥 Customers* (${res.rows.length})\n`];
    for (const c of res.rows) {
      const name = c.username ? `@${c.username}` : (c.first_name ?? `ID:${c.telegram_id}`);
      lines.push(`${name} — Balance: *$${parseFloat(c.balance).toFixed(2)}*`);
    }
    await safeEdit(ctx, lines.join("\n"), {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("💰 Top Up", "shop_admin_topup"), Markup.button.callback("🔙 Back", "shop_admin_menu")]]),
    });
  });

  bot.action("shop_admin_topup", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    getState(uid).shopAdminFlow = { step: "topup_uid" };
    await ctx.reply(
      `*💰 Top Up Customer Balance*\n\nEnter the customer's *Telegram ID*:`,
      { parse_mode: "Markdown" }
    );
  });

  // ── Text message handler ──────────────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const uid = ctx.from.id;
    const text = ctx.message.text.trim();
    const st = getState(uid);

    // ── Shop admin multi-step text flows ─────────────────────────────────
    if (st.shopAdminFlow?.step) {
      const flow = st.shopAdminFlow;

      if (flow.step === "name") {
        flow.name = text;
        flow.step = "description";
        return ctx.reply(
          `*➕ Add Product — Step 2/5*\n\nEnter a short *description* (or send "-" to skip):`,
          { parse_mode: "Markdown" }
        );
      }

      if (flow.step === "description") {
        flow.description = text === "-" ? "" : text;
        flow.step = "price";
        return ctx.reply(
          `*➕ Add Product — Step 3/5*\n\nEnter the *price* in USD (e.g. \`1.00\`):`,
          { parse_mode: "Markdown" }
        );
      }

      if (flow.step === "price") {
        const price = parseFloat(text);
        if (isNaN(price) || price <= 0) {
          return ctx.reply("Invalid price. Enter a positive number like `1.00`:", { parse_mode: "Markdown" });
        }
        flow.price = price.toFixed(2);
        flow.step = "account_type";
        return ctx.reply(
          `*➕ Add Product — Step 4/5*\n\nEnter the *account type*:\n\`${SHOP_ACCOUNT_TYPES.join(" | ")}\``,
          { parse_mode: "Markdown" }
        );
      }

      if (flow.step === "account_type") {
        const at = text.toLowerCase().trim();
        if (!SHOP_ACCOUNT_TYPES.includes(at)) {
          return ctx.reply(
            `Invalid type. Choose from:\n\`${SHOP_ACCOUNT_TYPES.join(" | ")}\``,
            { parse_mode: "Markdown" }
          );
        }
        flow.accountType = at;
        flow.step = "status_filter";
        return ctx.reply(
          `*➕ Add Product — Step 5/5*\n\nEnter the *status filter* — accounts with this status will be sold:\n_(e.g. \`available\`, \`working\`, \`created\`)_`,
          { parse_mode: "Markdown" }
        );
      }

      if (flow.step === "status_filter") {
        flow.statusFilter = text.toLowerCase().trim();
        // Save product to DB
        try {
          await dbQuery(
            `INSERT INTO shop_products (name, description, price, account_type, status_filter)
             VALUES ($1, $2, $3, $4, $5)`,
            [flow.name, flow.description || null, flow.price, flow.accountType, flow.statusFilter]
          );
          st.shopAdminFlow = undefined;
          return ctx.reply(
            `✅ *Product added!*\n\n*Name:* ${flow.name}\n*Price:* $${flow.price}\n*Type:* ${flow.accountType}\n*Filter:* ${flow.statusFilter}`,
            { parse_mode: "Markdown" }
          );
        } catch (err: any) {
          st.shopAdminFlow = undefined;
          return ctx.reply(`❌ Failed to save product: ${err.message}`);
        }
      }

      if (flow.step === "topup_uid") {
        const telegramId = parseInt(text.trim());
        if (isNaN(telegramId)) {
          return ctx.reply("Invalid Telegram ID. Enter a number:");
        }
        // Check if customer exists
        const custRes = await dbQuery(`SELECT telegram_id, balance FROM shop_customers WHERE telegram_id = $1`, [telegramId]);
        if (!custRes.rows[0]) {
          st.shopAdminFlow = undefined;
          return ctx.reply(`❌ Customer with ID ${telegramId} not found.`);
        }
        flow.topupUid = telegramId;
        flow.step = "topup_amount";
        return ctx.reply(
          `Customer balance: *$${parseFloat(custRes.rows[0].balance).toFixed(2)}*\n\nEnter the *amount to add* (e.g. \`5.00\`):`,
          { parse_mode: "Markdown" }
        );
      }

      if (flow.step === "topup_amount") {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply("Invalid amount. Enter a positive number like `5.00`:", { parse_mode: "Markdown" });
        }
        try {
          await dbQuery(
            `UPDATE shop_customers SET balance = balance + $1 WHERE telegram_id = $2`,
            [amount.toFixed(2), flow.topupUid]
          );
          const after = await dbQuery(`SELECT balance FROM shop_customers WHERE telegram_id = $1`, [flow.topupUid]);
          st.shopAdminFlow = undefined;
          return ctx.reply(
            `✅ *Balance topped up!*\n\nCustomer: \`${flow.topupUid}\`\nAdded: *$${amount.toFixed(2)}*\nNew balance: *$${parseFloat(after.rows[0]?.balance ?? "0").toFixed(2)}*`,
            { parse_mode: "Markdown" }
          );
        } catch (err: any) {
          st.shopAdminFlow = undefined;
          return ctx.reply(`❌ Top-up failed: ${err.message}`);
        }
      }

      return;
    }

    if (!st.awaitingText) return;

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

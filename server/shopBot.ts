import { Telegraf, Markup } from "telegraf";
import { Pool, PoolClient } from "pg";
import {
  pendingActivations, adminApprovalStates as _adminApprovalStates,
  buildActivationCountdownMsg,
  type PendingActivation, type ActivationService,
  ACTIVATION_LABEL, ACTIVATION_EMOJI,
} from "./activationStore";

const SUPPORT_CONTACT   = "@avinashaddison";

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on("error", (err) => console.error("[ShopBot] DB pool error:", err.message));

async function dbQuery(sql: string, params: any[] = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

const ACCOUNT_TABLE_MAP: Record<string, string> = {
  replit:   "replit_accounts",
  lovable:  "lovable_accounts",
  v0:       "v0_accounts",
  adobe:    "adobe_accounts",
  chatgpt:  "chatgpt_accounts",
  eleven:   "eleven_labs_accounts",
  outlook:  "private_outlook_accounts",
  gmail:    "private_gmail_accounts",
};

const PLATFORM_EMOJI: Record<string, string> = {
  replit:   "🔵",
  lovable:  "💜",
  v0:       "⚡",
  adobe:    "🅰️",
  chatgpt:  "֎",
  eleven:   "🎙",
  outlook:  "📧",
  gmail:    "📬",
};

function truncate(text: string, limit = 4000): string {
  return text.length > limit ? text.slice(0, limit - 3) + "…" : text;
}

function escHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Telegram Premium animated custom emoji ────────────────────────────────────
// These IDs reference Telegram's built-in animated emoji sticker packs.
// Users without Premium see the plain-text fallback instead.
const ANIM_EMOJI = {
  fire:    "5368324170671202286",  // 🔥
  bolt:    "5219005168305143806",  // ⚡
  diamond: "5471952986970267627",  // 💎
  robot:   "5392571666582032261",  // 🤖
  money:   "5371260806527499265",  // 💰
  star:    "5376425420038527205",  // ⭐ (distinct ID from fire)
  rocket:  "5380004077456738553",  // 🚀
  check:   "5404870433004043254",  // ✅
  crown:   "5379748062124056162",  // 👑
  card:    "5382116965029829100",  // 💳
  gift:    "5436040711104178070",  // 🎁
  bell:    "5361541227376957276",  // 🔔
} as const;

/**
 * Animated custom emoji helper.
 * NOTE: <tg-emoji> requires verified document IDs from real Telegram sticker packs.
 * Until valid IDs are sourced via the API, this returns the plain fallback emoji
 * so messages render correctly without DOCUMENT_INVALID errors.
 */
function ae(_id: string, fallback: string): string {
  return fallback;
}

/**
 * Clips a plain-text string to maxLen visible characters.
 * Used to keep product card content within the fixed-width box.
 */
function boxClip(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function fmt$(n: number | string) {
  return `$${parseFloat(String(n)).toFixed(2)}`;
}

function platformLabel(account_type: string): string {
  const map: Record<string, string> = {
    replit:  "Replit",
    lovable: "Lovable.dev",
    v0:      "v0.dev",
    adobe:   "Adobe",
    chatgpt: "ChatGPT",
    eleven:  "ElevenLabs",
    outlook: "Outlook",
    gmail:   "Gmail",
  };
  return map[account_type] ?? account_type;
}

function platformEmoji(account_type: string): string {
  return PLATFORM_EMOJI[account_type] ?? "🔹";
}

function stockBadge(stock: number): string {
  if (stock === 0) return "🔴 Sold out";
  if (stock <= 3)  return `🔥 Only ${stock} left — grab it fast!`;
  if (stock <= 10) return `🟡 ${stock} in stock`;
  return `🟢 ${stock} in stock`;
}

function stockLine(stock: number): string {
  if (stock === 0) return "🔴  SOLD OUT";
  if (stock <= 5)  return `🟡  LOW — ×${stock} remaining`;
  return `🟢  IN STOCK — ×${stock} units`;
}

// ── Main reply keyboard ──────────────────────────────────────────────────────
const BTN = {
  CHATGPT_PLUS: "֎  𝗖𝗵𝗮𝘁𝗚𝗣𝗧  𝗣𝗹𝘂𝘀  ·  $2",
  REPLIT_CORE:  "🔵  𝗥𝗲𝗽𝗹𝗶𝘁  𝗖𝗼𝗿𝗲  ·  $2",
  ACCOUNTS:     "⚡  𝗦𝗛𝗢𝗣  𝗔𝗜  𝗧𝗢𝗢𝗟𝗦",
  BALANCE:      "💰  𝗪𝗔𝗟𝗟𝗘𝗧",
  ORDERS:       "📋  𝗢𝗥𝗗𝗘𝗥𝗦",
  DEPOSIT:      "💳  𝗔𝗗𝗗  𝗙𝗨𝗡𝗗𝗦",
  IDENTITY:     "👤  𝗠𝗬  𝗣𝗥𝗢𝗙𝗜𝗟𝗘",
  SUPPORT:      "🎧  𝗦𝗨𝗣𝗣𝗢𝗥𝗧",
  REFER:        "🔗  𝗥𝗘𝗙𝗘𝗥  &  𝗘𝗔𝗥𝗡",
} as const;

const SHOP_KEYBOARD = Markup.keyboard([
  [BTN.CHATGPT_PLUS, BTN.REPLIT_CORE],
  [BTN.ACCOUNTS],
  [BTN.BALANCE,   BTN.ORDERS],
  [BTN.DEPOSIT,   BTN.SUPPORT],
  [BTN.IDENTITY,  BTN.REFER],
]).resize().oneTime();

// ── Per-user state ───────────────────────────────────────────────────────────
interface ShopUserState {
  selectedProductId?: string;
}
const userState = new Map<number, ShopUserState>();
function getState(uid: number): ShopUserState {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid)!;
}

interface ActivationFlow {
  service:   ActivationService;
  step:      "waiting_email" | "waiting_password" | "confirm";
  email?:    string;
  password?: string;
  promptMsgId?: number;
}
const activationFlows = new Map<number, ActivationFlow>();

// Buy flow (promo code + confirm)
interface BuyFlow {
  productId:    string;
  step:         "promo" | "confirm";
  promoCode?:   string;
  discountAmt?: number;
}
const buyFlows = new Map<number, BuyFlow>();

// Deposit screenshot flow
interface DepositFlow {
  step: "waiting_screenshot";
}
const depositFlows = new Map<number, DepositFlow>();

const ACTIVATION_PRICE = 2.00;
const VIP_THRESHOLD    = 10.00;

// ── DB helpers ───────────────────────────────────────────────────────────────
async function upsertCustomer(uid: number, username?: string, firstName?: string, referredBy?: number) {
  if (referredBy && referredBy !== uid) {
    await dbQuery(
      `INSERT INTO shop_customers (telegram_id, username, first_name, referred_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE
         SET username   = EXCLUDED.username,
             first_name = EXCLUDED.first_name`,
      [uid, username ?? null, firstName ?? null, referredBy]
    );
  } else {
    await dbQuery(
      `INSERT INTO shop_customers (telegram_id, username, first_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE
         SET username   = EXCLUDED.username,
             first_name = EXCLUDED.first_name`,
      [uid, username ?? null, firstName ?? null]
    );
  }
}

async function isNewCustomer(uid: number): Promise<boolean> {
  const r = await dbQuery(`SELECT 1 FROM shop_customers WHERE telegram_id = $1`, [uid]);
  return r.rows.length === 0;
}

async function getBalance(uid: number): Promise<number> {
  const r = await dbQuery(`SELECT balance FROM shop_customers WHERE telegram_id = $1`, [uid]);
  return parseFloat(r.rows[0]?.balance ?? "0");
}

async function getReferralReward(): Promise<number> {
  const r = await dbQuery(`SELECT value FROM shop_settings WHERE key = 'referral_reward'`);
  return parseFloat(r.rows[0]?.value ?? "0.50");
}

async function validatePromoCode(code: string, price: number): Promise<{ valid: false; reason: string } | { valid: true; discountAmt: number; codeId: number }> {
  const r = await dbQuery(
    `SELECT id, discount_pct, discount_fixed, max_uses, uses_count, active, expires_at
     FROM shop_promo_codes WHERE UPPER(code) = UPPER($1)`,
    [code]
  );
  const row = r.rows[0];
  if (!row)           return { valid: false, reason: "Invalid promo code." };
  if (!row.active)    return { valid: false, reason: "This promo code is no longer active." };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { valid: false, reason: "This promo code has expired." };
  if (row.max_uses > 0 && row.uses_count >= row.max_uses)      return { valid: false, reason: "This promo code has reached its usage limit." };
  const pctOff   = parseFloat(row.discount_pct ?? "0");
  const fixedOff = parseFloat(row.discount_fixed ?? "0");
  let discount   = fixedOff + (price * pctOff / 100);
  discount = Math.min(discount, price);
  return { valid: true, discountAmt: parseFloat(discount.toFixed(2)), codeId: row.id };
}

async function usePromoCode(codeId: number) {
  await dbQuery(`UPDATE shop_promo_codes SET uses_count = uses_count + 1 WHERE id = $1`, [codeId]);
}

async function checkAndUpdateVip(uid: number) {
  const r = await dbQuery(`SELECT total_spend, vip FROM shop_customers WHERE telegram_id = $1`, [uid]);
  const row = r.rows[0];
  if (!row || row.vip) return;
  if (parseFloat(row.total_spend ?? "0") >= VIP_THRESHOLD) {
    await dbQuery(`UPDATE shop_customers SET vip = TRUE WHERE telegram_id = $1`, [uid]);
  }
}

function alertAdminLowStock(productName: string, remaining: number) {
  const adminToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds   = (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!adminToken || adminIds.length === 0) return;
  const text =
    `⚠️ <b>LOW STOCK ALERT</b>\n\n` +
    `📦 Product: <b>${escHtml(productName)}</b>\n` +
    `📉 Only <b>${remaining}</b> unit${remaining !== 1 ? "s" : ""} remaining!\n\n` +
    `<i>Restock soon to avoid losing sales.</i>`;
  for (const id of adminIds) {
    fetch(`https://api.telegram.org/bot${adminToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML" }),
    }).catch(() => {});
  }
}

async function notifyRestockSubscribers(bot: any, productId: string, productName: string) {
  const r = await dbQuery(`SELECT telegram_id FROM shop_restock_subs WHERE product_id = $1`, [productId]);
  if (r.rows.length === 0) return;
  const emoji = "🔔";
  for (const row of r.rows) {
    bot.telegram.sendMessage(
      row.telegram_id,
      `${emoji} <b>Back in Stock!</b>\n\n` +
      `📦 <b>${escHtml(productName)}</b> is now available again.\n\n` +
      `<i>Tap below to buy before it sells out!</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("⚡  Buy Now", `shop_product_${productId}`)]]),
      }
    ).catch(() => {});
  }
  // Remove subs after notifying
  await dbQuery(`DELETE FROM shop_restock_subs WHERE product_id = $1`, [productId]);
}

function sendRatingRequest(bot: any, uid: number, orderId: string, productName: string) {
  setTimeout(async () => {
    bot.telegram.sendMessage(
      uid,
      `⭐ <b>Rate Your Purchase</b>\n\n` +
      `How was <b>${escHtml(productName)}</b>?\n\n` +
      `<i>Tap a star to rate — takes 1 second!</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[
          Markup.button.callback("1⭐", `rate_${orderId}_1`),
          Markup.button.callback("2⭐", `rate_${orderId}_2`),
          Markup.button.callback("3⭐", `rate_${orderId}_3`),
          Markup.button.callback("4⭐", `rate_${orderId}_4`),
          Markup.button.callback("5⭐", `rate_${orderId}_5`),
        ]]),
      }
    ).catch(() => {});
  }, 3000);
}

async function processReferralReward(newUid: number, bot: any) {
  const res = await dbQuery(
    `SELECT referred_by, referral_rewarded FROM shop_customers WHERE telegram_id = $1`,
    [newUid]
  );
  const row = res.rows[0];
  if (!row?.referred_by || row.referral_rewarded) return;

  const referrerId   = parseInt(row.referred_by);
  const rewardAmount = await getReferralReward();

  // Reward referrer and mark as rewarded
  await dbQuery(
    `UPDATE shop_customers SET balance = balance + $1 WHERE telegram_id = $2`,
    [rewardAmount.toFixed(2), referrerId]
  );
  await dbQuery(
    `UPDATE shop_customers SET referral_rewarded = true WHERE telegram_id = $1`,
    [newUid]
  );

  // Notify referrer
  const newUserRes = await dbQuery(
    `SELECT username, first_name FROM shop_customers WHERE telegram_id = $1`,
    [newUid]
  );
  const u = newUserRes.rows[0];
  const newName = u?.username ? `@${u.username}` : (u?.first_name ? escHtml(u.first_name) : `User ${newUid}`);

  bot.telegram.sendMessage(
    referrerId,
    `🎉 <b>Referral Reward!</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👤 <b>${newName}</b> just joined via your referral link.\n\n` +
    `💰 <b>+$${rewardAmount.toFixed(2)}</b> added to your wallet!\n\n` +
    `<i>Keep sharing your link to earn more rewards.</i>`,
    { parse_mode: "HTML" }
  ).catch(() => {});
}

const REQUIRED_CHANNEL = "@projectaddison";
const CHANNEL_URL      = "https://t.me/projectaddison";

async function isChannelMember(bot: any, uid: number): Promise<"member" | "not_member" | "bot_not_admin"> {
  try {
    const m = await bot.telegram.getChatMember(REQUIRED_CHANNEL, uid);
    const ok = ["member", "administrator", "creator"].includes(m.status);
    return ok ? "member" : "not_member";
  } catch (e: any) {
    const desc: string = e?.description || e?.message || "";
    console.warn(`[ShopBot] getChatMember error for uid=${uid}:`, desc);
    // Bot is not an admin of the channel — can't check membership
    if (
      desc.includes("CHAT_ADMIN_REQUIRED") ||
      desc.includes("bot is not a member") ||
      desc.includes("not enough rights") ||
      desc.includes("have no rights") ||
      desc.includes("administrators") ||
      desc.includes("chat not found")
    ) {
      return "bot_not_admin";
    }
    return "not_member";
  }
}

interface ProductWithStock {
  id: string;
  name: string;
  description: string | null;
  price: string;
  account_type: string;
  status_filter: string;
  min_credits: number | null;
  active: boolean;
  sort_order: number;
  stock: number;
}

function stockCountSql(table: string, statusFilter: string, minCredits: number | null): { sql: string; params: any[] } {
  if (minCredits != null) {
    return {
      sql: `SELECT COUNT(*) as cnt FROM ${table} WHERE status = $1 AND credits >= $2`,
      params: [statusFilter, minCredits],
    };
  }
  return {
    sql: `SELECT COUNT(*) as cnt FROM ${table} WHERE status = $1`,
    params: [statusFilter],
  };
}

async function getProductsWithStock(): Promise<ProductWithStock[]> {
  const res = await dbQuery(
    `SELECT * FROM shop_products WHERE active = true ORDER BY sort_order ASC, created_at ASC`
  );
  const out: ProductWithStock[] = [];
  for (const p of res.rows) {
    const table = ACCOUNT_TABLE_MAP[p.account_type];
    let stock = 0;
    if (table) {
      const { sql, params } = stockCountSql(table, p.status_filter, p.min_credits ?? null);
      const sr = await dbQuery(sql, params).catch(() => ({ rows: [{ cnt: "0" }] }));
      stock = parseInt(sr.rows[0]?.cnt ?? "0");
    }
    out.push({ ...p, stock });
  }
  return out;
}

async function getProductById(id: string): Promise<ProductWithStock | null> {
  const res = await dbQuery(`SELECT * FROM shop_products WHERE id = $1`, [id]);
  if (!res.rows[0]) return null;
  const p = res.rows[0];
  const table = ACCOUNT_TABLE_MAP[p.account_type];
  let stock = 0;
  if (table) {
    const { sql, params } = stockCountSql(table, p.status_filter, p.min_credits ?? null);
    const sr = await dbQuery(sql, params).catch(() => ({ rows: [{ cnt: "0" }] }));
    stock = parseInt(sr.rows[0]?.cnt ?? "0");
  }
  return { ...p, stock };
}

interface PurchaseResult {
  success: true;
  accountEmail: string;
  accountPassword: string;
  newBalance: number;
  orderId: string;
  finalPrice: number;
  stockRemaining: number;
  productName: string;
}
interface PurchaseFailure {
  success: false;
  reason: "insufficient_funds" | "out_of_stock" | "product_not_found" | "error";
  shortfall?: number;
  message?: string;
}

async function purchaseProduct(
  uid: number,
  productId: string,
  discountAmt = 0
): Promise<PurchaseResult | PurchaseFailure> {
  const prod = await getProductById(productId);
  if (!prod) return { success: false, reason: "product_not_found" };
  if (!prod.active) return { success: false, reason: "product_not_found" };

  const table = ACCOUNT_TABLE_MAP[prod.account_type];
  if (!table) return { success: false, reason: "error", message: "Unknown account type" };

  const listPrice  = parseFloat(prod.price);
  const finalPrice = Math.max(0, parseFloat((listPrice - discountAmt).toFixed(2)));

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const custRes = await client.query(
      `SELECT balance FROM shop_customers WHERE telegram_id = $1 FOR UPDATE`,
      [uid]
    );
    if (!custRes.rows[0]) {
      await client.query("ROLLBACK");
      return { success: false, reason: "error", message: "Customer not found" };
    }
    const balance = parseFloat(custRes.rows[0].balance);
    if (balance < finalPrice) {
      await client.query("ROLLBACK");
      return {
        success: false,
        reason: "insufficient_funds",
        shortfall: parseFloat((finalPrice - balance).toFixed(2)),
      };
    }

    const minCred = prod.min_credits ?? null;
    const acctSql = minCred != null
      ? `SELECT id, email, password FROM ${table} WHERE status = $1 AND credits >= $2 ORDER BY credits DESC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
      : `SELECT id, email, password FROM ${table} WHERE status = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const acctParams = minCred != null ? [prod.status_filter, minCred] : [prod.status_filter];
    const acctRes = await client.query(acctSql, acctParams);
    if (!acctRes.rows[0]) {
      await client.query("ROLLBACK");
      return { success: false, reason: "out_of_stock" };
    }

    const { id: accountId, email: accountEmail, password: accountPassword } = acctRes.rows[0];

    await client.query(
      `UPDATE shop_customers SET balance = balance - $1, total_spend = total_spend + $1 WHERE telegram_id = $2`,
      [finalPrice, uid]
    );

    await client.query(`UPDATE ${table} SET status = 'sold_out' WHERE id = $1`, [accountId]);

    const orderRes = await client.query(
      `INSERT INTO shop_orders
         (telegram_id, product_id, product_name, account_id, account_email, account_password, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [uid, productId, prod.name, accountId, accountEmail, accountPassword, finalPrice]
    );

    await client.query("COMMIT");

    // Count remaining stock after purchase
    const { sql: stockSql, params: stockParams } = stockCountSql(table, prod.status_filter, prod.min_credits ?? null);
    const stockRes = await dbQuery(stockSql, stockParams).catch(() => ({ rows: [{ cnt: "0" }] }));
    const stockRemaining = parseInt(stockRes.rows[0]?.cnt ?? "0");

    return {
      success: true,
      accountEmail,
      accountPassword,
      newBalance: balance - finalPrice,
      orderId: orderRes.rows[0].id,
      finalPrice,
      stockRemaining,
      productName: prod.name,
    };
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[ShopBot] Purchase transaction error:", err.message);
    return { success: false, reason: "error", message: err.message };
  } finally {
    client.release();
  }
}

// ── DB table setup ───────────────────────────────────────────────────────────
async function ensureShopTables() {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS shop_customers (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance NUMERIC(10,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shop_products (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      price NUMERIC(10,2) NOT NULL,
      account_type TEXT NOT NULL,
      status_filter TEXT NOT NULL DEFAULT 'available',
      min_credits INTEGER DEFAULT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS min_credits INTEGER DEFAULT NULL;
    CREATE TABLE IF NOT EXISTS shop_orders (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      telegram_id BIGINT NOT NULL,
      product_id VARCHAR NOT NULL,
      product_name TEXT NOT NULL,
      account_id VARCHAR,
      account_email TEXT,
      account_password TEXT,
      amount NUMERIC(10,2) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shop_activation_orders (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      telegram_id BIGINT NOT NULL,
      service TEXT NOT NULL,
      delivery_type TEXT NOT NULL DEFAULT 'activate',
      email TEXT,
      password TEXT,
      amount NUMERIC(10,2) NOT NULL DEFAULT 2.00,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("[ShopBot] Tables ready");
}

// ── Safe messaging helpers ───────────────────────────────────────────────────
async function safeReply(ctx: any, text: string, extra: any = {}) {
  try {
    return await ctx.reply(truncate(text), extra);
  } catch (e: any) {
    console.error("[ShopBot] safeReply failed:", e.message);
    return null;
  }
}

async function safeEdit(ctx: any, text: string, extra: any = {}) {
  try {
    return await ctx.editMessageText(truncate(text), extra);
  } catch {
    return safeReply(ctx, text, extra);
  }
}

// Edit a message that was previously sent (by message object reference)
async function editMsg(ctx: any, msg: any, text: string, extra: any = {}) {
  try {
    return await ctx.telegram.editMessageText(
      msg.chat.id,
      msg.message_id,
      undefined,
      truncate(text),
      extra
    );
  } catch {
    return safeReply(ctx, text, extra);
  }
}

// ── UI builders ──────────────────────────────────────────────────────────────
function divider(): string {
  return "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
}

function header(title: string, sub?: string): string {
  return sub
    ? `<b>${title}</b>\n<i>${escHtml(sub)}</i>`
    : `<b>${title}</b>`;
}

// Inner visible width for box cards (chars after "║  " prefix and before "  ║" suffix)
const BOX_INNER_WIDTH = 30;

function buildProductCard(p: ProductWithStock): string {
  const emoji   = platformEmoji(p.account_type);
  const rawName = p.name;
  // Clip to BOX_INNER_WIDTH (3 chars used by "emoji + 2 spaces")
  const name    = escHtml(boxClip(rawName, BOX_INNER_WIDTH - 3));
  const rawDesc = p.description ?? `${platformLabel(p.account_type)} · Instant delivery`;
  const desc    = escHtml(boxClip(rawDesc, BOX_INNER_WIDTH));
  const badge   = stockBadge(p.stock);
  return (
    `╔══════════════════════════════════════╗\n` +
    `║  ${emoji}  <b>${name}</b>  ║\n` +
    `║  <i>${desc}</i>  ║\n` +
    `║  💵 <b>${fmt$(p.price)}</b>  ·  ${badge}  ║\n` +
    `╚══════════════════════════════════════╝`
  );
}

function buildProductButtons(products: ProductWithStock[]) {
  return products.map((p) => {
    const emoji   = platformEmoji(p.account_type);
    const inStock = p.stock > 0;
    const icon    = inStock ? "⚡" : "🔴";
    const label   = `${icon}  ${p.name}  —  ${fmt$(p.price)}`;
    return [Markup.button.callback(label, `shop_product_${p.id}`)];
  });
}

// ── Main bot export ──────────────────────────────────────────────────────────
export function startShopBot(token: string) {
  if (!token) {
    console.warn("[ShopBot] No token provided — shop bot disabled");
    return;
  }

  const bot = new Telegraf(token);

  ensureShopTables().catch((err) => console.error("[ShopBot] Table init error:", err.message));

  bot.catch((err: any, ctx: any) => {
    console.error("[ShopBot] Unhandled error:", err?.message || err);
    try {
      ctx?.answerCbQuery?.("Something went wrong. Please try again.").catch(() => {});
    } catch {}
  });

  // ── /start ─────────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const uid     = ctx.from.id;
    const payload = ctx.startPayload ?? "";

    // Parse referral deep link: /start ref_<referrerId>
    let referredBy: number | undefined;
    if (payload.startsWith("ref_")) {
      const refId = parseInt(payload.slice(4));
      if (!isNaN(refId) && refId !== uid) referredBy = refId;
    }

    const isNew = await isNewCustomer(uid);
    bot.telegram.setChatMenuButton({
      chatId: ctx.chat.id,
      menuButton: { type: "commands" },
    }).catch(() => {});
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name, referredBy);

    // Credit referrer $0.50 when new user joins
    if (isNew && referredBy) {
      processReferralReward(uid, bot).catch(() => {});
    }

    const balance = await getBalance(uid);
    const name    = ctx.from.first_name || ctx.from.username || "User";
    const uname   = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";

    await ctx.reply(
      truncate(
        `╔══════════════════════════════════════╗\n` +
        `║  ${ae(ANIM_EMOJI.bolt, "⚡")}  <b>PROJECT ADDISON  v2</b>  ║\n` +
        `║  <i>Global AI Tools Marketplace</i>  ║\n` +
        `╚══════════════════════════════════════╝\n\n` +
        `👋 Welcome back, <b>${escHtml(name)}</b>!\n\n` +
        `<code>  💰 Balance   ›  ${fmt$(balance)}\n` +
        `  🔖 User      ›  ${uname}\n` +
        `  🆔 ID        ›  ${uid}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Use the menu below to get started.</i>`
      ),
      { parse_mode: "HTML", ...SHOP_KEYBOARD }
    );

    // Show product list right after welcome
    await showProductList(ctx);
  });

  bot.command("menu", async (ctx) => {
    const uid   = ctx.from.id;
    const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    // Dismiss any hidden keyboard first, then show fresh
    const dismiss = await ctx.reply("\u200B", { ...Markup.removeKeyboard() }).catch(() => null);
    if (dismiss) {
      await ctx.telegram.deleteMessage(ctx.chat.id, dismiss.message_id).catch(() => {});
    }
    await ctx.reply(
      truncate(
        `╔══════════════════════════════════════╗\n` +
        `║  ${ae(ANIM_EMOJI.bolt, "⚡")}  <b>PROJECT ADDISON  v2</b>  ║\n` +
        `║  <i>Global AI Tools Marketplace</i>  ║\n` +
        `╚══════════════════════════════════════╝\n\n` +
        `<code>  💰 Balance   ›  ${fmt$(balance)}\n` +
        `  🔖 User      ›  ${uname}\n` +
        `  🆔 ID        ›  ${uid}</code>\n\n` +
        `<i>Select an option from the menu below.</i>`
      ),
      { parse_mode: "HTML", ...SHOP_KEYBOARD }
    );
  });

  // ── Product list ──────────────────────────────────────────────────────────
  async function showProductList(ctx: any) {
    // Step 1: loading indicator
    const loader = await safeReply(
      ctx,
      `⏳ <i>Fetching live inventory…</i>`,
      { parse_mode: "HTML" }
    );

    // Step 2: fetch live data
    const products = await getProductsWithStock();

    if (products.length === 0) {
      if (loader) {
        await editMsg(ctx, loader,
          `${header("🛍 MARKETPLACE", "Project Addison v2")}\n\n` +
          `⚠️ <b>No products online right now.</b>\n` +
          `<i>Check back soon or contact support.</i>\n\n` +
          `→ ${escHtml(SUPPORT_CONTACT)}`,
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    const cards = products
      .map((p) => buildProductCard(p))
      .join(`\n\n${divider()}\n\n`);

    const count = products.length;
    const text =
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae(ANIM_EMOJI.bolt, "⚡")} <b>LIVE MARKETPLACE</b>  ║\n` +
      `║  <i>${count} product${count !== 1 ? "s" : ""}  ·  Instant delivery  ·  USD</i>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `${cards}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Tap a product below to view details and buy ↓</i>`;

    const keyboard = Markup.inlineKeyboard([
      ...buildProductButtons(products),
      [Markup.button.callback("🔄  Refresh", "shop_refresh_products")],
    ]);

    if (loader) {
      await editMsg(ctx, loader, text, { parse_mode: "HTML", ...keyboard });
    } else {
      await safeReply(ctx, text, { parse_mode: "HTML", ...keyboard });
    }
  }

  bot.hears(BTN.ACCOUNTS, async (ctx) => {
    await showProductList(ctx);
  });

  bot.action("shop_refresh_products", async (ctx) => {
    await ctx.answerCbQuery("Refreshing…").catch(() => {});
    const products = await getProductsWithStock();
    if (products.length === 0) {
      return safeEdit(ctx,
        `${header("🛍 MARKETPLACE")}\n\n⚠️ No products available right now.\n→ ${escHtml(SUPPORT_CONTACT)}`,
        { parse_mode: "HTML" }
      );
    }
    const cards = products.map((p) => buildProductCard(p)).join(`\n\n${divider()}\n\n`);
    const cnt   = products.length;
    const text  =
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae(ANIM_EMOJI.bolt, "⚡")} <b>LIVE MARKETPLACE</b>  ║\n` +
      `║  <i>${cnt} product${cnt !== 1 ? "s" : ""}  ·  Instant delivery  ·  USD</i>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `${cards}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Tap a product below to view details and buy ↓</i>`;
    await safeEdit(ctx, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        ...buildProductButtons(products),
        [Markup.button.callback("🔄  Refresh", "shop_refresh_products")],
      ]),
    });
  });

  // ── Product detail ────────────────────────────────────────────────────────
  bot.action(/^shop_product_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    getState(ctx.from.id).selectedProductId = productId;

    // Show loading state immediately
    await safeEdit(ctx,
      `⏳ <i>Loading product details…</i>`,
      { parse_mode: "HTML" }
    );

    const prod = await getProductById(productId);
    if (!prod || !prod.active) {
      return safeEdit(ctx,
        `${header("⚠️ UNAVAILABLE")}\n\nThis product is no longer available.\n\n→ <b>Back to shop:</b> tap the button below.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
        }
      );
    }

    const emoji    = platformEmoji(prod.account_type);
    const plat     = platformLabel(prod.account_type);
    const inStock  = prod.stock > 0;
    const desc     = prod.description
      ? `\n<i>${escHtml(prod.description)}</i>\n`
      : "";

    const text =
      `${emoji} <b>${escHtml(prod.name)}</b>${desc}\n\n` +
      `${divider()}\n\n` +
      `💵 <b>${fmt$(prod.price)}</b> per account\n` +
      `📦 Platform: ${plat}\n` +
      `📊 Stock: ${stockBadge(prod.stock)}\n` +
      `⚡ Delivery: Instant\n\n` +
      `${divider()}\n\n` +
      (inStock
        ? `✅ <b>Ready to buy.</b> Account delivered immediately after payment.`
        : `❌ <b>Out of stock.</b> Check back soon.`
      );

    const subsRes = await dbQuery(
      `SELECT 1 FROM shop_restock_subs WHERE telegram_id = $1 AND product_id = $2`,
      [ctx.from.id, productId]
    );
    const alreadySubscribed = subsRes.rows.length > 0;

    const buttons = [
      ...(inStock
        ? [[Markup.button.callback(`✅  Buy Now  —  ${fmt$(prod.price)}`, `shop_buy_${productId}`)]]
        : alreadySubscribed
          ? [[Markup.button.callback("🔔  Notify Me (subscribed)", `notify_already_${productId}`)]]
          : [[Markup.button.callback("🔔  Notify Me When Back in Stock", `notify_me_${productId}`)]]
      ),
      [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
    ];

    await safeEdit(ctx, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // ── Back to product list ──────────────────────────────────────────────────
  bot.action("shop_back_products", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});

    await safeEdit(ctx, `⏳ <i>Loading inventory…</i>`, { parse_mode: "HTML" });

    const products = await getProductsWithStock();
    if (products.length === 0) {
      return safeEdit(ctx,
        `${header("🛍 MARKETPLACE")}\n\n⚠️ No products available right now.\n→ ${escHtml(SUPPORT_CONTACT)}`,
        { parse_mode: "HTML" }
      );
    }
    const cards = products.map((p) => buildProductCard(p)).join(`\n\n${divider()}\n\n`);
    const cnt   = products.length;
    const text  =
      `⚡ <b>LIVE MARKETPLACE</b>\n` +
      `<i>${cnt} product${cnt !== 1 ? "s" : ""} available  ·  Instant delivery  ·  Prices in USD</i>\n\n` +
      `${divider()}\n\n` +
      `${cards}\n\n` +
      `${divider()}\n` +
      `<i>Tap a product below to view details and buy ↓</i>`;

    await safeEdit(ctx, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        ...buildProductButtons(products),
        [Markup.button.callback("🔄  Refresh", "shop_refresh_products")],
      ]),
    });
  });

  // ── Notify Me (restock subscription) ─────────────────────────────────────
  bot.action(/^notify_me_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid       = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];
    await dbQuery(
      `INSERT INTO shop_restock_subs (telegram_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [uid, productId]
    );
    return ctx.answerCbQuery("🔔 You'll be notified when this is back in stock!", { show_alert: true });
  });

  bot.action(/^notify_already_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("🔔 Already subscribed — we'll ping you when it restocks!", { show_alert: true });
  });

  // ── Buy flow ──────────────────────────────────────────────────────────────
  bot.action(/^shop_buy_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Processing…").catch(() => {});
    const uid       = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];

    await safeEdit(ctx, `⚙️ <i>Checking availability…</i>`, { parse_mode: "HTML" });
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);

    // ── Channel membership gate ───────────────────────────────────────────────
    const memberStatus = await isChannelMember(bot, uid);
    if (memberStatus === "not_member") {
      return safeEdit(ctx,
        `🔒 <b>Channel Access Required</b>\n\n` +
        `${divider()}\n\n` +
        `To purchase from our shop, you must be a member of our official channel.\n\n` +
        `1️⃣  Join the channel below\n` +
        `2️⃣  Come back and tap <b>✅ I've Joined</b> to verify\n\n` +
        `<i>Membership is free and gives you access to deals, restocks, and announcements.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.url("📢  Join @projectaddison", CHANNEL_URL)],
            [Markup.button.callback("✅  I've Joined — Verify", `shop_verify_${productId}`)],
            [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
          ]),
        }
      );
    }

    const prod = await getProductById(productId);
    if (!prod || !prod.active) {
      return safeEdit(ctx,
        `${header("⚠️ UNAVAILABLE")}\n\nThis product is no longer available.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
        }
      );
    }

    const balance = await getBalance(uid);
    const price   = parseFloat(prod.price);

    if (balance < price) {
      const shortfall = (price - balance).toFixed(2);
      return safeEdit(ctx,
        `💳 <b>Insufficient Funds</b>\n\n` +
        `${divider()}\n\n` +
        `📦 ${escHtml(prod.name)}\n` +
        `💵 Required: <b>${fmt$(price)}</b>  ·  Your balance: <b>${fmt$(balance)}</b>\n` +
        `⚠️ You need <b>$${shortfall}</b> more\n\n` +
        `${divider()}\n\n` +
        `To top up, contact ${escHtml(SUPPORT_CONTACT)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("➕  Deposit Info", "shop_deposit_info")],
            [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
          ]),
        }
      );
    }

    if (prod.stock === 0) {
      return safeEdit(ctx,
        `${header("❌ OUT OF STOCK")}\n\n` +
        `<b>${escHtml(prod.name)}</b> just sold out.\n` +
        `<i>Check back soon — stock is updated frequently.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
        }
      );
    }

    // ── Confirmation screen ───────────────────────────────────────────────────
    const emoji = platformEmoji(prod.account_type);
    buyFlows.set(uid, { productId, step: "confirm" });
    return safeEdit(ctx,
      `${emoji} <b>Confirm Purchase</b>\n\n` +
      `${divider()}\n\n` +
      `📦 <b>${escHtml(prod.name)}</b>\n` +
      `💵 Price: <b>${fmt$(price)}</b>\n` +
      `💰 Balance after: <b>${fmt$(balance - price)}</b>\n\n` +
      `${divider()}\n` +
      `<i>Have a promo code? Apply it for a discount!</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅  Confirm Purchase  —  ${fmt$(price)}`, `buyconfirm_${productId}`)],
          [Markup.button.callback("🏷️  Apply Promo Code", `buypromo_${productId}`)],
          [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
        ]),
      }
    );
  });

  // ── Promo code entry ──────────────────────────────────────────────────────
  bot.action(/^buypromo_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid       = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];
    buyFlows.set(uid, { productId, step: "promo" });
    return safeEdit(ctx,
      `🏷️ <b>Apply Promo Code</b>\n\n` +
      `${divider()}\n\n` +
      `Type and send your <b>promo code</b> below:\n\n` +
      `<i>Codes are not case-sensitive.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", `buycancel_${productId}`)]]),
      }
    );
  });

  bot.action(/^buycancel_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid       = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];
    buyFlows.delete(uid);
    return safeEdit(ctx, `❌ <i>Cancelled.</i>`, { parse_mode: "HTML" });
  });

  // ── Confirm purchase ──────────────────────────────────────────────────────
  bot.action(/^buyconfirm_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Processing…").catch(() => {});
    const uid       = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];
    const flow      = buyFlows.get(uid);
    const discount  = flow?.discountAmt ?? 0;
    const promoCode = flow?.promoCode;
    buyFlows.delete(uid);

    await safeEdit(ctx, `⚙️ <i>Processing payment…</i>`, { parse_mode: "HTML" });

    const prod = await getProductById(productId);
    if (!prod || !prod.active) {
      return safeEdit(ctx, `⚠️ <b>Product no longer available.</b>`, { parse_mode: "HTML" });
    }

    const result = await purchaseProduct(uid, productId, discount);

    if (!result.success) {
      if (result.reason === "insufficient_funds") {
        return safeEdit(ctx,
          `💳 <b>Insufficient Funds</b>\n\n` +
          `Need <b>$${(result.shortfall ?? 0).toFixed(2)}</b> more.\n\n→ Contact ${escHtml(SUPPORT_CONTACT)} to top up`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]) }
        );
      }
      if (result.reason === "out_of_stock") {
        return safeEdit(ctx,
          `❌ <b>Just sold out.</b>\n<i>Check back soon.</i>`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]) }
        );
      }
      return safeEdit(ctx,
        `⚠️ <b>Purchase Failed.</b> Balance not charged.\n→ ${escHtml(SUPPORT_CONTACT)}`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]) }
      );
    }

    // ── Post-purchase tasks ───────────────────────────────────────────────────
    checkAndUpdateVip(uid).catch(() => {});
    if (result.stockRemaining <= 3) {
      alertAdminLowStock(result.productName, result.stockRemaining);
      if (result.stockRemaining === 0) {
        notifyRestockSubscribers(bot, productId, result.productName).catch(() => {});
      }
    }
    sendRatingRequest(bot, uid, result.orderId, result.productName);

    const discountLine = discount > 0
      ? `🏷️ Promo <b>${escHtml(promoCode ?? "")}</b>: <b>-${fmt$(discount)}</b>\n`
      : "";

    const pEmoji = platformEmoji(prod.account_type);
    await safeEdit(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae(ANIM_EMOJI.check, "✅")}  <b>PURCHASE SUCCESSFUL!</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `${pEmoji} <b>${escHtml(prod.name)}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📧 <b>Email</b>\n<code>${escHtml(result.accountEmail)}</code>\n\n` +
      `🔑 <b>Password</b>\n<code>${escHtml(result.accountPassword)}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `${discountLine}` +
      `💵 Paid: <b>${fmt$(result.finalPrice)}</b>\n` +
      `💰 New balance: <b>${fmt$(result.newBalance)}</b>\n` +
      `<i>Credentials saved — access anytime in My Orders.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📦  My Orders", "shop_view_orders")],
          [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
        ]),
      }
    );
  });

  // ── Channel verify — triggered after user joins @projectaddison ──────────
  bot.action(/^shop_verify_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Checking membership…").catch(() => {});
    const uid       = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];

    const memberStatus = await isChannelMember(bot, uid);
    if (memberStatus === "not_member") {
      return safeEdit(ctx,
        `🔒 <b>Not Verified Yet</b>\n\n` +
        `${divider()}\n\n` +
        `We couldn't confirm your membership in ${REQUIRED_CHANNEL}.\n\n` +
        `Make sure you've joined the channel, then tap <b>✅ I've Joined</b> again.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.url("📢  Join @projectaddison", CHANNEL_URL)],
            [Markup.button.callback("✅  I've Joined — Verify", `shop_verify_${productId}`)],
            [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
          ]),
        }
      );
    }
    // "member" or "bot_not_admin" → proceed

    // Member confirmed — proceed with purchase
    await safeEdit(ctx,
      `✅ <b>Membership Verified!</b>\n\n` +
      `<i>Processing your purchase…</i>`,
      { parse_mode: "HTML" }
    );

    const prod = await getProductById(productId);
    if (!prod || !prod.active) {
      return safeEdit(ctx,
        `⚠️ <b>Product Unavailable</b>\n\nThis product is no longer available.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
        }
      );
    }

    const balance = await getBalance(uid);
    const price   = parseFloat(prod.price);
    if (balance < price) {
      const shortfall = (price - balance).toFixed(2);
      return safeEdit(ctx,
        `💳 <b>Insufficient Funds</b>\n\n` +
        `${divider()}\n\n` +
        `📦 ${escHtml(prod.name)}\n` +
        `💵 Required: <b>${fmt$(price)}</b>  ·  Your balance: <b>${fmt$(balance)}</b>\n` +
        `⚠️ You need <b>$${shortfall}</b> more\n\n` +
        `${divider()}\n\n` +
        `To top up, contact ${escHtml(SUPPORT_CONTACT)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("➕  Deposit Info", "shop_deposit_info")],
            [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
          ]),
        }
      );
    }

    if (prod.stock === 0) {
      return safeEdit(ctx,
        `❌ <b>Out of Stock</b>\n\n<b>${escHtml(prod.name)}</b> just sold out.\n<i>Check back soon.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
        }
      );
    }

    const result = await purchaseProduct(uid, productId);
    if (!result.success) {
      return safeEdit(ctx,
        `⚠️ <b>Purchase Failed</b>\n\nSomething went wrong. Your balance was not charged.\n\n→ Contact ${escHtml(SUPPORT_CONTACT)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
        }
      );
    }

    checkAndUpdateVip(uid).catch(() => {});
    if (result.stockRemaining <= 3) {
      alertAdminLowStock(result.productName, result.stockRemaining);
      if (result.stockRemaining === 0) notifyRestockSubscribers(bot, productId, result.productName).catch(() => {});
    }
    sendRatingRequest(bot, uid, result.orderId, result.productName);

    const pEmoji = platformEmoji(prod.account_type ?? "");
    await safeEdit(ctx,
      `🎉 <b>Purchase Successful!</b>\n\n` +
      `${pEmoji} <b>${escHtml(prod.name)}</b>\n\n` +
      `${divider()}\n\n` +
      `📧 <b>Email</b>\n<code>${escHtml(result.accountEmail)}</code>\n\n` +
      `🔑 <b>Password</b>\n<code>${escHtml(result.accountPassword)}</code>\n\n` +
      `${divider()}\n\n` +
      `💰 New balance: <b>${fmt$(result.newBalance)}</b>\n` +
      `<i>Save these credentials safely. For issues, contact ${escHtml(SUPPORT_CONTACT)}</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("📦  My Orders", "shop_view_orders")]]),
      }
    );
  });

  // ── Deposit info (inline) ─────────────────────────────────────────────────
  bot.action("shop_deposit_info", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    await safeEdit(ctx, depositText(uid), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🟡  Copy Binance ID", "dep_copy_binance"), Markup.button.callback("💎  TRC20", "dep_copy_trc20")],
        [Markup.button.callback("🔷  BEP20",          "dep_copy_bep20"),  Markup.button.callback("🇮🇳  UPI",  "dep_copy_upi")],
        [Markup.button.callback("📸  Submit Payment Proof", "dep_submit_proof")],
        [Markup.button.callback("◀  Back to Shop",          "shop_back_products")],
      ]),
    });
  });

  bot.action("dep_copy_binance", async (ctx) => {
    await ctx.answerCbQuery("🟡 Binance ID → 510120124", { show_alert: true });
  });
  bot.action("dep_copy_trc20", async (ctx) => {
    await ctx.answerCbQuery("💎 TRC20 → TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB", { show_alert: true });
  });
  bot.action("dep_copy_bep20", async (ctx) => {
    await ctx.answerCbQuery("🔷 BEP20 → 0x107fc554bba4cadd5c4e9f1e189d7dd93770202e", { show_alert: true });
  });
  bot.action("dep_copy_upi", async (ctx) => {
    await ctx.answerCbQuery("🇮🇳 UPI → avinashaddison-8@okaxis", { show_alert: true });
  });

  // ── Activation Service — keyboard button handlers ─────────────────────────
  async function showActivationMenu(ctx: any, service: ActivationService) {
    const emoji = ACTIVATION_EMOJI[service];
    const name  = ACTIVATION_LABEL[service];
    const price = ACTIVATION_PRICE.toFixed(2);

    // Feature lines differ per service
    const features: Record<ActivationService, string[]> = {
      chatgpt_plus: [
        "Access to GPT-4o, DALL·E & Plugins",
        "Works on any existing account",
        "Or receive a brand-new account",
        "Zero setup · Instant activation",
      ],
      replit_core: [
        "Full Replit Core subscription",
        "Unlimited AI tokens & compute",
        "Works on any existing account",
        "Zero setup · Instant activation",
      ],
    };
    const featureBlock = features[service]
      .map(f => `  ◈  ${f}`)
      .join("\n");

    await safeReply(ctx,
      `${emoji}  <b>${name}</b>\n` +
      `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n` +
      `<code>${featureBlock}</code>\n\n` +
      `<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n` +
      `💵  <b>$${price}</b>  ·  ⚡ Instant  ·  both options\n\n` +
      `<blockquote>🔑  <b>Activate at my Mail</b>\nShare your login once — we upgrade your account to ${name}. Your password never leaves your device.</blockquote>\n\n` +
      `<blockquote>📦  <b>Get a Sent Account</b>\nReceive a brand-new ${name} account — full email + password — delivered straight to this chat.</blockquote>\n\n` +
      `<i>Tap an option below to continue  →</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🔑  Activate at my Mail`, `act_mine_${service}`)],
          [Markup.button.callback(`📦  Get a Sent Account`, `act_send_${service}`)],
          [Markup.button.callback(`◀  Back to Menu`, `act_back`)],
        ]),
      }
    );
  }

  bot.hears(BTN.CHATGPT_PLUS, async (ctx) => {
    await upsertCustomer(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await showActivationMenu(ctx, "chatgpt_plus");
  });

  bot.hears(BTN.REPLIT_CORE, async (ctx) => {
    await upsertCustomer(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await showActivationMenu(ctx, "replit_core");
  });

  bot.action("act_back", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await safeEdit(ctx, `<i>Use the menu below to navigate.</i>`, { parse_mode: "HTML" });
  });

  // ── "Activate at my Mail" → collect email ─────────────────────────────────
  bot.action(/^act_mine_(chatgpt_plus|replit_core)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid     = ctx.from.id;
    const service = (ctx.match as RegExpExecArray)[1] as ActivationService;
    const emoji   = ACTIVATION_EMOJI[service];
    const name    = ACTIVATION_LABEL[service];

    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    if (balance < ACTIVATION_PRICE) {
      const shortfall = (ACTIVATION_PRICE - balance).toFixed(2);
      return safeEdit(ctx,
        `💳 <b>Insufficient Funds</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${emoji} <b>${name} Activation</b>\n` +
        `💵 Required: <b>$${ACTIVATION_PRICE.toFixed(2)}</b>  ·  Balance: <b>${fmt$(balance)}</b>\n` +
        `⚠️ Need <b>$${shortfall}</b> more to proceed`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("➕  Deposit Info", "shop_deposit_info")],
            [Markup.button.callback("◀  Back", "act_back")],
          ]),
        }
      );
    }

    activationFlows.set(uid, { service, step: "waiting_email" });

    await safeEdit(ctx,
      `${emoji} <b>${name} — Activate at my Mail</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📧 <b>Step 1 of 2 — Email</b>\n\n` +
      `Please type and send your <b>${name} account email</b>:\n\n` +
      `<i>Example: yourname@gmail.com</i>`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", `act_cancel`)]]) }
    );
  });

  // ── "Send Account by your side" → balance check → payment ────────────────
  bot.action(/^act_send_(chatgpt_plus|replit_core)$/, async (ctx) => {
    await ctx.answerCbQuery("Processing…").catch(() => {});
    const uid     = ctx.from.id;
    const service = (ctx.match as RegExpExecArray)[1] as ActivationService;
    const emoji   = ACTIVATION_EMOJI[service];
    const name    = ACTIVATION_LABEL[service];

    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);

    const memberStatus = await isChannelMember(bot, uid);
    if (memberStatus === "not_member") {
      return safeEdit(ctx,
        `🔒 <b>Channel Access Required</b>\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Join our channel to purchase services.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.url("📢  Join @projectaddison", CHANNEL_URL)],
            [Markup.button.callback("✅  I've Joined — Verify", `actsend_verify_${service}`)],
          ]),
        }
      );
    }

    const balance = await getBalance(uid);
    if (balance < ACTIVATION_PRICE) {
      const shortfall = (ACTIVATION_PRICE - balance).toFixed(2);
      return safeEdit(ctx,
        `💳 <b>Insufficient Funds</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${emoji} <b>${name} Account</b>\n` +
        `💵 Required: <b>$${ACTIVATION_PRICE.toFixed(2)}</b>  ·  Balance: <b>${fmt$(balance)}</b>\n` +
        `⚠️ Need <b>$${shortfall}</b> more`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("➕  Deposit Info", "shop_deposit_info")],
            [Markup.button.callback("◀  Back", `act_back`)],
          ]),
        }
      );
    }

    return safeEdit(ctx,
      `${emoji} <b>${name} — Send Account</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 We will deliver a ready-made <b>${name}</b> account to you.\n\n` +
      `💵 Cost: <b>$${ACTIVATION_PRICE.toFixed(2)}</b>\n` +
      `💰 Your balance: <b>${fmt$(balance)}</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Tap Confirm to pay and place your order.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅  Confirm — Pay $${ACTIVATION_PRICE.toFixed(2)}`, `actsend_pay_${service}`)],
          [Markup.button.callback("❌  Cancel", `act_back`)],
        ]),
      }
    );
  });

  // ── Send Account — payment ────────────────────────────────────────────────
  bot.action(/^actsend_pay_(chatgpt_plus|replit_core)$/, async (ctx) => {
    await ctx.answerCbQuery("Charging…").catch(() => {});
    const uid     = ctx.from.id;
    const service = (ctx.match as RegExpExecArray)[1] as ActivationService;
    const emoji   = ACTIVATION_EMOJI[service];
    const name    = ACTIVATION_LABEL[service];

    const client = await pool.connect();
    let newBalance = 0;
    try {
      await client.query("BEGIN");
      const r = await client.query(`SELECT balance FROM shop_customers WHERE telegram_id = $1 FOR UPDATE`, [uid]);
      const bal = parseFloat(r.rows[0]?.balance ?? "0");
      if (bal < ACTIVATION_PRICE) {
        await client.query("ROLLBACK");
        return safeEdit(ctx, `💳 <b>Insufficient Funds</b>`, { parse_mode: "HTML" });
      }
      await client.query(`UPDATE shop_customers SET balance = balance - $1 WHERE telegram_id = $2`, [ACTIVATION_PRICE, uid]);
      newBalance = bal - ACTIVATION_PRICE;
      await client.query(
        `INSERT INTO shop_activation_orders (telegram_id, service, delivery_type, amount) VALUES ($1, $2, 'send_account', $3)`,
        [uid, service, ACTIVATION_PRICE]
      );
      await client.query("COMMIT");
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[ShopBot] actsend_pay error:", err.message);
      return safeEdit(ctx, `⚠️ <b>Payment Failed</b>\n\nYour balance was not charged.`, { parse_mode: "HTML" });
    } finally {
      client.release();
    }

    await safeEdit(ctx,
      `${emoji} <b>${name} Account — Order Placed!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ <b>Payment confirmed</b> · $${ACTIVATION_PRICE.toFixed(2)} charged\n\n` +
      `📦 Your <b>${name}</b> account will be delivered shortly.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 New balance: <b>${fmt$(newBalance)}</b>\n` +
      `💬 For status: ${escHtml(SUPPORT_CONTACT)}\n` +
      `🪪 Your ID: <code>${uid}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("📦  My Orders", "shop_view_orders")]]),
      }
    );
  });

  // ── Send Account — verify after channel join ──────────────────────────────
  bot.action(/^actsend_verify_(chatgpt_plus|replit_core)$/, async (ctx) => {
    await ctx.answerCbQuery("Checking…").catch(() => {});
    const uid     = ctx.from.id;
    const service = (ctx.match as RegExpExecArray)[1] as ActivationService;
    const ms      = await isChannelMember(bot, uid);
    if (ms === "not_member") {
      return ctx.answerCbQuery("🔒 Still not a member — please join first", { show_alert: true });
    }
    // Redirect to payment confirmation
    const balance = await getBalance(uid);
    const emoji   = ACTIVATION_EMOJI[service];
    const name    = ACTIVATION_LABEL[service];
    return safeEdit(ctx,
      `${emoji} <b>${name} — Send Account</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✅ Membership verified!\n\n` +
      `💵 Cost: <b>$${ACTIVATION_PRICE.toFixed(2)}</b>  ·  Balance: <b>${fmt$(balance)}</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅  Confirm — Pay $${ACTIVATION_PRICE.toFixed(2)}`, `actsend_pay_${service}`)],
          [Markup.button.callback("❌  Cancel", "act_back")],
        ]),
      }
    );
  });

  // ── Cancel activation ─────────────────────────────────────────────────────
  bot.action("act_cancel", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    activationFlows.delete(uid);
    await safeEdit(ctx, `❌ <b>Cancelled.</b>\n\n<i>Use the menu below to navigate.</i>`, { parse_mode: "HTML" });
  });

  // ── Confirm activation payment ────────────────────────────────────────────
  bot.action(/^act_pay_(chatgpt_plus|replit_core)$/, async (ctx) => {
    await ctx.answerCbQuery("Charging…").catch(() => {});
    const uid     = ctx.from.id;
    const service = (ctx.match as RegExpExecArray)[1] as ActivationService;
    const flow    = activationFlows.get(uid);
    if (!flow || !flow.email || !flow.password) {
      return safeEdit(ctx, `⚠️ Session expired. Please start again.`, { parse_mode: "HTML" });
    }
    const { email, password } = flow;

    const client = await pool.connect();
    let newBalance = 0;
    try {
      await client.query("BEGIN");
      const r = await client.query(`SELECT balance FROM shop_customers WHERE telegram_id = $1 FOR UPDATE`, [uid]);
      const bal = parseFloat(r.rows[0]?.balance ?? "0");
      if (bal < ACTIVATION_PRICE) {
        await client.query("ROLLBACK");
        activationFlows.delete(uid);
        return safeEdit(ctx,
          `💳 <b>Insufficient Funds</b>\n\nBalance: <b>${fmt$(bal)}</b>  ·  Required: <b>$${ACTIVATION_PRICE.toFixed(2)}</b>`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("➕  Deposit Info", "shop_deposit_info")]]),
          }
        );
      }
      await client.query(`UPDATE shop_customers SET balance = balance - $1 WHERE telegram_id = $2`, [ACTIVATION_PRICE, uid]);
      newBalance = bal - ACTIVATION_PRICE;
      await client.query(
        `INSERT INTO shop_activation_orders (telegram_id, service, delivery_type, email, password, amount) VALUES ($1, $2, 'activate', $3, $4, $5)`,
        [uid, service, email, password, ACTIVATION_PRICE]
      );
      await client.query("COMMIT");
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[ShopBot] act_pay error:", err.message);
      activationFlows.delete(uid);
      return safeEdit(ctx, `⚠️ <b>Payment Failed</b>\n\nYour balance was not charged.`, { parse_mode: "HTML" });
    } finally {
      client.release();
    }

    activationFlows.delete(uid);

    // Grab identifiers for the waiting message
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
    const msgId  = ctx.callbackQuery?.message?.message_id;

    const orderId = String(Date.now()) + "_" + uid;
    const emoji   = ACTIVATION_EMOJI[service];
    const name    = ACTIVATION_LABEL[service];

    // Show "waiting for admin" message
    const waitingText =
      `${emoji} <b>${name} — Order Placed!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📧 <code>${escHtml(email)}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `⏳ <b>Your order is being processed…</b>\n` +
      `Our team has been notified and will begin activation shortly.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 Balance: <b>${fmt$(newBalance)}</b>\n` +
      `💬 Support: @avinashaddison`;
    await safeEdit(ctx, waitingText, { parse_mode: "HTML" });

    // Save pending activation so admin bot can start countdown when approved
    if (chatId && msgId) {
      pendingActivations.set(orderId, { orderId, userId: uid, chatId, msgId, service, email, newBalance });
    }

    // Notify admin bot users
    const adminToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminIds   = (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (adminToken && adminIds.length > 0) {
      const notifText =
        `📦 <b>NEW ACTIVATION ORDER</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${emoji} <b>Service:</b> ${name}\n` +
        `📧 <b>Email:</b> <code>${escHtml(email)}</code>\n` +
        `🔑 <b>Password:</b> <code>${escHtml(password)}</code>\n` +
        `👤 <b>User ID:</b> <code>${uid}</code>\n` +
        `🆔 <b>Order ID:</b> <code>${orderId}</code>\n\n` +
        `Tap <b>Approve</b> to start activation and set completion time.`;
      const keyboard = { inline_keyboard: [[{ text: "✅  Approve + Set Time", callback_data: `approve_act_${orderId}` }]] };
      for (const adminId of adminIds) {
        await fetch(`https://api.telegram.org/bot${adminToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: adminId, text: notifText, parse_mode: "HTML", reply_markup: keyboard }),
        }).catch((e) => console.error("[ShopBot] admin notify error:", e.message));
      }
    }
  });

  // ── Rating handler ────────────────────────────────────────────────────────
  bot.action(/^rate_([^_]+)_([1-5])$/, async (ctx) => {
    await ctx.answerCbQuery("Thank you for your rating!").catch(() => {});
    const uid     = ctx.from.id;
    const orderId = (ctx.match as RegExpExecArray)[1];
    const rating  = parseInt((ctx.match as RegExpExecArray)[2]);
    await dbQuery(
      `INSERT INTO shop_order_ratings (order_id, telegram_id, rating) VALUES ($1, $2, $3) ON CONFLICT (order_id) DO UPDATE SET rating = $3`,
      [orderId, uid, rating]
    ).catch(() => {});
    const stars = "⭐".repeat(rating) + "☆".repeat(5 - rating);
    await safeEdit(ctx,
      `${stars}\n\n<b>Thanks for rating!</b>\n<i>Your feedback helps us improve.</i>`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  });

  // ── Text message handler — collect email / password for activation ─────────
  bot.on("text", async (ctx: any, next: any) => {
    const uid  = ctx.from?.id;
    if (!uid) return next();

    // ── Buy promo code flow ───────────────────────────────────────────────────
    const buyFlow = buyFlows.get(uid);
    if (buyFlow && buyFlow.step === "promo") {
      const code = ctx.message.text?.trim() ?? "";
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
      const prod = await getProductById(buyFlow.productId);
      if (!prod) {
        buyFlows.delete(uid);
        return safeReply(ctx, `⚠️ Product not found. Please start again.`, { parse_mode: "HTML" });
      }
      const validResult = await validatePromoCode(code, parseFloat(prod.price));
      if (!validResult.valid) {
        return safeReply(ctx,
          `🚫 <b>Invalid Code</b>\n\n${escHtml(validResult.reason)}\n\n<i>Type another code or tap Cancel.</i>`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", `buycancel_${buyFlow.productId}`)]]),
          }
        );
      }
      const finalPrice = Math.max(0, parseFloat(prod.price) - validResult.discountAmt);
      buyFlows.set(uid, { ...buyFlow, step: "confirm", promoCode: code.toUpperCase(), discountAmt: validResult.discountAmt });
      // Use the promo code count immediately (decrement uses)
      usePromoCode(validResult.codeId).catch(() => {});
      return safeReply(ctx,
        `🏷️ <b>Promo Code Applied!</b>\n\n` +
        `${divider()}\n\n` +
        `Code: <b>${escHtml(code.toUpperCase())}</b>\n` +
        `Discount: <b>-${fmt$(validResult.discountAmt)}</b>\n` +
        `Original: <s>${fmt$(parseFloat(prod.price))}</s>\n` +
        `New price: <b>${fmt$(finalPrice)}</b>\n\n` +
        `${divider()}\n` +
        `<i>Tap Confirm to complete your purchase.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`✅  Confirm  —  ${fmt$(finalPrice)}`, `buyconfirm_${buyFlow.productId}`)],
            [Markup.button.callback("❌  Cancel", `buycancel_${buyFlow.productId}`)],
          ]),
        }
      );
    }

    const flow = activationFlows.get(uid);
    if (!flow) return next(); // not in activation flow — let hears handlers run

    const text = ctx.message.text?.trim() ?? "";

    // Delete user's message (contains sensitive data)
    await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});

    if (flow.step === "waiting_email") {
      if (!text.includes("@")) {
        const msg = await safeReply(ctx,
          `⚠️ That doesn't look like a valid email. Please send your email address again:`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", "act_cancel")]]),
          }
        );
        return;
      }
      flow.email = text;
      flow.step  = "waiting_password";
      activationFlows.set(uid, flow);

      const emoji = ACTIVATION_EMOJI[flow.service];
      const name  = ACTIVATION_LABEL[flow.service];
      await safeReply(ctx,
        `${emoji} <b>${name} — Activate at my Mail</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ Email received.\n\n` +
        `🔑 <b>Step 2 of 2 — Password</b>\n\n` +
        `Please send your <b>${name} account password</b>:\n\n` +
        `<i>It will be deleted immediately after reading.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", "act_cancel")]]),
        }
      );
      return;
    }

    if (flow.step === "waiting_password") {
      flow.password = text;
      flow.step     = "confirm";
      activationFlows.set(uid, flow);

      const emoji   = ACTIVATION_EMOJI[flow.service];
      const name    = ACTIVATION_LABEL[flow.service];
      const balance = await getBalance(uid);

      await safeReply(ctx,
        `${emoji} <b>${name} — Confirm Activation</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📧 Email:    <code>${escHtml(flow.email!)}</code>\n` +
        `🔑 Password: <code>${escHtml(flow.password)}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `💵 Cost:    <b>$${ACTIVATION_PRICE.toFixed(2)}</b>\n` +
        `💰 Balance: <b>${fmt$(balance)}</b>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Tap Pay to start activation. Your credentials are only used to apply the upgrade.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`✅  Pay $${ACTIVATION_PRICE.toFixed(2)} — Activate Now`, `act_pay_${flow.service}`)],
            [Markup.button.callback("❌  Cancel", "act_cancel")],
          ]),
        }
      );
    }
  });

  // ── My Balance ────────────────────────────────────────────────────────────
  bot.hears(BTN.BALANCE, async (ctx) => {
    const uid = ctx.from.id;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const r = await dbQuery(`SELECT balance, vip, total_spend FROM shop_customers WHERE telegram_id = $1`, [uid]);
    const row     = r.rows[0];
    const balance = parseFloat(row?.balance ?? "0");
    const vip     = row?.vip ?? false;
    const spend   = parseFloat(row?.total_spend ?? "0");
    const statusLine = vip
      ? `${ae(ANIM_EMOJI.crown, "👑")} <b>VIP Member</b>`
      : `🎯 VIP at <b>${fmt$(VIP_THRESHOLD)}</b> total spend  <i>(${fmt$(spend)} so far)</i>`;
    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae(ANIM_EMOJI.money, "💰")}  <b>MY WALLET</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `<code>  💵 Balance    ›  ${fmt$(balance)}\n` +
      `  🆔 User ID    ›  ${uid}</code>\n\n` +
      `${statusLine}\n\n` +
      `<i>Tap below to add funds to your wallet.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("💳  Add Funds", "shop_deposit_info")]]),
      }
    );
  });

  // ── Deposit ───────────────────────────────────────────────────────────────
  function depositText(uid: number): string {
    return (
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae(ANIM_EMOJI.card, "💳")}  <b>ADD FUNDS</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `🟡  <b>Binance ID</b>\n<code>510120124</code>\n\n` +
      `${divider()}\n\n` +
      `💎  <b>USDT TRC20</b>\n<code>TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB</code>\n\n` +
      `${divider()}\n\n` +
      `🔷  <b>USDT BEP20</b>\n<code>0x107fc554bba4cadd5c4e9f1e189d7dd93770202e</code>\n\n` +
      `${divider()}\n\n` +
      `🇮🇳  <b>UPI (India)</b>\n<code>avinashaddison-8@okaxis</code>\n\n` +
      `${divider()}\n\n` +
      `🪪  Your ID: <code>${uid}</code>\n` +
      `⚡  Minimum deposit: <b>$1.00</b>\n\n` +
      `<i>After paying, tap <b>📸 Submit Payment Proof</b> to send your screenshot for fast confirmation.</i>`
    );
  }

  bot.hears(BTN.DEPOSIT, async (ctx) => {
    const uid = ctx.from.id;
    await safeReply(ctx, depositText(uid), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🟡  Copy Binance ID", "dep_copy_binance"), Markup.button.callback("💎  USDT TRC20", "dep_copy_trc20")],
        [Markup.button.callback("🔷  USDT BEP20",     "dep_copy_bep20"),  Markup.button.callback("🇮🇳  UPI",       "dep_copy_upi")],
        [Markup.button.callback("📸  Submit Payment Proof", "dep_submit_proof")],
      ]),
    });
  });

  bot.action("dep_submit_proof", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    depositFlows.set(uid, { step: "waiting_screenshot" });
    return safeEdit(ctx,
      `📸 <b>Submit Payment Proof</b>\n\n` +
      `${divider()}\n\n` +
      `Send your <b>payment screenshot</b> as a photo right now.\n\n` +
      `<i>Our team will confirm and credit your balance within minutes.\n` +
      `Include your Telegram ID <code>${uid}</code> in the payment notes if possible.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", "dep_cancel_proof")]]),
      }
    );
  });

  bot.action("dep_cancel_proof", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    depositFlows.delete(uid);
    return safeEdit(ctx, `❌ <i>Cancelled.</i>`, { parse_mode: "HTML" });
  });

  // ── Photo handler — deposit screenshots ───────────────────────────────────
  bot.on("photo", async (ctx: any, next: any) => {
    const uid  = ctx.from?.id;
    if (!uid) return next();
    const flow = depositFlows.get(uid);
    if (!flow) return next();
    depositFlows.delete(uid);

    const photos    = ctx.message.photo;
    const fileId    = photos[photos.length - 1]?.file_id;

    // Save deposit request to DB
    const insRes = await dbQuery(
      `INSERT INTO shop_deposit_requests (telegram_id, screenshot_file_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [uid, fileId]
    );
    const reqId = insRes.rows[0]?.id;

    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae(ANIM_EMOJI.check, "✅")}  <b>PROOF SUBMITTED!</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `<code>  📋 Request ID  ›  ${reqId}\n` +
      `  🆔 Your ID     ›  ${uid}</code>\n\n` +
      `Our team will review and credit your balance shortly.\n` +
      `<i>Average confirmation: under 15 minutes.</i>`,
      { parse_mode: "HTML" }
    );

    // Notify admin
    const adminToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminIds   = (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (adminToken && adminIds.length > 0) {
      const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "Unknown";
      for (const adminId of adminIds) {
        fetch(`https://api.telegram.org/bot${adminToken}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: adminId,
            photo: fileId,
            caption:
              `📸 <b>NEW DEPOSIT PROOF</b>\n\n` +
              `👤 ${escHtml(uname)}\n` +
              `🆔 User ID: <code>${uid}</code>\n` +
              `📋 Request: #${reqId}\n\n` +
              `<i>Tap below to approve or deny.</i>`,
            parse_mode: "HTML",
            reply_markup: JSON.stringify({
              inline_keyboard: [
                [{ text: "✅  Approve + Set Amount", callback_data: `dep_approve_${reqId}_${uid}` }],
                [{ text: "❌  Deny",                 callback_data: `dep_deny_${reqId}_${uid}` }],
              ],
            }),
          }),
        }).catch(() => {});
      }
    }
  });

  // ── Support ───────────────────────────────────────────────────────────────
  bot.hears(BTN.SUPPORT, async (ctx) => {
    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  🎧  <b>SUPPORT</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `We can help with:\n` +
      `  · Account access issues\n` +
      `  · Balance top-ups &amp; deposits\n` +
      `  · Order problems or disputes\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💬 Contact: <b>${SUPPORT_CONTACT}</b>\n` +
      `🆔 Your ID: <code>${ctx.from.id}</code>\n\n` +
      `<i>Include your User ID when reaching out.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── My ID / Profile ───────────────────────────────────────────────────────
  bot.hears(BTN.IDENTITY, async (ctx) => {
    const uid   = ctx.from.id;
    const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    const r = await dbQuery(`SELECT vip, total_spend, balance FROM shop_customers WHERE telegram_id = $1`, [uid]);
    const row   = r.rows[0];
    const vip   = row?.vip ?? false;
    const spend = parseFloat(row?.total_spend ?? "0");
    const bal   = parseFloat(row?.balance ?? "0");
    const statusLine = vip
      ? `${ae(ANIM_EMOJI.crown, "👑")} <b>VIP Member</b>`
      : `🎯 VIP at <b>${fmt$(VIP_THRESHOLD)}</b> total spend`;
    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  👤  <b>MY PROFILE</b>${vip ? `  ${ae(ANIM_EMOJI.crown, "👑")}` : ""}  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `<code>  🔖 Username    ›  ${uname}\n` +
      `  🆔 User ID     ›  ${uid}\n` +
      `  💰 Balance     ›  ${fmt$(bal)}\n` +
      `  💳 Total Spent ›  ${fmt$(spend)}</code>\n\n` +
      `${statusLine}\n\n` +
      `<i>Share your User ID when contacting support.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── /cancel — exit any active flow ────────────────────────────────────────
  bot.command("cancel", async (ctx) => {
    const uid = ctx.from.id;
    activationFlows.delete(uid);
    buyFlows.delete(uid);
    depositFlows.delete(uid);
    await safeReply(ctx,
      `❌ <b>Cancelled.</b>\n\n<i>All active flows cleared. Use the menu below to continue.</i>`,
      { parse_mode: "HTML", ...SHOP_KEYBOARD }
    );
  });

  // ── Refer & Earn ──────────────────────────────────────────────────────────
  bot.hears(BTN.REFER, async (ctx) => {
    const uid         = ctx.from.id;
    const botUsername = ctx.botInfo.username;
    const referralLink = `https://t.me/${botUsername}?start=ref_${uid}`;
    const shareUrl     = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent("Join Project Addison — AI Tools Marketplace! Get AI tools at the best prices.")}`;

    const [totalRes, rewardedRes, rewardSetting] = await Promise.all([
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_customers WHERE referred_by = $1`, [uid]),
      dbQuery(`SELECT COUNT(*) as cnt FROM shop_customers WHERE referred_by = $1 AND referral_rewarded = true`, [uid]),
      getReferralReward(),
    ]);
    const totalReferred  = parseInt(totalRes.rows[0]?.cnt ?? "0");
    const rewardedCount  = parseInt(rewardedRes.rows[0]?.cnt ?? "0");
    const referReward    = rewardSetting as number;
    const totalEarned    = rewardedCount * referReward;

    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  🔗  <b>REFER &amp; EARN</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `Invite friends and earn <b>${fmt$(referReward)}</b> for every new user who joins using your link.\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 <b>Your Referral Link</b>\n` +
      `<code>${referralLink}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<code>Friends referred:   ${totalReferred}\n` +
      `Rewards earned:     $${totalEarned.toFixed(2)}</code>\n\n` +
      `<i>Reward is credited instantly when your friend joins.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.url("📤  Share My Link", shareUrl)],
        ]),
      }
    );
  });

  // ── My Orders (keyboard button) ────────────────────────────────────────────
  bot.hears(BTN.ORDERS, async (ctx) => {
    const uid = ctx.from.id;
    await showOrders(ctx, uid, false);
  });

  // ── My Orders (inline button) ──────────────────────────────────────────────
  bot.action("shop_view_orders", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    await showOrders(ctx, uid, true);
  });

  async function showOrders(ctx: any, uid: number, isEdit: boolean) {
    const res = await dbQuery(
      `SELECT id, product_name, amount, account_type, created_at
       FROM shop_orders
       WHERE telegram_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [uid]
    );

    if (res.rows.length === 0) {
      const text =
        `╔══════════════════════════════════════╗\n` +
        `║  📋  <b>ORDER HISTORY</b>  ║\n` +
        `╚══════════════════════════════════════╝\n\n` +
        `<i>No purchases yet.</i>\n\n` +
        `Browse the marketplace to get started:`;
      const kb = Markup.inlineKeyboard([[Markup.button.callback("🛍  Browse Marketplace", "shop_back_products")]]);
      if (isEdit) return safeEdit(ctx, text, { parse_mode: "HTML", ...kb });
      return safeReply(ctx, text, { parse_mode: "HTML", ...kb });
    }

    const lines: string[] = [
      `╔══════════════════════════════════════╗\n` +
      `║  📋  <b>ORDER HISTORY</b>  ║\n` +
      `║  <i>Last ${res.rows.length} purchase${res.rows.length !== 1 ? "s" : ""}</i>  ║\n` +
      `╚══════════════════════════════════════╝\n`
    ];

    const buttons = res.rows.map((o: any, i: number) => {
      const emoji = platformEmoji(o.account_type ?? "");
      const date  = new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      lines.push(`${emoji} <b>${escHtml(o.product_name)}</b>  —  ${fmt$(o.amount)}  —  <i>${date}</i>`);
      return [Markup.button.callback(`🔑  Reveal #${i + 1}: ${o.product_name}`, `shop_creds_${o.id}`)];
    });

    lines.push(`\n${divider()}\n<i>Tap an order below to reveal login credentials.</i>`);

    const text = lines.join("\n");
    const kb   = Markup.inlineKeyboard(buttons);

    if (isEdit) return safeEdit(ctx, text, { parse_mode: "HTML", ...kb });
    return safeReply(ctx, text, { parse_mode: "HTML", ...kb });
  }

  // ── Reveal credentials ────────────────────────────────────────────────────
  bot.action(/^shop_creds_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const orderId = (ctx.match as RegExpExecArray)[1];
    const uid     = ctx.from.id;

    const res = await dbQuery(
      `SELECT product_name, account_type, account_email, account_password, amount, created_at
       FROM shop_orders WHERE id = $1 AND telegram_id = $2`,
      [orderId, uid]
    );

    if (!res.rows[0]) {
      return safeEdit(ctx,
        `${header("⚠️ NOT FOUND")}\n\nOrder not found or does not belong to your account.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  My Orders", "shop_view_orders")]]),
        }
      );
    }

    const o     = res.rows[0];
    const emoji = platformEmoji(o.account_type ?? "");
    const date  = new Date(o.created_at).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    await safeEdit(ctx,
      `🔑 <b>Credentials</b>\n\n` +
      `${emoji} <b>${escHtml(o.product_name)}</b>\n` +
      `<i>Purchased ${date}  ·  ${fmt$(o.amount)}</i>\n\n` +
      `${divider()}\n\n` +
      `📧 <b>Email</b>\n<code>${escHtml(o.account_email)}</code>\n\n` +
      `🔑 <b>Password</b>\n<code>${escHtml(o.account_password)}</code>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("◀  My Orders", "shop_view_orders")]]),
      }
    );
  });

  // ── Commands ──────────────────────────────────────────────────────────────
  bot.command("balance", async (ctx) => {
    const uid = ctx.from.id;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae(ANIM_EMOJI.money, "💰")}  <b>MY WALLET</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `<code>  💵 Balance   ›  ${fmt$(balance)}\n` +
      `  🆔 User ID   ›  ${uid}</code>\n\n` +
      `<i>Tap Add Funds to top up your balance.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("💳  Add Funds", "shop_deposit_info")]]),
      }
    );
  });

  bot.command("shop", async (ctx) => {
    await showProductList(ctx);
  });

  bot.command("id", async (ctx) => {
    const uid   = ctx.from.id;
    const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await safeReply(ctx,
      `${header("🪪 MY IDENTITY")}\n\n` +
      `<code>` +
      `  Username  ›  ${uname}\n` +
      `  User ID   ›  ${uid}` +
      `</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Register commands ─────────────────────────────────────────────────────
  async function registerCommands() {
    try {
      await bot.telegram.setMyCommands([
        { command: "start",   description: "Start & open main menu" },
        { command: "menu",    description: "Open main menu keyboard" },
        { command: "shop",    description: "Browse AI tools marketplace" },
        { command: "balance", description: "Check my wallet balance" },
        { command: "id",      description: "My Telegram user ID" },
        { command: "cancel",  description: "Cancel any active flow" },
      ]);
      await bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } });
      console.log("[ShopBot] Commands registered");
    } catch (e: any) {
      console.error("[ShopBot] Failed to register commands:", e.message);
    }
  }

  // ── Launch with retry ─────────────────────────────────────────────────────
  async function launch(attempt = 1) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      console.log("[ShopBot] Online — Project Addison v2 Marketplace");
      await registerCommands();
    } catch (err: any) {
      const delay = Math.min(attempt * 5000, 60_000);
      console.error(`[ShopBot] Launch attempt ${attempt} failed: ${err.message} — retrying in ${delay / 1000}s`);
      setTimeout(() => launch(attempt + 1), delay);
    }
  }
  launch();

  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

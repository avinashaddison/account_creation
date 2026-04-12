import { Telegraf, Markup } from "telegraf";
import { Pool, PoolClient } from "pg";
import QRCode from "qrcode";
import {
  pendingActivations, adminApprovalStates as _adminApprovalStates,
  buildActivationCountdownMsg,
  type PendingActivation, type ActivationService,
  ACTIVATION_LABEL, ACTIVATION_EMOJI,
} from "./activationStore";
import { createOrder, setOnPaymentPaid } from "./crypto/orderService";
import { ae as aeFromSettings, loadEmojiSettings } from "./emojiSettings";
import { searchUpiPaymentEmail } from "./mailService";
import {
  createAccount as smtpDevCreate,
  getFullInbox as smtpDevInbox,
} from "./smtpDevService";
import { storage } from "./storage";

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
/**
 * Animated emoji helper — reads IDs from the database (via emojiSettings).
 * Falls back to default IDs if the setting hasn't been customised.
 */
function ae(key: Parameters<typeof aeFromSettings>[0], fallback?: string): string {
  return aeFromSettings(key, fallback);
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
  ACCOUNTS:     "⚡  𝗦𝗛𝗢𝗣  𝗔𝗜  𝗧𝗢𝗢𝗟𝗦",
  BALANCE:      "💰  𝗪𝗔𝗟𝗟𝗘𝗧",
  ORDERS:       "📋  𝗢𝗥𝗗𝗘𝗥𝗦",
  DEPOSIT:      "💳  𝗔𝗗𝗗  𝗙𝗨𝗡𝗗𝗦",
  IDENTITY:     "👤  𝗠𝗬  𝗣𝗥𝗢𝗙𝗜𝗟𝗘",
  SUPPORT:      "🎧  𝗦𝗨𝗣𝗣𝗢𝗥𝗧",
  REFER:        "🔗  𝗥𝗘𝗙𝗘𝗥  &  𝗘𝗔𝗥𝗡",
  BIZ_MAIL:     "📩  𝗧𝗘𝗠𝗣  𝗠𝗔𝗜𝗟",
} as const;

// Cycling hot-product emoji for sticky keyboard buttons
const STICKY_EMOJI = ["🔥", "⚡", "✨", "💎", "🌟", "🚀", "💥", "👑"];

function hasLeadingEmoji(s: string): boolean {
  return /^\p{Emoji_Presentation}/u.test(s) || /^\p{Extended_Pictographic}/u.test(s);
}

/** Convert ASCII letters/digits → Unicode Mathematical Bold Sans-Serif */
function toBold(text: string): string {
  return [...text].map(c => {
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90)  return String.fromCodePoint(0x1D5D4 + code - 65); // A-Z
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D5EE + code - 97); // a-z
    if (code >= 48 && code <= 57)  return String.fromCodePoint(0x1D7EC + code - 48); // 0-9
    return c;
  }).join("");
}

/** Build the display label for a sticky product: auto-emoji + bold text */
function stickyDisplayLabel(base: string, index: number): string {
  if (hasLeadingEmoji(base)) return base; // already has emoji — user set it themselves
  const icon = STICKY_EMOJI[index % STICKY_EMOJI.length];
  return `${icon}  ${toBold(base)}`;
}

async function buildShopKeyboard() {
  const res = await dbQuery(
    `SELECT name, sticky_label FROM shop_products WHERE sticky = true AND active = true ORDER BY sort_order ASC, created_at ASC`
  );
  const labels: string[] = res.rows.map((p: any, i: number) => {
    const base = (p.sticky_label ?? "").trim() || p.name;
    return stickyDisplayLabel(base, i);
  });
  const stickyRows: string[][] = [];
  for (let i = 0; i < labels.length; i += 2) {
    stickyRows.push(labels[i + 1] ? [labels[i], labels[i + 1]] : [labels[i]]);
  }
  return Markup.keyboard([
    ...stickyRows,
    [BTN.ACCOUNTS],
    [BTN.BALANCE,   BTN.ORDERS],
    [BTN.DEPOSIT,   BTN.SUPPORT],
    [BTN.IDENTITY,  BTN.REFER],
    [BTN.BIZ_MAIL],
  ]).resize().oneTime();
}

// ── Per-user state ───────────────────────────────────────────────────────────
interface ShopUserState {
  selectedProductId?: string;
}
const userState   = new Map<number, ShopUserState>();
const bizSeenIds  = new Map<string, Set<string>>(); // smtpAccountId → seen message IDs
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

// Auto-verify deposit flow (Binance Pay, TRC20, BEP20)
type DepositChain = "BINANCE_PAY" | "TRC20" | "BEP20";
interface CryptoDepositFlow {
  step:     "waiting_amount" | "waiting_payment";
  chain:    DepositChain;
  orderId?: string;
  note?:    string;
  amount?:  number;
}
const cryptoDepositFlows = new Map<number, CryptoDepositFlow>();

// UPI auto-verify flow
interface UpiDepositFlow {
  step:      "waiting_amount" | "waiting_utr";
  amountUsd?: number;
  amountInr?: number;
  msgId?:    number; // message to edit for status updates
}
const upiDepositFlows = new Map<number, UpiDepositFlow>();

const UPI_RATE = 100; // 1 USD = 100 INR (configurable)

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

function notifyAdminsManualOrder(
  productName: string,
  orderId: string,
  custName: string,
  custId: number,
  finalPrice: number
) {
  const adminToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds   = (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!adminToken || adminIds.length === 0) return;
  const text =
    `📬 <b>NEW MANUAL ORDER</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📦 Product:  <b>${escHtml(productName)}</b>\n` +
    `💵 Amount:   <b>$${finalPrice.toFixed(2)}</b>\n` +
    `👤 Customer: <b>${escHtml(custName)}</b>  <code>(${custId})</code>\n` +
    `🆔 Order ID: <code>${orderId}</code>\n\n` +
    `<i>Tap Fulfill to deliver the product to this customer.</i>`;
  for (const id of adminIds) {
    fetch(`https://api.telegram.org/bot${adminToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: id,
        text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: `📦  Fulfill Order`, callback_data: `shop_fulfill_${orderId}` }]],
        },
      }),
    }).catch((err: unknown) => {
      console.error(`[shopBot] Failed to notify admin ${id} of manual order ${orderId}:`, err);
    });
  }
}

function notifyAdminsUpiPayment(
  uid: number,
  uname: string,
  utr: string,
  amountInr: number,
  amountUsd: number,
  senderName: string | null,
  senderBank: string | null,
) {
  const adminToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds   = (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!adminToken || adminIds.length === 0) return;
  const text =
    `✅ <b>UPI PAYMENT RECEIVED</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🇮🇳 Amount:  <b>₹${amountInr.toFixed(2)}</b>  →  <b>$${amountUsd.toFixed(2)} USDT</b>\n` +
    `🔖 UTR:     <code>${utr}</code>\n` +
    (senderName ? `👤 Sender:  <b>${escHtml(senderName)}</b>` + (senderBank ? ` / ${escHtml(senderBank)}` : "") + `\n` : "") +
    `\n👤 Customer: ${escHtml(uname)}  <code>(${uid})</code>\n\n` +
    `<i>Balance credited automatically.</i>`;
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
  sticky: boolean;
  sticky_label: string | null;
  custom_emoji: string | null;
  delivery_mode: string;
  manual_stock: number | null;
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
    let stock = 0;
    if ((p.delivery_mode ?? "auto") === "manual") {
      stock = p.manual_stock ?? 0;
    } else if (p.stock_override != null) {
      stock = p.stock_override;
    } else {
      const table = ACCOUNT_TABLE_MAP[p.account_type];
      let credCount = 0;
      if (table) {
        const { sql, params } = stockCountSql(table, p.status_filter, p.min_credits ?? null);
        const sr = await dbQuery(sql, params).catch(() => ({ rows: [{ cnt: "0" }] }));
        credCount = parseInt(sr.rows[0]?.cnt ?? "0");
      }
      const linkRes = await dbQuery(
        `SELECT COUNT(*) as cnt FROM shop_redeem_links WHERE product_id = $1 AND status = 'available'`,
        [p.id]
      ).catch(() => ({ rows: [{ cnt: "0" }] }));
      const linkCount = parseInt(linkRes.rows[0]?.cnt ?? "0");
      stock = credCount + linkCount;
    }
    out.push({ ...p, stock });
  }
  return out;
}

async function getProductById(id: string): Promise<ProductWithStock | null> {
  const res = await dbQuery(`SELECT * FROM shop_products WHERE id = $1`, [id]);
  if (!res.rows[0]) return null;
  const p = res.rows[0];
  let stock = 0;
  if ((p.delivery_mode ?? "auto") === "manual") {
    stock = p.manual_stock ?? 0;
  } else if (p.stock_override != null) {
    stock = p.stock_override;
  } else {
    const table = ACCOUNT_TABLE_MAP[p.account_type];
    let credCount = 0;
    if (table) {
      const { sql, params } = stockCountSql(table, p.status_filter, p.min_credits ?? null);
      const sr = await dbQuery(sql, params).catch(() => ({ rows: [{ cnt: "0" }] }));
      credCount = parseInt(sr.rows[0]?.cnt ?? "0");
    }
    const linkRes = await dbQuery(
      `SELECT COUNT(*) as cnt FROM shop_redeem_links WHERE product_id = $1 AND status = 'available'`,
      [id]
    ).catch(() => ({ rows: [{ cnt: "0" }] }));
    const linkCount = parseInt(linkRes.rows[0]?.cnt ?? "0");
    stock = credCount + linkCount;
  }
  return { ...p, stock };
}

interface PurchaseResult {
  success: true;
  accountEmail: string;
  accountPassword: string;
  redeemLink?: string;
  newBalance: number;
  orderId: string;
  finalPrice: number;
  stockRemaining: number;
  productName: string;
  deliveryPending?: boolean;
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

    // ── Manual delivery branch ───────────────────────────────────────────────
    if ((prod.delivery_mode ?? "auto") === "manual") {
      // Atomically decrement manual_stock only if > 0 AND still in manual mode
      // (prevents overselling under concurrency and guards against mid-flow mode switch)
      const decrRes = await client.query(
        `UPDATE shop_products
         SET manual_stock = manual_stock - 1
         WHERE id = $1 AND delivery_mode = 'manual' AND manual_stock > 0
         RETURNING manual_stock`,
        [productId]
      );
      if ((decrRes.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return { success: false, reason: "out_of_stock" };
      }
      const newManualStock = decrRes.rows[0].manual_stock as number;

      await client.query(
        `UPDATE shop_customers SET balance = balance - $1, total_spend = total_spend + $1 WHERE telegram_id = $2`,
        [finalPrice, uid]
      );

      const orderRes = await client.query(
        `INSERT INTO shop_orders
           (telegram_id, product_id, product_name, account_id, account_email, account_password, amount, delivery_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [uid, productId, prod.name, "", "", "", finalPrice, "pending_delivery"]
      );

      await client.query("COMMIT");

      return {
        success: true,
        accountEmail: "",
        accountPassword: "",
        newBalance: balance - finalPrice,
        orderId: orderRes.rows[0].id,
        finalPrice,
        stockRemaining: newManualStock,
        productName: prod.name,
        deliveryPending: true,
      };
    }

    // ── Try redeem links first ───────────────────────────────────────────────
    const linkRes = await client.query(
      `SELECT id, link FROM shop_redeem_links WHERE product_id = $1 AND status = 'available' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [productId]
    );
    if (linkRes.rows[0]) {
      const { id: linkId, link: redeemLink } = linkRes.rows[0];

      await client.query(
        `UPDATE shop_customers SET balance = balance - $1, total_spend = total_spend + $1 WHERE telegram_id = $2`,
        [finalPrice, uid]
      );
      await client.query(`UPDATE shop_redeem_links SET status = 'sold' WHERE id = $1`, [linkId]);

      const orderRes = await client.query(
        `INSERT INTO shop_orders
           (telegram_id, product_id, product_name, amount, redeem_link)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [uid, productId, prod.name, finalPrice, redeemLink]
      );

      await client.query("COMMIT");

      const stockRem = await dbQuery(
        `SELECT COUNT(*) as cnt FROM shop_redeem_links WHERE product_id = $1 AND status = 'available'`,
        [productId]
      ).catch(() => ({ rows: [{ cnt: "0" }] }));

      return {
        success: true,
        accountEmail: "",
        accountPassword: "",
        redeemLink,
        newBalance: balance - finalPrice,
        orderId: orderRes.rows[0].id,
        finalPrice,
        stockRemaining: parseInt(stockRem.rows[0]?.cnt ?? "0"),
        productName: prod.name,
      };
    }

    // ── Fall back to credential table ────────────────────────────────────────
    if (!table) {
      await client.query("ROLLBACK");
      return { success: false, reason: "out_of_stock" };
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
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS stock_override INTEGER DEFAULT NULL;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS sticky BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS sticky_label TEXT DEFAULT NULL;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS custom_emoji TEXT DEFAULT NULL;
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'auto';
    ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS manual_stock INTEGER DEFAULT NULL;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='shop_products' AND constraint_name='shop_products_delivery_mode_check'
      ) THEN
        ALTER TABLE shop_products ADD CONSTRAINT shop_products_delivery_mode_check
          CHECK (delivery_mode IN ('auto', 'manual'));
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='shop_products' AND constraint_name='shop_products_manual_stock_check'
      ) THEN
        ALTER TABLE shop_products ADD CONSTRAINT shop_products_manual_stock_check
          CHECK (manual_stock IS NULL OR manual_stock >= 0);
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS shop_redeem_links (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id VARCHAR NOT NULL,
      link TEXT NOT NULL UNIQUE,
      status VARCHAR NOT NULL DEFAULT 'available',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS redeem_link TEXT DEFAULT NULL;
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'delivered';
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fulfillment_note TEXT DEFAULT NULL;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='shop_orders' AND constraint_name='shop_orders_delivery_status_check'
      ) THEN
        ALTER TABLE shop_orders ADD CONSTRAINT shop_orders_delivery_status_check
          CHECK (delivery_status IN ('delivered', 'pending_delivery', 'fulfilling'));
      END IF;
    END $$;
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
    CREATE TABLE IF NOT EXISTS upi_orders (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      utr         TEXT NOT NULL UNIQUE,
      user_id     TEXT NOT NULL,
      amount_inr  NUMERIC(12,2) NOT NULL,
      amount_usd  NUMERIC(12,2) NOT NULL,
      sender_name TEXT,
      sender_bank TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log("[ShopBot] Tables ready");
  await loadEmojiSettings();
}

// ── Safe messaging helpers ───────────────────────────────────────────────────
/** Strip <tg-emoji emoji-id="...">FALLBACK</tg-emoji> tags, leaving only the fallback character. */
function stripTgEmoji(text: string): string {
  return text.replace(/<tg-emoji[^>]*>([^<]*)<\/tg-emoji>/g, "$1");
}

async function safeReply(ctx: any, text: string, extra: any = {}) {
  try {
    return await ctx.reply(truncate(text), extra);
  } catch (e: any) {
    if (e.message?.includes("DOCUMENT_INVALID")) {
      try {
        return await ctx.reply(truncate(stripTgEmoji(text)), extra);
      } catch (e2: any) {
        console.error("[ShopBot] safeReply fallback failed:", e2.message);
      }
    } else {
      console.error("[ShopBot] safeReply failed:", e.message);
    }
    return null;
  }
}

async function safeEdit(ctx: any, text: string, extra: any = {}) {
  try {
    return await ctx.editMessageText(truncate(text), extra);
  } catch (e: any) {
    if (e.message?.includes("DOCUMENT_INVALID")) {
      try {
        return await ctx.editMessageText(truncate(stripTgEmoji(text)), extra);
      } catch {
        return safeReply(ctx, stripTgEmoji(text), extra);
      }
    }
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
  } catch (e: any) {
    if (e.message?.includes("DOCUMENT_INVALID")) {
      try {
        return await ctx.telegram.editMessageText(
          msg.chat.id,
          msg.message_id,
          undefined,
          truncate(stripTgEmoji(text)),
          extra
        );
      } catch {
        return safeReply(ctx, stripTgEmoji(text), extra);
      }
    }
    return safeReply(ctx, text, extra);
  }
}

// ── UI builders ──────────────────────────────────────────────────────────────
function divider(): string {
  return "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
}

function insufficientFundsMsg(opts: {
  productName?: string;
  productEmoji?: string;
  required: number;
  balance: number;
}): string {
  const { productName, productEmoji, required, balance } = opts;
  const shortfall = (required - balance).toFixed(2);
  const reqStr    = `$${required.toFixed(2)}`;
  const balStr    = `$${balance.toFixed(2)}`;
  const shortStr  = `$${shortfall}`;
  const col       = 11; // label column width
  const pad = (s: string, w: number) => s.padEnd(w);
  const productLine = productName
    ? `\n║  ${productEmoji ?? "📦"}  <b>${escHtml(productName)}</b>\n╠══════════════════════════════════════╣`
    : "";
  return (
    `${ae("card", "💳")}  <b>INSUFFICIENT FUNDS</b>  ${ae("money", "💰")}\n` +
    `╔══════════════════════════════════════╗` +
    `${productLine}\n` +
    `║\n` +
    `║  <code>${pad("Balance",  col)} ›   ${balStr}</code>\n` +
    `║  <code>${pad("Required", col)} ›   ${reqStr}</code>\n` +
    `║  <code>───────────────────────────</code>\n` +
    `║  ${ae("bolt", "⚡")}  <code>${pad("Shortfall",col)} ›   ${shortStr}</code>\n` +
    `║\n` +
    `╚══════════════════════════════════════╝\n\n` +
    `💬  To top up, contact ${escHtml(SUPPORT_CONTACT)}`
  );
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
  const name    = escHtml(boxClip(rawName, BOX_INNER_WIDTH - 3));
  const rawDesc = p.description ?? `${platformLabel(p.account_type)} · Instant delivery`;
  const desc    = escHtml(boxClip(rawDesc, BOX_INNER_WIDTH));
  const badge   = stockBadge(p.stock);
  const trendingLine = p.sticky
    ? `║  🔥 <b>TRENDING  ·  TOP PICK</b>  ║\n`
    : "";
  return (
    `╔══════════════════════════════════════╗\n` +
    `${trendingLine}` +
    `║  ${emoji}  <b>${name}</b>  ║\n` +
    `║  <i>${desc}</i>  ║\n` +
    `║  💵 <b>${fmt$(p.price)}</b>  ·  ${badge}  ║\n` +
    `╚══════════════════════════════════════╝`
  );
}

/**
 * Parse stored emoji value.
 * Format "tg:DOCUMENT_ID:FALLBACK" = Telegram animated custom emoji
 * Anything else = plain emoji string
 */
function parseTgEmoji(raw: string): { id: string; fallback: string } | null {
  if (!raw.startsWith("tg:")) return null;
  const rest = raw.slice(3);               // "DOCUMENT_ID:FALLBACK"
  const sep  = rest.indexOf(":");
  if (sep === -1) return null;
  return { id: rest.slice(0, sep), fallback: rest.slice(sep + 1) };
}

/** Plain emoji for use in inline-keyboard button labels (no HTML). */
function productEmoji(p: ProductWithStock, inStock = true): string {
  if (p.custom_emoji) {
    const tg = parseTgEmoji(p.custom_emoji);
    return tg ? tg.fallback : p.custom_emoji;
  }
  if (p.sticky && inStock) return "🔥";
  return platformEmoji(p.account_type);
}

/** Animated emoji HTML for use inside HTML-parsed message bodies. */
function productEmojiHtml(p: ProductWithStock, inStock = true): string {
  if (p.custom_emoji) {
    const tg = parseTgEmoji(p.custom_emoji);
    if (tg) return `<tg-emoji emoji-id="${tg.id}">${tg.fallback}</tg-emoji>`;
    return p.custom_emoji;
  }
  if (p.sticky && inStock) return "🔥";
  return platformEmoji(p.account_type);
}

function buildProductButtons(products: ProductWithStock[]) {
  return products.map((p) => {
    const emoji = productEmoji(p, p.stock > 0);
    const price = fmt$(p.price);
    const label = p.stock > 0
      ? `[${p.stock}]  ${emoji}  ${p.name}  •  ${price}`
      : `${emoji}  ${p.name}  •  ${price}`;
    return [Markup.button.callback(label, `shop_product_${p.id}`)];
  });
}

function buildMarketplaceText(products: ProductWithStock[]): string {
  const count = products.length;
  return (
    `🛍  <b>LIVE MARKETPLACE</b>  ·  <i>Project Addison v2</i>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `After ordering, your product &amp; credentials are delivered <b>automatically</b> — instant, secure, 24/7.\n\n` +
    `<i>${count} product${count !== 1 ? "s" : ""}  ·  USD  ·  ⚡ Instant delivery</i>\n\n` +
    `Choose a product below or manage your account:\n` +
    `<i>Need help? Contact → <a href="https://t.me/${SUPPORT_CONTACT.replace("@", "")}">${escHtml(SUPPORT_CONTACT)}</a></i>`
  );
}

function buildMarketplaceKeyboard(products: ProductWithStock[]) {
  return Markup.inlineKeyboard([
    ...buildProductButtons(products),
    [
      Markup.button.callback("📋  My Orders", "shop_view_orders"),
      Markup.button.callback("🔄  Refresh",   "shop_refresh_products"),
    ],
  ]);
}


// ── Main bot export ──────────────────────────────────────────────────────────
export function startShopBot(token: string) {
  if (!token) {
    console.warn("[ShopBot] No token provided — shop bot disabled");
    return;
  }

  const bot = new Telegraf(token);

  ensureShopTables().catch((err) => console.error("[ShopBot] Table init error:", err.message));

  // Per-chat: explicitly set menu button to type:"commands" so Telegram shows
  // the native "Menu" button that opens the command list — same as the reference
  // bot pattern.  The button is visible whenever no reply keyboard is active;
  // Telegram temporarily hides it while a reply keyboard is shown (this is normal
  // Telegram behaviour — once the user taps a keyboard button it closes and the
  // Menu button reappears).
  async function pushMenuButton(chatId: number) {
    await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:     chatId,
        menu_button: { type: "commands" },
      }),
    }).catch(() => {});
  }

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
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name, referredBy);
    pushMenuButton(ctx.chat.id).catch(() => {});   // reset any old per-chat override

    // Credit referrer $0.50 when new user joins
    if (isNew && referredBy) {
      processReferralReward(uid, bot).catch(() => {});
    }

    // "Menu" button deep link — show the main menu + reply keyboard directly
    if (payload === "show_menu") {
      const bal   = await getBalance(uid);
      const name2 = ctx.from.first_name || ctx.from.username || "User";
      const uname2 = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
      await ctx.reply(
        truncate(
          `${ae("fire", "🔥")}  <b>${toBold("PROJECT ADDISON v2")}</b>  ${ae("fire", "🔥")}\n` +
          `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n` +
          `      Global AI Tools Marketplace\n` +
          `◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
          `👋  Hey, <b>${escHtml(name2)}</b>!  Welcome back.\n\n` +
          `<b>💎  What you can do here:</b>\n` +
          `<blockquote>⚡  ${toBold("SHOP")}  —  Browse &amp; buy premium AI tools\n` +
          `💳  ${toBold("DEPOSIT")}  —  Instantly add funds to your wallet\n` +
          `👤  ${toBold("PROFILE")}  —  View balance, orders &amp; settings\n` +
          `🎧  ${toBold("SUPPORT")}  —  We\'re always here to help\n` +
          `🔗  ${toBold("REFER & EARN")}  —  Invite friends, earn rewards</blockquote>\n\n` +
          `<code>◈  💰  Balance   ›  ${fmt$(bal)}\n` +
          `◈  🔖  User      ›  ${uname2}\n` +
          `◈  🆔  ID        ›  ${uid}</code>\n\n` +
          `<i>👇  Select an option from the menu below</i>`
        ),
        { parse_mode: "HTML", ...(await buildShopKeyboard()) }
      );
      return;
    }

    const balance = await getBalance(uid);
    const name    = ctx.from.first_name || ctx.from.username || "User";
    const uname   = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";

    const greeting = isNew
      ? `✨  Hey, <b>${escHtml(name)}</b>!  Welcome aboard — glad to have you! 🎉`
      : `👋  Hey, <b>${escHtml(name)}</b>!  Great to see you back.`;

    // Welcome card — inline CTA buttons (no reply keyboard, no auto-open)
    await ctx.reply(
      truncate(
        `${ae("fire", "🔥")}  <b>${toBold("PROJECT ADDISON v2")}</b>  ${ae("fire", "🔥")}\n` +
        `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n` +
        `      Global AI Tools Marketplace\n` +
        `◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
        `${greeting}\n\n` +
        `<b>💎  What we offer:</b>\n` +
        `<blockquote>⚡  ${toBold("SHOP")}  —  Browse &amp; buy premium AI tools\n` +
        `💳  ${toBold("DEPOSIT")}  —  Instantly add funds to your wallet\n` +
        `👤  ${toBold("PROFILE")}  —  View balance, orders &amp; settings\n` +
        `🎧  ${toBold("SUPPORT")}  —  We\'re always here to help\n` +
        `🔗  ${toBold("REFER & EARN")}  —  Invite friends, earn rewards</blockquote>\n\n` +
        `<code>◈  💰  Balance   ›  ${fmt$(balance)}\n` +
        `◈  🔖  User      ›  ${uname}\n` +
        `◈  🆔  ID        ›  ${uid}</code>`
      ),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`🛍  ${toBold("SHOP NOW")}  ⚡`, "shop_now")],
          [
            Markup.button.callback(`💳  ${toBold("Add Funds")}`,  "shop_quick_deposit"),
            Markup.button.callback(`👤  ${toBold("My Profile")}`, "shop_quick_profile"),
          ],
        ]),
      }
    );

    // Send reply keyboard (sticky products + navigation) as a separate follow-up
    await ctx.reply(
      `<i>👇  Use the menu below to navigate</i>`,
      { parse_mode: "HTML", ...(await buildShopKeyboard()) }
    );
  });

  bot.command("menu", async (ctx) => {
    const uid   = ctx.from.id;
    const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    pushMenuButton(ctx.chat.id).catch(() => {});   // reset any old per-chat override
    const balance = await getBalance(uid);
    // Dismiss any hidden keyboard first, then show fresh
    const dismiss = await ctx.reply("\u200B", { ...Markup.removeKeyboard() }).catch(() => null);
    if (dismiss) {
      await ctx.telegram.deleteMessage(ctx.chat.id, dismiss.message_id).catch(() => {});
    }
    await ctx.reply(
      truncate(
        `${ae("fire", "🔥")}  <b>${toBold("PROJECT ADDISON v2")}</b>  ${ae("fire", "🔥")}\n` +
        `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n` +
        `      Global AI Tools Marketplace\n` +
        `◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
        `👋  Hey, <b>${escHtml(uname)}</b>!  Welcome back.\n\n` +
        `<b>💎  What you can do here:</b>\n` +
        `<blockquote>⚡  ${toBold("SHOP")}  —  Browse &amp; buy premium AI tools\n` +
        `💳  ${toBold("DEPOSIT")}  —  Instantly add funds to your wallet\n` +
        `👤  ${toBold("PROFILE")}  —  View balance, orders &amp; settings\n` +
        `🎧  ${toBold("SUPPORT")}  —  We\'re always here to help\n` +
        `🔗  ${toBold("REFER & EARN")}  —  Invite friends, earn rewards</blockquote>\n\n` +
        `<code>◈  💰  Balance   ›  ${fmt$(balance)}\n` +
        `◈  🔖  User      ›  ${uname}\n` +
        `◈  🆔  ID        ›  ${uid}</code>\n\n` +
        `<i>👇  Select an option from the menu below</i>`
      ),
      { parse_mode: "HTML", ...(await buildShopKeyboard()) }
    );
  });

  // ── Welcome card inline buttons ─────────────────────────────────────────
  bot.action("shop_now", async (ctx) => {
    await ctx.answerCbQuery("🛍  Loading marketplace…").catch(() => {});
    await showProductList(ctx);
  });

  bot.action("shop_quick_deposit", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    await safeReply(ctx, depositText(uid), {
      parse_mode: "HTML",
      ...depositMethodKeyboard(),
    });
  });

  bot.action("shop_quick_profile", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid   = ctx.from.id;
    const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    const r = await dbQuery(`SELECT vip, total_spend, balance FROM shop_customers WHERE telegram_id = $1`, [uid]);
    const row   = r.rows[0];
    const vip   = row?.vip ?? false;
    const spend = parseFloat(row?.total_spend ?? "0");
    const bal   = parseFloat(row?.balance ?? "0");
    const statusLine = vip
      ? `${ae("crown", "👑")} <b>VIP Member</b>`
      : `🎯 VIP at <b>${fmt$(VIP_THRESHOLD)}</b> total spend`;
    await ctx.reply(
      `╔══════════════════════════════════════╗\n` +
      `║  👤  <b>MY PROFILE</b>${vip ? `  ${ae("crown", "👑")}` : ""}  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `${statusLine}\n\n` +
      `<code>  💰  Balance   ›  ${fmt$(bal)}\n` +
      `  📊  Total Spend  ›  ${fmt$(spend)}\n` +
      `  🔖  Username    ›  ${uname}\n` +
      `  🆔  ID          ›  ${uid}</code>`,
      { parse_mode: "HTML" }
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
      const emptyText =
        `🛍  <b>LIVE MARKETPLACE</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `⚠️ <b>No products online right now.</b>\n` +
        `<i>Check back soon or contact support.</i>\n\n` +
        `→ <a href="https://t.me/${SUPPORT_CONTACT.replace("@", "")}">${escHtml(SUPPORT_CONTACT)}</a>`;
      if (loader) await editMsg(ctx, loader, emptyText, { parse_mode: "HTML" });
      return;
    }

    const text     = buildMarketplaceText(products);
    const keyboard = buildMarketplaceKeyboard(products);

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
        `🛍  <b>LIVE MARKETPLACE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n⚠️ No products available right now.\n→ ${escHtml(SUPPORT_CONTACT)}`,
        { parse_mode: "HTML" }
      );
    }
    await safeEdit(ctx, buildMarketplaceText(products), {
      parse_mode: "HTML",
      ...buildMarketplaceKeyboard(products),
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
          ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]),
        }
      );
    }

    const emoji   = productEmojiHtml(prod, prod.stock > 0);
    const inStock = prod.stock > 0;

    // Build description block — description is admin HTML (may contain <tg-emoji>, <b>, etc.)
    // Do NOT escHtml() here or animated emoji / formatting will be destroyed
    const descBlock = prod.description
      ? `\n${prod.description}\n`
      : "";

    // Stock warning line (only show when low or OOS)
    const stockLine = prod.stock === 0
      ? `\n❌ <b>Out of stock.</b> Join the waitlist below to be notified.\n`
      : prod.stock <= 5
        ? `\n⚠️ <i>Only ${prod.stock} left — order fast!</i>\n`
        : "";

    const text =
      `${emoji}  <b>${escHtml(prod.name)}</b>\n\n` +
      `Price: <b>${fmt$(prod.price)}</b> / account\n` +
      `${descBlock}` +
      `${stockLine}\n` +
      `<i>Delivery is automatic after payment confirmation.</i>`;

    const subsRes = await dbQuery(
      `SELECT 1 FROM shop_restock_subs WHERE telegram_id = $1 AND product_id = $2`,
      [ctx.from.id, productId]
    );
    const alreadySubscribed = subsRes.rows.length > 0;

    const buttons = [
      ...(inStock
        ? [[Markup.button.callback(`🛒  Buy Now  —  ${fmt$(prod.price)}`, `shop_buy_${productId}`)]]
        : alreadySubscribed
          ? [[Markup.button.callback("🔔  Notify Me (subscribed)", `notify_already_${productId}`)]]
          : [[Markup.button.callback("🔔  Notify Me When Back in Stock", `notify_me_${productId}`)]]
      ),
      [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
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
        `🛍  <b>LIVE MARKETPLACE</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n⚠️ No products available right now.\n→ ${escHtml(SUPPORT_CONTACT)}`,
        { parse_mode: "HTML" }
      );
    }
    await safeEdit(ctx, buildMarketplaceText(products), {
      parse_mode: "HTML",
      ...buildMarketplaceKeyboard(products),
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
            [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
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
          ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]),
        }
      );
    }

    const balance = await getBalance(uid);
    const price   = parseFloat(prod.price);

    if (balance < price) {
      return safeEdit(ctx,
        insufficientFundsMsg({ productName: prod.name, required: price, balance }),
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")],
            [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
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
          ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]),
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
          [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
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

  // ── Shared helper: manual-delivery post-purchase response ───────────────────
  async function replyManualPending(
    ctx: any,
    uid: number,
    result: PurchaseResult,
    prodName: string,
    discount: number
  ) {
    const custRes = await dbQuery(
      `SELECT username, first_name FROM shop_customers WHERE telegram_id = $1`,
      [uid]
    );
    const cu = custRes.rows[0];
    const custName = cu?.username ? `@${cu.username}` : (cu?.first_name ?? `User ${uid}`);
    notifyAdminsManualOrder(result.productName, result.orderId, custName, uid, result.finalPrice);

    return safeEdit(ctx,
      `📬 <b>Order Placed!</b>\n\n` +
      `<code>` +
      `Product:    ${escHtml(prodName)}\n` +
      `Quantity:   1\n` +
      `${discount > 0 ? `Discount:   -${fmt$(discount)}\n` : ""}` +
      `Total Paid: ${result.finalPrice.toFixed(2)} USDT\n` +
      `</code>\n\n` +
      `⏳ Your order is confirmed. The admin will deliver your product shortly.\n\n` +
      `💰 Balance: <b>${fmt$(result.newBalance)}</b>\n\n` +
      `<i>Need help? Contact ${escHtml(SUPPORT_CONTACT)}</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📦  My Orders", "shop_view_orders")],
          [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
        ]),
      }
    );
  }

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
        const bal2 = await getBalance(uid);
        const price2 = bal2 + (result.shortfall ?? 0);
        return safeEdit(ctx,
          insufficientFundsMsg({ productName: prod?.name, required: price2, balance: bal2 }),
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")],
              [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
            ]),
          }
        );
      }
      if (result.reason === "out_of_stock") {
        return safeEdit(ctx,
          `❌ <b>Just sold out.</b>\n<i>Check back soon.</i>`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]) }
        );
      }
      return safeEdit(ctx,
        `⚠️ <b>Purchase Failed.</b> Balance not charged.\n→ ${escHtml(SUPPORT_CONTACT)}`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]) }
      );
    }

    // ── Post-purchase tasks ───────────────────────────────────────────────────
    checkAndUpdateVip(uid).catch(() => {});

    if (result.deliveryPending) {
      return replyManualPending(ctx, uid, result, prod.name, discount);
    }

    if (result.stockRemaining <= 3) {
      alertAdminLowStock(result.productName, result.stockRemaining);
      if (result.stockRemaining === 0) {
        notifyRestockSubscribers(bot, productId, result.productName).catch(() => {});
      }
    }
    sendRatingRequest(bot, uid, result.orderId, result.productName);

    const itemsBlock = result.redeemLink
      ? `1. <code>${escHtml(result.redeemLink)}</code>`
      : `📧 <code>${escHtml(result.accountEmail)}</code>\n` +
        `🔑 <code>${escHtml(result.accountPassword)}</code>`;

    await safeEdit(ctx,
      `✅ <b>Order Delivered!</b>\n\n` +
      `<code>` +
      `Product:    ${escHtml(prod.name)}\n` +
      `Quantity:   1\n` +
      `${discount > 0 ? `Discount:   -${fmt$(discount)}\n` : ""}` +
      `Total Paid: ${result.finalPrice.toFixed(2)} USDT\n` +
      `</code>\n` +
      `📦 <b>${escHtml(prod.name)}</b> × 1\n\n` +
      `${itemsBlock}\n\n` +
      `💰 Balance: <b>${fmt$(result.newBalance)}</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📦  My Orders", "shop_view_orders")],
          [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
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
            [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
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
          ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]),
        }
      );
    }

    const balance = await getBalance(uid);
    const price   = parseFloat(prod.price);
    if (balance < price) {
      return safeEdit(ctx,
        insufficientFundsMsg({ productName: prod.name, required: price, balance }),
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")],
            [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
          ]),
        }
      );
    }

    if (prod.stock === 0) {
      return safeEdit(ctx,
        `❌ <b>Out of Stock</b>\n\n<b>${escHtml(prod.name)}</b> just sold out.\n<i>Check back soon.</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]),
        }
      );
    }

    const result = await purchaseProduct(uid, productId);
    if (!result.success) {
      return safeEdit(ctx,
        `⚠️ <b>Purchase Failed</b>\n\nSomething went wrong. Your balance was not charged.\n\n→ Contact ${escHtml(SUPPORT_CONTACT)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")]]),
        }
      );
    }

    checkAndUpdateVip(uid).catch(() => {});

    if (result.deliveryPending) {
      return replyManualPending(ctx, uid, result, prod.name, 0);
    }

    if (result.stockRemaining <= 3) {
      alertAdminLowStock(result.productName, result.stockRemaining);
      if (result.stockRemaining === 0) notifyRestockSubscribers(bot, productId, result.productName).catch(() => {});
    }
    sendRatingRequest(bot, uid, result.orderId, result.productName);

    const itemsBlock2 = result.redeemLink
      ? `1. <code>${escHtml(result.redeemLink)}</code>`
      : `📧 <code>${escHtml(result.accountEmail)}</code>\n` +
        `🔑 <code>${escHtml(result.accountPassword)}</code>`;

    await safeEdit(ctx,
      `✅ <b>Order Delivered!</b>\n\n` +
      `<code>` +
      `Product:    ${escHtml(prod.name)}\n` +
      `Quantity:   1\n` +
      `Total Paid: ${result.finalPrice.toFixed(2)} USDT\n` +
      `</code>\n` +
      `📦 <b>${escHtml(prod.name)}</b> × 1\n\n` +
      `${itemsBlock2}\n\n` +
      `💰 Balance: <b>${fmt$(result.newBalance)}</b>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📦  My Orders", "shop_view_orders")],
          [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
        ]),
      }
    );
  });

  // ── Deposit info (inline) ─────────────────────────────────────────────────
  bot.action("shop_deposit_info", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    await safeEdit(ctx, depositText(uid), {
      parse_mode: "HTML",
      ...depositMethodKeyboard(true),
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

  // ── Back to method selection ───────────────────────────────────────────────
  bot.action("dep_back_methods", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    return safeEdit(ctx, depositText(uid), { parse_mode: "HTML", ...depositMethodKeyboard(false) });
  });

  // ── Payment method detail screens ─────────────────────────────────────────
  bot.action("dep_method_binance", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return safeEdit(ctx,
      `${ae("money", "🟡")} <b>Binance Pay</b>  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Send USDT to this Binance ID:\n\n` +
      `<code>  🟡  Binance ID  ›  510120124</code>\n\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `${ae("bolt", "⚡")} Balance credited <b>instantly</b> after Binance confirms — tap <b>Auto Verify</b> to get your unique transfer note.\n\n` +
      `<i>Min deposit: <b>$1.00 USDT</b></i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📋  Copy ID", "dep_copy_binance"), Markup.button.callback("⚡  Auto Verify  ·  Instant", "dep_auto_binance")],
          [Markup.button.callback("‹  Back",     "dep_back_methods")],
        ]),
      }
    );
  });

  bot.action("dep_method_trc20", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return safeEdit(ctx,
      `${ae("diamond", "💎")} <b>USDT TRC20</b>  ·  Tron  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Send USDT (TRC20) to this address:\n\n` +
      `<code>TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB</code>\n\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `${ae("bolt", "⚡")} <b>Auto Verify</b> — We assign you a unique amount so your payment is matched automatically once the blockchain confirms.\n\n` +
      `<i>Min deposit: <b>$1.00 USDT</b>  ·  Network: <b>TRON (TRC20)</b></i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📋  Copy Address", "dep_copy_trc20"), Markup.button.callback("💎  Auto Verify  ·  Instant", "dep_auto_trc20")],
          [Markup.button.callback("‹  Back",          "dep_back_methods")],
        ]),
      }
    );
  });

  bot.action("dep_method_bep20", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return safeEdit(ctx,
      `${ae("bep20", "🔷")} <b>USDT BEP20</b>  ·  BSC  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Send USDT (BEP20) to this address:\n\n` +
      `<code>0x107fc554bba4cadd5c4e9f1e189d7dd93770202e</code>\n\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `${ae("bolt", "⚡")} <b>Auto Verify</b> — We assign you a unique amount so your payment is matched automatically once the blockchain confirms.\n\n` +
      `<i>Min deposit: <b>$1.00 USDT</b>  ·  Network: <b>BNB Smart Chain (BEP20)</b></i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📋  Copy Address", "dep_copy_bep20"), Markup.button.callback("🔷  Auto Verify  ·  Instant", "dep_auto_bep20")],
          [Markup.button.callback("‹  Back",          "dep_back_methods")],
        ]),
      }
    );
  });

  bot.action("dep_method_upi", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return safeEdit(ctx,
      `${ae("upi", "🇮🇳")} <b>UPI Payment</b>  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Send to this UPI ID:\n\n` +
      `<code>  🇮🇳  UPI ID  ›  avinashaddison-8@okaxis</code>\n\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `${ae("bolt", "⚡")} Tap <b>Auto Verify</b> — enter the amount, pay, then submit your UTR number for instant balance credit.\n\n` +
      `<i>Min deposit: <b>$1.00</b> · Rate: <b>$1 = ₹${UPI_RATE}</b></i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⚡  Auto Verify  ·  Instant", "dep_auto_upi")],
          [Markup.button.callback("📋  Copy UPI ID", "dep_copy_upi"), Markup.button.callback("📸  Submit Proof", "dep_submit_proof")],
          [Markup.button.callback("‹  Back",         "dep_back_methods")],
        ]),
      }
    );
  });

  // ── UPI Auto-Verify flow ──────────────────────────────────────────────────
  bot.action("dep_auto_upi", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    upiDepositFlows.set(uid, { step: "waiting_amount" });
    await safeReply(ctx,
      `${ae("upi", "🇮🇳")} <b>UPI Auto Verify</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Enter the amount you want to deposit <b>in USD</b>:\n\n` +
      `<i>Example: <code>10</code>  →  you will pay ₹${UPI_RATE * 10}</i>\n` +
      `<i>Min: <b>$1.00</b>  ·  Rate: <b>$1 = ₹${UPI_RATE}</b></i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("✖  Cancel", "dep_upi_cancel")]]),
      }
    );
  });

  bot.action("dep_upi_cancel", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    upiDepositFlows.delete(uid);
    return safeEdit(ctx,
      `${ae("upi", "🇮🇳")} <b>UPI Payment</b>  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Send to this UPI ID:\n\n` +
      `<code>  🇮🇳  UPI ID  ›  avinashaddison-8@okaxis</code>\n\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `${ae("bolt", "⚡")} Tap <b>Auto Verify</b> — enter the amount, pay, then submit your UTR number for instant balance credit.\n\n` +
      `<i>Min deposit: <b>$1.00</b> · Rate: <b>$1 = ₹${UPI_RATE}</b></i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⚡  Auto Verify  ·  Instant", "dep_auto_upi")],
          [Markup.button.callback("📋  Copy UPI ID", "dep_copy_upi"), Markup.button.callback("📸  Submit Proof", "dep_submit_proof")],
          [Markup.button.callback("‹  Back",         "dep_back_methods")],
        ]),
      }
    );
  });

  bot.action("dep_upi_paid", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid  = ctx.from.id;
    const flow = upiDepositFlows.get(uid);
    if (!flow || !flow.amountInr) {
      await ctx.answerCbQuery("Session expired. Please start over.", { show_alert: true });
      return;
    }
    flow.step = "waiting_utr";
    await safeReply(ctx,
      `🔖 <b>Enter your UTR number</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Please enter the <b>UTR / Reference number</b> shown in your UPI payment confirmation.\n\n` +
      `<i>It's a 12-digit number, e.g. <code>602487211999</code></i>\n\n` +
      `We will verify the payment automatically against your bank alert.`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("✖  Cancel", "dep_upi_cancel")]]),
      }
    );
  });

  bot.action("dep_upi_recheck", async (ctx) => {
    await ctx.answerCbQuery("Rechecking…").catch(() => {});
    const uid  = ctx.from.id;
    const flow = upiDepositFlows.get(uid);
    if (!flow || flow.step !== "waiting_utr" || !flow.amountInr) {
      await ctx.answerCbQuery("Session expired. Please start over.", { show_alert: true });
      return;
    }
    // Re-ask for UTR (user has to re-enter it after a recheck)
    await safeReply(ctx,
      `🔖 <b>Enter your UTR number again</b>\n\n` +
      `Please re-enter the UTR number to retry verification:`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("✖  Cancel", "dep_upi_cancel")]]),
      }
    );
  });

  // ── Activation Service — keyboard button handlers ─────────────────────────
  async function showActivationMenu(ctx: any, service: ActivationService, trending = false) {
    const emoji = ACTIVATION_EMOJI[service];
    const name  = ACTIVATION_LABEL[service];
    const price = ACTIVATION_PRICE.toFixed(2);

    const trendingHeader = trending
      ? `🔥  <b>TRENDING  ·  TOP PICK</b>\n<code>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`
      : "";

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
      `${trendingHeader}` +
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
          [Markup.button.callback(`🔙  BACK TO MENU`, `act_back`)],
        ]),
      }
    );
  }

  // ── Dynamic sticky-product keyboard handler ──────────────────────────────
  // Legacy exact-string fallbacks (users who still have old cached keyboards)
  bot.hears(
    ["🤖  𝗖𝗵𝗮𝘁𝗚𝗣𝗧  𝗣𝗹𝘂𝘀  ·  $2", "֎  𝗖𝗵𝗮𝘁𝗚𝗣𝗧  𝗣𝗹𝘂𝘀  ·  $2"],
    async (ctx) => {
      await upsertCustomer(ctx.from.id, ctx.from.username, ctx.from.first_name);
      await showActivationMenu(ctx, "chatgpt_plus");
    }
  );
  bot.hears(
    ["🔵  𝗥𝗲𝗽𝗹𝗶𝘁  𝗖𝗼𝗿𝗲  ·  $2"],
    async (ctx) => {
      await upsertCustomer(ctx.from.id, ctx.from.username, ctx.from.first_name);
      await showActivationMenu(ctx, "replit_core");
    }
  );

  // Dynamic handler: if the user taps any sticky product button, route to it
  bot.use(async (ctx: any, next: any) => {
    if (ctx.updateType !== "message" || !ctx.message?.text) return next();
    const text = ctx.message.text as string;
    const res = await dbQuery(
      `SELECT id, name, account_type, sticky_label FROM shop_products WHERE sticky = true AND active = true ORDER BY sort_order ASC, created_at ASC`
    );
    const match = res.rows.find((p: any, i: number) => {
      const base = (p.sticky_label ?? "").trim() || p.name;
      const displayLabel = stickyDisplayLabel(base, i);
      return displayLabel === text || base === text || toBold(base) === text;
    });
    if (!match) return next();
    await upsertCustomer(ctx.from.id, ctx.from.username, ctx.from.first_name);
    const at: string = match.account_type;
    if (at === "chatgpt_plus" || at === "replit_core") {
      await showActivationMenu(ctx, at as ActivationService, true);
    } else {
      shopState.set(ctx.from.id, { selectedProductId: match.id });
      await showProductList(ctx);
    }
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
      return safeEdit(ctx,
        insufficientFundsMsg({ productName: `${name} Activation`, productEmoji: emoji, required: ACTIVATION_PRICE, balance }),
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")],
            [Markup.button.callback("🔙  BACK", "act_back")],
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
      return safeEdit(ctx,
        insufficientFundsMsg({ productName: `${name} Account`, productEmoji: emoji, required: ACTIVATION_PRICE, balance }),
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")],
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
        return safeEdit(ctx,
          insufficientFundsMsg({ productName: `${name} Account`, productEmoji: emoji, required: ACTIVATION_PRICE, balance: bal }),
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")],
              [Markup.button.callback("🔙  BACK", "act_back")],
            ]),
          }
        );
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
          insufficientFundsMsg({ required: ACTIVATION_PRICE, balance: bal }),
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")],
              [Markup.button.callback("🛍  BACK TO SHOP", "shop_back_products")],
            ]),
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

    // ── Crypto auto-verify — amount input ─────────────────────────────────────
    const cryptoFlow = cryptoDepositFlows.get(uid);
    if (cryptoFlow && cryptoFlow.step === "waiting_amount") {
      const raw    = ctx.message.text?.trim() ?? "";
      const baseAmt = parseFloat(raw);
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
      if (isNaN(baseAmt) || baseAmt < 1) {
        return safeReply(ctx,
          `⚠️ <b>Invalid amount.</b> Please enter a number ≥ 1 (e.g. <code>10</code> or <code>25.50</code>):`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", "dep_auto_cancel")]]),
          }
        );
      }
      const chain = cryptoFlow.chain ?? "BINANCE_PAY";
      // Create order (on-chain orders get unique cent suffix inside createOrder)
      let order: Awaited<ReturnType<typeof createOrder>>;
      try {
        order = await createOrder({ userId: String(uid), amount: baseAmt, chain });
      } catch (err: any) {
        cryptoDepositFlows.delete(uid);
        return safeReply(ctx,
          `❌ <b>Failed to create order.</b> Please try again later.\n<i>${escHtml(err?.message ?? "Unknown error")}</i>`,
          { parse_mode: "HTML" }
        );
      }
      const exactAmt = order.amount;
      cryptoDepositFlows.set(uid, {
        step:    "waiting_payment",
        chain,
        orderId: order.orderId,
        note:    order.note,
        amount:  exactAmt,
      });

      // Build chain-specific payment instructions
      let payMsg = "";
      if (chain === "BINANCE_PAY") {
        payMsg =
          `╔══════════════════════════════════════╗\n` +
          `║  ⚡  <b>AUTO VERIFY — PAY NOW</b>  ║\n` +
          `╚══════════════════════════════════════╝\n\n` +
          `Send exactly:\n\n` +
          `<b>Amount:</b>  <code>${exactAmt.toFixed(2)} USDT</code>\n` +
          `<b>To Binance ID:</b>  <code>510120124</code>\n\n` +
          `${divider()}\n\n` +
          `<b>IMPORTANT — Payment Note / Reference:</b>\n` +
          `<code>${order.note}</code>\n\n` +
          `${divider()}\n\n` +
          `<i>Include the note above in the <b>Binance Pay transfer note / message</b> field.\n` +
          `Your balance will be credited <b>automatically</b> once we detect the payment (usually within 25 seconds).\n\n` +
          `Order expires in <b>30 minutes</b>.</i>`;
      } else if (chain === "TRC20") {
        payMsg =
          `╔══════════════════════════════════════╗\n` +
          `║  💎  <b>AUTO VERIFY — TRC20</b>  ║\n` +
          `╚══════════════════════════════════════╝\n\n` +
          `Send <b>exactly this amount</b> to our TRC20 wallet:\n\n` +
          `<b>Amount:</b>  <code>${exactAmt.toFixed(2)} USDT</code>\n` +
          `<b>Network:</b>  <code>TRON (TRC20)</code>\n` +
          `<b>Address:</b>\n<code>TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB</code>\n\n` +
          `${divider()}\n\n` +
          `<b>Reference Note:</b>  <code>${order.note}</code>\n\n` +
          `${divider()}\n\n` +
          `<b>⚠️ Send the EXACT amount shown above.</b>\n` +
          `<i>The unique amount identifies your payment automatically. Do not send a rounded number.\n\n` +
          `Your balance will be credited once the blockchain confirms the transfer (usually within 1-2 minutes).\n\n` +
          `Order expires in <b>30 minutes</b>.</i>`;
      } else {
        payMsg =
          `╔══════════════════════════════════════╗\n` +
          `║  🔷  <b>AUTO VERIFY — BEP20</b>  ║\n` +
          `╚══════════════════════════════════════╝\n\n` +
          `Send <b>exactly this amount</b> to our BEP20 wallet:\n\n` +
          `<b>Amount:</b>  <code>${exactAmt.toFixed(2)} USDT</code>\n` +
          `<b>Network:</b>  <code>BNB Smart Chain (BEP20)</code>\n` +
          `<b>Address:</b>\n<code>0x107fc554bba4cadd5c4e9f1e189d7dd93770202e</code>\n\n` +
          `${divider()}\n\n` +
          `<b>Reference Note:</b>  <code>${order.note}</code>\n\n` +
          `${divider()}\n\n` +
          `<b>⚠️ Send the EXACT amount shown above.</b>\n` +
          `<i>The unique amount identifies your payment automatically. Do not send a rounded number.\n\n` +
          `Your balance will be credited once the blockchain confirms the transfer (usually within 1-2 minutes).\n\n` +
          `Order expires in <b>30 minutes</b>.</i>`;
      }

      return safeReply(ctx, payMsg, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔄  Check Status", "dep_auto_check")],
          [Markup.button.callback("❌  Cancel Order",  "dep_auto_cancel")],
        ]),
      });
    }

    // ── UPI auto-verify — amount input ───────────────────────────────────────
    const upiFlow = upiDepositFlows.get(uid);
    if (upiFlow) {
      const raw = ctx.message.text?.trim() ?? "";
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});

      if (upiFlow.step === "waiting_amount") {
        const amtUsd = parseFloat(raw);
        if (isNaN(amtUsd) || amtUsd < 1) {
          return safeReply(ctx,
            `⚠️ <b>Invalid amount.</b> Enter a number ≥ 1 (e.g. <code>10</code>):`,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([[Markup.button.callback("✖  Cancel", "dep_upi_cancel")]]),
            }
          );
        }
        const amtInr = Math.round(amtUsd * UPI_RATE * 100) / 100;
        upiFlow.amountUsd = amtUsd;
        upiFlow.amountInr = amtInr;
        // Keep step as waiting_amount until user taps "I've Paid"

        // Build UPI deep-link — amount pre-filled so the user just scans & confirms
        const upiPayload = `upi://pay?pa=avinashaddison-8@okaxis&pn=Project%20Addison&am=${amtInr.toFixed(2)}&cu=INR`;

        const caption =
          `🇮🇳 <b>UPI Auto Verify  ·  ⚡ Instant</b>\n` +
          `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
          `📱 <b>Scan the QR code</b> with any UPI app\n` +
          `<i>(GPay, PhonePe, Paytm, BHIM — amount is pre-filled)</i>\n\n` +
          `Or pay manually:\n` +
          `<b>Amount:</b>  <code>₹${amtInr.toFixed(2)}</code>\n` +
          `<b>UPI ID:</b>  <code>avinashaddison-8@okaxis</code>\n\n` +
          `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
          `After paying, tap <b>I've Paid</b> and enter your UTR for instant credit.\n\n` +
          `<i>You pay: ₹${amtInr.toFixed(2)}  →  Get: $${amtUsd.toFixed(2)} USDT</i>`;

        const replyMarkup = {
          inline_keyboard: [
            [{ text: "✅  I've Paid — Enter UTR", callback_data: "dep_upi_paid" }],
            [{ text: "📋  Copy UPI ID",            callback_data: "dep_copy_upi"  }],
            [{ text: "✖  Cancel",                  callback_data: "dep_upi_cancel" }],
          ],
        };

        try {
          // Generate QR locally — no external API call, guaranteed valid PNG buffer
          const qrBuf = await QRCode.toBuffer(upiPayload, {
            type: "png",
            width: 360,
            margin: 2,
            color: { dark: "#000000", light: "#ffffff" },
          });

          // Use raw multipart FormData upload — most reliable way to send binary
          // files to Telegram (Telegraf's source:{} wrapper can cause DOCUMENT_INVALID)
          const form = new FormData();
          form.append("chat_id",      String(ctx.chat.id));
          form.append("caption",      caption);
          form.append("parse_mode",   "HTML");
          form.append("reply_markup", JSON.stringify(replyMarkup));
          form.append("photo",        new Blob([qrBuf], { type: "image/png" }), "upi_qr.png");

          const tgRes = await fetch(
            `https://api.telegram.org/bot${token}/sendPhoto`,
            { method: "POST", body: form }
          );
          const tgJson = await tgRes.json() as any;
          if (!tgJson.ok) throw new Error(tgJson.description ?? "Telegram sendPhoto failed");
        } catch (photoErr: any) {
          console.error("[UPI QR] Failed to send QR photo:", photoErr?.message);
          // Fallback to text if photo send fails for any reason
          await safeReply(ctx, caption, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("✅  I've Paid — Enter UTR", "dep_upi_paid")],
              [Markup.button.callback("📋  Copy UPI ID", "dep_copy_upi")],
              [Markup.button.callback("✖  Cancel", "dep_upi_cancel")],
            ]),
          });
        }
        return;
      }

      if (upiFlow.step === "waiting_utr") {
        const utr = raw.replace(/\s+/g, "").replace(/[^0-9]/g, "");
        if (utr.length < 6) {
          return safeReply(ctx,
            `⚠️ <b>Invalid UTR.</b> Please enter the full UTR/reference number from your payment confirmation:`,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([[Markup.button.callback("✖  Cancel", "dep_upi_cancel")]]),
            }
          );
        }

        // Show checking message
        const checkMsg = await safeReply(ctx,
          `🔍 <b>Verifying payment…</b>\n\n` +
          `Checking UTR <code>${utr}</code> against bank records.\n` +
          `<i>This may take up to 30 seconds…</i>`,
          { parse_mode: "HTML" }
        );

        // Check for duplicate UTR
        const dupCheck = await dbQuery(`SELECT id FROM upi_orders WHERE utr = $1`, [utr]);
        if (dupCheck.rows.length > 0) {
          return safeReply(ctx,
            `⚠️ <b>UTR Already Used</b>\n\n` +
            `This UTR <code>${utr}</code> has already been processed.\n\n` +
            `If this is a mistake, contact ${SUPPORT_CONTACT}.`,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([[Markup.button.callback("✖  Done", "dep_upi_cancel")]]),
            }
          );
        }

        // Search Gmail for matching Axis Bank email
        const payInfo = await searchUpiPaymentEmail(utr, 48);

        if (!payInfo) {
          return safeReply(ctx,
            `❌ <b>Payment Not Detected</b>\n\n` +
            `Could not find a bank alert for UTR <code>${utr}</code>.\n\n` +
            `Possible reasons:\n` +
            `  · The bank alert email hasn't arrived yet (can take 1–2 min)\n` +
            `  · The UTR number may be incorrect\n\n` +
            `<i>Try again in a moment, or contact ${SUPPORT_CONTACT} if the issue persists.</i>`,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([
                [Markup.button.callback("🔄  Try Again", "dep_upi_recheck")],
                [Markup.button.callback("✖  Cancel", "dep_upi_cancel")],
              ]),
            }
          );
        }

        // Verify amount (allow ±5% tolerance for rounding/fees)
        const expectedInr = upiFlow.amountInr ?? 0;
        const tolerance   = Math.max(expectedInr * 0.05, 1);
        if (Math.abs(payInfo.amountInr - expectedInr) > tolerance) {
          return safeReply(ctx,
            `⚠️ <b>Amount Mismatch</b>\n\n` +
            `Expected: <b>₹${expectedInr.toFixed(2)}</b>\n` +
            `Received: <b>₹${payInfo.amountInr.toFixed(2)}</b>\n\n` +
            `The credited amount does not match. Contact ${SUPPORT_CONTACT} for manual resolution.`,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([[Markup.button.callback("✖  Done", "dep_upi_cancel")]]),
            }
          );
        }

        // All checks passed — credit the wallet
        const amtUsd = Math.round((payInfo.amountInr / UPI_RATE) * 100) / 100;

        await dbQuery(
          `INSERT INTO upi_orders (utr, user_id, amount_inr, amount_usd, sender_name, sender_bank)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [utr, String(uid), payInfo.amountInr.toFixed(2), amtUsd.toFixed(2), payInfo.senderName, payInfo.senderBank]
        );

        await dbQuery(
          `UPDATE shop_customers SET balance = balance + $1 WHERE telegram_id = $2`,
          [amtUsd.toFixed(2), uid]
        );

        upiDepositFlows.delete(uid);

        const newBal = await getBalance(uid);

        await safeReply(ctx,
          `╔══════════════════════════════════════╗\n` +
          `║  ✅  <b>PAYMENT CONFIRMED!</b>  ║\n` +
          `╚══════════════════════════════════════╝\n\n` +
          `<b>+${amtUsd.toFixed(2)} USDT</b> has been added to your wallet.\n\n` +
          `🇮🇳 <b>INR paid:</b> <code>₹${payInfo.amountInr.toFixed(2)}</code>\n` +
          `🔖 <b>UTR:</b> <code>${utr}</code>\n` +
          (payInfo.senderName ? `👤 <b>Sender:</b> <code>${escHtml(payInfo.senderName)}</code>\n` : "") +
          `\n💰 <b>New balance:</b> <code>$${newBal.toFixed(2)}</code>`,
          { parse_mode: "HTML" }
        );

        // Notify admins
        const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "Unknown";
        notifyAdminsUpiPayment(uid, uname, utr, payInfo.amountInr, amtUsd, payInfo.senderName, payInfo.senderBank);

        return;
      }

      return; // in some UPI flow step — consumed
    }

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
      ? `${ae("crown", "👑")} <b>VIP Member</b>`
      : `🎯 VIP at <b>${fmt$(VIP_THRESHOLD)}</b> total spend  <i>(${fmt$(spend)} so far)</i>`;
    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  ${ae("money", "💰")}  <b>MY WALLET</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `<code>  💵 Balance    ›  ${fmt$(balance)}\n` +
      `  🆔 User ID    ›  ${uid}</code>\n\n` +
      `${statusLine}\n\n` +
      `<i>Tap below to add funds to your wallet.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")]]),
      }
    );
  });

  // ── Deposit ───────────────────────────────────────────────────────────────
  function depositText(uid: number): string {
    return (
      `${ae("card", "💳")} <b>ADD FUNDS</b>\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `Select a payment method below to deposit USDT into your wallet.\n\n` +
      `<code>  🪪  Your ID   ›  ${uid}\n` +
      `  ⚡  Minimum  ›  $1.00 USDT</code>\n\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>`
    );
  }

  // Returns the clean method-select keyboard (full-width buttons per method)
  function depositMethodKeyboard(withBack = false) {
    const rows: ReturnType<typeof Markup.button.callback>[][] = [
      [Markup.button.callback("⚡  Binance Pay  ·  Instant",         "dep_method_binance")],
      [Markup.button.callback("💎  USDT TRC20  ·  Tron  ·  Instant", "dep_method_trc20")],
      [Markup.button.callback("🔷  USDT BEP20  ·  BSC  ·  Instant",  "dep_method_bep20")],
      [Markup.button.callback("🇮🇳  UPI Payment  ·  Instant",            "dep_method_upi")],
    ];
    if (withBack) rows.push([Markup.button.callback("🛍  Back to Shop", "shop_back_products")]);
    return Markup.inlineKeyboard(rows);
  }

  bot.hears(BTN.DEPOSIT, async (ctx) => {
    const uid = ctx.from.id;
    await safeReply(ctx, depositText(uid), {
      parse_mode: "HTML",
      ...depositMethodKeyboard(),
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

  // ── Auto Verify — Binance Pay ─────────────────────────────────────────────
  bot.action("dep_auto_binance", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    cryptoDepositFlows.set(uid, { step: "waiting_amount", chain: "BINANCE_PAY" });
    return safeEdit(ctx,
      `${ae("money", "🟡")} <b>Binance Pay</b>  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n\n` +
      `${divider()}\n\n` +
      `How much USDT do you want to deposit?\n\n` +
      `<i>Type the amount (e.g. <code>10</code> or <code>25.50</code>).\nMinimum: <b>$1.00 USDT</b></i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", "dep_auto_cancel")]]),
      }
    );
  });

  bot.action("dep_auto_trc20", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    cryptoDepositFlows.set(uid, { step: "waiting_amount", chain: "TRC20" });
    return safeEdit(ctx,
      `${ae("diamond", "💎")} <b>USDT TRC20</b>  ·  Tron  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n\n` +
      `${divider()}\n\n` +
      `How much USDT do you want to deposit?\n\n` +
      `<i>Type the amount (e.g. <code>10</code> or <code>25.50</code>).\nMinimum: <b>$1.00 USDT</b></i>\n\n` +
      `<i>We will assign you a unique amount to send so your payment can be matched automatically.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", "dep_auto_cancel")]]),
      }
    );
  });

  bot.action("dep_auto_bep20", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    cryptoDepositFlows.set(uid, { step: "waiting_amount", chain: "BEP20" });
    return safeEdit(ctx,
      `${ae("bep20", "🔷")} <b>USDT BEP20</b>  ·  BSC  ·  ${ae("bolt", "⚡")} <b>Instant</b>\n\n` +
      `${divider()}\n\n` +
      `How much USDT do you want to deposit?\n\n` +
      `<i>Type the amount (e.g. <code>10</code> or <code>25.50</code>).\nMinimum: <b>$1.00 USDT</b></i>\n\n` +
      `<i>We will assign you a unique amount to send so your payment can be matched automatically.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("❌  Cancel", "dep_auto_cancel")]]),
      }
    );
  });

  bot.action("dep_auto_cancel", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    cryptoDepositFlows.delete(uid);
    return safeEdit(ctx, `❌ <i>Cancelled.</i>`, { parse_mode: "HTML" });
  });

  bot.action("dep_auto_check", async (ctx) => {
    await ctx.answerCbQuery("Checking payment…").catch(() => {});
    const uid  = ctx.from.id;
    const flow = cryptoDepositFlows.get(uid);
    if (!flow || flow.step !== "waiting_payment" || !flow.orderId) {
      return safeEdit(ctx,
        `⚠️ <i>No active payment order found. Please start a new deposit.</i>`,
        { parse_mode: "HTML" }
      );
    }
    const chain = flow.chain ?? "BINANCE_PAY";
    let statusLines = `<b>Amount:</b> <code>${flow.amount!.toFixed(2)} USDT</code>\n`;
    if (chain === "BINANCE_PAY") {
      statusLines += `<b>Note:</b> <code>${flow.note}</code>\n`;
    } else if (chain === "TRC20") {
      statusLines += `<b>Address:</b> <code>TTvcMqHZ2BDYp6G9QQVd7jxMCmarrUjGaB</code>\n<b>Network:</b> TRON (TRC20)\n<b>Reference Note:</b> <code>${flow.note}</code>\n`;
    } else {
      statusLines += `<b>Address:</b> <code>0x107fc554bba4cadd5c4e9f1e189d7dd93770202e</code>\n<b>Network:</b> BNB Smart Chain (BEP20)\n<b>Reference Note:</b> <code>${flow.note}</code>\n`;
    }
    return safeEdit(ctx,
      `⏳ <b>Still waiting for payment…</b>\n\n` +
      `${divider()}\n\n` +
      `Our system checks every ~25 seconds. Your balance will be credited automatically once the transfer is detected.\n\n` +
      statusLines,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔄  Check Again", "dep_auto_check")],
          [Markup.button.callback("❌  Cancel Order", "dep_auto_cancel")],
        ]),
      }
    );
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
      `║  ${ae("check", "✅")}  <b>PROOF SUBMITTED!</b>  ║\n` +
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
      ? `${ae("crown", "👑")} <b>VIP Member</b>`
      : `🎯 VIP at <b>${fmt$(VIP_THRESHOLD)}</b> total spend`;
    await safeReply(ctx,
      `╔══════════════════════════════════════╗\n` +
      `║  👤  <b>MY PROFILE</b>${vip ? `  ${ae("crown", "👑")}` : ""}  ║\n` +
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
      { parse_mode: "HTML", ...(await buildShopKeyboard()) }
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
      `SELECT id, product_name, amount, account_type, created_at, delivery_status
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
      const isPending = o.delivery_status === "pending_delivery";
      const statusTag = isPending ? "  ⏳" : "";
      lines.push(`${emoji} <b>${escHtml(o.product_name)}</b>${statusTag}  —  ${fmt$(o.amount)}  —  <i>${date}</i>`);
      const btnLabel = isPending
        ? `⏳  Order #${i + 1}: ${o.product_name}  (pending)`
        : `🔑  Reveal #${i + 1}: ${o.product_name}`;
      return [Markup.button.callback(btnLabel, `shop_creds_${o.id}`)];
    });

    lines.push(`\n${divider()}\n<i>Tap an order to view details or reveal credentials.</i>`);

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
      `SELECT product_name, account_type, account_email, account_password, amount,
              created_at, delivery_status, fulfillment_note
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

    const isPending = o.delivery_status === "pending_delivery";
    const isManualDelivered = o.delivery_status === "delivered" && o.fulfillment_note;

    let contentBlock: string;
    if (isPending) {
      contentBlock =
        `⏳ <b>Pending Delivery</b>\n\n` +
        `Your order is being processed. An admin will deliver your product shortly.\n\n` +
        `<i>You will receive the delivery directly in this chat.</i>`;
    } else if (isManualDelivered) {
      contentBlock =
        `✅ <b>Delivered</b>\n\n` +
        `<code>${escHtml(o.fulfillment_note)}</code>`;
    } else {
      contentBlock =
        `📧 <b>Email</b>\n<code>${escHtml(o.account_email ?? "")}</code>\n\n` +
        `🔑 <b>Password</b>\n<code>${escHtml(o.account_password ?? "")}</code>`;
    }

    await safeEdit(ctx,
      `🔑 <b>${isPending ? "Order Status" : "Credentials"}</b>\n\n` +
      `${emoji} <b>${escHtml(o.product_name)}</b>\n` +
      `<i>Purchased ${date}  ·  ${fmt$(o.amount)}</i>\n\n` +
      `${divider()}\n\n` +
      contentBlock,
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
      `║  ${ae("money", "💰")}  <b>MY WALLET</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `<code>  💵 Balance   ›  ${fmt$(balance)}\n` +
      `  🆔 User ID   ›  ${uid}</code>\n\n` +
      `<i>Tap Add Funds to top up your balance.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("💸  ADD FUNDS", "shop_deposit_info")]]),
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

  // ── Menu button web app data → show main menu ────────────────────────────
  bot.on("web_app_data", async (ctx: any) => {
    const data = ctx.message?.web_app_data?.data;
    if (data !== "open_menu") return;
    const uid = ctx.from.id;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    const name  = ctx.from.first_name || ctx.from.username || "User";
    const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await ctx.reply(
      truncate(
        `${ae("fire", "🔥")}  <b>${toBold("PROJECT ADDISON v2")}</b>  ${ae("fire", "🔥")}\n` +
        `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n` +
        `      Global AI Tools Marketplace\n` +
        `◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
        `👋  Hey, <b>${escHtml(name)}</b>!  Welcome back.\n\n` +
        `<b>💎  What you can do here:</b>\n` +
        `<blockquote>⚡  ${toBold("SHOP")}  —  Browse &amp; buy premium AI tools\n` +
        `💳  ${toBold("DEPOSIT")}  —  Instantly add funds to your wallet\n` +
        `👤  ${toBold("PROFILE")}  —  View balance, orders &amp; settings\n` +
        `🎧  ${toBold("SUPPORT")}  —  We\'re always here to help\n` +
        `🔗  ${toBold("REFER & EARN")}  —  Invite friends, earn rewards</blockquote>\n\n` +
        `<code>◈  💰  Balance   ›  ${fmt$(balance)}\n` +
        `◈  🔖  User      ›  ${uname}\n` +
        `◈  🆔  ID        ›  ${uid}</code>\n\n` +
        `<i>👇  Select an option from the menu below</i>`
      ),
      { parse_mode: "HTML", ...(await buildShopKeyboard()) }
    );
  });

  // ── Business Mail helpers ─────────────────────────────────────────────────
  function genBizPassword(): string {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!";
    return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  function alertAdminBizMailAllocated(email: string, password: string, telegramId: number, username: string | undefined) {
    const adminToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminIds   = (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (!adminToken || adminIds.length === 0) return;
    const uname = username ? `@${username}` : `ID ${telegramId}`;
    const text =
      `📩 <b>BIZ MAIL ALLOCATED</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📧 Email:     <code>${escHtml(email)}</code>\n` +
      `🔑 Password:  <code>${escHtml(password)}</code>\n` +
      `👤 User:      ${escHtml(uname)}  <code>(${telegramId})</code>\n\n` +
      `<i>Realtime inbox monitoring active for this user.</i>`;
    for (const id of adminIds) {
      fetch(`https://api.telegram.org/bot${adminToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML" }),
      }).catch(() => {});
    }
  }

  function startBizInboxPoller(smtpAccountId: string, email: string, telegramId: number) {
    if (!bizSeenIds.has(smtpAccountId)) bizSeenIds.set(smtpAccountId, new Set());
    const seen = bizSeenIds.get(smtpAccountId)!;
    console.log(`[ShopBot/BizMail] Polling inbox for ${email} → user ${telegramId}`);
    (async () => {
      while (true) {
        try {
          const msgs = await smtpDevInbox(smtpAccountId);
          for (const msg of msgs) {
            if (seen.has(msg.id)) continue;
            seen.add(msg.id);
            const body = (msg.text || msg.subject || "(no content)").substring(0, 3000);
            await bot.telegram.sendMessage(
              telegramId,
              `📬 <b>New Business Email!</b>\n\n` +
              `💼 <b>To:</b> <code>${escHtml(email)}</code>\n` +
              `👤 <b>From:</b> <code>${escHtml(msg.from)}</code>\n` +
              `📌 <b>Subject:</b> ${escHtml(msg.subject)}\n` +
              `📅 <b>Date:</b> ${new Date(msg.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n\n` +
              `<pre>${escHtml(body)}</pre>`,
              { parse_mode: "HTML" }
            ).catch(() => {});
          }
        } catch (_e) { /* retry silently */ }
        await new Promise(r => setTimeout(r, 3_000));
      }
    })();
  }

  async function showBizMailPanel(chatId: number, uid: number) {
    const mails  = await storage.getBizMailsByTelegramId(uid);
    const active = mails.filter(m => !m.deletedAt);
    let text =
      `📩 <b>BUSINESS MAIL</b>  ·  <i>@addison.asia</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (active.length === 0) {
      text += `<i>You have no active business email addresses yet.\nTap Generate to create one exclusively for you.</i>\n\n`;
    } else {
      text += `<b>Your Allocated Addresses:</b>\n\n`;
      for (const m of active) {
        const since = m.allocatedAt
          ? new Date(m.allocatedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
          : "—";
        text += `📧 <code>${escHtml(m.email)}</code>\n🔑 <code>${escHtml(m.password)}</code>\n📅 Since: ${since}\n\n`;
      }
      text += `🌐 <b>Webmail:</b> <a href="https://app.smtp.dev">app.smtp.dev</a>\n`;
      text += `📮 <b>IMAP:</b>    <code>imap.smtp.dev:993 (SSL)</code>\n`;
      text += `📤 <b>SMTP:</b>    <code>smtp.smtp.dev:587 (STARTTLS)</code>\n\n`;
      text += `<i>New emails are forwarded here in realtime.</i>`;
    }
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("📩  Generate New Mail", "bizmail_generate")]]),
    }).catch(() => {});
  }

  // ── Business Mail (Bot 2) — handlers ─────────────────────────────────────
  bot.hears(BTN.BIZ_MAIL, async (ctx) => {
    await upsertCustomer(ctx.from.id, ctx.from.username, ctx.from.first_name);
    await showBizMailPanel(ctx.chat.id, ctx.from.id);
  });

  bot.action("bizmail_generate", async (ctx) => {
    await ctx.answerCbQuery("Creating your business email…").catch(() => {});
    const uid      = ctx.from.id;
    const chatId   = ctx.chat!.id;
    const username = ctx.from.username;

    const loadMsg = await bot.telegram.sendMessage(chatId,
      `⏳ <b>Creating your business email address…</b>`, { parse_mode: "HTML" }
    ).catch(() => null);

    const address  = `user${uid}m${Date.now() % 100000}@addison.asia`;
    const password = genBizPassword();

    let smtpAccountId: string;
    try {
      const { account } = await smtpDevCreate(address, password);
      smtpAccountId = account.id;
    } catch (err: any) {
      if (loadMsg) {
        await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
          `❌ <b>Failed to create email account</b>\n<code>${escHtml(err.message?.substring(0, 200))}</code>`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
      return;
    }

    await storage.registerBizMailAccount(null, address, password, {
      allocatedTo: uid, smtpAccountId,
    });
    alertAdminBizMailAllocated(address, password, uid, username);
    startBizInboxPoller(smtpAccountId, address, uid);

    const card =
      `📩 <b>Business Email Allocated!</b>\n\n` +
      `📧 <b>Email:</b>     <code>${escHtml(address)}</code>\n` +
      `🔑 <b>Password:</b>  <code>${escHtml(password)}</code>\n\n` +
      `🌐 <b>Webmail:</b>   <a href="https://app.smtp.dev">app.smtp.dev</a>\n` +
      `📮 <b>IMAP:</b>      <code>imap.smtp.dev:993 (SSL)</code>\n` +
      `📤 <b>SMTP:</b>      <code>smtp.smtp.dev:587 (STARTTLS)</code>\n\n` +
      `<b>This address is exclusively yours.</b>\n` +
      `<i>Any emails sent to it will be forwarded here in realtime.</i>`;

    if (loadMsg) {
      await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined, card, {
        parse_mode: "HTML",
      }).catch(() => {});
    }

    await bot.telegram.sendMessage(chatId,
      `⏳ <b>Waiting for Mail…</b>\n\n` +
      `Your inbox is live. Any email delivered to <code>${escHtml(address)}</code> will appear here instantly.`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  });

  bot.action("bizmail_list", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showBizMailPanel(ctx.chat!.id, ctx.from!.id);
  });

  // Resume inbox polling for all allocated accounts on startup
  (async () => {
    try {
      const all = await storage.getAllAllocatedBizMails();
      for (const acc of all) {
        if (acc.smtpAccountId && acc.allocatedTo && !acc.deletedAt) {
          startBizInboxPoller(acc.smtpAccountId, acc.email, acc.allocatedTo);
          await new Promise(r => setTimeout(r, 100));
        }
      }
      if (all.length > 0) console.log(`[ShopBot/BizMail] Resumed polling for ${all.length} allocated accounts`);
    } catch (e: any) {
      console.error("[ShopBot/BizMail] Startup resume error:", e.message);
    }
  })();

  // ── Fallback: any unrecognised text → info card only, NO keyboard ────────
  // Intentionally no reply keyboard here — sending a keyboard on every message
  // keeps it permanently active, which hides the "Menu" button in the input bar.
  // Users can tap the Menu button or use /start / /menu to get the keyboard.
  bot.on("text", async (ctx: any) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    pushMenuButton(ctx.chat.id).catch(() => {});
    const name = ctx.from.first_name || ctx.from.username || "User";
    await safeReply(
      ctx,
      `${ae("fire", "🔥")}  <b>${toBold("PROJECT ADDISON v2")}</b>  ${ae("fire", "🔥")}\n` +
      `<code>◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈\n` +
      `      Global AI Tools Marketplace\n` +
      `◈━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━◈</code>\n\n` +
      `👋  Hey, <b>${escHtml(name)}</b>!  Tap the <b>Menu</b> button to navigate.`,
      // Explicitly remove any active reply keyboard so the "Menu" button in the
      // input bar becomes visible again.
      { parse_mode: "HTML", ...Markup.removeKeyboard() }
    );
  });

  // ── Register commands ─────────────────────────────────────────────────────
  async function registerCommands() {
    try {
      // Register the command list (shown when user taps the blue "Menu" button).
      // Descriptions shown in the command list popup that appears when Menu is tapped.
      await bot.telegram.setMyCommands([
        { command: "start", description: "🚀 Main Menu" },
      ]);
      // Set global default to type:"commands"
      await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_button: { type: "commands" } }),
      });
      console.log("[ShopBot] Commands registered");
    } catch (e: any) {
      console.error("[ShopBot] Failed to register commands:", e.message);
    }
  }

  // ── Launch with retry ─────────────────────────────────────────────────────
  // IMPORTANT: bot.launch() in long-polling mode blocks forever (resolves only
  // when bot.stop() is called).  Any code after `await bot.launch()` would NEVER
  // run.  We must NOT await it — start polling as a background task and then
  // call registerCommands() immediately after.
  async function launch(attempt = 1) {
    try {
      await registerCommands();   // ← register BEFORE launch so commands are set
      bot.launch({ dropPendingUpdates: true }).catch((err: any) => {
        console.error("[ShopBot] Polling error:", err?.message);
      });
      console.log("[ShopBot] Online — Project Addison v2 Marketplace");
    } catch (err: any) {
      const delay = Math.min(attempt * 5000, 60_000);
      console.error(`[ShopBot] Launch attempt ${attempt} failed: ${err.message} — retrying in ${delay / 1000}s`);
      setTimeout(() => launch(attempt + 1), delay);
    }
  }
  // ── Wire crypto payment-confirmed callback ────────────────────────────────
  // Called by the background payment checker when it detects a matched USDT
  // transfer on Binance.  Credits the customer balance and notifies via bot.
  setOnPaymentPaid(async (order) => {
    const telegramId = parseInt(order.userId, 10);
    const amount     = parseFloat(order.amount);

    // Credit balance in shop_customers (upsert-safe: only if the row exists)
    await dbQuery(
      `UPDATE shop_customers SET balance = balance + $1 WHERE telegram_id = $2`,
      [amount.toFixed(2), telegramId]
    );

    // Clear the user's in-memory crypto deposit flow (if still pending)
    cryptoDepositFlows.delete(telegramId);

    // Notify the user via Telegram
    const newBal = await getBalance(telegramId);
    await bot.telegram.sendMessage(
      telegramId,
      `╔══════════════════════════════════════╗\n` +
      `║  ✅  <b>PAYMENT CONFIRMED!</b>  ║\n` +
      `╚══════════════════════════════════════╝\n\n` +
      `<b>+${amount.toFixed(2)} USDT</b> has been added to your wallet.\n\n` +
      `💰 <b>New balance:</b> <code>$${newBal.toFixed(2)}</code>\n\n` +
      `<i>Reference: <code>${order.note}</code></i>`,
      { parse_mode: "HTML" }
    ).catch((err: any) => {
      console.error(`[ShopBot] Failed to send payment confirmation to ${telegramId}:`, err?.message);
    });
  });

  launch();

  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

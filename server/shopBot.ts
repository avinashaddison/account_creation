import { Telegraf, Markup } from "telegraf";
import { Pool, PoolClient } from "pg";

const SUPPORT_CONTACT = "@avinashaddison";

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

function truncate(text: string, limit = 4000): string {
  return text.length > limit ? text.slice(0, limit - 3) + "…" : text;
}

function escHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

function stockLine(stock: number): string {
  if (stock === 0) return "🔴  SOLD OUT";
  if (stock <= 5)  return `🟡  LOW — ×${stock} remaining`;
  return `🟢  IN STOCK — ×${stock} units`;
}

function buildProductCard(p: ProductWithStock, index: number): string {
  const platform = platformLabel(p.account_type);
  const desc     = p.description ? `\n  <i>${escHtml(p.description)}</i>` : "";
  return (
    `<b>${index + 1}. ${escHtml(p.name)}</b>${desc}\n` +
    `<code>` +
    `  Platform  ◈  ${platform}\n` +
    `  Price     ◈  ${fmt$(p.price)} / account\n` +
    `  Stock     ◈  ${stockLine(p.stock)}` +
    `</code>`
  );
}

function buildProductButtons(products: ProductWithStock[]) {
  return products.map((p) => {
    const icon      = p.stock > 0 ? "⚡" : "🔴";
    const stockText = p.stock > 0 ? `×${p.stock}` : "SOLD OUT";
    return [Markup.button.callback(
      `${icon}  ${p.name}  ·  ${fmt$(p.price)}  ·  ${stockText}`,
      `shop_product_${p.id}`
    )];
  });
}

// Convert text to mathematical sans-serif bold unicode (renders as a different font in Telegram)
// Must use [...str] spread to correctly iterate surrogate pairs (non-BMP chars)
function toBold(text: string): string {
  const upperChars = [..."𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭"];
  const lowerChars = [..."𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇"];
  return [...text].map(c => {
    const u = c.charCodeAt(0);
    if (u >= 65 && u <= 90) return upperChars[u - 65];
    if (u >= 97 && u <= 122) return lowerChars[u - 97];
    return c;
  }).join("");
}

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

// ── Main reply keyboard ────────────────────────────────────────────────────────
const BTN = {
  ACCOUNTS:  "🛍 // ACCOUNTS",
  BALANCE:   "💰 // BALANCE",
  ORDERS:    "📦 // MY ORDERS",
  DEPOSIT:   "➕ // DEPOSIT",
  IDENTITY:  "🪪 // MY ID",
  SUPPORT:   "💬 // SUPPORT",
} as const;

const SHOP_KEYBOARD = Markup.keyboard([
  [BTN.ACCOUNTS,  BTN.BALANCE],
  [BTN.ORDERS,    BTN.DEPOSIT],
  [BTN.IDENTITY,  BTN.SUPPORT],
]).resize();

// ── Per-user shop state ────────────────────────────────────────────────────────
interface ShopUserState {
  selectedProductId?: string;
}
const userState = new Map<number, ShopUserState>();
function getState(uid: number): ShopUserState {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid)!;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────
async function upsertCustomer(uid: number, username?: string, firstName?: string) {
  await dbQuery(
    `INSERT INTO shop_customers (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE
       SET username   = EXCLUDED.username,
           first_name = EXCLUDED.first_name`,
    [uid, username ?? null, firstName ?? null]
  );
}

async function getBalance(uid: number): Promise<number> {
  const r = await dbQuery(`SELECT balance FROM shop_customers WHERE telegram_id = $1`, [uid]);
  return parseFloat(r.rows[0]?.balance ?? "0");
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
}
interface PurchaseFailure {
  success: false;
  reason: "insufficient_funds" | "out_of_stock" | "product_not_found" | "error";
  shortfall?: number;
  message?: string;
}

async function purchaseProduct(
  uid: number,
  productId: string
): Promise<PurchaseResult | PurchaseFailure> {
  const prod = await getProductById(productId);
  if (!prod) return { success: false, reason: "product_not_found" };
  if (!prod.active) return { success: false, reason: "product_not_found" };

  const table = ACCOUNT_TABLE_MAP[prod.account_type];
  if (!table) return { success: false, reason: "error", message: "Unknown account type" };

  const price = parseFloat(prod.price);

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock customer row and check balance
    const custRes = await client.query(
      `SELECT balance FROM shop_customers WHERE telegram_id = $1 FOR UPDATE`,
      [uid]
    );
    if (!custRes.rows[0]) {
      await client.query("ROLLBACK");
      return { success: false, reason: "error", message: "Customer not found" };
    }
    const balance = parseFloat(custRes.rows[0].balance);
    if (balance < price) {
      await client.query("ROLLBACK");
      return {
        success: false,
        reason: "insufficient_funds",
        shortfall: parseFloat((price - balance).toFixed(2)),
      };
    }

    // Get and lock oldest available account (respects min_credits if set)
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

    // Deduct balance
    await client.query(
      `UPDATE shop_customers SET balance = balance - $1 WHERE telegram_id = $2`,
      [price, uid]
    );

    // Mark account as sold_out
    await client.query(`UPDATE ${table} SET status = 'sold_out' WHERE id = $1`, [accountId]);

    // Insert order (store credentials at purchase time)
    const orderRes = await client.query(
      `INSERT INTO shop_orders
         (telegram_id, product_id, product_name, account_id, account_email, account_password, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [uid, productId, prod.name, accountId, accountEmail, accountPassword, price]
    );

    await client.query("COMMIT");

    return {
      success: true,
      accountEmail,
      accountPassword,
      newBalance: balance - price,
      orderId: orderRes.rows[0].id,
    };
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[ShopBot] Purchase transaction error:", err.message);
    return { success: false, reason: "error", message: err.message };
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
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
  `);
  console.log("[ShopBot] Tables ready");
}

export function startShopBot(token: string) {
  if (!token) {
    console.warn("[ShopBot] No token provided — shop bot disabled");
    return;
  }

  const bot = new Telegraf(token);

  // ── Ensure DB tables exist before handling any messages ───────────────────
  ensureShopTables().catch((err) => console.error("[ShopBot] Table init error:", err.message));

  // ── Global error guard ────────────────────────────────────────────────────
  bot.catch((err: any, ctx: any) => {
    console.error("[ShopBot] Unhandled handler error:", err?.message || err);
    try {
      ctx?.answerCbQuery?.("An error occurred. Please try again.").catch(() => {});
    } catch {}
  });

  // ── /start ────────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const uid = ctx.from.id;
    // Set menu button for this specific chat so the "/" icon appears immediately
    bot.telegram.setChatMenuButton({
      chatId: ctx.chat.id,
      menuButton: { type: "commands" },
    }).catch(() => {});
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    const name = ctx.from.first_name || ctx.from.username || "User";
    const usernameDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await ctx.reply(
      truncate(
        `╔══[ PROJECT ADDISON v2 ]══╗\n` +
        `║   🔐  Digital Access Store   ║\n` +
        `╚══════════════════════════════╝\n\n` +
        `▸ Session initialized...\n` +
        `▸ Identity confirmed ✓\n\n` +
        `Hello, <b>${escHtml(name)}</b>\n\n` +
        `<code>◈ Balance   →  ${fmt$(balance)}\n` +
        `◈ Username  →  ${usernameDisplay}\n` +
        `◈ User ID   →  ${uid}</code>\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `  System online · Loading inventory...\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      ),
      { parse_mode: "HTML", ...SHOP_KEYBOARD }
    );
    // Auto-fetch and display live product list immediately
    await showProductList(ctx);
  });

  // ── /menu ─────────────────────────────────────────────────────────────────
  bot.command("menu", async (ctx) => {
    await ctx.reply("Use the menu below:", SHOP_KEYBOARD);
  });

  // ── Accounts ──────────────────────────────────────────────────────────────
  async function showProductList(ctx: any) {
    const products = await getProductsWithStock();
    if (products.length === 0) {
      return safeReply(ctx,
        `╔══[ INVENTORY ]══╗\n` +
        `║  ⚠ No Stock Found  ║\n` +
        `╚══════════════════╝\n\n` +
        `▸ No products online at this time.\n` +
        `→ Contact ${escHtml(SUPPORT_CONTACT)}`,
        { parse_mode: "HTML" }
      );
    }

    const header =
      `╔══[ 🛍 LIVE INVENTORY ]══════════════════╗\n` +
      `╚════════════════════════════════════════╝\n`;

    const cards = products.map((p, i) => buildProductCard(p, i)).join("\n\n─────────────────────────────────────────\n\n");

    await safeReply(ctx,
      header + cards + `\n\n─────────────────────────────────────────\n▸ Tap a product below to purchase:`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard(buildProductButtons(products)) }
    );
  }

  bot.hears(BTN.ACCOUNTS, async (ctx) => {
    await showProductList(ctx);
  });

  // ── Product detail ────────────────────────────────────────────────────────
  bot.action(/^shop_product_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const productId = (ctx.match as RegExpExecArray)[1];
    getState(ctx.from.id).selectedProductId = productId;

    const prod = await getProductById(productId);
    if (!prod || !prod.active) {
      return safeEdit(ctx, "This product is no longer available.");
    }

    const platform  = platformLabel(prod.account_type);
    const descLine  = prod.description ? `\n<i>${escHtml(prod.description)}</i>\n` : "";
    const inStock   = prod.stock > 0;
    const buyLabel  = inStock ? `⚡  BUY NOW  ·  ${fmt$(prod.price)}` : `🔴  OUT OF STOCK`;

    await safeEdit(
      ctx,
      `╔══[ PRODUCT DETAIL ]═════════════════════╗\n` +
      `╚════════════════════════════════════════╝\n\n` +
      `<b>${escHtml(prod.name)}</b>${descLine}\n` +
      `<code>` +
      `  Platform  ◈  ${platform}\n` +
      `  Price     ◈  ${fmt$(prod.price)} / account\n` +
      `  Stock     ◈  ${stockLine(prod.stock)}\n` +
      `</code>\n` +
      (inStock ? `▸ Confirm purchase below:` : `▸ This product is currently out of stock.`),
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          ...(inStock ? [[Markup.button.callback(buyLabel, `shop_buy_${productId}`)]] : []),
          [Markup.button.callback("‹  Back to Shop", "shop_back_products")],
        ]),
      }
    );
  });

  bot.action("shop_back_products", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const products = await getProductsWithStock();
    if (products.length === 0) {
      return safeEdit(ctx, "No products available right now. Check back soon!");
    }
    const header =
      `╔══[ 🛍 LIVE INVENTORY ]══════════════════╗\n` +
      `╚════════════════════════════════════════╝\n`;
    const cards = products.map((p, i) => buildProductCard(p, i)).join("\n\n─────────────────────────────────────────\n\n");
    await safeEdit(ctx,
      header + cards + `\n\n─────────────────────────────────────────\n▸ Tap a product below to purchase:`,
      { parse_mode: "HTML", ...Markup.inlineKeyboard(buildProductButtons(products)) }
    );
  });

  // ── Buy flow ──────────────────────────────────────────────────────────────
  bot.action(/^shop_buy_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Processing…").catch(() => {});
    const uid = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];

    // Ensure customer row exists
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);

    const prod = await getProductById(productId);
    if (!prod || !prod.active) {
      return safeEdit(ctx, "This product is no longer available.");
    }

    const balance = await getBalance(uid);
    const price = parseFloat(prod.price);

    if (balance < price) {
      const shortfall = (price - balance).toFixed(2);
      return safeEdit(
        ctx,
        `╔══[ ACCESS DENIED ]══════╗\n` +
        `║  ⚠  Insufficient Funds   ║\n` +
        `╚═════════════════════════╝\n\n` +
        `<code>◆ Product   →  ${escHtml(prod.name)}\n` +
        `◆ Required  →  ${fmt$(price)}\n` +
        `◆ Balance   →  ${fmt$(balance)}\n` +
        `◆ Shortfall →  $${shortfall}</code>\n\n` +
        `→ Contact ${escHtml(SUPPORT_CONTACT)} to top up`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("← Back to Products", "shop_back_products")],
          ]),
        }
      );
    }

    if (prod.stock === 0) {
      return safeEdit(
        ctx,
        `╔══[ UNAVAILABLE ]══╗\n` +
        `║  ⚠  Out of Stock   ║\n` +
        `╚═══════════════════╝\n\n` +
        `▸ <b>${escHtml(prod.name)}</b> has sold out.\n` +
        `→ Check back soon`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("← Back to Products", "shop_back_products")],
          ]),
        }
      );
    }

    const result = await purchaseProduct(uid, productId);

    if (!result.success) {
      if (result.reason === "insufficient_funds") {
        return safeEdit(
          ctx,
          `╔══[ ACCESS DENIED ]══════╗\n` +
          `║  ⚠  Insufficient Funds   ║\n` +
          `╚═════════════════════════╝\n\n` +
          `▸ Need <b>$${(result.shortfall ?? 0).toFixed(2)}</b> more.\n` +
          `→ Contact ${escHtml(SUPPORT_CONTACT)} to top up`,
          { parse_mode: "HTML" }
        );
      }
      if (result.reason === "out_of_stock") {
        return safeEdit(
          ctx,
          `╔══[ UNAVAILABLE ]══╗\n` +
          `║  ⚠  Out of Stock   ║\n` +
          `╚═══════════════════╝\n\n` +
          `▸ <b>${escHtml(prod.name)}</b> just sold out.\n` +
          `→ Check back soon`,
          { parse_mode: "HTML" }
        );
      }
      return safeEdit(
        ctx,
        `╔══[ ERROR ]══╗\n` +
        `║  ✖  Failed   ║\n` +
        `╚═════════════╝\n\n` +
        `▸ Something went wrong.\n` +
        `→ Contact ${escHtml(SUPPORT_CONTACT)} for help`,
        { parse_mode: "HTML" }
      );
    }

    // Success — send confirmation with credentials
    await safeEdit(
      ctx,
      `╔══[ TRANSACTION CONFIRMED ]══╗\n` +
      `║  ✅  Purchase Successful!    ║\n` +
      `╚═════════════════════════════╝\n\n` +
      `▸ <b>${escHtml(prod.name)}</b>\n\n` +
      `<code>LOGIN  →  ${escHtml(result.accountEmail)}\n` +
      `PASS   →  ${escHtml(result.accountPassword)}</code>\n\n` +
      `<code>◈ New balance  →  ${fmt$(result.newBalance)}</code>\n\n` +
      `⚠ <i>Credentials saved — access anytime via My Orders</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("← Back to Products", "shop_back_products")],
        ]),
      }
    );
  });

  // ── My Balance ────────────────────────────────────────────────────────────
  bot.hears(BTN.BALANCE, async (ctx) => {
    const uid = ctx.from.id;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    await safeReply(
      ctx,
      `╔══[ WALLET STATUS ]══╗\n` +
      `║  💰  Account Balance  ║\n` +
      `╚═════════════════════╝\n\n` +
      `<code>◈ Balance  →  ${fmt$(balance)}</code>\n\n` +
      `→ To top up: ${escHtml(SUPPORT_CONTACT)}`,
      { parse_mode: "HTML" }
    );
  });

  // ── Add Funds ─────────────────────────────────────────────────────────────
  bot.hears(BTN.DEPOSIT, async (ctx) => {
    await safeReply(
      ctx,
      `╔══[ DEPOSIT PORTAL ]══╗\n` +
      `║  ➕  Fund Your Account ║\n` +
      `╚══════════════════════╝\n\n` +
      `<code>◆ Contact  →  ${SUPPORT_CONTACT}\n` +
      `◆ Your ID  →  ${ctx.from.id}</code>\n\n` +
      `→ Send your User ID when requesting top-up`,
      { parse_mode: "HTML" }
    );
  });

  // ── Support ───────────────────────────────────────────────────────────────
  bot.hears(BTN.SUPPORT, async (ctx) => {
    await safeReply(
      ctx,
      `╔══[ SUPPORT ]══════╗\n` +
      `║  💬  Help Desk      ║\n` +
      `╚═══════════════════╝\n\n` +
      `<code>◆ Agent   →  ${SUPPORT_CONTACT}\n` +
      `◆ Status  →  Online</code>\n\n` +
      `→ Describe your issue clearly`,
      { parse_mode: "HTML" }
    );
  });

  // ── My Account ID ─────────────────────────────────────────────────────────
  bot.hears(BTN.IDENTITY, async (ctx) => {
    const uid = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await safeReply(
      ctx,
      `╔══[ IDENTITY ]══════╗\n` +
      `║  🪪  Account Info    ║\n` +
      `╚════════════════════╝\n\n` +
      `<code>◈ Username  →  ${username}\n` +
      `◈ User ID   →  ${uid}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── My Orders ─────────────────────────────────────────────────────────────
  bot.hears(BTN.ORDERS, async (ctx) => {
    const uid = ctx.from.id;
    const res = await dbQuery(
      `SELECT id, product_name, amount, created_at FROM shop_orders
       WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [uid]
    );

    if (res.rows.length === 0) {
      return safeReply(ctx,
        `╔══[ ORDER HISTORY ]══╗\n` +
        `║  📦  No Orders Found  ║\n` +
        `╚═════════════════════╝\n\n` +
        `▸ No purchases yet.\n` +
        `→ Browse <b>Accounts</b> to get started`,
        { parse_mode: "HTML" }
      );
    }

    const orderLines: string[] = [
      `╔══[ ORDER HISTORY ]══════╗\n` +
      `║  📦  Your Purchases       ║\n` +
      `╚═════════════════════════╝\n`
    ];
    const buttons: ReturnType<typeof Markup.button.callback>[][] = res.rows.map((o: any, i: number) => {
      const date = new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      orderLines.push(`<code>${i + 1}.</code> <b>${escHtml(o.product_name)}</b>  —  ${fmt$(o.amount)}  —  ${date}`);
      return [Markup.button.callback(`[ ${i + 1} ] Reveal Credentials`, `shop_creds_${o.id}`)];
    });
    orderLines.push(`\n▸ Tap below to reveal credentials:`);

    await safeReply(ctx, orderLines.join("\n"), {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // ── Show credentials for an order ─────────────────────────────────────────
  bot.action(/^shop_creds_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const orderId = (ctx.match as RegExpExecArray)[1];
    const uid = ctx.from.id;

    const res = await dbQuery(
      `SELECT product_name, account_email, account_password, amount, created_at
       FROM shop_orders WHERE id = $1 AND telegram_id = $2`,
      [orderId, uid]
    );

    if (!res.rows[0]) {
      return safeEdit(ctx, "Order not found.");
    }

    const o = res.rows[0];
    const date = new Date(o.created_at).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    await safeEdit(
      ctx,
      `╔══[ CREDENTIALS ]═══════╗\n` +
      `║  🔑  Access Details      ║\n` +
      `╚════════════════════════╝\n\n` +
      `▸ <b>${escHtml(o.product_name)}</b>\n\n` +
      `<code>◆ Purchased  →  ${date}\n` +
      `◆ Amount     →  ${fmt$(o.amount)}\n\n` +
      `LOGIN  →  ${escHtml(o.account_email)}\n` +
      `PASS   →  ${escHtml(o.account_password)}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Shortcut commands ─────────────────────────────────────────────────────
  bot.command("balance", async (ctx) => {
    const uid = ctx.from.id;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    await safeReply(ctx,
      `╔══[ WALLET STATUS ]══╗\n` +
      `║  💰  Account Balance  ║\n` +
      `╚═════════════════════╝\n\n` +
      `<code>◈ Balance  →  ${fmt$(balance)}</code>\n\n` +
      `→ To top up: ${escHtml(SUPPORT_CONTACT)}`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("shop", async (ctx) => {
    await showProductList(ctx);
  });

  bot.command("id", async (ctx) => {
    const uid = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await safeReply(ctx,
      `╔══[ IDENTITY ]══════╗\n` +
      `║  🪪  Account Info    ║\n` +
      `╚════════════════════╝\n\n` +
      `<code>◈ Username  →  ${username}\n` +
      `◈ User ID   →  ${uid}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Register commands + Menu button in Telegram ────────────────────────────
  async function registerCommands() {
    try {
      await bot.telegram.setMyCommands([
        { command: "start",   description: "Open the store" },
        { command: "shop",    description: "Browse accounts" },
        { command: "balance", description: "Check my balance" },
        { command: "id",      description: "My Telegram ID" },
        { command: "menu",    description: "Show keyboard" },
      ]);
      console.log("[ShopBot] Commands registered");
      // Set default menu button for all new chats globally
      await bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } });
      console.log("[ShopBot] Global menu button set (type: commands)");
    } catch (e: any) {
      console.error("[ShopBot] Failed to register commands:", e.message);
    }
  }

  // ── Launch with retry ─────────────────────────────────────────────────────
  async function launch(attempt = 1) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      console.log("[ShopBot] Polling started (Project Addison v2 — open to all users)");
      await registerCommands();
    } catch (err: any) {
      const delay = Math.min(attempt * 5000, 60_000);
      console.error(`[ShopBot] Launch attempt ${attempt} failed: ${err.message} — retrying in ${delay / 1000}s`);
      setTimeout(() => launch(attempt + 1), delay);
    }
  }
  launch();

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

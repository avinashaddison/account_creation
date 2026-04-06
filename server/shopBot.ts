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

const PLATFORM_EMOJI: Record<string, string> = {
  replit:   "🔵",
  lovable:  "💜",
  v0:       "⚡",
  adobe:    "🅰️",
  chatgpt:  "🤖",
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
  if (stock === 0) return "🔴 Sold Out";
  if (stock <= 3)  return `🟠 Only ${stock} left!`;
  if (stock <= 10) return `🟡 ${stock} in stock`;
  return `🟢 ${stock} available`;
}

function stockLine(stock: number): string {
  if (stock === 0) return "🔴  SOLD OUT";
  if (stock <= 5)  return `🟡  LOW — ×${stock} remaining`;
  return `🟢  IN STOCK — ×${stock} units`;
}

// ── Main reply keyboard ──────────────────────────────────────────────────────
const BTN = {
  ACCOUNTS:  "⚡  𝗦𝗛𝗢𝗣  𝗔𝗜  𝗧𝗢𝗢𝗟𝗦",
  BALANCE:   "💰  𝗪𝗔𝗟𝗟𝗘𝗧",
  ORDERS:    "📦  𝗢𝗥𝗗𝗘𝗥𝗦",
  DEPOSIT:   "➕  𝗔𝗗𝗗  𝗙𝗨𝗡𝗗𝗦",
  IDENTITY:  "🪪  𝗠𝗬  𝗣𝗥𝗢𝗙𝗜𝗟𝗘",
  SUPPORT:   "💬  𝗦𝗨𝗣𝗣𝗢𝗥𝗧",
} as const;

const SHOP_KEYBOARD = Markup.keyboard([
  [BTN.ACCOUNTS],
  [BTN.BALANCE,   BTN.ORDERS],
  [BTN.DEPOSIT,   BTN.SUPPORT],
  [BTN.IDENTITY],
]).resize();

// ── Per-user state ───────────────────────────────────────────────────────────
interface ShopUserState {
  selectedProductId?: string;
}
const userState = new Map<number, ShopUserState>();
function getState(uid: number): ShopUserState {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid)!;
}

// ── DB helpers ───────────────────────────────────────────────────────────────
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
      `UPDATE shop_customers SET balance = balance - $1 WHERE telegram_id = $2`,
      [price, uid]
    );

    await client.query(`UPDATE ${table} SET status = 'sold_out' WHERE id = $1`, [accountId]);

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
  return "─────────────────────────────────────";
}

function header(title: string, sub?: string): string {
  const line = `[ ${title} ]`;
  return sub
    ? `<b>${line}</b>\n<i>${escHtml(sub)}</i>\n${divider()}`
    : `<b>${line}</b>\n${divider()}`;
}

function buildProductCard(p: ProductWithStock): string {
  const emoji   = platformEmoji(p.account_type);
  const plat    = platformLabel(p.account_type);
  const badge   = stockBadge(p.stock);
  const desc    = p.description ? `\n<i>  ${escHtml(p.description)}</i>` : "";
  return (
    `${emoji} <b>${escHtml(p.name)}</b>${desc}\n` +
    `<code>` +
    `  Platform  ›  ${plat}\n` +
    `  Price     ›  ${fmt$(p.price)} / account\n` +
    `  Stock     ›  ${badge}` +
    `</code>`
  );
}

function buildProductButtons(products: ProductWithStock[]) {
  return products.map((p) => {
    const emoji     = platformEmoji(p.account_type);
    const inStock   = p.stock > 0;
    const stockTag  = inStock ? `${p.stock} left` : "SOLD OUT";
    const label     = `${emoji}  ${p.name}  ·  ${fmt$(p.price)}  ·  ${stockTag}`;
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
    const uid = ctx.from.id;
    bot.telegram.setChatMenuButton({
      chatId: ctx.chat.id,
      menuButton: { type: "commands" },
    }).catch(() => {});
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    const name    = ctx.from.first_name || ctx.from.username || "User";
    const uname   = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";

    await ctx.reply(
      truncate(
        `[ PROJECT ADDISON v2 ]\n` +
        `<i>Global AI Tools Marketplace</i>\n` +
        `${divider()}\n\n` +
        `Welcome back, <b>${escHtml(name)}</b>!\n\n` +
        `<code>` +
        `  Balance   ›  ${fmt$(balance)}\n` +
        `  Username  ›  ${uname}\n` +
        `  User ID   ›  ${uid}` +
        `</code>\n\n` +
        `${divider()}\n` +
        `Use the menu below to get started.`
      ),
      { parse_mode: "HTML", ...SHOP_KEYBOARD }
    );

    // Show product list right after welcome
    await showProductList(ctx);
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply("Menu restored.", SHOP_KEYBOARD);
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
      .join(`\n${divider()}\n`);

    const text =
      `${header("🛍 LIVE MARKETPLACE", "Tap a product below to view details & buy")}\n\n` +
      `${cards}\n\n` +
      `${divider()}\n` +
      `<i>Prices in USD · Instant delivery after purchase</i>`;

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
    const cards = products.map((p) => buildProductCard(p)).join(`\n${divider()}\n`);
    const text =
      `${header("🛍 LIVE MARKETPLACE", "Tap a product below to view details & buy")}\n\n` +
      `${cards}\n\n` +
      `${divider()}\n` +
      `<i>Prices in USD · Instant delivery after purchase</i>`;
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
      `${header(`${emoji} PRODUCT DETAILS`)}\n\n` +
      `<b>${escHtml(prod.name)}</b>${desc}\n` +
      `<code>` +
      `  Platform   ›  ${plat}\n` +
      `  Price      ›  ${fmt$(prod.price)} / account\n` +
      `  Stock      ›  ${stockBadge(prod.stock)}\n` +
      `  Delivery   ›  Instant` +
      `</code>\n\n` +
      (inStock
        ? `✅ <b>In stock.</b> Ready to deliver instantly after purchase.`
        : `❌ <b>Currently out of stock.</b> Check back soon.`
      );

    const buttons = [
      ...(inStock
        ? [[Markup.button.callback(`✅  Buy Now  —  ${fmt$(prod.price)}`, `shop_buy_${productId}`)]]
        : []
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
    const cards = products.map((p) => buildProductCard(p)).join(`\n${divider()}\n`);
    const text =
      `${header("🛍 LIVE MARKETPLACE", "Tap a product below to view details & buy")}\n\n` +
      `${cards}\n\n` +
      `${divider()}\n` +
      `<i>Prices in USD · Instant delivery after purchase</i>`;

    await safeEdit(ctx, text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        ...buildProductButtons(products),
        [Markup.button.callback("🔄  Refresh", "shop_refresh_products")],
      ]),
    });
  });

  // ── Buy flow ──────────────────────────────────────────────────────────────
  bot.action(/^shop_buy_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Processing…").catch(() => {});
    const uid       = ctx.from.id;
    const productId = (ctx.match as RegExpExecArray)[1];

    // Show processing state
    await safeEdit(ctx,
      `⚙️ <i>Processing your purchase…\nPlease wait a moment.</i>`,
      { parse_mode: "HTML" }
    );

    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);

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
        `${header("💳 INSUFFICIENT FUNDS")}\n\n` +
        `<code>` +
        `  Product    ›  ${escHtml(prod.name)}\n` +
        `  Required   ›  ${fmt$(price)}\n` +
        `  Balance    ›  ${fmt$(balance)}\n` +
        `  Shortfall  ›  $${shortfall}` +
        `</code>\n\n` +
        `To top up your wallet, contact:\n${escHtml(SUPPORT_CONTACT)}`,
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

    const result = await purchaseProduct(uid, productId);

    if (!result.success) {
      if (result.reason === "insufficient_funds") {
        return safeEdit(ctx,
          `${header("💳 INSUFFICIENT FUNDS")}\n\n` +
          `Need <b>$${(result.shortfall ?? 0).toFixed(2)}</b> more to complete this purchase.\n\n` +
          `→ Contact ${escHtml(SUPPORT_CONTACT)} to top up`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
          }
        );
      }
      if (result.reason === "out_of_stock") {
        return safeEdit(ctx,
          `${header("❌ OUT OF STOCK")}\n\n` +
          `<b>${escHtml(prod.name)}</b> just sold out.\n` +
          `<i>Check back soon.</i>`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
          }
        );
      }
      return safeEdit(ctx,
        `${header("⚠️ PURCHASE FAILED")}\n\n` +
        `Something went wrong. Your balance was not charged.\n\n` +
        `→ Contact ${escHtml(SUPPORT_CONTACT)} if this keeps happening.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
        }
      );
    }

    // ── Success ──────────────────────────────────────────────────────────────
    const emoji = platformEmoji(prod.account_type);
    await safeEdit(ctx,
      `${header("✅ PURCHASE SUCCESSFUL")}\n\n` +
      `${emoji} <b>${escHtml(prod.name)}</b>\n\n` +
      `<code>` +
      `  Email      ›  ${escHtml(result.accountEmail)}\n` +
      `  Password   ›  ${escHtml(result.accountPassword)}` +
      `</code>\n\n` +
      `${divider()}\n` +
      `<code>  New Balance  ›  ${fmt$(result.newBalance)}</code>\n\n` +
      `<i>Credentials saved — view anytime via My Orders.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📦  My Orders", "shop_view_orders")],
          [Markup.button.callback("◀  Back to Shop", "shop_back_products")],
        ]),
      }
    );
  });

  // ── Deposit info (inline) ─────────────────────────────────────────────────
  bot.action("shop_deposit_info", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const uid = ctx.from.id;
    await safeEdit(ctx,
      `${header("➕ DEPOSIT")}\n\n` +
      `To add funds to your wallet, message the support contact and include your User ID.\n\n` +
      `<code>` +
      `  Support  ›  ${SUPPORT_CONTACT}\n` +
      `  Your ID  ›  ${uid}` +
      `</code>\n\n` +
      `<i>Deposits are processed manually and confirmed within minutes.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("◀  Back to Shop", "shop_back_products")]]),
      }
    );
  });

  // ── My Balance ────────────────────────────────────────────────────────────
  bot.hears(BTN.BALANCE, async (ctx) => {
    const uid = ctx.from.id;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    await safeReply(ctx,
      `${header("💰 MY WALLET")}\n\n` +
      `<code>` +
      `  Balance   ›  ${fmt$(balance)}\n` +
      `  User ID   ›  ${uid}` +
      `</code>\n\n` +
      `<i>To top up, contact: ${escHtml(SUPPORT_CONTACT)}</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Deposit ───────────────────────────────────────────────────────────────
  bot.hears(BTN.DEPOSIT, async (ctx) => {
    const uid = ctx.from.id;
    await safeReply(ctx,
      `${header("➕ DEPOSIT FUNDS")}\n\n` +
      `Message our support contact with your User ID to add funds to your wallet.\n\n` +
      `<code>` +
      `  Contact  ›  ${SUPPORT_CONTACT}\n` +
      `  Your ID  ›  ${uid}` +
      `</code>\n\n` +
      `<i>Deposits are confirmed within minutes.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Support ───────────────────────────────────────────────────────────────
  bot.hears(BTN.SUPPORT, async (ctx) => {
    await safeReply(ctx,
      `${header("💬 SUPPORT")}\n\n` +
      `Our team is available to help with:\n` +
      `  • Account issues or questions\n` +
      `  • Deposits and balance top-ups\n` +
      `  • Order problems or disputes\n\n` +
      `<code>  Agent   ›  ${SUPPORT_CONTACT}</code>\n\n` +
      `<i>Please include your User ID: <b>${ctx.from.id}</b></i>`,
      { parse_mode: "HTML" }
    );
  });

  // ── My ID ─────────────────────────────────────────────────────────────────
  bot.hears(BTN.IDENTITY, async (ctx) => {
    const uid   = ctx.from.id;
    const uname = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "—";
    await safeReply(ctx,
      `${header("🪪 MY IDENTITY")}\n\n` +
      `<code>` +
      `  Username  ›  ${uname}\n` +
      `  User ID   ›  ${uid}` +
      `</code>\n\n` +
      `<i>Share your User ID when contacting support.</i>`,
      { parse_mode: "HTML" }
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
        `${header("📦 ORDER HISTORY")}\n\n` +
        `<i>No purchases yet.</i>\n\n` +
        `Browse the marketplace to get started:`;
      const kb = Markup.inlineKeyboard([[Markup.button.callback("🛍  Browse Marketplace", "shop_back_products")]]);
      if (isEdit) return safeEdit(ctx, text, { parse_mode: "HTML", ...kb });
      return safeReply(ctx, text, { parse_mode: "HTML", ...kb });
    }

    const lines: string[] = [
      `${header("📦 ORDER HISTORY", `Last ${res.rows.length} purchases`)}\n`
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
      `${header("🔑 CREDENTIALS")}\n\n` +
      `${emoji} <b>${escHtml(o.product_name)}</b>\n\n` +
      `<code>` +
      `  Purchased  ›  ${date}\n` +
      `  Amount     ›  ${fmt$(o.amount)}\n\n` +
      `  Email      ›  ${escHtml(o.account_email)}\n` +
      `  Password   ›  ${escHtml(o.account_password)}` +
      `</code>`,
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
      `${header("💰 MY WALLET")}\n\n` +
      `<code>` +
      `  Balance   ›  ${fmt$(balance)}\n` +
      `  User ID   ›  ${uid}` +
      `</code>\n\n` +
      `<i>To top up: ${escHtml(SUPPORT_CONTACT)}</i>`,
      { parse_mode: "HTML" }
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
        { command: "start",   description: "Open the marketplace" },
        { command: "shop",    description: "Browse AI tools" },
        { command: "balance", description: "Check my wallet balance" },
        { command: "id",      description: "My Telegram user ID" },
        { command: "menu",    description: "Show keyboard" },
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

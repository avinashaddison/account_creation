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
const SHOP_KEYBOARD = Markup.keyboard([
  ["🛍 Accounts", "💰 My Balance"],
  ["📦 My Orders", "➕ Add Funds"],
  ["🪪 My Telegram ID", "💬 Support"],
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
  active: boolean;
  sort_order: number;
  stock: number;
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
      const sr = await dbQuery(
        `SELECT COUNT(*) as cnt FROM ${table} WHERE status = $1`,
        [p.status_filter]
      ).catch(() => ({ rows: [{ cnt: "0" }] }));
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
    const sr = await dbQuery(
      `SELECT COUNT(*) as cnt FROM ${table} WHERE status = $1`,
      [p.status_filter]
    ).catch(() => ({ rows: [{ cnt: "0" }] }));
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

    // Get and lock oldest available account
    const acctRes = await client.query(
      `SELECT id, email, password FROM ${table} WHERE status = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [prod.status_filter]
    );
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
      active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
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
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    const name = ctx.from.first_name || ctx.from.username || "there";
    await ctx.reply(
      truncate(
        `<b>Welcome to Project Addison v2</b>, ${escHtml(name)}!\n\n` +
          `Your current balance: <b>${fmt$(balance)}</b>\n\n` +
          `Browse and purchase premium accounts instantly using the menu below.`
      ),
      { parse_mode: "HTML", ...SHOP_KEYBOARD }
    );
  });

  // ── /menu ─────────────────────────────────────────────────────────────────
  bot.command("menu", async (ctx) => {
    await ctx.reply("Use the menu below:", SHOP_KEYBOARD);
  });

  // ── Accounts ──────────────────────────────────────────────────────────────
  async function showProductList(ctx: any) {
    const products = await getProductsWithStock();
    if (products.length === 0) {
      return safeReply(ctx, "No products available right now. Check back soon!");
    }
    const buttons: ReturnType<typeof Markup.button.callback>[][] = products.map((p) => {
      const label = `${p.name} — ${fmt$(p.price)} | ${p.stock} in stock`;
      return [Markup.button.callback(label, `shop_product_${p.id}`)];
    });
    await safeReply(ctx, "<b>Available Accounts</b>\n\nChoose a product to view details:", {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons),
    });
  }

  bot.hears("🛍 Accounts", async (ctx) => {
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

    const desc = prod.description ? `\n${escHtml(prod.description)}\n` : "\n";
    const stockText = prod.stock > 0 ? `<b>${prod.stock}</b> in stock` : "<b>Out of stock</b>";

    await safeEdit(
      ctx,
      `<b>${escHtml(prod.name)}</b>\n${desc}\n` +
        `Price: <b>${fmt$(prod.price)}</b>\n` +
        `Available: ${stockText}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Buy Now", `shop_buy_${productId}`)],
          [Markup.button.callback("Back to Products", "shop_back_products")],
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
    const buttons: ReturnType<typeof Markup.button.callback>[][] = products.map((p) => {
      const label = `${p.name} — ${fmt$(p.price)} | ${p.stock} in stock`;
      return [Markup.button.callback(label, `shop_product_${p.id}`)];
    });
    await safeEdit(ctx, "<b>Available Accounts</b>\n\nChoose a product to view details:", {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons),
    });
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
        `<b>Insufficient Balance</b>\n\n` +
          `Product: <b>${escHtml(prod.name)}</b>\n` +
          `Price: <b>${fmt$(price)}</b>\n` +
          `Your balance: <b>${fmt$(balance)}</b>\n` +
          `Shortfall: <b>$${shortfall}</b>\n\n` +
          `Contact ${escHtml(SUPPORT_CONTACT)} to add funds.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("Back to Products", "shop_back_products")],
          ]),
        }
      );
    }

    if (prod.stock === 0) {
      return safeEdit(
        ctx,
        `<b>${escHtml(prod.name)}</b> is currently out of stock.\n\nPlease check back later.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("Back to Products", "shop_back_products")],
          ]),
        }
      );
    }

    const result = await purchaseProduct(uid, productId);

    if (!result.success) {
      if (result.reason === "insufficient_funds") {
        return safeEdit(
          ctx,
          `<b>Insufficient Balance</b>\n\nYou need $${(result.shortfall ?? 0).toFixed(2)} more.\n\nContact ${escHtml(SUPPORT_CONTACT)} to top up.`,
          { parse_mode: "HTML" }
        );
      }
      if (result.reason === "out_of_stock") {
        return safeEdit(
          ctx,
          `<b>Out of Stock</b>\n\n<b>${escHtml(prod.name)}</b> just sold out. Please check back later.`,
          { parse_mode: "HTML" }
        );
      }
      return safeEdit(
        ctx,
        `<b>Purchase Failed</b>\n\nSomething went wrong. Please try again or contact ${escHtml(SUPPORT_CONTACT)}.`,
        { parse_mode: "HTML" }
      );
    }

    // Success — send confirmation with credentials
    await safeEdit(
      ctx,
      `<b>Purchase Successful!</b>\n\n` +
        `<b>${escHtml(prod.name)}</b>\n\n` +
        `<b>Email:</b> <code>${escHtml(result.accountEmail)}</code>\n` +
        `<b>Password:</b> <code>${escHtml(result.accountPassword)}</code>\n\n` +
        `Your new balance: <b>${fmt$(result.newBalance)}</b>\n\n` +
        `<i>Save these credentials now — they will always be accessible via My Orders.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("Back to Products", "shop_back_products")],
        ]),
      }
    );
  });

  // ── My Balance ────────────────────────────────────────────────────────────
  bot.hears("💰 My Balance", async (ctx) => {
    const uid = ctx.from.id;
    await upsertCustomer(uid, ctx.from.username, ctx.from.first_name);
    const balance = await getBalance(uid);
    await safeReply(
      ctx,
      `<b>Your Wallet</b>\n\nCurrent balance: <b>${fmt$(balance)}</b>\n\nTo add funds, contact ${escHtml(SUPPORT_CONTACT)}.`,
      { parse_mode: "HTML" }
    );
  });

  // ── Add Funds ─────────────────────────────────────────────────────────────
  bot.hears("➕ Add Funds", async (ctx) => {
    await safeReply(
      ctx,
      `<b>Add Funds</b>\n\nTo top up your balance, contact:\n${escHtml(SUPPORT_CONTACT)}\n\nMention your Telegram ID: <code>${ctx.from.id}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Support ───────────────────────────────────────────────────────────────
  bot.hears("💬 Support", async (ctx) => {
    await safeReply(
      ctx,
      `<b>Support</b>\n\nFor help or issues, contact:\n${escHtml(SUPPORT_CONTACT)}`,
      { parse_mode: "HTML" }
    );
  });

  // ── My Telegram ID ────────────────────────────────────────────────────────
  bot.hears("🪪 My Telegram ID", async (ctx) => {
    const uid = ctx.from.id;
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "No username";
    await safeReply(
      ctx,
      `<b>Your Telegram ID</b>\n\n${escHtml(username)} — <code>${uid}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── My Orders ─────────────────────────────────────────────────────────────
  bot.hears("📦 My Orders", async (ctx) => {
    const uid = ctx.from.id;
    const res = await dbQuery(
      `SELECT id, product_name, amount, created_at FROM shop_orders
       WHERE telegram_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [uid]
    );

    if (res.rows.length === 0) {
      return safeReply(ctx, "You have no orders yet. Browse <b>Accounts</b> to make your first purchase!", {
        parse_mode: "HTML",
      });
    }

    const orderLines: string[] = [`<b>My Orders</b> (last ${res.rows.length})\n`];
    const buttons: ReturnType<typeof Markup.button.callback>[][] = res.rows.map((o: any, i: number) => {
      const date = new Date(o.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      orderLines.push(`${i + 1}. <b>${o.product_name}</b> — ${fmt$(o.amount)} — ${date}`);
      return [Markup.button.callback(`${i + 1}. Show Credentials`, `shop_creds_${o.id}`)];
    });
    orderLines.push("\nTap below to reveal credentials:");

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
      `<b>Order: ${escHtml(o.product_name)}</b>\n` +
        `Date: ${date}\n` +
        `Amount paid: <b>${fmt$(o.amount)}</b>\n\n` +
        `<b>Email:</b> <code>${escHtml(o.account_email)}</code>\n` +
        `<b>Password:</b> <code>${escHtml(o.account_password)}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Launch with retry ─────────────────────────────────────────────────────
  async function launch(attempt = 1) {
    try {
      await bot.launch({ dropPendingUpdates: true });
      console.log("[ShopBot] Polling started (Project Addison v2 — open to all users)");
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

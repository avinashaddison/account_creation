import { Telegraf, Markup } from "telegraf";
import { Pool } from "pg";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

if (!TOKEN) {
  console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");
}

// ── State tracking ──────────────────────────────────────────────────────────
const userState = new Map<number, any>();
const runningOps = new Map<number, boolean>();
// Stores last copied account IDs per user for apply-status flow
const lastCopiedIds = new Map<number, string[]>();

// ── DB helpers ──────────────────────────────────────────────────────────────
function makePool() {
  return new Pool({
    connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

async function dbQuery(sql: string, params: any[] = []) {
  const pool = makePool();
  try {
    return await pool.query(sql, params);
  } finally {
    await pool.end();
  }
}

// ── Internal API helper ─────────────────────────────────────────────────────
async function botApi(path: string, method = "GET", body?: object) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-bot-token": TOKEN || "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function statusEmoji(status: string): string {
  switch (status) {
    case "processing": return "⏳";
    case "sold_out": return "✅";
    case "working": return "🔗";
    case "available": return "🟢";
    case "error": return "❌";
    case "banned": return "🚫";
    default: return "❓";
  }
}

function buildUsageBar(used: number, total: number): string {
  const filled = Math.round((used / total) * 10);
  const empty = 10 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${used}/${total}`;
}

function chunk(text: string, size = 4000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

async function sendLong(ctx: any, text: string, opts: any = {}) {
  const parts = chunk(text, 4000);
  for (const part of parts) {
    await ctx.reply(part, { parse_mode: "Markdown", ...opts });
  }
}

// ── Main menu keyboard ───────────────────────────────────────────────────────
function mainMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📊 Stats", "menu_stats"),
      Markup.button.callback("👥 Accounts", "menu_accounts"),
    ],
    [
      Markup.button.callback("📋 Copy Accounts", "menu_copy"),
      Markup.button.callback("🔗 Checkout Links", "menu_checkout"),
    ],
    [
      Markup.button.callback("🏗 Create Accounts", "menu_create"),
      Markup.button.callback("🔄 Auto-Scan", "menu_scan"),
    ],
    [
      Markup.button.callback("🔥 Warm Accounts", "menu_warm"),
      Markup.button.callback("🗑 Purge Banned", "menu_purge"),
    ],
    [
      Markup.button.callback("⚙️ Settings", "menu_settings"),
      Markup.button.callback("❓ Help", "menu_help"),
    ],
  ]);
}

export function startTelegramBot() {
  if (!TOKEN) return;

  const bot = new Telegraf(TOKEN);

  // ── /start ──────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    await ctx.reply(
      `*🤖 Replit Admin Bot*\n\nFull control of your Replit accounts from Telegram.\nChoose an option:`,
      { parse_mode: "Markdown", ...mainMenu() }
    );
  });

  // ── /menu ────────────────────────────────────────────────────────────────
  bot.command("menu", async (ctx) => {
    await ctx.reply("Main Menu:", mainMenu());
  });

  // ── /cancel ──────────────────────────────────────────────────────────────
  bot.command("cancel", (ctx) => {
    const uid = ctx.from.id;
    userState.delete(uid);
    lastCopiedIds.delete(uid);
    if (runningOps.has(uid)) {
      runningOps.set(uid, false);
      ctx.reply("⛔ Operation cancelled. It will stop after the current account finishes.");
    } else {
      ctx.reply("Cancelled. Use /menu to go back.");
    }
  });

  // ── /stats ───────────────────────────────────────────────────────────────
  bot.command("stats", async (ctx) => {
    await handleStats(ctx);
  });

  // ── /accounts ────────────────────────────────────────────────────────────
  bot.command("accounts", async (ctx) => {
    const parts = ctx.message.text.split(" ");
    const status = parts[1] || "all";
    await handleAccountsList(ctx, status);
  });

  // ── /copy ────────────────────────────────────────────────────────────────
  bot.command("copy", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const count = parseInt(parts[1]) || 10;
    const status = parts[2] || "processing";
    await handleCopy(ctx, count, status);
  });

  // ── /apply ───────────────────────────────────────────────────────────────
  bot.command("apply", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const status = parts[1];
    if (!status) {
      return ctx.reply("Usage: /apply <status>\nStatuses: sold_out, working, processing, available, error");
    }
    await handleApplyStatus(ctx, status);
  });

  // ── /create ───────────────────────────────────────────────────────────────
  bot.command("create", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const count = parseInt(parts[1]) || 1;
    await handleCreate(ctx, count);
  });

  // ── /checkout ─────────────────────────────────────────────────────────────
  bot.command("checkout", async (ctx) => {
    await handleCheckout(ctx);
  });

  // ── /scan / /autoscan ────────────────────────────────────────────────────
  bot.command(["scan", "autoscan"], async (ctx) => {
    await handleScan(ctx);
  });

  // ── /warm ─────────────────────────────────────────────────────────────────
  bot.command("warm", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const count = parseInt(parts[1]) || 10;
    await handleWarm(ctx, count);
  });

  // ── /purge ────────────────────────────────────────────────────────────────
  bot.command("purge", async (ctx) => {
    await handlePurge(ctx);
  });

  // ── /settings ─────────────────────────────────────────────────────────────
  bot.command("settings", async (ctx) => {
    await handleSettings(ctx);
  });

  // ── /proxy ────────────────────────────────────────────────────────────────
  bot.command("proxy", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const url = parts[1];
    if (!url) {
      const cur = await dbQuery(`SELECT value FROM settings WHERE key = 'residential_proxy_url'`);
      return ctx.reply(`Current proxy:\n\`${cur.rows[0]?.value || "not set"}\`\n\nTo update: /proxy <url>`, { parse_mode: "Markdown" });
    }
    await dbQuery(`INSERT INTO settings (key, value) VALUES ('residential_proxy_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [url]);
    return ctx.reply(`✅ Proxy updated to:\n\`${url}\``, { parse_mode: "Markdown" });
  });

  // ── /setstatus ────────────────────────────────────────────────────────────
  bot.command("setstatus", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const email = parts[1];
    const status = parts[2];
    if (!email || !status) {
      return ctx.reply("Usage: /setstatus <email> <status>");
    }
    const r = await dbQuery(`UPDATE replit_accounts SET status = $1 WHERE email = $2 RETURNING email, status`, [status, email]);
    if (r.rowCount === 0) return ctx.reply(`❌ Account not found: ${email}`);
    return ctx.reply(`✅ ${email} → \`${status}\``, { parse_mode: "Markdown" });
  });

  // ── /help ─────────────────────────────────────────────────────────────────
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*📖 All Commands*\n\n` +
      `*Account Info*\n` +
      `/stats — Dashboard overview\n` +
      `/accounts [status] — List accounts\n\n` +
      `*Account Actions*\n` +
      `/copy [N] [status] — Copy N accounts\n` +
      `/apply [status] — Apply status to last copied\n` +
      `/setstatus <email> <status> — Set one account's status\n\n` +
      `*Automation*\n` +
      `/create [N] — Create N Replit accounts\n` +
      `/checkout — Generate checkout links\n` +
      `/scan — Auto-scan accounts for coupons\n` +
      `/warm [N] — Warm N accounts\n` +
      `/purge — Purge banned accounts\n\n` +
      `*Settings*\n` +
      `/settings — View all settings\n` +
      `/proxy [url] — View or update proxy\n\n` +
      `*Other*\n` +
      `/menu — Show main menu\n` +
      `/cancel — Cancel running operation`,
      { parse_mode: "Markdown" }
    );
  });

  // ── Inline keyboard callbacks ─────────────────────────────────────────────
  bot.action("menu_stats", async (ctx) => { await ctx.answerCbQuery(); await handleStats(ctx); });
  bot.action("menu_accounts", async (ctx) => { await ctx.answerCbQuery(); await handleAccountsList(ctx, "all"); });
  bot.action("menu_copy", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      "*Copy Accounts*\n\nUsage: /copy [count] [status]\n\nExamples:\n`/copy 10` — Copy 10 processing accounts\n`/copy 5 sold_out` — Copy 5 sold out accounts\n`/copy 1 working` — Copy 1 working account",
      { parse_mode: "Markdown" }
    );
  });
  bot.action("menu_checkout", async (ctx) => { await ctx.answerCbQuery(); await handleCheckout(ctx); });
  bot.action("menu_create", async (ctx) => {
    await ctx.answerCbQuery();
    userState.set(ctx.from!.id, { step: "awaiting_create_count" });
    await ctx.reply("How many Replit accounts do you want to create? (Enter a number 1-50)");
  });
  bot.action("menu_scan", async (ctx) => { await ctx.answerCbQuery(); await handleScan(ctx); });
  bot.action("menu_warm", async (ctx) => {
    await ctx.answerCbQuery();
    userState.set(ctx.from!.id, { step: "awaiting_warm_count" });
    await ctx.reply("How many accounts do you want to warm? (Enter a number)");
  });
  bot.action("menu_purge", async (ctx) => { await ctx.answerCbQuery(); await handlePurge(ctx); });
  bot.action("menu_settings", async (ctx) => { await ctx.answerCbQuery(); await handleSettings(ctx); });
  bot.action("menu_help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `*Commands:*\n/stats /accounts /copy /apply /create /checkout /scan /warm /purge /settings /proxy /cancel`,
      { parse_mode: "Markdown" }
    );
  });

  // Status apply callbacks (after /copy)
  for (const status of ["sold_out", "working", "processing", "available", "error"]) {
    bot.action(`apply_${status}`, async (ctx) => {
      await ctx.answerCbQuery();
      await handleApplyStatus(ctx, status);
    });
  }

  bot.action("apply_dismiss", async (ctx) => {
    await ctx.answerCbQuery();
    lastCopiedIds.delete(ctx.from!.id);
    await ctx.reply("Dismissed. No status change applied.");
  });

  // Confirm create
  bot.action(/^confirm_create_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    await triggerCreate(ctx, count);
  });

  // Confirm warm
  bot.action(/^confirm_warm_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    await triggerWarm(ctx, count);
  });

  // Confirm purge
  bot.action("confirm_purge", async (ctx) => {
    await ctx.answerCbQuery();
    await triggerPurge(ctx);
  });

  // ── Text message handler ──────────────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const uid = ctx.from.id;
    const text = ctx.message.text.trim();
    const state = userState.get(uid);

    if (!state) return;

    if (state.step === "awaiting_create_count") {
      const count = parseInt(text);
      if (isNaN(count) || count < 1) return ctx.reply("Please enter a valid number (1-50).");
      userState.delete(uid);
      await handleCreate(ctx, count);
      return;
    }

    if (state.step === "awaiting_warm_count") {
      const count = parseInt(text);
      if (isNaN(count) || count < 1) return ctx.reply("Please enter a valid number.");
      userState.delete(uid);
      await handleWarm(ctx, count);
      return;
    }

    // Legacy manual check flow
    if (state.step === "awaiting_email") {
      if (!text.includes("@")) return ctx.reply("That doesn't look like an email. Enter a valid email:");
      userState.set(uid, { step: "awaiting_password", email: text });
      return ctx.reply("Enter the *password*:", { parse_mode: "Markdown" });
    }

    if (state.step === "awaiting_password") {
      const email = state.email!;
      userState.delete(uid);
      await ctx.reply(`Checking account \`${email}\`...`, { parse_mode: "Markdown" });
      const { extractCouponFromReplitAccount } = await import("./playwrightService");
      try {
        const result = await extractCouponFromReplitAccount(email, text, () => {});
        if (result.success && result.coupon) {
          await ctx.reply(`✅ Coupon: \`${result.coupon}\``, { parse_mode: "Markdown" });
        } else {
          await ctx.reply(`❌ Failed: ${result.error?.slice(0, 200) || "Unknown error"}`, { parse_mode: "Markdown" });
        }
      } catch (err: any) {
        await ctx.reply(`Error: ${err.message}`);
      }
    }
  });

  // ── Handler implementations ───────────────────────────────────────────────

  async function handleStats(ctx: any) {
    try {
      const counts = await dbQuery(`
        SELECT status, COUNT(*) as cnt FROM replit_accounts GROUP BY status ORDER BY cnt DESC
      `);
      const total = counts.rows.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
      const recent = await dbQuery(`
        SELECT COUNT(*) as cnt FROM replit_accounts WHERE created_at > NOW() - INTERVAL '24 hours'
      `);

      let msg = `*📊 Account Dashboard*\n\n`;
      msg += `*Total Accounts: ${total}*\n`;
      msg += `\`${"─".repeat(28)}\`\n`;

      for (const row of counts.rows) {
        const emoji = statusEmoji(row.status);
        const bar = buildUsageBar(parseInt(row.cnt), total);
        msg += `${emoji} *${row.status}*: ${row.cnt}\n${bar}\n\n`;
      }

      msg += `\n📅 *Created last 24h:* ${recent.rows[0]?.cnt || 0}`;

      await ctx.reply(msg, { parse_mode: "Markdown", ...mainMenu() });
    } catch (err: any) {
      await ctx.reply(`Error loading stats: ${err.message}`);
    }
  }

  async function handleAccountsList(ctx: any, filterStatus: string) {
    try {
      const isAll = !filterStatus || filterStatus === "all";
      const rows = isAll
        ? (await dbQuery(`SELECT email, password, status, credits, checkout_url, coupon_code FROM replit_accounts ORDER BY status, created_at DESC LIMIT 50`)).rows
        : (await dbQuery(`SELECT email, password, status, credits, checkout_url, coupon_code FROM replit_accounts WHERE status = $1 ORDER BY created_at DESC LIMIT 50`, [filterStatus])).rows;

      if (rows.length === 0) {
        return ctx.reply(`No accounts found${isAll ? "" : ` with status: ${filterStatus}`}.`);
      }

      let msg = `*👥 Accounts${isAll ? "" : ` — ${filterStatus}`}* (${rows.length})\n\n`;
      for (const row of rows) {
        const emoji = statusEmoji(row.status);
        msg += `${emoji} \`${row.email}\`\n`;
        if (row.checkout_url) msg += `  🔗 Has checkout link\n`;
        if (row.coupon_code) msg += `  🎟 Coupon: \`${row.coupon_code}\`\n`;
      }

      const kbd = Markup.inlineKeyboard([
        [
          Markup.button.callback("⏳ Processing", "view_processing"),
          Markup.button.callback("✅ Sold Out", "view_sold_out"),
        ],
        [
          Markup.button.callback("🔗 Working", "view_working"),
          Markup.button.callback("🟢 Available", "view_available"),
        ],
        [Markup.button.callback("📋 Copy 10 processing", "quick_copy_10")],
      ]);

      await sendLong(ctx, msg);
      await ctx.reply("Filter by status:", kbd);
    } catch (err: any) {
      await ctx.reply(`Error: ${err.message}`);
    }
  }

  async function handleCopy(ctx: any, count: number, status: string) {
    try {
      const safeStatus = status === "all" ? null : status;
      const rows = safeStatus
        ? (await dbQuery(`SELECT id, email, password, credits, status FROM replit_accounts WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [safeStatus, count])).rows
        : (await dbQuery(`SELECT id, email, password, credits, status FROM replit_accounts ORDER BY created_at DESC LIMIT $1`, [count])).rows;

      if (rows.length === 0) {
        return ctx.reply(`No accounts found${safeStatus ? ` with status: ${safeStatus}` : ""}.`);
      }

      // Store IDs for apply-status
      const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
      lastCopiedIds.set(uid, rows.map((r: any) => String(r.id)));

      // Build formatted text (Telegram-copyable)
      const formatted = rows.map((r: any) =>
        `Email 📧: ${r.email}\n\nPassword 🔑: ${r.password || ""}\n\nCredits ✈︎: $${r.credits || "20"} 💰`
      ).join("\n\n---\n\n");

      await ctx.reply(`*📋 ${rows.length} accounts copied:*`, { parse_mode: "Markdown" });

      // Send in chunks (each account as its own message to be copyable)
      for (const row of rows) {
        await ctx.reply(
          `Email 📧: \`${row.email}\`\n\nPassword 🔑: \`${row.password || ""}\`\n\nCredits ✈︎: $${row.credits || "20"} 💰`,
          { parse_mode: "Markdown" }
        );
      }

      // Show apply-status keyboard
      const applyKbd = Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Sold Out", "apply_sold_out"),
          Markup.button.callback("🔗 Working", "apply_working"),
        ],
        [
          Markup.button.callback("⏳ Processing", "apply_processing"),
          Markup.button.callback("🟢 Available", "apply_available"),
        ],
        [Markup.button.callback("❌ Dismiss", "apply_dismiss")],
      ]);

      await ctx.reply(
        `Apply status to these *${rows.length} accounts*?`,
        { parse_mode: "Markdown", ...applyKbd }
      );
    } catch (err: any) {
      await ctx.reply(`Error: ${err.message}`);
    }
  }

  async function handleApplyStatus(ctx: any, status: string) {
    const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
    const ids = lastCopiedIds.get(uid);

    if (!ids || ids.length === 0) {
      return ctx.reply("No accounts selected. Use /copy first.");
    }

    try {
      const placeholders = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
      const r = await dbQuery(
        `UPDATE replit_accounts SET status = $1 WHERE id IN (${placeholders}) RETURNING id`,
        [status, ...ids]
      );
      lastCopiedIds.delete(uid);
      await ctx.reply(`✅ Updated *${r.rowCount}* accounts → \`${status}\``, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`Error applying status: ${err.message}`);
    }
  }

  async function handleCreate(ctx: any, count: number) {
    const safe = Math.min(Math.max(1, count), 50);
    const kbd = Markup.inlineKeyboard([
      [
        Markup.button.callback(`✅ Create ${safe} accounts`, `confirm_create_${safe}`),
        Markup.button.callback("❌ Cancel", "apply_dismiss"),
      ],
    ]);
    await ctx.reply(
      `*🏗 Create Replit Accounts*\n\nThis will create *${safe}* new Replit accounts using available Outlook emails.\n\nProceed?`,
      { parse_mode: "Markdown", ...kbd }
    );
  }

  async function triggerCreate(ctx: any, count: number) {
    await ctx.reply(`🚀 Starting creation of *${count}* Replit accounts...\n\nThis runs in the background — check the panel for live logs.`, { parse_mode: "Markdown" });
    try {
      const r = await botApi("/api/replit-create/bulk", "POST", { count });
      if (!r.ok) {
        await ctx.reply(`❌ Failed to start: ${r.data?.error || "Unknown error"}`);
      } else {
        await ctx.reply(`✅ Creation started! Batch ID: \`${r.data.batchId || "started"}\`\n\nAccounts will appear in /stats as they finish.`, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`Error: ${err.message}`);
    }
  }

  async function handleCheckout(ctx: any) {
    // Show how many processing accounts are ready
    const ready = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    const sources = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'sold_out' AND coupon_extracted = false`);

    const cnt = parseInt(ready.rows[0]?.cnt || "0");
    const srcCnt = parseInt(sources.rows[0]?.cnt || "0");

    const kbd = Markup.inlineKeyboard([
      [Markup.button.callback("🔗 Generate Checkout Links", "confirm_checkout")],
      [Markup.button.callback("❌ Cancel", "apply_dismiss")],
    ]);

    await ctx.reply(
      `*🔗 Generate Checkout Links*\n\n` +
      `⏳ Processing accounts (targets): *${cnt}*\n` +
      `✅ Source accounts available: *${srcCnt}*\n\n` +
      `This will auto-pick a source account, extract its coupon, and generate checkout links for all processing accounts.`,
      { parse_mode: "Markdown", ...kbd }
    );
  }

  bot.action("confirm_checkout", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("🔗 Starting checkout link generation...\n\nThis runs in the background — check /stats for updates.");
    try {
      const r = await botApi("/api/replit-auto-coupon-links", "POST", {});
      if (!r.ok) {
        await ctx.reply(`❌ Failed: ${r.data?.error || "Unknown error"}`);
      } else {
        await ctx.reply(`✅ Checkout generation started!\nSource: \`${r.data.sourceEmail || "auto-selected"}\``, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`Error: ${err.message}`);
    }
  });

  async function handleScan(ctx: any) {
    const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
    if (runningOps.get(uid) === true) {
      return ctx.reply("A scan is already running. Send /cancel to stop it.");
    }

    const unchecked = await dbQuery(
      `SELECT id, email, password FROM replit_accounts WHERE coupon_extracted = false AND email != '' AND password IS NOT NULL AND password != '' ORDER BY created_at ASC`
    );

    if (unchecked.rows.length === 0) {
      return ctx.reply("✅ No unchecked accounts. All accounts have been scanned.\n\nUse /list to see results.");
    }

    runningOps.set(uid, true);
    await ctx.reply(
      `🔄 Starting auto-scan of *${unchecked.rows.length} accounts*...\n\nSend /cancel to stop.`,
      { parse_mode: "Markdown" }
    );

    let found = 0, noFeature = 0, errors = 0;
    const { extractCouponFromReplitAccount } = await import("./playwrightService");

    for (let i = 0; i < unchecked.rows.length; i++) {
      if (runningOps.get(uid) !== true) {
        await ctx.reply(`⛔ Scan stopped at ${i}/${unchecked.rows.length}\n✅ ${found} | ❌ ${noFeature} | ⚠️ ${errors}`);
        break;
      }

      const acct = unchecked.rows[i];
      const prefix = `[${i + 1}/${unchecked.rows.length}]`;

      try {
        const result = await extractCouponFromReplitAccount(acct.email, acct.password, () => {});
        if (result.success && result.coupon) {
          await dbQuery(`UPDATE replit_accounts SET coupon_extracted = true, coupon_code = $1 WHERE id = $2`, [result.coupon, acct.id]);
          found++;
          await ctx.reply(`${prefix} ✅ \`${acct.email}\` → \`${result.coupon}\``, { parse_mode: "Markdown" });
        } else {
          const err = result.error || "";
          const permanent = err.includes("__NO_FEATURE__") || err.includes("__HAS_FEATURE__") ||
            err.toLowerCase().includes("banned") || err.toLowerCase().includes("wrong password");
          if (permanent) {
            await dbQuery(`UPDATE replit_accounts SET coupon_extracted = true, coupon_code = '' WHERE id = $1`, [acct.id]);
            noFeature++;
            await ctx.reply(`${prefix} ❌ \`${acct.email}\` — no panel`, { parse_mode: "Markdown" });
          } else {
            errors++;
            await ctx.reply(`${prefix} ⚠️ \`${acct.email}\` — transient error`, { parse_mode: "Markdown" });
          }
        }
      } catch {
        errors++;
        await ctx.reply(`${prefix} ⚠️ \`${acct.email}\` — unexpected error`, { parse_mode: "Markdown" });
      }
    }

    runningOps.delete(uid);
    await ctx.reply(
      `*✅ Scan complete!*\n\n✅ Found: ${found} | ❌ No panel: ${noFeature} | ⚠️ Errors: ${errors}`,
      { parse_mode: "Markdown", ...mainMenu() }
    );
  }

  async function handleWarm(ctx: any, count: number) {
    const safe = Math.min(Math.max(1, count), 100);
    const kbd = Markup.inlineKeyboard([
      [
        Markup.button.callback(`🔥 Warm ${safe} accounts`, `confirm_warm_${safe}`),
        Markup.button.callback("❌ Cancel", "apply_dismiss"),
      ],
    ]);
    await ctx.reply(
      `*🔥 Warm Accounts*\n\nThis will warm *${safe}* processing accounts (visit Replit, simulate activity).\n\nProceed?`,
      { parse_mode: "Markdown", ...kbd }
    );
  }

  async function triggerWarm(ctx: any, count: number) {
    await ctx.reply(`🔥 Starting warm for *${count}* accounts...`, { parse_mode: "Markdown" });
    try {
      const r = await botApi("/api/replit-warm-accounts", "POST", { count });
      if (!r.ok) {
        await ctx.reply(`❌ Failed: ${r.data?.error || "Unknown error"}`);
      } else {
        await ctx.reply(`✅ Warming started! Batch ID: \`${r.data.batchId || "started"}\``, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`Error: ${err.message}`);
    }
  }

  async function handlePurge(ctx: any) {
    const processing = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    const cnt = parseInt(processing.rows[0]?.cnt || "0");

    const kbd = Markup.inlineKeyboard([
      [Markup.button.callback("🗑 Confirm Purge", "confirm_purge")],
      [Markup.button.callback("❌ Cancel", "apply_dismiss")],
    ]);

    await ctx.reply(
      `*🗑 Purge Banned Accounts*\n\n` +
      `Will scan *${cnt}* processing accounts, login to each, and permanently delete any that are banned.\n\n⚠️ This action is irreversible. Proceed?`,
      { parse_mode: "Markdown", ...kbd }
    );
  }

  async function triggerPurge(ctx: any) {
    await ctx.reply("🗑 Starting purge scan...\n\nThis runs in the background.");
    try {
      const r = await botApi("/api/replit-purge-banned", "POST", {});
      if (!r.ok) {
        await ctx.reply(`❌ Failed: ${r.data?.error || "Unknown error"}`);
      } else {
        await ctx.reply(`✅ Purge started! Batch ID: \`${r.data.batchId || "started"}\``, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`Error: ${err.message}`);
    }
  }

  async function handleSettings(ctx: any) {
    try {
      const keys = [
        "residential_proxy_url",
        "capsolver_api_key",
        "zenrows_api_key",
        "fivesim_api_key",
        "replit_checkout_delay",
      ];
      const rows = await dbQuery(`SELECT key, value FROM settings WHERE key = ANY($1)`, [keys]);
      const map: Record<string, string> = {};
      rows.rows.forEach((r: any) => { map[r.key] = r.value; });

      const mask = (v: string) => v ? v.slice(0, 8) + "..." : "not set";

      let msg = `*⚙️ Settings*\n\n`;
      msg += `🌐 *Proxy:* \`${mask(map["residential_proxy_url"] || "")}\`\n`;
      msg += `🔑 *Capsolver:* \`${mask(map["capsolver_api_key"] || "")}\`\n`;
      msg += `🔑 *ZenRows:* \`${mask(map["zenrows_api_key"] || "")}\`\n`;
      msg += `📱 *5sim:* \`${mask(map["fivesim_api_key"] || "")}\`\n`;
      msg += `⏱ *Checkout delay:* \`${map["replit_checkout_delay"] || "default"}\`\n\n`;
      msg += `To update proxy: /proxy <url>`;

      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`Error loading settings: ${err.message}`);
    }
  }

  // Quick copy shortcut from accounts list
  bot.action("quick_copy_10", async (ctx) => {
    await ctx.answerCbQuery();
    await handleCopy(ctx, 10, "processing");
  });

  bot.action(/^view_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const status = (ctx.match as RegExpMatchArray)[1];
    await handleAccountsList(ctx, status);
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  // In Telegraf v4, launch() resolves only when the bot STOPS (not when it starts)
  bot.launch({ dropPendingUpdates: true }).catch((err) => {
    console.error("[TelegramBot] ❌ Bot error:", err.message);
  });
  console.log("[TelegramBot] ✅ Bot polling started");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

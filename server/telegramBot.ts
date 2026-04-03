import { Telegraf, Markup } from "telegraf";
import { Pool } from "pg";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

if (!TOKEN) console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");

// ── Per-user state ──────────────────────────────────────────────────────────
interface UserState {
  lastCopiedIds?: string[];
  pendingCreate?: number;
  pendingWarm?: number;
  awaitingText?: "email" | "password" | "proxy" | "custom_copy_count" | "custom_copy_status";
  tempEmail?: string;
  customCopyStatus?: string;
}
const userState = new Map<number, UserState>();
const runningScans = new Map<number, boolean>();

function getState(uid: number): UserState {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid)!;
}

// ── DB helper ────────────────────────────────────────────────────────────────
function makePool() {
  return new Pool({
    connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}
async function dbQuery(sql: string, params: any[] = []) {
  const pool = makePool();
  try { return await pool.query(sql, params); }
  finally { await pool.end(); }
}

// ── Internal API ─────────────────────────────────────────────────────────────
async function botApi(path: string, method = "GET", body?: object) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-bot-token": TOKEN || "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Emoji helpers ─────────────────────────────────────────────────────────────
function statusEmoji(s: string) {
  return { processing: "⏳", sold_out: "✅", working: "🔗", available: "🟢", error: "❌", banned: "🚫" }[s] ?? "❓";
}

// ── Menu builders ─────────────────────────────────────────────────────────────
const BACK_HOME = [Markup.button.callback("⬅️ Main Menu", "nav_home")];
const BACK_ACCTS = [Markup.button.callback("⬅️ Back", "nav_accounts")];
const BACK_AUTO = [Markup.button.callback("⬅️ Back", "nav_automation")];
const BACK_COPY = [Markup.button.callback("⬅️ Back", "nav_copy")];

function menuMain() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📊 Statistics", "nav_stats"), Markup.button.callback("👥 Accounts", "nav_accounts")],
    [Markup.button.callback("📋 Copy Accounts", "nav_copy"), Markup.button.callback("🤖 Automation", "nav_automation")],
    [Markup.button.callback("⚙️ Settings", "nav_settings"), Markup.button.callback("❓ Help", "nav_help")],
  ]);
}

function menuAccounts() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 All Accounts", "list_all"), Markup.button.callback("⏳ Processing", "list_processing")],
    [Markup.button.callback("✅ Sold Out", "list_sold_out"), Markup.button.callback("🔗 Working", "list_working")],
    [Markup.button.callback("🟢 Available", "list_available"), Markup.button.callback("❌ Error", "list_error")],
    BACK_HOME,
  ]);
}

function menuCopy() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⏳ Processing — 5", "copy_processing_5"), Markup.button.callback("⏳ Processing — 10", "copy_processing_10")],
    [Markup.button.callback("⏳ Processing — 25", "copy_processing_25"), Markup.button.callback("⏳ Processing — 50", "copy_processing_50")],
    [Markup.button.callback("✅ Sold Out — 5", "copy_sold_out_5"), Markup.button.callback("✅ Sold Out — 10", "copy_sold_out_10")],
    [Markup.button.callback("🔗 Working — 5", "copy_working_5"), Markup.button.callback("✍️ Custom Count", "copy_custom")],
    BACK_HOME,
  ]);
}

function menuAutomation() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🏗 Create Accounts", "nav_create"), Markup.button.callback("🔗 Checkout Links", "do_checkout")],
    [Markup.button.callback("🔄 Auto-Scan Coupons", "do_scan"), Markup.button.callback("🔥 Warm Accounts", "nav_warm")],
    [Markup.button.callback("🗑 Purge Banned", "do_purge_confirm")],
    BACK_HOME,
  ]);
}

function menuSettings() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 View Settings", "show_settings")],
    [Markup.button.callback("🌐 Update Proxy", "update_proxy")],
    BACK_HOME,
  ]);
}

function menuApplyStatus() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Mark Sold Out", "apply_sold_out"), Markup.button.callback("🔗 Mark Working", "apply_working")],
    [Markup.button.callback("⏳ Mark Processing", "apply_processing"), Markup.button.callback("🟢 Mark Available", "apply_available")],
    [Markup.button.callback("❌ No Change", "apply_dismiss"), Markup.button.callback("📋 Copy Menu", "nav_copy")],
  ]);
}

// ── Safe edit or send ─────────────────────────────────────────────────────────
async function editOrReply(ctx: any, text: string, kbd: any) {
  try {
    await ctx.editMessageText(text, { parse_mode: "Markdown", ...kbd });
  } catch {
    await ctx.reply(text, { parse_mode: "Markdown", ...kbd });
  }
}

// ── Screen renderers ──────────────────────────────────────────────────────────
async function showHome(ctx: any) {
  const text = `*🤖 Replit Admin Panel*\n\nChoose an option to get started:`;
  await editOrReply(ctx, text, menuMain());
}

async function showStats(ctx: any) {
  const counts = await dbQuery(`SELECT status, COUNT(*) as cnt FROM replit_accounts GROUP BY status ORDER BY cnt DESC`);
  const total = counts.rows.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const recent = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`);
  const withLinks = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE checkout_url IS NOT NULL AND checkout_url != ''`);
  const withCoupons = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE coupon_extracted = true AND coupon_code != ''`);

  let lines = `*📊 Account Statistics*\n\n`;
  lines += `Total: *${total}* accounts\n`;
  lines += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
  for (const row of counts.rows) {
    const pct = total > 0 ? Math.round(parseInt(row.cnt) / total * 100) : 0;
    lines += `${statusEmoji(row.status)} ${row.status}: *${row.cnt}* (${pct}%)\n`;
  }
  lines += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
  lines += `🔗 With checkout links: *${withLinks.rows[0]?.cnt || 0}*\n`;
  lines += `🎟 With coupons: *${withCoupons.rows[0]?.cnt || 0}*\n`;
  lines += `📅 Created today: *${recent.rows[0]?.cnt || 0}*`;

  const kbd = Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Refresh", "nav_stats")],
    BACK_HOME,
  ]);
  await editOrReply(ctx, lines, kbd);
}

async function showAccountsList(ctx: any, status: string | null) {
  const isAll = !status || status === "all";
  const rows = isAll
    ? (await dbQuery(`SELECT email, password, status, checkout_url, coupon_code FROM replit_accounts ORDER BY created_at DESC LIMIT 30`)).rows
    : (await dbQuery(`SELECT email, password, status, checkout_url, coupon_code FROM replit_accounts WHERE status = $1 ORDER BY created_at DESC LIMIT 30`, [status])).rows;

  const label = isAll ? "All" : status!.replace("_", " ");
  let msg = `*👥 ${label} Accounts* (${rows.length}${rows.length === 30 ? "+" : ""})\n\n`;

  for (const row of rows) {
    const e = statusEmoji(row.status);
    const extras = [
      row.checkout_url ? "🔗 link" : "",
      row.coupon_code ? "🎟 coupon" : "",
    ].filter(Boolean).join(" ");
    msg += `${e} \`${row.email}\` ${extras}\n`;
  }
  if (rows.length === 0) msg += "_No accounts found._";

  try {
    await ctx.editMessageText(msg, { parse_mode: "Markdown", ...menuAccounts() });
  } catch {
    await ctx.reply(msg, { parse_mode: "Markdown", ...menuAccounts() });
  }
}

async function doCopy(ctx: any, status: string, count: number) {
  const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
  const rows = (await dbQuery(
    `SELECT id, email, password, credits FROM replit_accounts WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
    [status, count]
  )).rows;

  if (rows.length === 0) {
    return ctx.reply(`No ${status} accounts found.`, { ...Markup.inlineKeyboard([BACK_COPY]) });
  }

  // Store IDs for apply-status
  getState(uid).lastCopiedIds = rows.map((r: any) => String(r.id));

  // Send one message per account (easy to forward/copy)
  for (const row of rows) {
    await ctx.reply(
      `Email 📧: \`${row.email}\`\n\nPassword 🔑: \`${row.password || ""}\`\n\nCredits: $${row.credits || "20"} 💰`,
      { parse_mode: "Markdown" }
    );
  }

  // Apply status prompt
  await ctx.reply(
    `✅ *${rows.length}* ${statusEmoji(status)} \`${status}\` accounts sent.\n\nApply a new status to these accounts?`,
    { parse_mode: "Markdown", ...menuApplyStatus() }
  );
}

async function applyStatus(ctx: any, status: string) {
  const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
  const ids = getState(uid).lastCopiedIds;
  if (!ids || ids.length === 0) {
    return ctx.reply("No accounts selected. Use Copy Accounts first.", { ...Markup.inlineKeyboard([BACK_HOME]) });
  }
  const placeholders = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
  const r = await dbQuery(`UPDATE replit_accounts SET status = $1 WHERE id IN (${placeholders}) RETURNING id`, [status, ...ids]);
  getState(uid).lastCopiedIds = undefined;

  await editOrReply(
    ctx,
    `✅ Updated *${r.rowCount}* accounts → \`${status}\``,
    Markup.inlineKeyboard([
      [Markup.button.callback("📊 View Stats", "nav_stats"), Markup.button.callback("📋 Copy Again", "nav_copy")],
      BACK_HOME,
    ])
  );
}

async function showCreateMenu(ctx: any) {
  const text = `*🏗 Create Replit Accounts*\n\nHow many accounts do you want to create?`;
  const kbd = Markup.inlineKeyboard([
    [Markup.button.callback("1", "create_1"), Markup.button.callback("5", "create_5"), Markup.button.callback("10", "create_10")],
    [Markup.button.callback("20", "create_20"), Markup.button.callback("30", "create_30"), Markup.button.callback("50", "create_50")],
    BACK_AUTO,
  ]);
  await editOrReply(ctx, text, kbd);
}

async function showWarmMenu(ctx: any) {
  const processing = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
  const cnt = parseInt(processing.rows[0]?.cnt || "0");
  const text = `*🔥 Warm Accounts*\n\n⏳ Processing accounts available: *${cnt}*\n\nHow many to warm?`;
  const kbd = Markup.inlineKeyboard([
    [Markup.button.callback("5", "warm_5"), Markup.button.callback("10", "warm_10"), Markup.button.callback("25", "warm_25")],
    [Markup.button.callback("50", "warm_50"), Markup.button.callback("All", "warm_all")],
    BACK_AUTO,
  ]);
  await editOrReply(ctx, text, kbd);
}

async function showSettings(ctx: any) {
  const keys = ["residential_proxy_url", "capsolver_api_key", "zenrows_api_key", "fivesim_api_key"];
  const rows = await dbQuery(`SELECT key, value FROM settings WHERE key = ANY($1)`, [keys]);
  const map: Record<string, string> = {};
  rows.rows.forEach((r: any) => { map[r.key] = r.value; });
  const mask = (v: string) => v ? `${v.slice(0, 14)}...` : "_not set_";

  const text =
    `*⚙️ Settings*\n\n` +
    `🌐 *Proxy:*\n\`${mask(map["residential_proxy_url"] || "")}\`\n\n` +
    `🔑 *Capsolver:* ${mask(map["capsolver_api_key"] || "")}\n` +
    `🔑 *ZenRows:* ${mask(map["zenrows_api_key"] || "")}\n` +
    `📱 *5sim:* ${mask(map["fivesim_api_key"] || "")}`;

  await editOrReply(ctx, text, menuSettings());
}

// ── Bot setup ─────────────────────────────────────────────────────────────────
export function startTelegramBot() {
  if (!TOKEN) return;

  const bot = new Telegraf(TOKEN);

  // ── /start ───────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    await ctx.reply(`*🤖 Replit Admin Panel*\n\nChoose an option to get started:`, {
      parse_mode: "Markdown",
      ...menuMain(),
    });
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply(`*🤖 Replit Admin Panel*\n\nChoose an option to get started:`, {
      parse_mode: "Markdown",
      ...menuMain(),
    });
  });

  // ── /cancel ──────────────────────────────────────────────────────────────
  bot.command("cancel", (ctx) => {
    const uid = ctx.from.id;
    const st = getState(uid);
    st.awaitingText = undefined;
    if (runningScans.has(uid)) {
      runningScans.set(uid, false);
      ctx.reply("⛔ Scan stopping after current account...");
    } else {
      ctx.reply("Cancelled.", { ...Markup.inlineKeyboard([BACK_HOME]) });
    }
  });

  // ── Quick commands ────────────────────────────────────────────────────────
  bot.command("stats", async (ctx) => {
    await ctx.reply("Loading stats...");
    await showStats(ctx);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*❓ Commands*\n\n` +
      `/menu — Open main menu\n` +
      `/stats — Account statistics\n` +
      `/cancel — Cancel running scan\n\n` +
      `_Use the menu buttons for everything else._`,
      { parse_mode: "Markdown" }
    );
  });

  // ── Navigation callbacks ──────────────────────────────────────────────────
  bot.action("nav_home", async (ctx) => { await ctx.answerCbQuery(); await showHome(ctx); });
  bot.action("nav_stats", async (ctx) => { await ctx.answerCbQuery(); await showStats(ctx); });
  bot.action("nav_accounts", async (ctx) => { await ctx.answerCbQuery(); await editOrReply(ctx, "*👥 Accounts*\n\nSelect a status to view:", menuAccounts()); });
  bot.action("nav_copy", async (ctx) => { await ctx.answerCbQuery(); await editOrReply(ctx, "*📋 Copy Accounts*\n\nSelect status and count:", menuCopy()); });
  bot.action("nav_automation", async (ctx) => { await ctx.answerCbQuery(); await editOrReply(ctx, "*🤖 Automation*\n\nSelect an operation:", menuAutomation()); });
  bot.action("nav_settings", async (ctx) => { await ctx.answerCbQuery(); await showSettings(ctx); });
  bot.action("nav_create", async (ctx) => { await ctx.answerCbQuery(); await showCreateMenu(ctx); });
  bot.action("nav_warm", async (ctx) => { await ctx.answerCbQuery(); await showWarmMenu(ctx); });
  bot.action("nav_help", async (ctx) => {
    await ctx.answerCbQuery();
    await editOrReply(ctx,
      `*❓ Help*\n\n` +
      `📊 *Statistics* — Account counts and details\n` +
      `👥 *Accounts* — Browse by status\n` +
      `📋 *Copy* — Send account credentials to chat\n` +
      `🤖 *Automation* — Create, scan, warm, purge\n` +
      `⚙️ *Settings* — View/update configuration\n\n` +
      `Send /cancel to stop a running scan.`,
      Markup.inlineKeyboard([BACK_HOME])
    );
  });

  // ── Account list callbacks ────────────────────────────────────────────────
  bot.action("list_all", async (ctx) => { await ctx.answerCbQuery(); await showAccountsList(ctx, null); });
  bot.action("list_processing", async (ctx) => { await ctx.answerCbQuery(); await showAccountsList(ctx, "processing"); });
  bot.action("list_sold_out", async (ctx) => { await ctx.answerCbQuery(); await showAccountsList(ctx, "sold_out"); });
  bot.action("list_working", async (ctx) => { await ctx.answerCbQuery(); await showAccountsList(ctx, "working"); });
  bot.action("list_available", async (ctx) => { await ctx.answerCbQuery(); await showAccountsList(ctx, "available"); });
  bot.action("list_error", async (ctx) => { await ctx.answerCbQuery(); await showAccountsList(ctx, "error"); });

  // ── Copy callbacks ────────────────────────────────────────────────────────
  bot.action(/^copy_(.+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const m = ctx.match as RegExpMatchArray;
    const status = m[1];
    const count = parseInt(m[2]);
    await doCopy(ctx, status, count);
  });

  bot.action("copy_custom", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).awaitingText = "custom_copy_status";
    await ctx.reply(
      `*Custom Copy*\n\nEnter: \`[count] [status]\`\nExample: \`15 processing\` or \`5 sold_out\``,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([BACK_COPY]) }
    );
  });

  // ── Apply status callbacks ────────────────────────────────────────────────
  bot.action("apply_sold_out", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "sold_out"); });
  bot.action("apply_working", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "working"); });
  bot.action("apply_processing", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "processing"); });
  bot.action("apply_available", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "available"); });
  bot.action("apply_dismiss", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).lastCopiedIds = undefined;
    await editOrReply(ctx, "No status change applied.", Markup.inlineKeyboard([
      [Markup.button.callback("📋 Copy Again", "nav_copy")],
      BACK_HOME,
    ]));
  });

  // ── Create callbacks ──────────────────────────────────────────────────────
  bot.action(/^create_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);

    await editOrReply(ctx,
      `*🏗 Create ${count} Account${count > 1 ? "s" : ""}?*\n\nThis will use ${count} Outlook email${count > 1 ? "s" : ""} from your pool.\n\nConfirm?`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Create ${count}`, `confirm_create_${count}`), Markup.button.callback("❌ Cancel", "nav_create")],
      ])
    );
  });

  bot.action(/^confirm_create_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    const r = await botApi("/api/replit-create/bulk", "POST", { count });
    if (!r.ok) {
      await editOrReply(ctx, `❌ Failed: ${r.data?.error || "Unknown error"}`, Markup.inlineKeyboard([BACK_AUTO]));
    } else {
      await editOrReply(ctx,
        `✅ *Creating ${count} accounts*\n\nBatch started! Check panel for live logs.\nBatch ID: \`${r.data.batchId || "started"}\``,
        Markup.inlineKeyboard([
          [Markup.button.callback("📊 Stats", "nav_stats")],
          BACK_AUTO,
        ])
      );
    }
  });

  // ── Checkout callback ─────────────────────────────────────────────────────
  bot.action("do_checkout", async (ctx) => {
    await ctx.answerCbQuery();
    const ready = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    const sources = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'sold_out' AND coupon_extracted = false`);
    const cnt = parseInt(ready.rows[0]?.cnt || "0");
    const srcCnt = parseInt(sources.rows[0]?.cnt || "0");

    await editOrReply(ctx,
      `*🔗 Generate Checkout Links*\n\n⏳ Processing accounts (targets): *${cnt}*\n✅ Source accounts available: *${srcCnt}*\n\nWill auto-pick a source, extract its coupon, and generate checkout links for all processing accounts.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Generate Links", "confirm_checkout"), Markup.button.callback("❌ Cancel", "nav_automation")],
      ])
    );
  });

  bot.action("confirm_checkout", async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const r = await botApi("/api/replit-auto-coupon-links", "POST", {});
    if (!r.ok) {
      await editOrReply(ctx, `❌ Failed: ${r.data?.error || "Unknown error"}`, Markup.inlineKeyboard([BACK_AUTO]));
    } else {
      await editOrReply(ctx,
        `✅ *Checkout generation started!*\n\nSource: \`${r.data.sourceEmail || "auto-selected"}\`\nCheck panel for live logs.`,
        Markup.inlineKeyboard([[Markup.button.callback("📊 Stats", "nav_stats")], BACK_AUTO])
      );
    }
  });

  // ── Scan callback ─────────────────────────────────────────────────────────
  bot.action("do_scan", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from!.id;
    if (runningScans.get(uid) === true) {
      return ctx.reply("A scan is already running. Send /cancel to stop.");
    }

    const unchecked = await dbQuery(
      `SELECT id, email, password FROM replit_accounts WHERE coupon_extracted = false AND email != '' AND password IS NOT NULL AND password != '' ORDER BY created_at ASC`
    );

    if (unchecked.rows.length === 0) {
      return editOrReply(ctx, `✅ No unscanned accounts — all done!`, Markup.inlineKeyboard([BACK_AUTO]));
    }

    runningScans.set(uid, true);
    await ctx.reply(`🔄 *Starting scan of ${unchecked.rows.length} accounts*\n\nSend /cancel to stop early.`, { parse_mode: "Markdown" });

    let found = 0, noFeature = 0, errors = 0;
    const { extractCouponFromReplitAccount } = await import("./playwrightService");

    for (let i = 0; i < unchecked.rows.length; i++) {
      if (runningScans.get(uid) !== true) {
        await ctx.reply(`⛔ Stopped at ${i}/${unchecked.rows.length} — ✅${found} ❌${noFeature} ⚠️${errors}`);
        break;
      }
      const acct = unchecked.rows[i];
      try {
        const result = await extractCouponFromReplitAccount(acct.email, acct.password, () => {});
        if (result.success && result.coupon) {
          await dbQuery(`UPDATE replit_accounts SET coupon_extracted = true, coupon_code = $1 WHERE id = $2`, [result.coupon, acct.id]);
          found++;
          await ctx.reply(`[${i + 1}/${unchecked.rows.length}] ✅ \`${acct.email}\` — \`${result.coupon}\``, { parse_mode: "Markdown" });
        } else {
          const err = result.error || "";
          const permanent = err.includes("__NO_FEATURE__") || err.includes("__HAS_FEATURE__") ||
            err.toLowerCase().includes("banned") || err.toLowerCase().includes("wrong password");
          await dbQuery(`UPDATE replit_accounts SET coupon_extracted = true, coupon_code = '' WHERE id = $1`, [acct.id]);
          if (permanent) { noFeature++; await ctx.reply(`[${i + 1}/${unchecked.rows.length}] ❌ \`${acct.email}\` — no panel`, { parse_mode: "Markdown" }); }
          else { errors++; await ctx.reply(`[${i + 1}/${unchecked.rows.length}] ⚠️ \`${acct.email}\` — error`, { parse_mode: "Markdown" }); }
        }
      } catch {
        errors++;
        await ctx.reply(`[${i + 1}/${unchecked.rows.length}] ⚠️ \`${acct.email}\` — unexpected error`, { parse_mode: "Markdown" });
      }
    }

    runningScans.delete(uid);
    await ctx.reply(
      `*✅ Scan complete!*\n\n✅ Found: ${found}\n❌ No panel: ${noFeature}\n⚠️ Errors: ${errors}`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("📊 View Stats", "nav_stats")], BACK_HOME]) }
    );
  });

  // ── Warm callbacks ────────────────────────────────────────────────────────
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

    if (count === 0) {
      return editOrReply(ctx, "No processing accounts to warm.", Markup.inlineKeyboard([BACK_AUTO]));
    }

    await editOrReply(ctx,
      `*🔥 Warm ${count} account${count > 1 ? "s" : ""}?*\n\nThis will visit Replit and simulate activity for ${count} accounts.\n\nConfirm?`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`✅ Warm ${count}`, `confirm_warm_${count}`), Markup.button.callback("❌ Cancel", "nav_warm")],
      ])
    );
  });

  bot.action(/^confirm_warm_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    const r = await botApi("/api/replit-warm-accounts", "POST", { count });
    if (!r.ok) {
      await editOrReply(ctx, `❌ Failed: ${r.data?.error || "Unknown error"}`, Markup.inlineKeyboard([BACK_AUTO]));
    } else {
      await editOrReply(ctx,
        `✅ *Warming ${count} accounts*\n\nCheck panel for live logs.\nBatch ID: \`${r.data.batchId || "started"}\``,
        Markup.inlineKeyboard([[Markup.button.callback("📊 Stats", "nav_stats")], BACK_AUTO])
      );
    }
  });

  // ── Purge callbacks ────────────────────────────────────────────────────────
  bot.action("do_purge_confirm", async (ctx) => {
    await ctx.answerCbQuery();
    const processing = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    const cnt = parseInt(processing.rows[0]?.cnt || "0");
    await editOrReply(ctx,
      `*🗑 Purge Banned Accounts*\n\nWill scan *${cnt}* processing accounts, login to each, and permanently delete permanently banned accounts.\n\n⚠️ This cannot be undone.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ Confirm Purge", "confirm_purge"), Markup.button.callback("❌ Cancel", "nav_automation")],
      ])
    );
  });

  bot.action("confirm_purge", async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const r = await botApi("/api/replit-purge-banned", "POST", {});
    if (!r.ok) {
      await editOrReply(ctx, `❌ Failed: ${r.data?.error || "Unknown error"}`, Markup.inlineKeyboard([BACK_AUTO]));
    } else {
      await editOrReply(ctx,
        `✅ *Purge started!*\n\nChecking all processing accounts for bans.\nCheck panel for live logs.`,
        Markup.inlineKeyboard([[Markup.button.callback("📊 Stats", "nav_stats")], BACK_AUTO])
      );
    }
  });

  // ── Settings callbacks ────────────────────────────────────────────────────
  bot.action("show_settings", async (ctx) => { await ctx.answerCbQuery(); await showSettings(ctx); });

  bot.action("update_proxy", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from!.id;
    getState(uid).awaitingText = "proxy";
    const cur = await dbQuery(`SELECT value FROM settings WHERE key = 'residential_proxy_url'`);
    const current = cur.rows[0]?.value || "not set";
    await ctx.reply(
      `*🌐 Update Proxy*\n\nCurrent:\n\`${current.slice(0, 60)}...\`\n\nSend the new proxy URL now:`,
      { parse_mode: "Markdown", ...Markup.inlineKeyboard([BACK_HOME]) }
    );
  });

  // ── Text message handler (multi-step flows) ───────────────────────────────
  bot.on("text", async (ctx) => {
    const uid = ctx.from.id;
    const text = ctx.message.text.trim();
    const st = getState(uid);

    if (!st.awaitingText) return;

    if (st.awaitingText === "proxy") {
      if (!text.startsWith("http")) {
        return ctx.reply("That doesn't look like a proxy URL (should start with http). Try again or press Back.");
      }
      await dbQuery(`INSERT INTO settings (key, value) VALUES ('residential_proxy_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [text]);
      st.awaitingText = undefined;
      await ctx.reply(`✅ Proxy updated!`, {
        ...Markup.inlineKeyboard([[Markup.button.callback("⚙️ View Settings", "nav_settings")], BACK_HOME])
      });
      return;
    }

    if (st.awaitingText === "custom_copy_status") {
      // Expect "15 processing" or "5 sold_out"
      const parts = text.split(/\s+/);
      const count = parseInt(parts[0]);
      const status = parts[1] || "processing";
      if (isNaN(count) || count < 1) {
        return ctx.reply("Format: `count status` — e.g. `10 processing`", { parse_mode: "Markdown" });
      }
      st.awaitingText = undefined;
      await doCopy(ctx, status, count);
      return;
    }
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  bot.launch({ dropPendingUpdates: true }).catch((err) => {
    console.error("[TelegramBot] ❌ Bot error:", err.message);
  });
  console.log("[TelegramBot] ✅ Bot polling started");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

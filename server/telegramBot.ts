import { Telegraf, Markup } from "telegraf";
import { Pool } from "pg";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

if (!TOKEN) console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");

// ── Per-user state ────────────────────────────────────────────────────────────
interface UserState {
  lastCopiedIds?: string[];
  awaitingText?: "proxy" | "custom_copy";
}
const userState = new Map<number, UserState>();
const runningScans = new Map<number, boolean>();

function getState(uid: number): UserState {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid)!;
}

// ── DB ────────────────────────────────────────────────────────────────────────
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

// ── Internal API ──────────────────────────────────────────────────────────────
async function botApi(path: string, method = "GET", body?: object) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-bot-token": TOKEN || "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusEmoji(s: string) {
  return { processing: "⏳", sold_out: "✅", working: "🔗", available: "🟢", error: "❌", banned: "🚫" }[s] ?? "❓";
}

// ── Persistent bottom keyboard ────────────────────────────────────────────────
const MAIN_KEYBOARD = Markup.keyboard([
  ["📊 Statistics", "👥 Accounts"],
  ["📋 Copy Accounts", "🔗 Checkout Links"],
  ["🏗 Create Accounts", "🔄 Auto-Scan"],
  ["🔥 Warm Accounts", "🗑 Purge Banned"],
  ["⚙️ Settings", "❓ Help"],
]).resize().persistent();

// ── Inline sub-menus (shown in chat, not bottom bar) ─────────────────────────
function inlineAccounts() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📋 All", "list_all"), Markup.button.callback("⏳ Processing", "list_processing")],
    [Markup.button.callback("✅ Sold Out", "list_sold_out"), Markup.button.callback("🔗 Working", "list_working")],
    [Markup.button.callback("🟢 Available", "list_available"), Markup.button.callback("❌ Error", "list_error")],
  ]);
}

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
async function buildStatsText() {
  const counts = await dbQuery(`SELECT status, COUNT(*) as cnt FROM replit_accounts GROUP BY status ORDER BY cnt DESC`);
  const total = counts.rows.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
  const [recent, links, coupons] = await Promise.all([
    dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE created_at > NOW() - INTERVAL '24 hours'`),
    dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE checkout_url IS NOT NULL AND checkout_url != ''`),
    dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE coupon_extracted = true AND coupon_code != ''`),
  ]);

  let t = `📊 *Account Statistics*\n\n`;
  t += `Total: *${total}* accounts\n`;
  t += `━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const row of counts.rows) {
    const pct = total > 0 ? Math.round(parseInt(row.cnt) / total * 100) : 0;
    t += `${statusEmoji(row.status)} *${row.status}*: ${row.cnt} (${pct}%)\n`;
  }
  t += `━━━━━━━━━━━━━━━━━━━━━\n`;
  t += `🔗 Checkout links: *${links.rows[0]?.cnt || 0}*\n`;
  t += `🎟 Coupons extracted: *${coupons.rows[0]?.cnt || 0}*\n`;
  t += `📅 Created today: *${recent.rows[0]?.cnt || 0}*`;
  return t;
}

// ── Copy + apply ──────────────────────────────────────────────────────────────
async function doCopy(ctx: any, status: string, count: number) {
  const uid = ctx.from?.id;
  const rows = (await dbQuery(
    `SELECT id, email, password, credits FROM replit_accounts WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
    [status, count]
  )).rows;

  if (rows.length === 0) {
    return ctx.reply(`No ${statusEmoji(status)} ${status} accounts found.`);
  }

  getState(uid).lastCopiedIds = rows.map((r: any) => String(r.id));

  for (const row of rows) {
    await ctx.reply(
      `Email 📧: \`${row.email}\`\n\nPassword 🔑: \`${row.password || ""}\`\n\nCredits: $${row.credits || "20"} 💰`,
      { parse_mode: "Markdown" }
    );
  }

  await ctx.reply(
    `✅ *${rows.length}* ${statusEmoji(status)} accounts sent.\n\nApply a status to these accounts?`,
    { parse_mode: "Markdown", ...inlineApplyStatus() }
  );
}

async function applyStatus(ctx: any, status: string) {
  const uid = ctx.from?.id || ctx.callbackQuery?.from?.id;
  const ids = getState(uid).lastCopiedIds;
  if (!ids?.length) {
    return ctx.answerCbQuery ? ctx.answerCbQuery("No accounts selected.") : ctx.reply("No accounts selected.");
  }
  const ph = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
  const r = await dbQuery(`UPDATE replit_accounts SET status = $1 WHERE id IN (${ph}) RETURNING id`, [status, ...ids]);
  getState(uid).lastCopiedIds = undefined;
  if (ctx.answerCbQuery) await ctx.answerCbQuery(`Updated ${r.rowCount} accounts`);
  await ctx.reply(`✅ *${r.rowCount}* accounts → \`${status}\``, { parse_mode: "Markdown" });
}

// ─────────────────────────────────────────────────────────────────────────────
export function startTelegramBot() {
  if (!TOKEN) return;
  const bot = new Telegraf(TOKEN);

  // ── Set bot commands (slash-command list) ─────────────────────────────────
  bot.telegram.setMyCommands([
    { command: "start", description: "Open main menu" },
    { command: "menu", description: "Show keyboard menu" },
    { command: "stats", description: "Account statistics" },
    { command: "cancel", description: "Cancel running scan" },
  ]).catch(() => {});

  // ── /start & /menu ────────────────────────────────────────────────────────
  const sendWelcome = async (ctx: any) => {
    await ctx.reply(
      `👋 *Replit Admin Bot*\n\nUse the menu below or tap any button to get started.`,
      { parse_mode: "Markdown", ...MAIN_KEYBOARD }
    );
  };
  bot.start(sendWelcome);
  bot.command("menu", sendWelcome);

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
    const text = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REPLY KEYBOARD handlers (hears)
  // ──────────────────────────────────────────────────────────────────────────

  bot.hears("📊 Statistics", async (ctx) => {
    const text = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    });
  });

  bot.hears("👥 Accounts", async (ctx) => {
    await ctx.reply("*👥 Accounts* — select a status:", {
      parse_mode: "Markdown",
      ...inlineAccounts(),
    });
  });

  bot.hears("📋 Copy Accounts", async (ctx) => {
    await ctx.reply("*📋 Copy Accounts* — choose status and count:", {
      parse_mode: "Markdown",
      ...inlineCopy(),
    });
  });

  bot.hears("🔗 Checkout Links", async (ctx) => {
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
  });

  bot.hears("🏗 Create Accounts", async (ctx) => {
    await ctx.reply("*🏗 Create Accounts* — how many?", {
      parse_mode: "Markdown",
      ...inlineCreate(),
    });
  });

  bot.hears("🔄 Auto-Scan", async (ctx) => {
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
  });

  bot.hears("🔥 Warm Accounts", async (ctx) => {
    const processing = await dbQuery(`SELECT COUNT(*) as cnt FROM replit_accounts WHERE status = 'processing'`);
    await ctx.reply(
      `*🔥 Warm Accounts*\n\n⏳ Processing accounts: *${processing.rows[0]?.cnt || 0}*\n\nHow many to warm?`,
      { parse_mode: "Markdown", ...inlineWarm() }
    );
  });

  bot.hears("🗑 Purge Banned", async (ctx) => {
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
  });

  bot.hears("⚙️ Settings", async (ctx) => {
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
  });

  bot.hears("❓ Help", async (ctx) => {
    await ctx.reply(
      `*❓ Help*\n\n` +
      `Use the bottom keyboard to navigate:\n\n` +
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
  });

  // ──────────────────────────────────────────────────────────────────────────
  // INLINE KEYBOARD callbacks
  // ──────────────────────────────────────────────────────────────────────────

  bot.action("refresh_stats", async (ctx) => {
    await ctx.answerCbQuery("Refreshing...");
    const text = await buildStatsText();
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    });
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

  // Copy callbacks
  bot.action(/^copy_(.+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Copying...");
    await ctx.deleteMessage().catch(() => {});
    const m = ctx.match as RegExpMatchArray;
    await doCopy(ctx, m[1], parseInt(m[2]));
  });

  bot.action("copy_custom", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    getState(uid).awaitingText = "custom_copy";
    await ctx.reply(`Send: \`count status\`\nExample: \`15 processing\` or \`5 sold_out\``, { parse_mode: "Markdown" });
  });

  // Apply status
  bot.action("apply_sold_out", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "sold_out"); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_working", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "working"); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_processing", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "processing"); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_available", async (ctx) => { await ctx.answerCbQuery(); await applyStatus(ctx, "available"); await ctx.deleteMessage().catch(() => {}); });
  bot.action("apply_dismiss", async (ctx) => {
    await ctx.answerCbQuery();
    getState(ctx.from.id).lastCopiedIds = undefined;
    await ctx.deleteMessage().catch(() => {});
  });

  // Create
  bot.action(/^create_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    await ctx.editMessageText(
      `*🏗 Create ${count} account${count > 1 ? "s" : ""}?*\n\nWill use ${count} Outlook email${count > 1 ? "s" : ""} from the pool.`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`✅ Create ${count}`, `confirm_create_${count}`), Markup.button.callback("❌ Cancel", "dismiss")],
        ]),
      }
    );
  });

  bot.action(/^confirm_create_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const count = parseInt((ctx.match as RegExpMatchArray)[1]);
    const r = await botApi("/api/replit-create/bulk", "POST", { count });
    const msg = r.ok
      ? `✅ *Creating ${count} accounts*\n\nBatch: \`${r.data.batchId || "started"}\`\nCheck the panel for live logs.`
      : `❌ Error: ${r.data?.error || "Unknown"}`;
    await ctx.editMessageText(msg, { parse_mode: "Markdown" });
  });

  // Checkout
  bot.action("confirm_checkout", async (ctx) => {
    await ctx.answerCbQuery("Starting...");
    const r = await botApi("/api/replit-auto-coupon-links", "POST", {});
    const msg = r.ok
      ? `✅ *Checkout generation started!*\n\nSource: \`${r.data.sourceEmail || "auto-selected"}\``
      : `❌ Error: ${r.data?.error || "Unknown"}`;
    await ctx.editMessageText(msg, { parse_mode: "Markdown" });
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

  // ── Text message handler ──────────────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const uid = ctx.from.id;
    const text = ctx.message.text.trim();
    const st = getState(uid);
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
      await doCopy(ctx, status, count);
      return;
    }
  });

  // ── Launch ────────────────────────────────────────────────────────────────
  bot.launch({ dropPendingUpdates: true }).catch((err) => {
    console.error("[TelegramBot] ❌ Error:", err.message);
  });
  console.log("[TelegramBot] ✅ Bot polling started");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

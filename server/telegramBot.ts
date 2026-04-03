import { Telegraf, Markup } from "telegraf";
import { Pool } from "pg";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

if (!TOKEN) console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");

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
  replit:  { label: "Replit",   emoji: "🔵", endpoint: "/api/replit-create/bulk",  outlookTable: "replit_accounts",  hasCard: true, hasCoupon: true },
  lovable: { label: "Lovable",  emoji: "💜", endpoint: "/api/lovable-create/bulk",                                    hasReferral: true },
  v0:      { label: "v0.dev",   emoji: "⚡", endpoint: "/api/v0-create/bulk",      outlookTable: "v0_accounts" },
  adobe:   { label: "Adobe",    emoji: "🅰️", endpoint: "/api/adobe-create/bulk",   outlookTable: "adobe_accounts" },
  chatgpt: { label: "ChatGPT",  emoji: "🤖", endpoint: "/api/chatgpt-create/bulk", outlookTable: "chatgpt_accounts" },
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
interface UserState {
  lastCopiedIds?: string[];
  awaitingText?: "proxy" | "custom_copy" | "coupon_code" | "create_count" | "referral_url";
  createFlow?: CreateFlow;
}
const userState = new Map<number, UserState>();
const runningScans = new Map<number, boolean>();

function getState(uid: number): UserState {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid)!;
}

// ── Create flow helpers ───────────────────────────────────────────────────────
async function getAvailableCount(svc: ServiceConfig): Promise<number> {
  if (!svc.outlookTable) return 0;
  const r = await dbQuery(
    `SELECT COUNT(*) as cnt FROM private_outlook_accounts WHERE email NOT IN (SELECT COALESCE(outlook_email,'') FROM ${svc.outlookTable})`
  );
  return parseInt(r.rows[0]?.cnt || "0");
}

async function showCountPicker(ctx: any, uid: number) {
  const flow = getState(uid).createFlow!;
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

async function showCardStep(ctx: any, uid: number) {
  const cards = await dbQuery(`SELECT id, cardholder_name, card_number FROM saved_cards ORDER BY created_at DESC LIMIT 10`);
  const state = getState(uid);

  if (cards.rows.length === 0) {
    state.createFlow!.cardId = "";
    state.createFlow!.cardLabel = "none";
    await showCreateSummary(ctx, uid);
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

async function showCreateSummary(ctx: any, uid: number) {
  const flow = getState(uid).createFlow!;
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

// ── Reply keyboard — shown on /start and after completing actions ──────────────
const MAIN_KEYBOARD = Markup.keyboard([
  ["📊 Statistics", "👥 Accounts"],
  ["📋 Copy Accounts", "🔗 Checkout Links"],
  ["🏗 Create Accounts", "🔄 Auto-Scan"],
  ["🔥 Warm Accounts", "🗑 Purge Banned"],
  ["⚙️ Settings", "❓ Help"],
]).resize().oneTime();

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
    { command: "menu", description: "Open main keyboard" },
    { command: "stats", description: "Account statistics" },
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
    const text = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: "Markdown",
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
    const text = await buildStatsText();
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "refresh_stats")]]),
    });
  }));

  bot.hears("👥 Accounts", (ctx) => handleMenu(ctx, async () => {
    await ctx.reply("*👥 Accounts* — select a status:", {
      parse_mode: "Markdown",
      ...inlineAccounts(),
    });
  }));

  bot.hears("📋 Copy Accounts", (ctx) => handleMenu(ctx, async () => {
    await ctx.reply("*📋 Copy Accounts* — choose status and count:", {
      parse_mode: "Markdown",
      ...inlineCopy(),
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
    await showCountPicker(ctx, uid);
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
      await showCreateSummary(ctx, uid);
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
    await showCardStep(ctx, uid);
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
    await showCountPicker(ctx, uid);
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
    await showCreateSummary(ctx, uid);
  });

  // ── Create flow: card step ────────────────────────────────────────────────
  bot.action("create_skip_card", async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from.id;
    const st = getState(uid);
    st.createFlow!.cardId = "";
    st.createFlow!.cardLabel = "none";
    await ctx.deleteMessage().catch(() => {});
    await showCreateSummary(ctx, uid);
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
    await showCreateSummary(ctx, uid);
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

        // Only mark done when we see the 🏁 summary line or "Batch complete"
        // sentinel — never trust isComplete alone ([].every() is always true)
        const hasDoneLine = allLines.some(l => l.startsWith("🏁"));
        const done = hasDoneLine || seenBatchComplete;

        if (done) {
          const doneLog = allLines.find(l => l.startsWith("🏁")) || "";
          const created = parseInt(doneLog.match(/(\d+) created/)?.[1] || "0");
          const failed  = parseInt(doneLog.match(/(\d+) failed/)?.[1] || "0");
          const time = elapsed();
          const bars = created > 0
            ? "█".repeat(Math.min(created, 10)) + (failed > 0 ? "░".repeat(Math.min(failed, 5)) : "")
            : (failed > 0 ? "░".repeat(Math.min(failed, 10)) : "");
          const successRate = totalCount > 0 ? Math.round((created / totalCount) * 100) : 0;

          // Step 1: flash
          await bot.telegram.editMessageText(chatId, msgId, undefined,
            `⚡ <b>Finalising results...</b>`, { parse_mode: "HTML" }
          ).catch(() => {});

          await new Promise(res => setTimeout(res, 500));

          // Step 2: polished completion card (edit the live-log message)
          const displayTotal = totalCount > 1 ? totalCount : (created + failed) || totalCount;
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

          // Step 3: NEW alert at bottom of chat
          await bot.telegram.sendMessage(chatId,
            `🔔 <b>Account creation done!</b>\n\n` +
            `${svc.emoji} <b>${esc(svc.label)}</b> — ` +
            `✅ <b>${created}</b> created  ❌ <b>${failed}</b> failed  ⏱ ${time}`,
            { parse_mode: "HTML", ...completionKeyboard }
          ).catch(() => {});

          return;
        }

        // Rolling live log view — last 15 lines in a <pre> block (safe from any char)
        const display = allLines.slice(-15).map(esc).join("\n");
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
    await ctx.answerCbQuery("Starting...");
    const uid = ctx.from.id;
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
      await showCardStep(ctx, uid);
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
      await showCreateSummary(ctx, uid);
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

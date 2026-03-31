import { Telegraf } from "telegraf";
import { extractCouponFromReplitAccount } from "./playwrightService";
import { Pool } from "pg";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");
}

// Track per-user state for multi-step input
const userState = new Map<number, { step: string; email?: string }>();

// Track running auto-scans per user (so they can cancel)
const runningScans = new Map<number, boolean>();

function makePool() {
  return new Pool({
    connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

export function startTelegramBot() {
  if (!TOKEN) return;

  const bot = new Telegraf(TOKEN);

  // ── /start ──
  bot.start((ctx) => {
    ctx.reply(
      `*Replit Coupon Checker*\n\nCommands:\n/autoscan — Auto-check all unchecked accounts from DB\n/list — Show which accounts have the referral panel\n/check — Manually check one account\n/cancel — Cancel current operation`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /help ──
  bot.help((ctx) => {
    ctx.reply(
      `*Commands:*\n/autoscan — Auto-scan all unchecked accounts from DB\n/list — Show accounts with & without referral panel\n/check — Manually check one account by email+password\n/cancel — Cancel scan or current operation`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /cancel ──
  bot.command("cancel", (ctx) => {
    const userId = ctx.from.id;
    userState.delete(userId);
    if (runningScans.has(userId)) {
      runningScans.set(userId, false);
      ctx.reply("Scan cancelled. It will stop after the current account finishes.");
    } else {
      ctx.reply("Cancelled.");
    }
  });

  // ── /list — show which accounts have the referral panel ──
  bot.command("list", async (ctx) => {
    await ctx.reply("Loading account list...");
    const pool = makePool();
    try {
      const withFeature = await pool.query(
        `SELECT email, coupon_code, status, checkout_url
         FROM replit_accounts
         WHERE coupon_extracted = true AND coupon_code IS NOT NULL AND coupon_code != ''
         ORDER BY status, email LIMIT 50`
      );

      const noFeature = await pool.query(
        `SELECT email, status FROM replit_accounts
         WHERE coupon_extracted = true AND (coupon_code IS NULL OR coupon_code = '')
         ORDER BY status, email LIMIT 30`
      );

      const unchecked = await pool.query(
        `SELECT COUNT(*) as cnt FROM replit_accounts
         WHERE coupon_extracted = false AND email != '' AND password IS NOT NULL AND password != ''`
      );

      let msg = `*Account Referral Status*\n\n`;

      msg += `*Have Referral Panel (${withFeature.rowCount})*\n`;
      if (withFeature.rowCount === 0) {
        msg += `_None found_\n`;
      } else {
        for (const row of withFeature.rows) {
          const hasLink = row.checkout_url ? " + link" : "";
          msg += `✅ \`${row.email}\` → \`${row.coupon_code}\`${hasLink}\n`;
        }
      }

      msg += `\n*No Referral Panel (${noFeature.rowCount})*\n`;
      if (noFeature.rowCount === 0) {
        msg += `_None confirmed yet_\n`;
      } else {
        for (const row of noFeature.rows.slice(0, 15)) {
          msg += `❌ \`${row.email}\`\n`;
        }
        if (noFeature.rowCount > 15) msg += `_...and ${noFeature.rowCount - 15} more_\n`;
      }

      const uncheckedCount = parseInt(unchecked.rows[0]?.cnt || "0");
      msg += `\n*Not Yet Checked: ${uncheckedCount} accounts*\n`;
      if (uncheckedCount > 0) msg += `_Use /autoscan to check them all automatically_`;

      if (msg.length > 4000) msg = msg.slice(0, 3990) + "\n...(truncated)";
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`Error: ${err.message}`);
    } finally {
      await pool.end();
    }
  });

  // ── /autoscan — auto-check all unchecked accounts from DB ──
  bot.command("autoscan", async (ctx) => {
    const userId = ctx.from.id;

    if (runningScans.get(userId) === true) {
      await ctx.reply("A scan is already running. Send /cancel to stop it.");
      return;
    }

    const pool = makePool();
    let uncheckedAccounts: any[] = [];

    try {
      const res = await pool.query(
        `SELECT id, email, password FROM replit_accounts
         WHERE coupon_extracted = false AND email != '' AND password IS NOT NULL AND password != ''
         ORDER BY status DESC, created_at ASC`
      );
      uncheckedAccounts = res.rows;
    } catch (err: any) {
      await ctx.reply(`Failed to load accounts: ${err.message}`);
      await pool.end();
      return;
    }
    await pool.end();

    if (uncheckedAccounts.length === 0) {
      await ctx.reply("No unchecked accounts found. All accounts have already been scanned.\n\nUse /list to see results.");
      return;
    }

    runningScans.set(userId, true);
    await ctx.reply(
      `Starting auto-scan of *${uncheckedAccounts.length} accounts*...\n\nI'll update you every 5 accounts. Send /cancel to stop.\n\n_This will take ${Math.round(uncheckedAccounts.length * 0.7)} – ${uncheckedAccounts.length * 1} minutes._`,
      { parse_mode: "Markdown" }
    );

    let found = 0, noFeature = 0, errors = 0;
    const foundList: string[] = [];

    for (let i = 0; i < uncheckedAccounts.length; i++) {
      // Check if user cancelled
      if (runningScans.get(userId) !== true) {
        await ctx.reply(
          `Scan stopped at ${i}/${uncheckedAccounts.length}.\n\n*Found so far:* ${found} with referral panel\n*No feature:* ${noFeature}\n*Errors:* ${errors}`,
          { parse_mode: "Markdown" }
        );
        break;
      }

      const acct = uncheckedAccounts[i];

      try {
        const result = await extractCouponFromReplitAccount(acct.email, acct.password, () => {});

        const updatePool = makePool();
        try {
          if (result.success && result.coupon) {
            // Has referral panel — save coupon code
            await updatePool.query(
              `UPDATE replit_accounts SET coupon_extracted = true, coupon_code = $1 WHERE id = $2`,
              [result.coupon, acct.id]
            );
            found++;
            foundList.push(`✅ \`${acct.email}\` → \`${result.coupon}\``);
          } else {
            const err = result.error || "";
            if (err.includes("__NO_FEATURE__") || err.includes("__HAS_FEATURE__") ||
                err.toLowerCase().includes("banned") || err.toLowerCase().includes("disabled") ||
                err.toLowerCase().includes("wrong password") || err.toLowerCase().includes("invalid username") ||
                err.toLowerCase().includes("bad_credentials")) {
              // Permanent skip — mark as extracted with empty code
              await updatePool.query(
                `UPDATE replit_accounts SET coupon_extracted = true, coupon_code = '' WHERE id = $1`,
                [acct.id]
              );
              noFeature++;
            } else {
              // Transient error — don't mark, retry next scan
              errors++;
            }
          }
        } finally {
          await updatePool.end();
        }
      } catch (err: any) {
        errors++;
      }

      // Progress update every 5 accounts
      if ((i + 1) % 5 === 0 || i === uncheckedAccounts.length - 1) {
        const isLast = i === uncheckedAccounts.length - 1;
        let update = isLast
          ? `*Scan complete!* (${i + 1}/${uncheckedAccounts.length})\n\n`
          : `*Progress: ${i + 1}/${uncheckedAccounts.length}*\n\n`;
        update += `✅ Found referral panel: *${found}*\n`;
        update += `❌ No referral panel: *${noFeature}*\n`;
        update += `⚠️ Errors (will retry): *${errors}*\n`;

        if (foundList.length > 0) {
          update += `\n*New coupons found:*\n`;
          update += foundList.slice(-10).join("\n");
          if (foundList.length > 10) update = `...\n` + update;
        }

        if (isLast) {
          update += `\n\nUse /list to see the full account list.`;
          runningScans.delete(userId);
        } else {
          update += `\n_Send /cancel to stop_`;
        }

        await ctx.reply(update, { parse_mode: "Markdown" });
      }
    }

    runningScans.delete(userId);
  });

  // ── /check — manual credential flow ──
  bot.command("check", (ctx) => {
    userState.set(ctx.from.id, { step: "awaiting_email" });
    ctx.reply("Enter the Replit account *email address*:", { parse_mode: "Markdown" });
  });

  // ── Text handler ──
  bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const state = userState.get(userId);

    if (!state) {
      ctx.reply("Use /autoscan to scan all accounts, /list to see status, or /check to manually check one account.");
      return;
    }

    if (state.step === "awaiting_email") {
      if (!text.includes("@")) {
        ctx.reply("That doesn't look like an email. Please enter a valid email address:");
        return;
      }
      userState.set(userId, { step: "awaiting_password", email: text });
      ctx.reply("Enter the *password* for this account:", { parse_mode: "Markdown" });
      return;
    }

    if (state.step === "awaiting_password") {
      const email = state.email!;
      const password = text;
      userState.delete(userId);

      await ctx.reply(`Logging into *${email}* and extracting coupon...\n\nThis may take 30–60 seconds.`, { parse_mode: "Markdown" });

      try {
        const result = await extractCouponFromReplitAccount(email, password, () => {});

        if (!result.success) {
          const err = result.error || "Unknown error";
          let userMsg = `*Failed to extract coupon*\n\n`;
          if (err.toLowerCase().includes("banned") || err.toLowerCase().includes("disabled")) {
            userMsg += `Account is *banned or disabled*.`;
          } else if (err.toLowerCase().includes("wrong password") || err.toLowerCase().includes("invalid username") || err.toLowerCase().includes("incorrect password") || err.toLowerCase().includes("bad_credentials")) {
            userMsg += `*Wrong email or password.* Check credentials and try again.`;
          } else if (err.includes("__NO_FEATURE__")) {
            userMsg += `This account has *no referral panel* on Replit.\n\nUse /list to see which accounts DO have it.`;
          } else if (err.includes("__HAS_FEATURE__")) {
            userMsg += `Referral panel found but *URL could not be parsed*. Try again later.`;
          } else if (err.toLowerCase().includes("captcha")) {
            userMsg += `Blocked by *captcha*. Try again in a few minutes.`;
          } else if (err.toLowerCase().includes("timeout")) {
            userMsg += `*Connection timed out.* Replit may be slow. Try again.`;
          } else {
            userMsg += `\`${err.slice(0, 200)}\``;
          }
          await ctx.reply(userMsg, { parse_mode: "Markdown" });
          return;
        }

        const { coupon, usedSlots = 0, totalSlots = 4, remainingSlots = 0 } = result;
        const usageBar = buildUsageBar(usedSlots, totalSlots);
        const statusEmoji = remainingSlots === 0 ? "🔴" : remainingSlots <= 1 ? "🟡" : "🟢";

        let reply = `*Coupon Extracted*\n\n`;
        reply += `Account: \`${email}\`\n`;
        reply += `Coupon Code: \`${coupon}\`\n\n`;
        reply += `*Referral Usage:*\n${usageBar}\n`;
        reply += `${statusEmoji} *${usedSlots} of ${totalSlots} slots used* — ${remainingSlots} remaining\n\n`;

        if (remainingSlots === 0) reply += `All referral slots are used.`;
        else if (remainingSlots === 1) reply += `Only 1 slot left — generate a checkout link soon!`;
        else reply += `${remainingSlots} slot(s) available for checkout link generation.`;

        if (result.referralUrl) {
          reply += `\n\nReferral URL:\n\`${result.referralUrl.slice(0, 300)}\``;
        }

        await ctx.reply(reply, { parse_mode: "Markdown" });
      } catch (err: any) {
        await ctx.reply(`Unexpected error:\n\`${String(err?.message || err).slice(0, 300)}\``, { parse_mode: "Markdown" });
      }
    }
  });

  bot.launch().then(() => {
    console.log("[TelegramBot] Bot started successfully");
  }).catch((err) => {
    console.error("[TelegramBot] Failed to start:", err.message);
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

function buildUsageBar(used: number, total: number): string {
  const filled = Math.round((used / total) * 10);
  const empty = 10 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${used}/${total}`;
}

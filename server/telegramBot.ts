import { Telegraf } from "telegraf";
import { extractCouponFromReplitAccount } from "./playwrightService";
import { Pool } from "pg";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");
}

// Track per-user state for multi-step input
const userState = new Map<number, { step: string; email?: string }>();

async function getPool() {
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
      `*Replit Coupon Checker*\n\nCommands:\n/check — Extract coupon from any account\n/list — Show which accounts have the referral panel\n/cancel — Cancel current operation`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /help ──
  bot.help((ctx) => {
    ctx.reply(
      `*Commands:*\n/check — Extract coupon from a Replit account\n/list — Show accounts with & without referral panel\n/cancel — Cancel current operation`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /cancel ──
  bot.command("cancel", (ctx) => {
    userState.delete(ctx.from.id);
    ctx.reply("Cancelled.");
  });

  // ── /list — show which accounts have the referral panel ──
  bot.command("list", async (ctx) => {
    await ctx.reply("Loading account list from database...");
    const pool = await getPool();
    try {
      // Accounts with confirmed real coupon codes = have referral panel
      const withFeature = await pool.query(
        `SELECT email, coupon_code, status, checkout_url
         FROM replit_accounts
         WHERE coupon_extracted = true AND coupon_code IS NOT NULL AND coupon_code != ''
         ORDER BY status, email
         LIMIT 50`
      );

      // Accounts confirmed to have NO feature
      const noFeature = await pool.query(
        `SELECT email, status
         FROM replit_accounts
         WHERE coupon_extracted = true AND (coupon_code IS NULL OR coupon_code = '')
         ORDER BY status, email
         LIMIT 30`
      );

      // Accounts not yet checked
      const unchecked = await pool.query(
        `SELECT COUNT(*) as cnt FROM replit_accounts WHERE coupon_extracted = false AND email != '' AND password != ''`
      );

      let msg = `*Account Referral Status*\n\n`;

      // Accounts WITH referral panel
      msg += `*Have Referral Panel (${withFeature.rowCount})*\n`;
      if (withFeature.rowCount === 0) {
        msg += `_None found_\n`;
      } else {
        for (const row of withFeature.rows) {
          const hasLink = row.checkout_url ? " + link" : "";
          const slots = row.coupon_code ? ` → \`${row.coupon_code}\`` : "";
          msg += `✅ \`${row.email}\`${slots}${hasLink}\n`;
        }
      }

      msg += `\n*No Referral Panel (${noFeature.rowCount})*\n`;
      if (noFeature.rowCount === 0) {
        msg += `_None confirmed yet_\n`;
      } else {
        for (const row of noFeature.rows.slice(0, 15)) {
          msg += `❌ \`${row.email}\`\n`;
        }
        if (noFeature.rowCount > 15) {
          msg += `_...and ${noFeature.rowCount - 15} more_\n`;
        }
      }

      const uncheckedCount = parseInt(unchecked.rows[0]?.cnt || "0");
      if (uncheckedCount > 0) {
        msg += `\n*Not Yet Checked: ${uncheckedCount} accounts*\n`;
        msg += `_Use /check on any of these to find out_`;
      }

      // Telegram message limit is 4096 chars
      if (msg.length > 4000) msg = msg.slice(0, 3990) + "\n...(truncated)";
      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`Error loading list: ${err.message}`);
    } finally {
      await pool.end();
    }
  });

  // ── /check — start credential flow ──
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
      ctx.reply("Use /check to extract a coupon or /list to see which accounts work.");
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

      const log = (_msg: string) => {};

      try {
        const result = await extractCouponFromReplitAccount(email, password, log);

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
        reply += `*Referral Usage:*\n`;
        reply += `${usageBar}\n`;
        reply += `${statusEmoji} *${usedSlots} of ${totalSlots} slots used* — ${remainingSlots} remaining\n\n`;

        if (remainingSlots === 0) {
          reply += `All referral slots are used. No checkout links can be generated.`;
        } else if (remainingSlots === 1) {
          reply += `Only 1 slot left — generate a checkout link soon!`;
        } else {
          reply += `${remainingSlots} slot(s) available for checkout link generation.`;
        }

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
  return `[${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}] ${used}/${total}`;
}

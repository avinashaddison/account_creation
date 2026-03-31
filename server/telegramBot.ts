import { Telegraf, Markup } from "telegraf";
import { extractCouponFromReplitAccount } from "./playwrightService";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.warn("[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled");
}

// Track per-user state for multi-step input
const userState = new Map<number, { step: string; email?: string }>();

export function startTelegramBot() {
  if (!TOKEN) return;

  const bot = new Telegraf(TOKEN);

  bot.start((ctx) => {
    ctx.reply(
      `👋 *Replit Coupon Checker*\n\nSend your Replit account credentials to extract the referral coupon code and see how many slots have been used.\n\nUse /check to begin.`,
      { parse_mode: "Markdown" }
    );
  });

  bot.help((ctx) => {
    ctx.reply(
      `*Commands:*\n/check — Extract coupon from a Replit account\n/cancel — Cancel current operation`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("cancel", (ctx) => {
    userState.delete(ctx.from.id);
    ctx.reply("❌ Cancelled.");
  });

  bot.command("check", (ctx) => {
    userState.set(ctx.from.id, { step: "awaiting_email" });
    ctx.reply("📧 Enter the Replit account *email address*:", { parse_mode: "Markdown" });
  });

  bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();
    const state = userState.get(userId);

    if (!state) {
      ctx.reply("Use /check to start or /help for help.");
      return;
    }

    if (state.step === "awaiting_email") {
      if (!text.includes("@")) {
        ctx.reply("⚠️ That doesn't look like an email. Please enter a valid email address:");
        return;
      }
      userState.set(userId, { step: "awaiting_password", email: text });
      ctx.reply("🔐 Enter the *password* for this account:", { parse_mode: "Markdown" });
      return;
    }

    if (state.step === "awaiting_password") {
      const email = state.email!;
      const password = text;
      userState.delete(userId);

      const statusMsg = await ctx.reply(`⏳ Logging into *${email}* and extracting coupon...\n\nThis may take 30–60 seconds.`, { parse_mode: "Markdown" });

      const logs: string[] = [];
      const log = (msg: string) => {
        logs.push(msg);
      };

      try {
        const result = await extractCouponFromReplitAccount(email, password, log);

        if (!result.success) {
          const err = result.error || "Unknown error";
          let userMsg = `❌ *Failed to extract coupon*\n\n`;
          if (err.toLowerCase().includes("banned") || err.toLowerCase().includes("disabled")) {
            userMsg += `🚫 Account is *banned or disabled*.`;
          } else if (err.toLowerCase().includes("wrong password") || err.toLowerCase().includes("invalid username") || err.toLowerCase().includes("incorrect password") || err.toLowerCase().includes("bad_credentials")) {
            userMsg += `🔑 *Wrong email or password.* Check credentials and try again.`;
          } else if (err.includes("__NO_FEATURE__")) {
            userMsg += `⚠️ This account has *no referral feature* (panel not found).`;
          } else if (err.includes("__HAS_FEATURE__")) {
            userMsg += `⚠️ Referral panel found but *URL could not be parsed*. Try again later.`;
          } else if (err.toLowerCase().includes("captcha")) {
            userMsg += `🤖 Blocked by *captcha*. Try again in a few minutes.`;
          } else if (err.toLowerCase().includes("timeout")) {
            userMsg += `⏱️ *Connection timed out.* Replit may be slow. Try again.`;
          } else {
            userMsg += `\`${err.slice(0, 200)}\``;
          }
          await ctx.reply(userMsg, { parse_mode: "Markdown" });
          return;
        }

        const { coupon, usedSlots = 0, totalSlots = 4, remainingSlots = 0 } = result;

        const usageBar = buildUsageBar(usedSlots, totalSlots);
        const statusEmoji = remainingSlots === 0 ? "🔴" : remainingSlots <= 1 ? "🟡" : "🟢";

        let reply = `✅ *Coupon Extracted Successfully*\n\n`;
        reply += `📧 Account: \`${email}\`\n`;
        reply += `🎟️ Coupon Code: \`${coupon}\`\n\n`;
        reply += `📊 *Referral Usage:*\n`;
        reply += `${usageBar}\n`;
        reply += `${statusEmoji} *${usedSlots} of ${totalSlots} slots used* — ${remainingSlots} remaining\n\n`;

        if (remainingSlots === 0) {
          reply += `⚠️ All referral slots are fully used. No checkout links can be generated.`;
        } else if (remainingSlots === 1) {
          reply += `⚡ Only 1 slot left — generate a checkout link soon!`;
        } else {
          reply += `✨ ${remainingSlots} slot(s) available for checkout link generation.`;
        }

        if (result.referralUrl) {
          reply += `\n\n🔗 Referral URL:\n\`${result.referralUrl.slice(0, 200)}\``;
        }

        await ctx.reply(reply, { parse_mode: "Markdown" });
      } catch (err: any) {
        await ctx.reply(`❌ *Unexpected error:*\n\`${String(err?.message || err).slice(0, 300)}\``, { parse_mode: "Markdown" });
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

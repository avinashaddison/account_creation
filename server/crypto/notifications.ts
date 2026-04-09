import { logger } from "./logger";

/**
 * Send a Telegram message to a customer via the shop bot (Bot 2).
 * userId should be the customer's Telegram numeric ID (as a string).
 */
export async function notifyUser(userId: string, message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN_2 || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.warn("Notifications", "No Telegram bot token configured — skipping user notification", { userId });
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        chat_id:    userId,
        text:       message,
        parse_mode: "HTML",
      }),
    });
    const json = await res.json() as { ok: boolean; description?: string };
    if (!json.ok) {
      logger.error("Notifications", "Telegram send failed", { userId, error: json.description });
    } else {
      logger.info("Notifications", "User notified", { userId });
    }
  } catch (err: unknown) {
    logger.error("Notifications", "Telegram send threw", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function buildPaymentSuccessMessage(opts: {
  orderId: string;
  amount:  string;
  note:    string;
}): string {
  return (
    `✅ <b>PAYMENT CONFIRMED!</b>\n\n` +
    `Your payment of <b>$${parseFloat(opts.amount).toFixed(2)} USDT</b> has been received.\n\n` +
    `<code>Order : ${opts.orderId}</code>\n` +
    `<code>Note  : ${opts.note}</code>\n\n` +
    `Your balance has been updated. Thank you! 🎉`
  );
}

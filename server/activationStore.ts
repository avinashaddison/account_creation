import { Telegram } from "telegraf";
import { Pool } from "pg";

const _pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

export type ActivationService = "chatgpt_plus" | "replit_core";

export const ACTIVATION_LABEL: Record<ActivationService, string> = {
  chatgpt_plus: "ChatGPT Plus",
  replit_core:  "Replit Core",
};

export const ACTIVATION_EMOJI: Record<ActivationService, string> = {
  chatgpt_plus: "🤖",
  replit_core:  "🔵",
};

export interface PendingActivation {
  orderId: string;
  userId: number;
  chatId: number;
  msgId: number;
  service: ActivationService;
  email: string;
  newBalance: number;
}

export const pendingActivations = new Map<string, PendingActivation>();

export interface AdminApprovalState {
  orderId: string;
  step: "waiting_time";
}
export const adminApprovalStates = new Map<number, AdminApprovalState>();

function escHtml(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmt$(n: number) {
  return `$${n.toFixed(2)}`;
}

function progressBar(pct: number, width = 18): string {
  const filled = Math.min(width, Math.round((pct / 100) * width));
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

function timeStr(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function buildActivationCountdownMsg(
  service: ActivationService,
  email: string,
  secsLeft: number,
  totalSecs: number,
  newBalance: number,
  done: boolean
): string {
  const emoji     = ACTIVATION_EMOJI[service];
  const name      = ACTIVATION_LABEL[service];
  const elapsed   = totalSecs - secsLeft;
  const pct       = Math.min(100, Math.round((elapsed / totalSecs) * 100));
  const bar       = progressBar(pct);
  const totalMins = Math.ceil(totalSecs / 60);

  if (done) {
    return (
      `${emoji} <b>${name} — Activated!</b>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📧 <code>${escHtml(email)}</code>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  <b>100%</b>\n\n` +
      `✅ <b>ORDER COMPLETED IN ${totalMins} MIN</b>\n` +
      `<i>${name} has been applied to your account.</i>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 Balance: <b>${fmt$(newBalance)}</b>\n` +
      `💬 Issues? Contact @avinashaddison`
    );
  }
  return (
    `${emoji} <b>${name} — Activating…</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📧 <code>${escHtml(email)}</code>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${bar}  <b>${pct}%</b>\n` +
    `⏳ <b>${timeStr(secsLeft)}</b> remaining  ·  ORDER COMPLETES IN ${totalMins} MIN\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 Balance: <b>${fmt$(newBalance)}</b>\n` +
    `🔄 <i>Admin is activating your account…</i>`
  );
}

export async function startActivationCountdown(
  shopBotToken: string,
  pending: PendingActivation,
  minutesApproved: number
) {
  const tg        = new Telegram(shopBotToken);
  const totalSecs = minutesApproved * 60;
  let secsLeft    = totalSecs;

  const sendUpdate = async (secs: number, done: boolean) => {
    const text = buildActivationCountdownMsg(
      pending.service, pending.email, Math.max(0, secs), totalSecs, pending.newBalance, done
    );
    try {
      await tg.editMessageText(pending.chatId, pending.msgId, undefined, text, { parse_mode: "HTML" });
    } catch (e: any) {
      const msg = e?.message ?? "";
      if (msg.includes("message is not modified")) return;
      if (msg.includes("Too Many Requests"))       return;
    }
  };

  await sendUpdate(secsLeft, false);

  const TICK = 5; // update every 5 seconds — avoids Telegram rate limits
  const timer = setInterval(async () => {
    secsLeft -= TICK;
    const done = secsLeft <= 0;
    await sendUpdate(Math.max(0, secsLeft), done);
    if (done) {
      clearInterval(timer);
      pendingActivations.delete(pending.orderId);
      // Auto-complete the activation order in DB
      _pool.query(
        `UPDATE shop_activation_orders SET status = 'completed' WHERE telegram_id = $1 AND service = $2 AND status != 'completed' ORDER BY created_at DESC LIMIT 1`,
        [pending.userId, pending.service]
      ).catch((e: any) => console.error("[activationStore] auto-complete order error:", e.message));
    }
  }, TICK * 1000);
}

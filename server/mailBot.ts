/**
 * mailBot.ts — Bot 3: Dedicated Temp Mail bot
 * Provides the same business mail features as shopBot but as a standalone,
 * mail-only bot. Uses source_bot='bot3' so its pollers never conflict with
 * the shop bot (Bot 2).
 */

import { Telegraf, Markup } from "telegraf";
import { storage } from "./storage";
import {
  getActiveDomain,
  createAccount as smtpDevCreate,
  getFullInbox as smtpDevInbox,
  listAccounts as smtpDevListAccounts,
} from "./smtpDevService";

// ── Tiny shared utilities ──────────────────────────────────────────────────
function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function genPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function genUsername(domain: string): string {
  const first = ["alex","sam","james","emma","noah","olivia","liam","ava","ethan","mia",
    "lucas","sophia","mason","isabella","aiden","grace","logan","chloe","ryan","lily",
    "jack","ella","henry","aria","owen","zoe","leo","nora","finn","hannah"];
  const last  = ["smith","jones","brown","davis","clark","white","hall","lee","king","wood",
    "reed","bell","fox","lane","stone","hayes","cole","ross","shaw","page"];
  const fn  = first[Math.floor(Math.random() * first.length)];
  const ln  = last[Math.floor(Math.random() * last.length)];
  const num = Math.floor(Math.random() * 900) + 10;
  return `${fn}${ln}${num}@${domain}`;
}

// ── Bot state ──────────────────────────────────────────────────────────────
// smtpAccountId → Set of seen message IDs
const mailSeenIds     = new Map<string, Set<string>>();
// userId → currently active smtpAccountId (receives realtime mail)
const mailActiveInbox = new Map<number, string>();
// smtpAccountId → is poller already running
const mailPollerRunning = new Set<string>();

export interface MailBotWebhookConfig {
  domain: string;
  register: (path: string, handler: any) => void;
}

// ── Inbox poller — with auto-recovery on 404 ──────────────────────────────
function startMailPoller(
  bot: Telegraf,
  smtpAccountId: string,
  email: string,
  password: string,
  telegramId: number,
) {
  if (email.endsWith("@addison.asia")) return; // legacy guard
  if (mailPollerRunning.has(smtpAccountId)) return; // already running
  mailPollerRunning.add(smtpAccountId);
  if (!mailSeenIds.has(smtpAccountId)) mailSeenIds.set(smtpAccountId, new Set());
  const seen = mailSeenIds.get(smtpAccountId)!;

  console.log(`[MailBot/Poller] Polling ${email} → user ${telegramId}`);

  let currentSmtpId = smtpAccountId;

  (async () => {
    while (true) {
      try {
        if (mailActiveInbox.get(telegramId) === currentSmtpId) {
          const msgs = await smtpDevInbox(currentSmtpId);
          for (const msg of msgs) {
            if (seen.has(msg.id)) continue;
            seen.add(msg.id);
            const body = (msg.text || msg.subject || "(no content)").substring(0, 3000);
            await bot.telegram.sendMessage(
              telegramId,
              `📬 <b>New Mail Received!</b>\n\n` +
              `📧 <b>To:</b> <code>${escHtml(email)}</code>\n` +
              `👤 <b>From:</b> <code>${escHtml(msg.from)}</code>\n` +
              `📌 <b>Subject:</b> ${escHtml(msg.subject)}\n` +
              `📅 <b>Date:</b> ${new Date(msg.createdAt ?? msg.date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}\n\n` +
              `<pre>${escHtml(body)}</pre>`,
              { parse_mode: "HTML" }
            ).catch(() => {});
          }
        } else {
          // Not the active inbox — still poll silently so seen-set stays current
          const msgs = await smtpDevInbox(currentSmtpId);
          for (const msg of msgs) seen.add(msg.id);
        }
      } catch (e: any) {
        const m = e?.message ?? "";
        if (m.includes("404")) {
          // smtp.dev account ID is stale — look up real ID by email address first
          console.warn(`[MailBot/Poller] 404 for ${email} — searching smtp.dev by address`);
          let newId: string | null = null;
          try {
            const allAccts = await smtpDevListAccounts();
            const found = allAccts.find(a => a.address.toLowerCase() === email.toLowerCase());
            if (found) newId = found.id;
          } catch { /* fallthrough to create */ }

          // If not found in list, try creating it
          if (!newId) {
            try {
              const res = await smtpDevCreate(email, password);
              newId = res.account?.id ?? null;
            } catch { /* account truly gone */ }
          }

          if (newId) {
            console.log(`[MailBot/Poller] Recovered smtp.dev ID for ${email} → ${newId}`);
            mailSeenIds.set(newId, seen);
            mailSeenIds.delete(currentSmtpId);
            mailPollerRunning.delete(currentSmtpId);
            mailPollerRunning.add(newId);
            await storage.updateBizMailSmtpId(email, newId).catch(() => {});
            if (mailActiveInbox.get(telegramId) === currentSmtpId) {
              mailActiveInbox.set(telegramId, newId);
            }
            currentSmtpId = newId;
            await new Promise(r => setTimeout(r, 2_000));
            continue;
          }

          console.warn(`[MailBot/Poller] Stopping poller for ${email} (cannot recover)`);
          break;
        }
        console.error(`[MailBot/Poller] Error for ${email}:`, m);
      }
      await new Promise(r => setTimeout(r, 3_000));
    }
    mailPollerRunning.delete(currentSmtpId);
  })();
}

// ── Ensure smtp.dev account exists for an email ───────────────────────────
// Returns the smtp.dev account ID to use. Strategy:
// 1. Try existing ID first (fast path)
// 2. If 404 or missing ID: search smtp.dev account list by address
// 3. If not found in list: create new account
async function ensureSmtpAccount(email: string, password: string, existingId?: string | null): Promise<string | null> {
  // Fast path: existing ID works
  if (existingId) {
    try {
      await smtpDevInbox(existingId);
      return existingId;
    } catch (e: any) {
      if (!e.message?.includes("404")) return existingId; // non-404 error — try with it anyway
      // 404: stale ID, fall through to lookup
    }
  }

  // Lookup by email address in smtp.dev account list
  try {
    const accounts = await smtpDevListAccounts();
    const found = accounts.find(a => a.address.toLowerCase() === email.toLowerCase());
    if (found) {
      console.log(`[MailBot] Found smtp.dev account for ${email} by lookup → ID: ${found.id}`);
      await storage.updateBizMailSmtpId(email, found.id).catch(() => {});
      return found.id;
    }
  } catch { /* fall through to create */ }

  // Account doesn't exist on smtp.dev at all — create it
  try {
    const res = await smtpDevCreate(email, password);
    const id  = res.account?.id;
    if (id) {
      await storage.updateBizMailSmtpId(email, id).catch(() => {});
      return id;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Inbox snapshot (for manual refresh) ───────────────────────────────────
async function buildSnapshot(smtpId: string, email: string): Promise<string> {
  let msgs: Awaited<ReturnType<typeof smtpDevInbox>> = [];
  try { msgs = await smtpDevInbox(smtpId); } catch {}
  if (!msgs.length) {
    return `📩 <b>Inbox:</b> <code>${escHtml(email)}</code>\n\n<i>No messages yet. Any email sent here will appear instantly.</i>`;
  }
  const lines = msgs.slice(0, 10).map((m, i) => {
    const date = new Date(m.createdAt ?? m.date).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short",
    });
    const preview = (m.text || m.subject || "").substring(0, 120).replace(/\n/g, " ");
    return (
      `<b>${i + 1}.</b> 👤 <code>${escHtml(m.from)}</code>\n` +
      `   📌 ${escHtml(m.subject)}\n` +
      `   📅 ${date}\n` +
      `   <i>${escHtml(preview)}…</i>`
    );
  }).join("\n\n");
  return (
    `📩 <b>Inbox:</b> <code>${escHtml(email)}</code>\n` +
    `<i>${msgs.length} message${msgs.length !== 1 ? "s" : ""} — showing latest ${Math.min(msgs.length, 10)}</i>\n\n` +
    lines
  );
}

// ── Admin alert ────────────────────────────────────────────────────────────
function alertAdmin(email: string, password: string, telegramId: number, username?: string) {
  const adminToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminIds   = (process.env.TELEGRAM_ALLOWED_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!adminToken || !adminIds.length) return;
  const uname = username ? `@${username}` : `ID ${telegramId}`;
  const text =
    `📩 <b>MAIL BOT 3 — ALLOCATED</b>\n\n` +
    `📧 Email:     <code>${escHtml(email)}</code>\n` +
    `🔑 Password:  <code>${escHtml(password)}</code>\n` +
    `👤 User:      ${escHtml(uname)}  <code>(${telegramId})</code>\n\n` +
    `<i>Realtime inbox monitoring active via Bot 3.</i>`;
  for (const id of adminIds) {
    fetch(`https://api.telegram.org/bot${adminToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML" }),
    }).catch(() => {});
  }
}

// ── Main panel ─────────────────────────────────────────────────────────────
async function showPanel(bot: Telegraf, chatId: number) {
  const domain = await getActiveDomain().catch(() => "addison.monster");
  await bot.telegram.sendMessage(chatId,
    `📩  <b>TEMP MAIL</b>  ·  <i>@${domain}</i>\n\n` +
    `<code>⚡ Instant  ·  🔒 Private  ·  📬 Real-time</code>\n\n` +
    `Choose an option below:`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("📩  Generate New Mail", "mb3_generate")],
        [Markup.button.callback("📋  All My Mails",      "mb3_list")],
      ]),
    }
  ).catch(() => {});
}

async function showList(bot: Telegraf, chatId: number, uid: number) {
  const mails  = await storage.getBizMailsByTelegramId(uid);
  const active = mails.filter(m => !m.deletedAt && m.sourceBot === "bot3");

  if (active.length === 0) {
    await bot.telegram.sendMessage(chatId,
      `📋 <b>All My Mails</b>\n\n<i>You have no addresses yet.\nTap Generate New Mail to create one.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("📩  Generate New Mail", "mb3_generate")]]),
      }
    ).catch(() => {});
    return;
  }

  const current = mailActiveInbox.get(uid);
  const rows = active.map(m => {
    const label = current === m.smtpAccountId ? `✅  ${m.email}` : `📥  ${m.email}`;
    return [Markup.button.callback(label, `mb3_open:${m.smtpAccountId}`)];
  });

  await bot.telegram.sendMessage(chatId,
    `📋 <b>All My Mails</b>\n\nTap any address to open its inbox.\n<i>✅ = currently active</i>`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(rows),
    }
  ).catch(() => {});
}

// ── Bot startup ────────────────────────────────────────────────────────────
export function startMailBot(token: string, webhook?: MailBotWebhookConfig) {
  if (!token) {
    console.warn("[MailBot] No token provided — mail bot (Bot 3) disabled");
    return;
  }

  const bot = new Telegraf(token);

  bot.catch((err: any) => {
    console.error("[MailBot] Unhandled error:", err?.message ?? err);
  });

  // ── Register slash commands (creates the "Menu" persistent button in chat) ─
  bot.telegram.setMyCommands([
    { command: "start", description: "Open mail panel" },
    { command: "mails", description: "List all my mailboxes" },
  ]).catch(() => {});

  // Set the menu button type to 'commands' so Telegram shows the Menu button
  bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } }).catch(() => {});

  // ── /start ───────────────────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const uid    = ctx.from.id;
    const chatId = ctx.chat.id;
    await showPanel(bot, chatId);

    // Resume this user's bot3 pollers
    const mails = await storage.getBizMailsByTelegramId(uid).catch(() => []);
    for (const acc of mails) {
      if (acc.smtpAccountId && !acc.deletedAt && acc.sourceBot === "bot3") {
        if (!mailPollerRunning.has(acc.smtpAccountId)) {
          startMailPoller(bot, acc.smtpAccountId, acc.email, acc.password, uid);
        }
        if (!mailActiveInbox.has(uid)) {
          mailActiveInbox.set(uid, acc.smtpAccountId);
        }
      }
    }
  });

  // ── Generate ─────────────────────────────────────────────────────────────
  bot.action("mb3_generate", async (ctx) => {
    await ctx.answerCbQuery("Allocating your temp email…").catch(() => {});
    const uid      = ctx.from.id;
    const chatId   = ctx.chat!.id;
    const username = ctx.from.username;

    const loadMsg = await bot.telegram.sendMessage(chatId,
      `⏳ <b>Allocating your temp email address…</b>`, { parse_mode: "HTML" }
    ).catch(() => null);

    let finalAddress: string;
    let password: string;
    let smtpAccountId: string;

    // ── Step 1: pool first ────────────────────────────────────────────────
    const pool = await storage.getUnallocatedBizMails();
    if (pool.length > 0) {
      const poolAcc   = pool[0];
      const allocated = await storage.allocateBizMailToUser(poolAcc.email, uid, "bot3");
      if (allocated) {
        finalAddress = allocated.email;
        password     = allocated.password;

        // Ensure smtp.dev account exists (pool accounts may have stale/missing IDs)
        const verifiedSmtpId = await ensureSmtpAccount(finalAddress, password, allocated.smtpAccountId);
        if (!verifiedSmtpId) {
          if (loadMsg) await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
            `❌ <b>Email Not Available</b>\n\nCould not provision inbox. Please try again.`,
            { parse_mode: "HTML" }
          ).catch(() => {});
          return;
        }
        smtpAccountId = verifiedSmtpId;
        alertAdmin(finalAddress, password, uid, username);
        mailActiveInbox.set(uid, smtpAccountId);
        startMailPoller(bot, smtpAccountId, finalAddress, password, uid);

        const card =
          `📩 <b>Temp Mail Allocated!</b>\n\n` +
          `📧 <b>Email:</b>     <code>${escHtml(finalAddress)}</code>\n` +
          `🔑 <b>Password:</b>  <code>${escHtml(password)}</code>\n\n` +
          `<b>This address is exclusively yours.</b>\n` +
          `<i>Any emails sent to it will be forwarded here in realtime.</i>`;

        if (loadMsg) await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined, card, { parse_mode: "HTML" }).catch(() => {});
        await bot.telegram.sendMessage(chatId,
          `⏳ <b>Waiting for Mail…</b>\n\nYour inbox is live. Any email delivered to <code>${escHtml(finalAddress)}</code> will appear here instantly.`,
          { parse_mode: "HTML" }
        ).catch(() => {});
        return;
      }
    }

    // ── Step 2: create fresh on smtp.dev ─────────────────────────────────
    const domain     = await getActiveDomain();
    const newAddress = genUsername(domain);
    const newPassword = genPassword();

    let account: any;
    let usedAddress = newAddress;
    try {
      const res = await smtpDevCreate(newAddress, newPassword);
      account = res.account;
    } catch (e1: any) {
      if (e1.message?.includes("422")) {
        try {
          usedAddress = genUsername(domain);
          const res = await smtpDevCreate(usedAddress, newPassword);
          account = res.account;
        } catch { account = null; }
      }
    }

    // ── Step 3: unavailable ───────────────────────────────────────────────
    if (!account) {
      if (loadMsg) await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined,
        `❌ <b>Email Not Available</b>\n\nNo temp email addresses are available right now.\nPlease try again later or contact support.`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      return;
    }

    finalAddress  = usedAddress;
    password      = newPassword;
    smtpAccountId = account.id;

    await storage.registerBizMailAccount(null, finalAddress, password, {
      allocatedTo: uid, smtpAccountId, sourceBot: "bot3",
    });
    alertAdmin(finalAddress, password, uid, username);
    mailActiveInbox.set(uid, smtpAccountId);
    startMailPoller(bot, smtpAccountId, finalAddress, password, uid);

    const card =
      `📩 <b>Temp Mail Allocated!</b>\n\n` +
      `📧 <b>Email:</b>     <code>${escHtml(finalAddress)}</code>\n` +
      `🔑 <b>Password:</b>  <code>${escHtml(password)}</code>\n\n` +
      `<b>This address is exclusively yours.</b>\n` +
      `<i>Any emails sent to it will be forwarded here in realtime.</i>`;

    if (loadMsg) await bot.telegram.editMessageText(chatId, loadMsg.message_id, undefined, card, { parse_mode: "HTML" }).catch(() => {});
    await bot.telegram.sendMessage(chatId,
      `⏳ <b>Waiting for Mail…</b>\n\nYour inbox is live. Any email delivered to <code>${escHtml(finalAddress)}</code> will appear here instantly.`,
      { parse_mode: "HTML" }
    ).catch(() => {});
  });

  // ── /mails command ────────────────────────────────────────────────────────
  bot.command("mails", async (ctx) => {
    await showList(bot, ctx.chat.id, ctx.from.id);
  });

  // ── List ──────────────────────────────────────────────────────────────────
  bot.action("mb3_list", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showList(bot, ctx.chat!.id, ctx.from!.id);
  });

  // ── Open inbox ────────────────────────────────────────────────────────────
  bot.action(/^mb3_open:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Loading inbox…").catch(() => {});
    const uid    = ctx.from!.id;
    const chatId = ctx.chat!.id;
    const smtpId = (ctx.match as RegExpMatchArray)[1];

    const mails  = await storage.getBizMailsByTelegramId(uid);
    const target = mails.find(m => m.smtpAccountId === smtpId && !m.deletedAt);
    if (!target) { await ctx.answerCbQuery("Mailbox not found.", { show_alert: true }).catch(() => {}); return; }

    mailActiveInbox.set(uid, smtpId);
    // Ensure poller is running
    if (!mailPollerRunning.has(smtpId)) {
      startMailPoller(bot, smtpId, target.email, target.password, uid);
    }

    const snapshot = await buildSnapshot(smtpId, target.email);
    await bot.telegram.sendMessage(chatId, snapshot, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄  Refresh Inbox", `mb3_refresh:${smtpId}`)]]),
    }).catch(() => {});
  });

  // ── Refresh inbox ─────────────────────────────────────────────────────────
  bot.action(/^mb3_refresh:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery("Refreshing…").catch(() => {});
    const uid    = ctx.from!.id;
    const chatId = ctx.chat!.id;
    const smtpId = (ctx.match as RegExpMatchArray)[1];

    const mails  = await storage.getBizMailsByTelegramId(uid);
    const target = mails.find(m => m.smtpAccountId === smtpId && !m.deletedAt);
    if (!target) { await ctx.answerCbQuery("Mailbox not found.", { show_alert: true }).catch(() => {}); return; }

    // Ensure poller is running
    if (!mailPollerRunning.has(smtpId)) {
      startMailPoller(bot, smtpId, target.email, target.password, uid);
    }

    const snapshot = await buildSnapshot(smtpId, target.email);
    await ctx.editMessageText(snapshot, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([[Markup.button.callback("🔄  Refresh Inbox", `mb3_refresh:${smtpId}`)]]),
    }).catch(async () => {
      await bot.telegram.sendMessage(chatId, snapshot, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("🔄  Refresh Inbox", `mb3_refresh:${smtpId}`)]]),
      }).catch(() => {});
    });
  });

  // ── Catch-all: any text → show panel ─────────────────────────────────────
  bot.on("text", async (ctx) => {
    await showPanel(bot, ctx.chat.id);
  });

  // ── Startup: resume Bot3 pollers ──────────────────────────────────────────
  (async () => {
    try {
      const all = await storage.getAllAllocatedBizMailsByBot("bot3");
      const latestPerUser = new Map<number, string>();
      for (const acc of all) {
        if (acc.smtpAccountId && acc.allocatedTo && !acc.deletedAt) {
          if (!latestPerUser.has(acc.allocatedTo)) latestPerUser.set(acc.allocatedTo, acc.smtpAccountId);
        }
      }
      for (const [userId, smtpId] of latestPerUser) mailActiveInbox.set(userId, smtpId);
      for (const acc of all) {
        if (acc.smtpAccountId && acc.allocatedTo && !acc.deletedAt) {
          startMailPoller(bot, acc.smtpAccountId, acc.email, acc.password, acc.allocatedTo);
          await new Promise(r => setTimeout(r, 100));
        }
      }
      if (all.length > 0) console.log(`[MailBot] Resumed polling for ${all.length} bot3 accounts`);
    } catch (e: any) {
      console.error("[MailBot] Startup resume error:", e.message);
    }
  })();

  // ── 30s scan: pick up newly allocated accounts ────────────────────────────
  setInterval(async () => {
    try {
      const all = await storage.getAllAllocatedBizMailsByBot("bot3");
      for (const acc of all) {
        if (acc.smtpAccountId && acc.allocatedTo && !acc.deletedAt) {
          if (!mailPollerRunning.has(acc.smtpAccountId)) {
            startMailPoller(bot, acc.smtpAccountId, acc.email, acc.password, acc.allocatedTo);
            if (!mailActiveInbox.has(acc.allocatedTo)) mailActiveInbox.set(acc.allocatedTo, acc.smtpAccountId);
          }
        }
      }
    } catch {}
  }, 30_000);

  // ── Webhook / polling ─────────────────────────────────────────────────────
  if (webhook) {
    const webhookPath = "/webhook/mailbot";
    webhook.register(webhookPath, bot.webhookCallback("/") as any);
    bot.telegram.setWebhook(`${webhook.domain}${webhookPath}`, { drop_pending_updates: true })
      .then(() => console.log(`[MailBot] webhook active → ${webhook.domain}${webhookPath}`))
      .catch((e: any) => console.error(`[MailBot] setWebhook failed: ${e.message}`));
  } else {
    bot.launch({ dropPendingUpdates: true })
      .then(() => console.log("[MailBot] polling mode active"))
      .catch((e: any) => console.error("[MailBot] launch failed:", e.message));
  }

  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  console.log("[MailBot] Bot 3 (mail-only) started");
}

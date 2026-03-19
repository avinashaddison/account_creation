import { storage } from "../storage";
import { searchEvents, getEventById, type TmEvent } from "./ticketmasterDiscoveryService";

let monitorInterval: ReturnType<typeof setInterval> | null = null;

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getTelegramConfig(): Promise<{ botToken: string; chatId: string } | null> {
  const [botToken, chatId] = await Promise.all([
    storage.getSetting("tm_telegram_bot_token"),
    storage.getSetting("tm_telegram_chat_id"),
  ]);
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

async function runMonitorCycle(): Promise<void> {
  try {
    const keyword = await storage.getSetting("tm_keyword");
    if (!keyword) return;

    const { events: currentEvents } = await searchEvents({ keyword, size: 50 });
    const trackedEvents = await storage.getTmTrackedEvents();
    const telegram = await getTelegramConfig();

    const trackedMap = new Map(trackedEvents.map((e) => [e.eventId, e]));
    const currentMap = new Map(currentEvents.map((e) => [e.id, e]));

    for (const event of currentEvents) {
      const tracked = trackedMap.get(event.id);

      if (!tracked) {
        // Add to tracked events first so future cycles see it as known
        const newTracked = await storage.createTmTrackedEvent({
          eventId: event.id,
          name: event.name,
          date: event.date ?? null,
          venue: event.venue ?? null,
          city: event.city ?? null,
          priceMin: event.priceMin != null ? String(event.priceMin) : null,
          priceMax: event.priceMax != null ? String(event.priceMax) : null,
          currency: event.currency ?? "USD",
          url: event.url ?? null,
          status: "active",
        });

        const message = `🎟 <b>New Event Detected</b>\n<b>${event.name}</b>\n📅 ${event.date ?? "TBD"}\n📍 ${event.venue ?? "Unknown"}, ${event.city ?? ""}\n💰 ${event.priceMin ? `$${event.priceMin} - $${event.priceMax}` : "Price TBD"}\n🔗 ${event.url}`;
        await storage.createTmAlert({
          eventId: event.id,
          eventName: event.name,
          alertType: "new_event",
          message,
          sentViaTelegram: false,
        });

        if (telegram) {
          const sent = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);
          if (sent) {
            await storage.updateTmTrackedEvent(newTracked.id, { status: "active" });
          }
        }
      } else {
        const oldMin = tracked.priceMin;
        const newMin = event.priceMin != null ? String(event.priceMin) : null;
        if (oldMin !== null && newMin !== null && oldMin !== newMin) {
          const message = `💸 <b>Price Change Alert</b>\n<b>${event.name}</b>\n📅 ${event.date ?? "TBD"}\nOld price: $${oldMin}\nNew price: $${newMin}\n🔗 ${event.url}`;
          await storage.createTmAlert({
            eventId: event.id,
            eventName: event.name,
            alertType: "price_change",
            message,
            oldPrice: oldMin,
            newPrice: newMin,
            sentViaTelegram: false,
          });

          if (telegram) {
            await sendTelegramMessage(telegram.botToken, telegram.chatId, message);
          }

          await storage.updateTmTrackedEvent(tracked.id, {
            priceMin: newMin,
            priceMax: event.priceMax != null ? String(event.priceMax) : null,
          });
        }
      }
    }

    for (const tracked of trackedEvents) {
      const stillExists = currentMap.has(tracked.eventId);
      if (!stillExists && tracked.status === "active") {
        const liveEvent = await getEventById(tracked.eventId);
        if (!liveEvent) {
          await storage.updateTmTrackedEvent(tracked.id, { status: "sold_out" });
          const message = `🚫 <b>Event No Longer Available</b>\n<b>${tracked.name}</b>\n🔗 ${tracked.url ?? ""}`;
          await storage.createTmAlert({
            eventId: tracked.eventId,
            eventName: tracked.name,
            alertType: "sold_out",
            message,
            sentViaTelegram: false,
          });
          if (telegram) {
            await sendTelegramMessage(telegram.botToken, telegram.chatId, message);
          }
        } else {
          await storage.updateTmTrackedEvent(tracked.id, {
            priceMin: liveEvent.priceMin != null ? String(liveEvent.priceMin) : null,
            priceMax: liveEvent.priceMax != null ? String(liveEvent.priceMax) : null,
            status: liveEvent.status,
          });
        }
      }
    }

    await storage.deleteTmAlertsOlderThan(30);
  } catch (err: any) {
    console.error("[AlertService] Monitor cycle error:", err.message);
  }
}

export function startMonitoring(): void {
  if (monitorInterval) return;
  console.log("[AlertService] Starting Ticketmaster event monitoring (30s interval)");
  runMonitorCycle();
  monitorInterval = setInterval(runMonitorCycle, 30_000);
}

export function stopMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

export { sendTelegramMessage };

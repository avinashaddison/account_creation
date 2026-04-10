import { db } from "./db";
import { sql } from "drizzle-orm";

// ── Emoji slot definitions ────────────────────────────────────────────────────
export const EMOJI_SLOTS = {
  card:    { label: "💳 Card (ADD FUNDS header)",      fallback: "💳", default: "5382116965029829100" },
  bolt:    { label: "⚡ Bolt (Auto Verify / speed)",   fallback: "⚡", default: "5219005168305143806" },
  diamond: { label: "💎 Diamond (TRC20)",              fallback: "💎", default: "5471952986970267627" },
  money:   { label: "💰 Money (wallet / balance)",     fallback: "💰", default: "5371260806527499265" },
  fire:    { label: "🔥 Fire (header / branding)",     fallback: "🔥", default: "5368324170671202286" },
  star:    { label: "⭐ Star (VIP / featured)",        fallback: "⭐", default: "5376425420038527205" },
  rocket:  { label: "🚀 Rocket (launch / upgrade)",   fallback: "🚀", default: "5380004077456738553" },
  check:   { label: "✅ Check (success / confirmed)", fallback: "✅", default: "5404870433004043254" },
  crown:   { label: "👑 Crown (VIP badge)",            fallback: "👑", default: "5379748062124056162" },
  gift:    { label: "🎁 Gift (bonus / reward)",        fallback: "🎁", default: "5436040711104178070" },
  bell:    { label: "🔔 Bell (alerts / notifications)",fallback: "🔔", default: "5361541227376957276" },
} as const;

export type EmojiKey = keyof typeof EMOJI_SLOTS;

// ── In-memory cache ───────────────────────────────────────────────────────────
let cache: Record<string, string> = {};
let cacheLoaded = false;

export async function loadEmojiSettings(): Promise<void> {
  const result = await db.execute(sql`SELECT key, value FROM shop_settings WHERE key LIKE ${"emoji_%"}`);
  cache = {};
  for (const row of result.rows ?? []) {
    const slot = (row.key as string).replace("emoji_", "") as EmojiKey;
    cache[slot] = row.value as string;
  }
  cacheLoaded = true;
}

/** Returns the animated emoji <tg-emoji> tag for the given slot. */
export function ae(key: EmojiKey, customFallback?: string): string {
  if (!cacheLoaded) {
    // Sync fallback if cache not loaded yet
    const slot = EMOJI_SLOTS[key];
    const fb = customFallback ?? slot.fallback;
    return `<tg-emoji emoji-id="${slot.default}">${fb}</tg-emoji>`;
  }
  const id  = cache[key] ?? EMOJI_SLOTS[key].default;
  const fb  = customFallback ?? EMOJI_SLOTS[key].fallback;
  return `<tg-emoji emoji-id="${id}">${fb}</tg-emoji>`;
}

/** Returns just the emoji ID for the given slot. */
export function getEmojiId(key: EmojiKey): string {
  return cache[key] ?? EMOJI_SLOTS[key].default;
}

/** Saves a new emoji ID for a slot and updates the cache. */
export async function setEmojiId(key: EmojiKey, id: string): Promise<void> {
  const dbKey = `emoji_${key}`;
  await db.execute(sql`
    INSERT INTO shop_settings (key, value) VALUES (${dbKey}, ${id})
    ON CONFLICT (key) DO UPDATE SET value = ${id}
  `);
  cache[key] = id;
}

/** Resets a slot back to the built-in default. */
export async function resetEmojiId(key: EmojiKey): Promise<void> {
  const dbKey = `emoji_${key}`;
  await db.execute(sql`DELETE FROM shop_settings WHERE key = ${dbKey}`);
  delete cache[key];
}

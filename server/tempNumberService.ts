/**
 * tempNumberService.ts
 * Scrapes temp-number.com to provide free temporary phone numbers (US & UK).
 * No API key required — uses public web pages.
 */

const BASE = "https://temp-number.com";
const UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type CountryCode = "us" | "uk";

export const COUNTRY_META: Record<CountryCode, { slug: string; flag: string; label: string }> = {
  us: { slug: "united-states",  flag: "🇺🇸", label: "US" },
  uk: { slug: "united-kingdom", flag: "🇬🇧", label: "UK" },
};

export interface TempNumber {
  number:  string;   // e.g. "14386195693"
  display: string;   // e.g. "+14386195693"
  timeAgo: string;   // e.g. "8 hours ago"
  isNew:   boolean;
}

export interface TempMessage {
  from:    string;
  timeAgo: string;
  body:    string;
  otp?:    string;
}

export interface NumbersPage {
  numbers:     TempNumber[];
  totalPages:  number;
  currentPage: number;
  totalCount:  number;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">").replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim();
}

/** Fetch a page of temp numbers for a given country. page is 1-indexed. */
export async function fetchNumbers(country: CountryCode, page = 1): Promise<NumbersPage> {
  const { slug } = COUNTRY_META[country];
  const url = page === 1
    ? `${BASE}/countries/${slug}`
    : `${BASE}/countries/${slug}/${page}`;

  const res  = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();

  const countMatch = html.match(/(\d+)\s+numbers available/i);
  const totalCount = countMatch ? parseInt(countMatch[1]) : 0;

  const pageMatch = html.match(/Page \d+ of (\d+)/i);
  const totalPages = pageMatch ? parseInt(pageMatch[1]) : 1;

  const numbers: TempNumber[] = [];
  const cardChunks = html.split('data-number="');
  for (let i = 1; i < cardChunks.length; i++) {
    const chunk  = cardChunks[i];
    const numEnd = chunk.indexOf('"');
    const num    = chunk.substring(0, numEnd);
    if (!/^\d{7,15}$/.test(num)) continue;

    const timeMatch = chunk.match(/class="add_time-top">(.*?)<\/div>/);
    const timeAgo   = timeMatch ? timeMatch[1].trim() : "";
    const isNew     = chunk.includes("ribbon-green") || chunk.includes("ribbon-wrapper-green");

    numbers.push({ number: num, display: `+${num}`, timeAgo, isNew });
  }

  return { numbers, totalPages, currentPage: page, totalCount };
}

/** Backward-compat alias */
export const fetchUSNumbers = (page = 1) => fetchNumbers("us", page);

/** Fetch inbox messages for a specific number and country. */
export async function fetchNumberMessages(number: string, country: CountryCode = "us"): Promise<TempMessage[]> {
  const clean = number.replace(/\D/g, "");
  const { slug } = COUNTRY_META[country];
  const url  = `${BASE}/temporary-numbers/${slug}/${clean}`;
  const res  = await fetch(url, { headers: { "User-Agent": UA } });

  if (!res.ok) return [];
  const html = await res.text();

  const messages: TempMessage[] = [];
  const chunks = html.split('<article class="msg-card');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];

    const fromMatch = chunk.match(/<span>([^<]+)<\/span>/);
    const from      = fromMatch ? fromMatch[1].trim() : "unknown";

    const timeMatch = chunk.match(/<time[^>]*>(.*?)<\/time>/s);
    const timeAgo   = timeMatch ? timeMatch[1].trim() : "";

    const bodyStart = chunk.indexOf('<div class="msg-body">');
    const bodyEnd   = chunk.indexOf("</div>", bodyStart);
    const rawBody   = bodyStart > -1 ? chunk.substring(bodyStart + 22, bodyEnd) : "";
    const body      = stripTags(rawBody);

    const otpMatch = chunk.match(/data-clipboard-text='(\d{4,8})'/);
    const otp      = otpMatch ? otpMatch[1] : undefined;

    if (body) messages.push({ from, timeAgo, body, otp });
  }

  return messages.slice(0, 15);
}

/**
 * tempNumberService.ts
 * Scrapes temp-number.com to provide free US temporary phone numbers.
 * No API key required — uses public web pages.
 */

import fetch from "node-fetch";

const BASE = "https://temp-number.com";
const UA   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface TempNumber {
  number: string;   // e.g. "14386195693"
  display: string;  // e.g. "+14386195693"
  timeAgo: string;  // e.g. "8 hours ago"
  isNew: boolean;
}

export interface TempMessage {
  from:    string;
  timeAgo: string;
  body:    string;
  otp?:   string;
}

export interface NumbersPage {
  numbers:     TempNumber[];
  totalPages:  number;
  currentPage: number;
  totalCount:  number;
}

function getText(html: string, startTag: string, endTag: string): string {
  const s = html.indexOf(startTag);
  if (s === -1) return "";
  const e = html.indexOf(endTag, s + startTag.length);
  if (e === -1) return "";
  return html.substring(s + startTag.length, e).trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">").replace(/&#039;/g, "'").replace(/&quot;/g, '"').trim();
}

/** Fetch a page of US temp numbers. page is 1-indexed. */
export async function fetchUSNumbers(page = 1): Promise<NumbersPage> {
  const url = page === 1
    ? `${BASE}/countries/united-states`
    : `${BASE}/countries/united-states/${page}`;

  const res  = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();

  // Total count
  const countMatch = html.match(/(\d+)\s+numbers available/i);
  const totalCount = countMatch ? parseInt(countMatch[1]) : 0;

  // Total pages
  const pageMatch = html.match(/Page \d+ of (\d+)/i);
  const totalPages = pageMatch ? parseInt(pageMatch[1]) : 1;

  // Parse number cards by splitting on data-number=" attribute
  const numbers: TempNumber[] = [];
  const cardChunks = html.split('data-number="');
  for (let i = 1; i < cardChunks.length; i++) {
    const chunk = cardChunks[i];
    const numEnd = chunk.indexOf('"');
    const num = chunk.substring(0, numEnd);
    if (!/^\d{10,15}$/.test(num)) continue;

    const timeMatch = chunk.match(/class="add_time-top">(.*?)<\/div>/);
    const timeAgo = timeMatch ? timeMatch[1].trim() : "";

    const isNew = chunk.includes("ribbon-green") || chunk.includes("ribbon-wrapper-green");

    numbers.push({
      number:  num,
      display: `+${num}`,
      timeAgo,
      isNew,
    });
  }

  return { numbers, totalPages, currentPage: page, totalCount };
}

/** Fetch inbox messages for a specific number (digits only, no +). */
export async function fetchNumberMessages(number: string): Promise<TempMessage[]> {
  const clean = number.replace(/\D/g, "");
  const url   = `${BASE}/temporary-numbers/united-states/${clean}`;
  const res   = await fetch(url, { headers: { "User-Agent": UA } });

  if (!res.ok) return [];
  const html = await res.text();

  const messages: TempMessage[] = [];
  const chunks = html.split('<article class="msg-card');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Sender
    const fromMatch = chunk.match(/<span>([^<]+)<\/span>/);
    const from = fromMatch ? fromMatch[1].trim() : "unknown";

    // Time
    const timeMatch = chunk.match(/<time[^>]*>(.*?)<\/time>/s);
    const timeAgo = timeMatch ? timeMatch[1].trim() : "";

    // Body
    const bodyStart = chunk.indexOf('<div class="msg-body">');
    const bodyEnd   = chunk.indexOf("</div>", bodyStart);
    const rawBody   = bodyStart > -1 ? chunk.substring(bodyStart + 22, bodyEnd) : "";
    const body      = stripTags(rawBody);

    // OTP code (if present)
    const otpMatch = chunk.match(/data-clipboard-text='(\d{4,8})'/);
    const otp = otpMatch ? otpMatch[1] : undefined;

    if (body) {
      messages.push({ from, timeAgo, body, otp });
    }
  }

  return messages.slice(0, 15); // return at most 15 most recent
}

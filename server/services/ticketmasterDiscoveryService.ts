const TM_API_KEY = "shlSyu33GHigFHoQbO44PJqhvqzYF8K0";
const TM_BASE_URL = "https://app.ticketmaster.com/discovery/v2";

export interface TmEvent {
  id: string;
  name: string;
  date: string | null;
  venue: string | null;
  city: string | null;
  priceMin: string | null;
  priceMax: string | null;
  currency: string;
  url: string;
  status: string;
  images: string[];
  segment: string | null;
  genre: string | null;
}

function parseEvent(raw: any): TmEvent {
  const dateObj = raw.dates?.start;
  const date = dateObj?.localDate
    ? `${dateObj.localDate}${dateObj.localTime ? " " + dateObj.localTime : ""}`
    : null;

  const venue = raw._embedded?.venues?.[0];
  const venueName = venue?.name ?? null;
  const city = venue?.city?.name ?? null;

  const priceRange = raw.priceRanges?.[0];
  const priceMin = priceRange ? String(priceRange.min) : null;
  const priceMax = priceRange ? String(priceRange.max) : null;
  const currency = priceRange?.currency ?? "USD";

  const images: string[] = (raw.images ?? []).map((img: any) => img.url as string);

  const classifications = raw.classifications?.[0];
  const segment = classifications?.segment?.name ?? null;
  const genre = classifications?.genre?.name ?? null;

  const status = raw.dates?.status?.code ?? "onsale";

  return {
    id: raw.id,
    name: raw.name,
    date,
    venue: venueName,
    city,
    priceMin,
    priceMax,
    currency,
    url: raw.url ?? `https://www.ticketmaster.com/event/${raw.id}`,
    status,
    images,
    segment,
    genre,
  };
}

export async function searchEvents(options: {
  keyword?: string;
  countryCode?: string;
  size?: number;
  page?: number;
  classificationName?: string;
  startDateTime?: string;
  endDateTime?: string;
}): Promise<{ events: TmEvent[]; total: number; page: number; totalPages: number }> {
  const params = new URLSearchParams();
  params.set("apikey", TM_API_KEY);
  params.set("countryCode", options.countryCode ?? "US");
  params.set("size", String(options.size ?? 20));
  params.set("page", String(options.page ?? 0));
  params.set("sort", "date,asc");

  if (options.keyword) params.set("keyword", options.keyword);
  if (options.classificationName) params.set("classificationName", options.classificationName);
  if (options.startDateTime) params.set("startDateTime", options.startDateTime);
  if (options.endDateTime) params.set("endDateTime", options.endDateTime);

  const url = `${TM_BASE_URL}/events.json?${params.toString()}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ticketmaster API error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  const rawEvents: any[] = data._embedded?.events ?? [];
  const page = data.page ?? { totalElements: 0, totalPages: 0, number: 0 };

  return {
    events: rawEvents.map(parseEvent),
    total: page.totalElements ?? rawEvents.length,
    page: page.number ?? 0,
    totalPages: page.totalPages ?? 1,
  };
}

export async function getEventById(eventId: string): Promise<TmEvent | null> {
  const url = `${TM_BASE_URL}/events/${eventId}.json?apikey=${TM_API_KEY}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  return parseEvent(data);
}

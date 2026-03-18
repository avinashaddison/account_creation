import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Ticket, MapPin, Calendar, DollarSign, ExternalLink, Plus, ChevronLeft, ChevronRight, Radio } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { handleUnauthorized } from "@/lib/auth";

type TmEvent = {
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
};

type SearchResult = { events: TmEvent[]; total: number; page: number; totalPages: number };

function statusColor(status: string) {
  switch (status) {
    case "onsale": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "offsale": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "cancelled": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "rescheduled": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    case "postponed": return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  }
}

export default function TMEventScanner() {
  const { toast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<SearchResult>({
    queryKey: ["/api/tm-discovery/events", searchTerm, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), size: "20" });
      if (searchTerm) params.set("keyword", searchTerm);
      const res = await fetch(`/api/tm-discovery/events?${params.toString()}`, { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const trackMutation = useMutation({
    mutationFn: (event: TmEvent) =>
      apiRequest("POST", "/api/tm-discovery/track", {
        eventId: event.id, name: event.name, date: event.date, venue: event.venue,
        city: event.city, priceMin: event.priceMin, priceMax: event.priceMax,
        currency: event.currency, url: event.url, status: event.status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-discovery/tracked"] });
      toast({ title: "Event tracked", description: "You will receive alerts for this event." });
      setTrackingId(null);
    },
    onError: (err: any) => {
      const msg = err?.message?.includes("already tracked") ? "Already tracking this event." : "Failed to track event.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      setTrackingId(null);
    },
  });

  function handleSearch() {
    setSearchTerm(keyword);
    setPage(0);
  }

  const events = data?.events ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-emerald-400/10 blur-md" />
              <div className="relative w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.1) 0%, rgba(255,176,0,0.08) 100%)', border: '1px solid rgba(0,255,65,0.15)' }}>
                <Ticket className="w-4 h-4 text-emerald-400" />
              </div>
            </div>
            <h1 className="text-lg font-bold font-mono text-white">Event Scanner</h1>
          </div>
          <p className="text-xs text-zinc-500 font-mono ml-10.5">Live search from Ticketmaster Discovery API — auto-refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-400/60 uppercase tracking-wider">Live</span>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search events, artists, venues..."
            className="pl-9 h-9 bg-black/30 border-emerald-500/10 text-zinc-200 placeholder:text-zinc-700 font-mono text-sm focus:border-emerald-500/30"
            data-testid="input-event-search"
          />
        </div>
        <Button onClick={handleSearch} className="h-9 px-4 bg-emerald-600/80 hover:bg-emerald-600 text-black font-mono text-xs font-bold" data-testid="button-search-events">
          {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Search"}
        </Button>
      </div>

      <div className="rounded-xl border border-emerald-500/[0.08]" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.02) 0%, rgba(0,0,0,0.4) 100%)' }}>
        <div className="px-4 py-3 border-b border-emerald-500/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-3 h-3 text-emerald-400/40" />
            <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
              {data ? `${data.total.toLocaleString()} events found` : "Events"}
            </span>
          </div>
          {data && data.totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} data-testid="button-prev-page">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-[10px] font-mono text-zinc-600">{page + 1} / {totalPages}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} data-testid="button-next-page">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400/50" />
              <p className="text-[10px] font-mono text-zinc-700 uppercase tracking-wider">Fetching events...</p>
            </div>
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Ticket className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
              <p className="text-sm font-mono text-zinc-600">No events found</p>
              <p className="text-[10px] font-mono text-zinc-700 mt-1">Try a different keyword or check your Settings</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-emerald-500/[0.04]">
            {events.map((event) => (
              <div key={event.id} className="px-4 py-3 flex items-center gap-4 hover:bg-emerald-500/[0.02] transition-colors group" data-testid={`row-event-${event.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-mono text-zinc-200 truncate font-medium">{event.name}</p>
                    {event.genre && (
                      <span className="text-[9px] font-mono text-zinc-600 border border-zinc-800 rounded px-1 py-0.5 shrink-0">{event.genre}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {event.date && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5 text-zinc-700" />
                        <span className="text-[10px] font-mono text-zinc-600">{event.date}</span>
                      </div>
                    )}
                    {(event.venue || event.city) && (
                      <div className="flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5 text-zinc-700" />
                        <span className="text-[10px] font-mono text-zinc-600">{[event.venue, event.city].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    {event.priceMin && (
                      <div className="flex items-center gap-1">
                        <DollarSign className="w-2.5 h-2.5 text-emerald-500/50" />
                        <span className="text-[10px] font-mono text-emerald-400/70">${event.priceMin}{event.priceMax && event.priceMax !== event.priceMin ? ` – $${event.priceMax}` : ""}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`text-[9px] font-mono border uppercase ${statusColor(event.status)}`}>{event.status}</Badge>
                  <a href={event.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-zinc-800 transition-colors" data-testid={`link-event-${event.id}`}>
                    <ExternalLink className="w-3 h-3 text-zinc-700 hover:text-zinc-400 transition-colors" />
                  </a>
                  <Button
                    size="sm"
                    className="h-7 px-3 text-[10px] font-mono bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/40"
                    disabled={trackMutation.isPending && trackingId === event.id}
                    onClick={() => { setTrackingId(event.id); trackMutation.mutate(event); }}
                    data-testid={`button-track-${event.id}`}
                  >
                    {trackMutation.isPending && trackingId === event.id ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <><Plus className="w-2.5 h-2.5 mr-1" />Track</>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

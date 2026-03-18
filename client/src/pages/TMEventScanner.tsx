import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Ticket, MapPin, Calendar, DollarSign, ExternalLink, Plus, ChevronLeft, ChevronRight, Star, Tag, Zap } from "lucide-react";
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

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    onsale:     { label: "ON SALE",     bg: "bg-green-500/20",  text: "text-green-300",  dot: "bg-green-400" },
    offsale:    { label: "OFF SALE",    bg: "bg-red-500/20",    text: "text-red-300",    dot: "bg-red-400" },
    cancelled:  { label: "CANCELLED",   bg: "bg-red-500/20",    text: "text-red-300",    dot: "bg-red-400" },
    rescheduled:{ label: "RESCHEDULED", bg: "bg-amber-500/20",  text: "text-amber-300",  dot: "bg-amber-400" },
    postponed:  { label: "POSTPONED",   bg: "bg-orange-500/20", text: "text-orange-300", dot: "bg-orange-400" },
  };
  const s = config[status] ?? { label: status.toUpperCase(), bg: "bg-zinc-700/30", text: "text-zinc-400", dot: "bg-zinc-500" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function GenreChip({ label }: { label: string }) {
  const colors = [
    "bg-purple-500/20 text-purple-300 border-purple-500/30",
    "bg-blue-500/20 text-blue-300 border-blue-500/30",
    "bg-pink-500/20 text-pink-300 border-pink-500/30",
    "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  ];
  const idx = label.charCodeAt(0) % colors.length;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${colors[idx]}`}>
      <Tag className="w-2.5 h-2.5" />
      {label}
    </span>
  );
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
      toast({ title: "Event tracked!", description: "You'll receive alerts for this event." });
      setTrackingId(null);
    },
    onError: (err: any) => {
      const msg = err?.message?.includes("already tracked") ? "Already tracking this event." : "Failed to track event.";
      toast({ title: "Error", description: msg, variant: "destructive" });
      setTrackingId(null);
    },
  });

  function handleSearch() { setSearchTerm(keyword); setPage(0); }

  const events = data?.events ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 0 20px rgba(99,102,241,0.4)' }}>
              <Ticket className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Event Scanner</h1>
              <p className="text-xs text-zinc-400">Live search · Ticketmaster Discovery API · Auto-refresh 30s</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}>
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-xs font-semibold text-blue-300 uppercase tracking-widest">Live</span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-2xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by artist, event name, venue..."
            className="pl-11 h-11 text-sm rounded-xl border-white/10 text-zinc-200 placeholder:text-zinc-600"
            style={{ background: 'rgba(255,255,255,0.04)' }}
            data-testid="input-event-search"
          />
        </div>
        <Button
          onClick={handleSearch}
          className="h-11 px-6 rounded-xl font-semibold text-sm"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 0 15px rgba(99,102,241,0.3)' }}
          data-testid="button-search-events"
        >
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4 mr-2" />Search</>}
        </Button>
      </div>

      {/* Results Header */}
      {data && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-white">{data.total.toLocaleString()}</span>
            <span className="text-sm text-zinc-400">events found</span>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 rounded-lg border border-white/10 hover:border-blue-500/50 hover:bg-blue-500/10"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-zinc-400 px-2">Page {page + 1} of {totalPages}</span>
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 rounded-lg border border-white/10 hover:border-blue-500/50 hover:bg-blue-500/10"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                data-testid="button-next-page"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Events List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.2)' }}>
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
            <p className="text-sm text-zinc-500">Scanning Ticketmaster events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <Ticket className="w-8 h-8 text-indigo-400/50" />
            </div>
            <p className="text-base font-medium text-zinc-400">No events found</p>
            <p className="text-sm text-zinc-600">Try a different keyword or check your settings</p>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="group rounded-xl p-4 transition-all hover:translate-y-[-1px]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
              data-testid={`row-event-${event.id}`}
            >
              <div className="flex items-start gap-4">
                {/* Left: event icon */}
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(99,102,241,0.2))', border: '1px solid rgba(99,102,241,0.3)' }}>
                  <Ticket className="w-4.5 h-4.5 text-indigo-400" />
                </div>

                {/* Center: event info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap mb-2">
                    <p className="text-base font-semibold text-white leading-tight">{event.name}</p>
                    {event.genre && <GenreChip label={event.genre} />}
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {event.date && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-blue-400/70" />
                        <span className="text-sm text-zinc-300">{event.date}</span>
                      </div>
                    )}
                    {(event.venue || event.city) && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-pink-400/70" />
                        <span className="text-sm text-zinc-300">{[event.venue, event.city].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    {event.priceMin && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                        <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-sm font-semibold text-emerald-300">
                          ${event.priceMin}{event.priceMax && event.priceMax !== event.priceMin ? ` – $${event.priceMax}` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill status={event.status} />
                  <a
                    href={event.url} target="_blank" rel="noopener noreferrer"
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
                    data-testid={`link-event-${event.id}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                  </a>
                  <Button
                    size="sm"
                    className="h-8 px-4 rounded-lg text-xs font-bold transition-all"
                    style={
                      trackMutation.isPending && trackingId === event.id
                        ? { background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc' }
                        : { background: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(99,102,241,0.3))', border: '1px solid rgba(99,102,241,0.5)', color: '#c7d2fe' }
                    }
                    disabled={trackMutation.isPending && trackingId === event.id}
                    onClick={() => { setTrackingId(event.id); trackMutation.mutate(event); }}
                    data-testid={`button-track-${event.id}`}
                  >
                    {trackMutation.isPending && trackingId === event.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <><Star className="w-3 h-3 mr-1" />Track</>
                    }
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

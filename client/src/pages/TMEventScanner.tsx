import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Ticket, MapPin, Calendar, DollarSign, ExternalLink, Plus, ChevronLeft, ChevronRight, Star, Tag, Zap, Filter, X, TrendingUp, Clock, Bell, Sparkles } from "lucide-react";
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

type Filters = {
  city: string;
  stateCode: string;
  classificationName: string;
  minPrice: string;
  maxPrice: string;
  startDate: string;
  endDate: string;
  radius: string;
  postalCode: string;
  sort: string;
};

const STATES = ["","AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const CLASSIFICATIONS = ["","Music","Sports","Arts & Theatre","Film","Miscellaneous"];
const SORT_OPTIONS = [
  { value: "date,asc", label: "Date (Earliest)" },
  { value: "date,desc", label: "Date (Latest)" },
  { value: "name,asc", label: "Name (A-Z)" },
  { value: "name,desc", label: "Name (Z-A)" },
  { value: "relevance,desc", label: "Relevance" },
  { value: "onsaleStartDate,asc", label: "On Sale Date" },
];

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string; glow: string }> = {
    onsale:     { label: "ON SALE",     color: "#10b981", glow: "rgba(16,185,129,0.3)" },
    offsale:    { label: "OFF SALE",    color: "#ef4444", glow: "rgba(239,68,68,0.25)" },
    cancelled:  { label: "CANCELLED",   color: "#ef4444", glow: "rgba(239,68,68,0.25)" },
    rescheduled:{ label: "RESCHEDULED", color: "#f59e0b", glow: "rgba(245,158,11,0.3)" },
    postponed:  { label: "POSTPONED",   color: "#f97316", glow: "rgba(249,115,22,0.3)" },
  };
  const s = cfg[status] ?? { label: status.toUpperCase(), color: "#71717a", glow: "rgba(113,113,122,0.2)" };
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold tracking-wider" style={{ background: `${s.color}15`, border: `1px solid ${s.color}40`, color: s.color, boxShadow: `0 0 8px ${s.glow}` }}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: s.color, boxShadow: `0 0 4px ${s.color}` }} />
      {s.label}
    </span>
  );
}

function GenreChip({ label }: { label: string }) {
  const colors = ["#a78bfa", "#60a5fa", "#ec4899", "#06b6d4", "#8b5cf6"];
  const color = colors[label.charCodeAt(0) % colors.length];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-medium" style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
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
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    city: "", stateCode: "", classificationName: "", minPrice: "", maxPrice: "",
    startDate: "", endDate: "", radius: "", postalCode: "", sort: "relevance,desc"
  });

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(f => ({ ...f, [key]: value }));
  }

  function applyFilters() {
    setSearchTerm(keyword);
    setPage(0);
    setShowFilters(false);
  }

  function clearFilters() {
    setFilters({ city: "", stateCode: "", classificationName: "", minPrice: "", maxPrice: "", startDate: "", endDate: "", radius: "", postalCode: "", sort: "relevance,desc" });
    setKeyword("");
    setSearchTerm("");
    setPage(0);
  }

  const activeFilterCount = Object.entries(filters).filter(([k,v]) => k !== "sort" && v).length + (searchTerm ? 1 : 0);

  const { data, isLoading, isFetching } = useQuery<SearchResult>({
    queryKey: ["/api/tm-discovery/events", searchTerm, page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), size: "20", sort: filters.sort });
      if (searchTerm) params.set("keyword", searchTerm);
      if (filters.city) params.set("city", filters.city);
      if (filters.stateCode) params.set("stateCode", filters.stateCode);
      if (filters.classificationName) params.set("classificationName", filters.classificationName);
      
      // Only force startDateTime when sorting by date (TM's relevance sort naturally returns upcoming events)
      // Ticketmaster requires format: YYYY-MM-DDTHH:mm:ssZ (no milliseconds)
      if (filters.startDate) {
        params.set("startDateTime", filters.startDate + "T00:00:00Z");
      } else if (filters.sort.startsWith("date")) {
        const today = new Date().toISOString().split("T")[0] + "T00:00:00Z";
        params.set("startDateTime", today);
      }
      
      if (filters.endDate) params.set("endDateTime", filters.endDate + "T23:59:59Z");
      if (filters.postalCode && filters.radius) {
        params.set("postalCode", filters.postalCode);
        params.set("radius", filters.radius);
        params.set("unit", "miles");
      }
      const res = await fetch(`/api/tm-discovery/events?${params.toString()}`, { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 0,
    gcTime: 0,
  });

  const trackMutation = useMutation({
    mutationFn: (event: TmEvent) =>
      apiRequest("POST", "/api/tm-discovery/track", {
        eventId: event.id, name: event.name, date: event.date, venue: event.venue,
        city: event.city, priceMin: event.priceMin, priceMax: event.priceMax,
        currency: event.currency, url: event.url, status: event.status,
      }),
    onSuccess: () => {
      toast({ title: "Event tracked", description: "Added to your tracked events list" });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-discovery/tracked"] });
    },
    onError: (err: any) => toast({ title: "Failed to track", description: err.message, variant: "destructive" }),
  });

  const events = data?.events || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;

  const inputCls = "w-full px-3 py-2 rounded-lg text-[12px] font-mono outline-none transition-all focus:ring-1";
  const inputStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)" };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(37,99,235,0.1))", border: "1px solid rgba(59,130,246,0.3)", boxShadow: "0 0 20px rgba(59,130,246,0.15)" }}>
            <Search className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-white font-mono font-bold text-xl tracking-tight flex items-center gap-2">
              Event_Scanner
              <span className="px-2 py-0.5 rounded-md text-[9px] font-semibold tracking-widest" style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}>LIVE</span>
            </h1>
            <p className="text-white/20 mt-0.5 text-[11px] font-mono">
              {total.toLocaleString()} upcoming events · Today onwards · Auto-refresh 30s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/15">Page {page + 1} of {totalPages || 1}</span>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "linear-gradient(180deg, rgba(59,130,246,0.04) 0%, rgba(0,0,0,0.3) 100%)", border: "1px solid rgba(59,130,246,0.12)" }}>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && applyFilters()}
              placeholder="Search events, artists, venues..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-[13px] font-mono outline-none transition-all focus:ring-1"
              style={{ ...inputStyle, borderColor: keyword ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.08)" }}
              data-testid="input-search"
            />
          </div>
          <Button onClick={applyFilters} disabled={isLoading} className="px-5 rounded-xl font-mono text-[12px] font-semibold" style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.3), rgba(37,99,235,0.2))", border: "1px solid rgba(59,130,246,0.4)", color: "#60a5fa" }}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
          </Button>
          <Button onClick={() => setShowFilters(!showFilters)} className="px-4 rounded-xl" style={{ background: showFilters ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${showFilters ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.08)"}`, color: showFilters ? "#60a5fa" : "rgba(255,255,255,0.4)" }}>
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: "#60a5fa", color: "#0f172a" }}>{activeFilterCount}</span>}
          </Button>
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="pt-3 space-y-3" style={{ borderTop: "1px solid rgba(59,130,246,0.1)" }}>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">City</label>
                <input type="text" value={filters.city} onChange={e => setFilter("city", e.target.value)} placeholder="e.g. Los Angeles" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">State</label>
                <select value={filters.stateCode} onChange={e => setFilter("stateCode", e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: "pointer" }}>
                  <option value="" style={{ background: "#111" }}>All States</option>
                  {STATES.slice(1).map(s => <option key={s} value={s} style={{ background: "#111" }}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Category</label>
                <select value={filters.classificationName} onChange={e => setFilter("classificationName", e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: "pointer" }}>
                  <option value="" style={{ background: "#111" }}>All Categories</option>
                  {CLASSIFICATIONS.slice(1).map(c => <option key={c} value={c} style={{ background: "#111" }}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Sort By</label>
                <select value={filters.sort} onChange={e => setFilter("sort", e.target.value)} className={inputCls} style={{ ...inputStyle, cursor: "pointer" }}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Start Date</label>
                <input type="date" value={filters.startDate} onChange={e => setFilter("startDate", e.target.value)} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">End Date</label>
                <input type="date" value={filters.endDate} onChange={e => setFilter("endDate", e.target.value)} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Postal Code</label>
                <input type="text" value={filters.postalCode} onChange={e => setFilter("postalCode", e.target.value)} placeholder="e.g. 90210" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Radius (miles)</label>
                <input type="number" value={filters.radius} onChange={e => setFilter("radius", e.target.value)} placeholder="e.g. 50" className={inputCls} style={inputStyle} />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={clearFilters} className="px-3 py-1.5 rounded-lg text-[11px] font-mono" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
                <X className="w-3 h-3 mr-1" /> Clear All
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Events Grid */}
      {isLoading ? (
        <div className="h-96 flex flex-col items-center justify-center gap-3 rounded-2xl" style={{ border: "1px dashed rgba(59,130,246,0.15)" }}>
          <Loader2 className="w-8 h-8 text-blue-400/30 animate-spin" />
          <p className="text-[12px] font-mono text-white/15">Searching Ticketmaster...</p>
        </div>
      ) : events.length === 0 ? (
        <div className="h-96 flex flex-col items-center justify-center gap-3 rounded-2xl" style={{ border: "1px dashed rgba(255,255,255,0.05)" }}>
          <Ticket className="w-10 h-10 text-white/8" />
          <div className="text-center">
            <p className="text-[13px] font-mono text-white/20">No events found</p>
            <p className="text-[11px] font-mono text-white/10 mt-1">Try different search terms or filters</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="events-grid">
          {events.map(event => {
            const img = event.images?.[0] || "";
            const hasPrice = event.priceMin || event.priceMax;
            return (
              <div
                key={event.id}
                className="group rounded-2xl overflow-hidden transition-all hover:scale-[1.02] cursor-pointer"
                style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.8) 100%)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}
                data-testid={`event-card-${event.id}`}
              >
                {/* Image */}
                {img && (
                  <div className="relative h-40 overflow-hidden">
                    <img src={img} alt={event.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                    <div className="absolute top-2 right-2">
                      <StatusBadge status={event.status} />
                    </div>
                  </div>
                )}

                {/* Content */}
                <div className="p-4 space-y-3">
                  <div>
                    <h3 className="text-white font-semibold text-[13px] leading-tight line-clamp-2 mb-2">{event.name}</h3>
                    <div className="flex flex-wrap gap-1">
                      {event.segment && <GenreChip label={event.segment} />}
                      {event.genre && <GenreChip label={event.genre} />}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {event.date && (
                      <div className="flex items-center gap-2 text-[11px] text-white/50">
                        <Calendar className="w-3 h-3" />
                        <span className="font-mono">{new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    )}
                    {event.venue && (
                      <div className="flex items-center gap-2 text-[11px] text-white/50">
                        <MapPin className="w-3 h-3" />
                        <span className="truncate">{event.venue}{event.city && `, ${event.city}`}</span>
                      </div>
                    )}
                    {hasPrice && (
                      <div className="flex items-center gap-2 text-[11px] text-white/50">
                        <DollarSign className="w-3 h-3" />
                        <span className="font-mono">
                          {event.priceMin && event.priceMax ? `${event.currency} ${event.priceMin} - ${event.priceMax}` :
                           event.priceMin ? `From ${event.currency} ${event.priceMin}` :
                           event.priceMax ? `Up to ${event.currency} ${event.priceMax}` : ""}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <a href={event.url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80" style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}>
                      <ExternalLink className="w-3 h-3" /> View
                    </a>
                    <button onClick={() => trackMutation.mutate(event)} disabled={trackMutation.isPending} className="px-3 py-2 rounded-lg transition-all hover:opacity-80" style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80" }}>
                      <Star className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || isFetching} className="px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-[12px] font-mono text-white/30 min-w-[100px] text-center">
            Page {page + 1} of {totalPages}
          </span>
          <Button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1 || isFetching} className="px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

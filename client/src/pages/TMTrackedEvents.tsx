import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, Bookmark, MapPin, Calendar, DollarSign, ExternalLink, Trash2, RefreshCw, Star, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { handleUnauthorized } from "@/lib/auth";

type TrackedEvent = {
  id: string;
  eventId: string;
  name: string;
  date: string | null;
  venue: string | null;
  city: string | null;
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  url: string | null;
  status: string;
  createdAt: string;
};

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; bg: string; border: string; text: string }> = {
    onsale:     { label: "On Sale",     bg: "rgba(16,185,129,0.15)",  border: "rgba(16,185,129,0.3)",  text: "text-emerald-300" },
    active:     { label: "Active",      bg: "rgba(16,185,129,0.15)",  border: "rgba(16,185,129,0.3)",  text: "text-emerald-300" },
    offsale:    { label: "Off Sale",    bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.3)",   text: "text-red-300" },
    cancelled:  { label: "Cancelled",   bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.3)",   text: "text-red-300" },
    sold_out:   { label: "Sold Out",    bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.3)",   text: "text-red-300" },
    rescheduled:{ label: "Rescheduled", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)",  text: "text-amber-300" },
  };
  const s = config[status] ?? { label: status, bg: "rgba(113,113,122,0.15)", border: "rgba(113,113,122,0.3)", text: "text-zinc-400" };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold ${s.text}`} style={{ background: s.bg, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
}

export default function TMTrackedEvents() {
  const { toast } = useToast();

  const { data: events = [], isLoading, isFetching, refetch } = useQuery<TrackedEvent[]>({
    queryKey: ["/api/tm-discovery/tracked"],
    queryFn: async () => {
      const res = await fetch("/api/tm-discovery/tracked", { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
      if (!res.ok) throw new Error("Failed to fetch tracked events");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tm-discovery/tracked/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-discovery/tracked"] });
      toast({ title: "Removed", description: "Event removed from tracking." });
    },
    onError: () => toast({ title: "Error", description: "Failed to remove event.", variant: "destructive" }),
  });

  const onSaleCount = events.filter((e) => e.status === "onsale" || e.status === "active").length;
  const soldOutCount = events.filter((e) => e.status === "sold_out" || e.status === "offsale" || e.status === "cancelled").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', boxShadow: '0 0 20px rgba(139,92,246,0.4)' }}>
            <Star className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Tracked Events</h1>
            <p className="text-xs text-zinc-400">Monitoring {events.length} event{events.length !== 1 ? "s" : ""} for changes</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            data-testid="button-refresh-tracked"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin text-purple-400" : "text-zinc-500"}`} />
            <span className="text-xs text-zinc-500">Refresh</span>
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      {events.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(167,139,250,0.05))', border: '1px solid rgba(139,92,246,0.25)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.2)' }}>
              <Bookmark className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-purple-300">{events.length}</p>
              <p className="text-xs text-zinc-500">Total Tracked</p>
            </div>
          </div>
          <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(52,211,153,0.05))', border: '1px solid rgba(16,185,129,0.25)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.2)' }}>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-300">{onSaleCount}</p>
              <p className="text-xs text-zinc-500">Available Now</p>
            </div>
          </div>
          <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(248,113,113,0.05))', border: '1px solid rgba(239,68,68,0.25)' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.2)' }}>
              <Trash2 className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-300">{soldOutCount}</p>
              <p className="text-xs text-zinc-500">Sold Out / Gone</p>
            </div>
          </div>
        </div>
      )}

      {/* Events */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400/60" />
            <p className="text-sm text-zinc-600">Loading tracked events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}>
              <Star className="w-8 h-8 text-purple-400/40" />
            </div>
            <p className="text-base font-medium text-zinc-400">No tracked events</p>
            <p className="text-sm text-zinc-600">Go to Event Scanner and click "Track" on any event</p>
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="rounded-xl p-4 transition-all hover:translate-y-[-1px]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}
              data-testid={`row-tracked-${event.id}`}
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(236,72,153,0.2))', border: '1px solid rgba(139,92,246,0.3)' }}>
                  <Star className="w-4.5 h-4.5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white mb-2 leading-tight">{event.name}</p>
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
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={event.status} />
                  {event.url && (
                    <a
                      href={event.url} target="_blank" rel="noopener noreferrer"
                      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
                      data-testid={`link-tracked-${event.id}`}
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-500 hover:text-zinc-300" />
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 rounded-lg hover:bg-red-500/15 hover:text-red-400 text-zinc-600 transition-all"
                    style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(event.id)}
                    data-testid={`button-remove-${event.id}`}
                  >
                    {removeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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

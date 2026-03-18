import { useQuery, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Bookmark, MapPin, Calendar, DollarSign, ExternalLink, Trash2, RefreshCw } from "lucide-react";
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

function statusColor(status: string) {
  switch (status) {
    case "onsale": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "active": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "offsale": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "cancelled": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "sold_out": return "bg-red-500/10 text-red-400 border-red-500/20";
    case "rescheduled": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  }
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-emerald-400/10 blur-md" />
              <div className="relative w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.1) 0%, rgba(255,176,0,0.08) 100%)', border: '1px solid rgba(0,255,65,0.15)' }}>
                <Bookmark className="w-4 h-4 text-emerald-400" />
              </div>
            </div>
            <h1 className="text-lg font-bold font-mono text-white">Tracked Events</h1>
          </div>
          <p className="text-xs text-zinc-500 font-mono">Events being monitored for changes and alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-700 border border-zinc-800 rounded px-2 py-1">{events.length} tracked</span>
          <button onClick={() => refetch()} className="p-1.5 rounded hover:bg-emerald-500/5 transition-colors" data-testid="button-refresh-tracked">
            <RefreshCw className={`w-3.5 h-3.5 text-zinc-600 ${isFetching ? "animate-spin text-emerald-400" : ""}`} />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-emerald-500/[0.08]" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.02) 0%, rgba(0,0,0,0.4) 100%)' }}>
        <div className="px-4 py-3 border-b border-emerald-500/[0.08] flex items-center gap-2">
          <Bookmark className="w-3 h-3 text-emerald-400/40" />
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">Monitored Events</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-400/50" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Bookmark className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
              <p className="text-sm font-mono text-zinc-600">No tracked events</p>
              <p className="text-[10px] font-mono text-zinc-700 mt-1">Go to Event Scanner and click "Track" on any event</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-emerald-500/[0.04]">
            {events.map((event) => (
              <div key={event.id} className="px-4 py-3 flex items-center gap-4 hover:bg-emerald-500/[0.02] transition-colors group" data-testid={`row-tracked-${event.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-zinc-200 truncate font-medium mb-1">{event.name}</p>
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
                        <span className="text-[10px] font-mono text-emerald-400/70">
                          ${event.priceMin}{event.priceMax && event.priceMax !== event.priceMin ? ` – $${event.priceMax}` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={`text-[9px] font-mono border uppercase ${statusColor(event.status)}`}>{event.status}</Badge>
                  {event.url && (
                    <a href={event.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-zinc-800 transition-colors" data-testid={`link-tracked-${event.id}`}>
                      <ExternalLink className="w-3 h-3 text-zinc-700 hover:text-zinc-400 transition-colors" />
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-zinc-700 hover:text-red-400 hover:bg-red-500/10"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(event.id)}
                    data-testid={`button-remove-${event.id}`}
                  >
                    {removeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
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

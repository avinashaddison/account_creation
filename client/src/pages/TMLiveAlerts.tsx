import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bell, Zap, TrendingDown, AlertCircle, Clock, RefreshCw } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";

type TmAlert = {
  id: string;
  eventId: string;
  eventName: string;
  alertType: string;
  message: string;
  oldPrice: string | null;
  newPrice: string | null;
  sentViaTelegram: boolean;
  ownerId: string | null;
  createdAt: string;
};

function alertIcon(type: string) {
  switch (type) {
    case "new_event": return <Zap className="w-3.5 h-3.5 text-emerald-400" />;
    case "price_change": return <TrendingDown className="w-3.5 h-3.5 text-yellow-400" />;
    case "sold_out": return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
    default: return <Bell className="w-3.5 h-3.5 text-zinc-400" />;
  }
}

function alertBadgeStyle(type: string) {
  switch (type) {
    case "new_event": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    case "price_change": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
    case "sold_out": return "bg-red-500/10 text-red-400 border-red-500/20";
    default: return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  }
}

function alertLabel(type: string) {
  switch (type) {
    case "new_event": return "New Event";
    case "price_change": return "Price Change";
    case "sold_out": return "Unavailable";
    default: return type;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TMLiveAlerts() {
  const { data: alerts = [], isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<TmAlert[]>({
    queryKey: ["/api/tm-discovery/alerts"],
    queryFn: async () => {
      const res = await fetch("/api/tm-discovery/alerts?limit=100", { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); throw new Error("Unauthorized"); }
      if (!res.ok) throw new Error("Failed to fetch alerts");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const newEvents = alerts.filter((a) => a.alertType === "new_event").length;
  const priceChanges = alerts.filter((a) => a.alertType === "price_change").length;
  const unavailable = alerts.filter((a) => a.alertType === "sold_out").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-emerald-400/10 blur-md" />
              <div className="relative w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.1) 0%, rgba(255,176,0,0.08) 100%)', border: '1px solid rgba(0,255,65,0.15)' }}>
                <Bell className="w-4 h-4 text-emerald-400" />
              </div>
            </div>
            <h1 className="text-lg font-bold font-mono text-white">Live Alerts</h1>
          </div>
          <p className="text-xs text-zinc-500 font-mono">Real-time notifications — auto-refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-[10px] font-mono text-zinc-700 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {timeAgo(new Date(dataUpdatedAt).toISOString())}
            </span>
          )}
          <button onClick={() => refetch()} className="p-1.5 rounded hover:bg-emerald-500/5 transition-colors" data-testid="button-refresh-alerts">
            <RefreshCw className={`w-3.5 h-3.5 text-zinc-600 ${isFetching ? "animate-spin text-emerald-400" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "New Events", value: newEvents, icon: Zap, color: "emerald" },
          { label: "Price Changes", value: priceChanges, icon: TrendingDown, color: "yellow" },
          { label: "Unavailable", value: unavailable, icon: AlertCircle, color: "red" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl p-4 border" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.02) 0%, rgba(0,0,0,0.4) 100%)', borderColor: 'rgba(0,255,65,0.06)' }} data-testid={`stat-${label.toLowerCase().replace(" ", "-")}`}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-3.5 h-3.5 text-${color}-400/60`} />
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">{label}</span>
            </div>
            <p className={`text-2xl font-bold font-mono text-${color}-400`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-emerald-500/[0.08]" style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.02) 0%, rgba(0,0,0,0.4) 100%)' }}>
        <div className="px-4 py-3 border-b border-emerald-500/[0.08] flex items-center gap-2">
          <Bell className="w-3 h-3 text-emerald-400/40" />
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">Alert History ({alerts.length})</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-400/50" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Bell className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
              <p className="text-sm font-mono text-zinc-600">No alerts yet</p>
              <p className="text-[10px] font-mono text-zinc-700 mt-1">Set a keyword in Settings to start monitoring</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-emerald-500/[0.04]">
            {alerts.map((alert) => (
              <div key={alert.id} className="px-4 py-3 flex items-start gap-3 hover:bg-emerald-500/[0.02] transition-colors" data-testid={`alert-${alert.id}`}>
                <div className="mt-0.5 p-1.5 rounded-lg bg-black/30 border border-emerald-500/[0.06] shrink-0">
                  {alertIcon(alert.alertType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-mono text-zinc-200 truncate">{alert.eventName}</p>
                    <Badge className={`text-[9px] font-mono border uppercase shrink-0 ${alertBadgeStyle(alert.alertType)}`}>
                      {alertLabel(alert.alertType)}
                    </Badge>
                  </div>
                  {alert.alertType === "price_change" && alert.oldPrice && alert.newPrice && (
                    <p className="text-[10px] font-mono text-yellow-400/70 mb-0.5">
                      ${alert.oldPrice} → ${alert.newPrice}
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-zinc-700">{timeAgo(alert.createdAt)}</span>
                    {alert.sentViaTelegram && (
                      <span className="text-[9px] font-mono text-emerald-400/40 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-emerald-400/40" />
                        Telegram sent
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

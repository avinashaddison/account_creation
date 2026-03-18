import { useQuery } from "@tanstack/react-query";
import { Loader2, Bell, Zap, TrendingDown, AlertCircle, RefreshCw, Send } from "lucide-react";
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

const ALERT_CONFIG = {
  new_event: {
    label: "New Event",
    icon: Zap,
    iconColor: "text-blue-400",
    badgeBg: "rgba(59,130,246,0.15)",
    badgeBorder: "rgba(59,130,246,0.3)",
    badgeText: "text-blue-300",
    leftBorder: "#3b82f6",
    cardBg: "rgba(59,130,246,0.04)",
  },
  price_change: {
    label: "Price Drop",
    icon: TrendingDown,
    iconColor: "text-amber-400",
    badgeBg: "rgba(245,158,11,0.15)",
    badgeBorder: "rgba(245,158,11,0.3)",
    badgeText: "text-amber-300",
    leftBorder: "#f59e0b",
    cardBg: "rgba(245,158,11,0.04)",
  },
  sold_out: {
    label: "Unavailable",
    icon: AlertCircle,
    iconColor: "text-red-400",
    badgeBg: "rgba(239,68,68,0.15)",
    badgeBorder: "rgba(239,68,68,0.3)",
    badgeText: "text-red-300",
    leftBorder: "#ef4444",
    cardBg: "rgba(239,68,68,0.04)",
  },
};

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
  const { data: alerts = [], isLoading, refetch, isFetching } = useQuery<TmAlert[]>({
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)', boxShadow: '0 0 20px rgba(245,158,11,0.4)' }}>
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Live Alerts</h1>
            <p className="text-xs text-zinc-400">Real-time event notifications · Auto-refresh 30s</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all hover:bg-white/5"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          data-testid="button-refresh-alerts"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin text-amber-400" : "text-zinc-500"}`} />
          <span className="text-xs text-zinc-500">Refresh</span>
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(99,102,241,0.08))', border: '1px solid rgba(59,130,246,0.25)' }} data-testid="stat-new-events">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.2)' }}>
              <Zap className="w-4.5 h-4.5 text-blue-400" />
            </div>
            <span className="text-xs font-semibold text-blue-400/70 uppercase tracking-wider">New</span>
          </div>
          <p className="text-3xl font-bold text-blue-300">{newEvents}</p>
          <p className="text-xs text-zinc-500 mt-1">New Events Detected</p>
        </div>
        <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(251,191,36,0.06))', border: '1px solid rgba(245,158,11,0.25)' }} data-testid="stat-price-changes">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.2)' }}>
              <TrendingDown className="w-4.5 h-4.5 text-amber-400" />
            </div>
            <span className="text-xs font-semibold text-amber-400/70 uppercase tracking-wider">Price</span>
          </div>
          <p className="text-3xl font-bold text-amber-300">{priceChanges}</p>
          <p className="text-xs text-zinc-500 mt-1">Price Changes</p>
        </div>
        <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(248,113,113,0.06))', border: '1px solid rgba(239,68,68,0.25)' }} data-testid="stat-unavailable">
          <div className="flex items-center justify-between mb-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.2)' }}>
              <AlertCircle className="w-4.5 h-4.5 text-red-400" />
            </div>
            <span className="text-xs font-semibold text-red-400/70 uppercase tracking-wider">Gone</span>
          </div>
          <p className="text-3xl font-bold text-red-300">{unavailable}</p>
          <p className="text-xs text-zinc-500 mt-1">Unavailable</p>
        </div>
      </div>

      {/* Alert Feed */}
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-semibold text-zinc-200">Alert History</span>
          </div>
          <span className="text-xs text-zinc-600 px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>{alerts.length} total</span>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-6 h-6 animate-spin text-amber-400/60" />
            <p className="text-sm text-zinc-600">Loading alerts...</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)' }}>
              <Bell className="w-8 h-8 text-amber-400/40" />
            </div>
            <p className="text-base font-medium text-zinc-400">No alerts yet</p>
            <p className="text-sm text-zinc-600">Set a keyword in Settings to start monitoring</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {alerts.map((alert) => {
              const cfg = ALERT_CONFIG[alert.alertType as keyof typeof ALERT_CONFIG] ?? ALERT_CONFIG.new_event;
              const Icon = cfg.icon;
              return (
                <div
                  key={alert.id}
                  className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{ borderLeft: `3px solid ${cfg.leftBorder}`, background: cfg.cardBg }}
                  data-testid={`alert-${alert.id}`}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: cfg.badgeBg, border: `1px solid ${cfg.badgeBorder}` }}>
                    <Icon className={`w-4 h-4 ${cfg.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-semibold text-white truncate">{alert.eventName}</p>
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide" style={{ background: cfg.badgeBg, border: `1px solid ${cfg.badgeBorder}`, color: cfg.badgeText.replace("text-", "") }}>
                        <span className={cfg.badgeText}>{cfg.label}</span>
                      </span>
                    </div>
                    {alert.alertType === "price_change" && alert.oldPrice && alert.newPrice && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm text-zinc-500 line-through">${alert.oldPrice}</span>
                        <span className="text-sm font-bold text-amber-300">→ ${alert.newPrice}</span>
                        <span className="text-xs text-amber-400/60">price changed</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-600">{timeAgo(alert.createdAt)}</span>
                      {alert.sentViaTelegram && (
                        <span className="flex items-center gap-1 text-xs text-blue-400/60">
                          <Send className="w-2.5 h-2.5" />
                          Sent to Telegram
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

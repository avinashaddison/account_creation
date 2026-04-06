import { useEffect, useState } from "react";
import {
  Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2,
  Wallet, Activity, Zap, Shield, ArrowUpRight, Copy, Phone,
  BarChart3, Database, ChevronRight, Globe,
  TrendingUp, TrendingDown, Minus, Calendar,
} from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useAccountPrice } from "@/lib/useAccountPrice";

const G = "#10b981";
const GA = (a: number) => `rgba(16,185,129,${a})`;
const RED = "#ef4444";
const AMBER = "#f59e0b";
const BLUE = "#3b82f6";
const PURPLE = "#8b5cf6";

type DashboardData = {
  stats: { total: number; verified: number; failed: number; pending: number };
  billingTotal: number;
  freeAccountsUsed: number;
  freeAccountLimit: number;
  walletBalance: string;
  role: string;
};

type RecentAccount = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  country: string;
  platform?: string;
  createdAt: string;
};

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-xs tabular-nums text-white/30">
      {time.toUTCString().split(" ").slice(1, 5).join(" ")} UTC
    </span>
  );
}

function RingChart({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const [animDash, setAnimDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimDash(dash), 200);
    return () => clearTimeout(t);
  }, [dash]);

  return (
    <div className="relative w-32 h-32">
      <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke={GA(0.08)} strokeWidth="8" />
        <circle
          cx="60" cy="60" r={r} fill="none"
          stroke={G} strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${animDash} ${circ}`}
          style={{ transition: "stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{Math.round(pct)}%</span>
        <span className="text-[10px] text-white/35 mt-0.5 uppercase tracking-wider">success</span>
      </div>
    </div>
  );
}

function StatCard({
  label, value, sub, accent, icon: Icon, pulse = false,
}: {
  label: string; value: number | string; sub: string;
  accent: string; icon: any; pulse?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05] transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{label}</span>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}12`, border: `1px solid ${accent}22` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        </div>
      </div>
      <div className="flex items-end gap-2 mb-1.5">
        <span className="text-3xl font-bold text-white leading-none">
          {pulse && typeof value === "number" && value > 0 ? (
            <span className="flex items-center gap-2">
              {value}
              <span className="relative flex w-2 h-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: accent }} />
                <span className="relative inline-flex rounded-full w-2 h-2" style={{ background: accent }} />
              </span>
            </span>
          ) : value}
        </span>
      </div>
      <p className="text-[11px] text-white/30">{sub}</p>
    </div>
  );
}

function MetricCell({
  icon: Icon, label, value, color, sub,
}: {
  icon: any; label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div className="p-3.5 rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      {sub && <div className="text-[10px] text-white/22 mt-0.5">{sub}</div>}
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 100, h = 32;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(" ");
  const area = `M 0,${h} L ${data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" L ")} L ${w},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 32 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sparkFill-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sparkFill-${color.replace("#", "")})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      {data.length > 0 && (
        <circle
          cx={(data.length - 1) / (data.length - 1) * w}
          cy={h - (data[data.length - 1] / max) * h}
          r="2.5" fill={color}
        />
      )}
    </svg>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(pct) < 1)
    return <Minus className="w-3 h-3 text-white/25" />;
  return pct > 0 ? (
    <span className="flex items-center gap-0.5 text-[10px] font-medium text-emerald-400">
      <TrendingUp className="w-3 h-3" />+{pct}%
    </span>
  ) : (
    <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-400">
      <TrendingDown className="w-3 h-3" />{pct}%
    </span>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="w-3.5 h-3.5 text-white/25" />
      <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">{label}</span>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>([]);
  const [allAccounts, setAllAccounts] = useState<RecentAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [smsPoolBalance, setSmsPoolBalance] = useState<string | null>(null);
  const [capSolverBalance, setCapSolverBalance] = useState<string | null>(null);
  const { toast } = useToast();
  const accountPrice = useAccountPrice();

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard", { credentials: "include" }).then((r) => {
        if (r.status === 401) { handleUnauthorized(); return null; }
        return r.json();
      }),
      fetch("/api/accounts", { credentials: "include" }).then((r) =>
        r.ok ? (r.json() as Promise<RecentAccount[]>) : []
      ),
      fetch("/api/smspool/balance", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/capsolver/balance", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([dashData, accounts, smsData, capData]) => {
        if (dashData) setData(dashData);
        setAllAccounts(accounts || []);
        setRecentAccounts((accounts || []).slice(0, 8));
        if (smsData?.configured && smsData?.balance) setSmsPoolBalance(smsData.balance);
        if (capData?.balance !== undefined) setCapSolverBalance(String(capData.balance));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const walletBalance = parseFloat(data?.walletBalance || "0");
  const total = data?.stats.total || 0;
  const verified = data?.stats.verified || 0;
  const failed = data?.stats.failed || 0;
  const pending = data?.stats.pending || 0;
  const successRate = total > 0 ? Math.round((verified / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((failed / total) * 100) : 0;

  const drawOkCount = allAccounts.filter((a) => a.status === "completed").length;
  const verifiedOnlyCount = allAccounts.filter((a) => a.status === "verified").length;
  const drawRegCount = allAccounts.filter((a) => a.status === "draw_registering").length;
  const processingCount = Math.max(0, pending - drawRegCount);

  const dailyActivity = (() => {
    const days: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push(allAccounts.filter((a) => a.createdAt?.slice(0, 10) === dateStr).length);
    }
    return days;
  })();

  const todayCount = dailyActivity[6];
  const yesterdayCount = dailyActivity[5];
  const weekTotal = dailyActivity.reduce((s, v) => s + v, 0);

  const platformCounts = allAccounts.reduce<Record<string, number>>((acc, a) => {
    const p = a.platform || "unknown";
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const topPlatforms = Object.entries(platformCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const countryCounts = allAccounts.reduce<Record<string, number>>((acc, a) => {
    const c = a.country || "—";
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const topCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const freeUsed = data?.freeAccountsUsed || 0;
  const freeLimit = data?.freeAccountLimit || 0;
  const freePct = freeLimit > 0 ? (freeUsed / freeLimit) * 100 : 0;

  function copyEmail(email: string) {
    navigator.clipboard.writeText(email);
    toast({ title: "Copied", description: email });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
          <p className="text-[12px] text-white/30">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const panelColors = [BLUE, G, PURPLE, AMBER, RED];

  return (
    <div className="space-y-5">

      {/* ── HEADER ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white" data-testid="text-dashboard-title">
            Dashboard
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <LiveClock />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.role === "superadmin" && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/8 border border-red-500/15">
              <Shield className="w-3 h-3 text-red-400" />
              <span className="text-[11px] font-medium text-red-400">Superadmin</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/8 border border-emerald-500/15">
            <span className="relative flex w-1.5 h-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
              <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-emerald-400" />
            </span>
            <span className="text-[11px] font-medium text-emerald-400">Live</span>
          </div>
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Accounts" value={total} sub={`$${(data?.billingTotal || 0).toFixed(2)} invested`} accent={BLUE} icon={Database} />
        <StatCard label="Verified" value={verified} sub={`${successRate}% success rate`} accent={G} icon={CheckCircle2} />
        <StatCard label="Failed" value={failed} sub={`${failRate}% fail rate`} accent={RED} icon={XCircle} />
        <StatCard label="In Progress" value={pending} sub={pending > 0 ? "Processing..." : "Queue empty"} accent={AMBER} icon={Clock} pulse={pending > 0} />
      </div>

      {/* ── MIDDLE ROW ── */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* SUCCESS RING */}
        <div className="rounded-xl p-5 border border-white/[0.07] bg-white/[0.03]" data-testid="card-success-ring">
          <SectionTitle icon={BarChart3} label="Success Rate" />
          <div className="flex flex-col items-center">
            <RingChart value={verified} total={total} />
            <div className="grid grid-cols-3 gap-2 mt-5 w-full text-center">
              {[
                { val: verified, label: "Pass", color: G },
                { val: failed, label: "Fail", color: RED },
                { val: pending, label: "Queue", color: AMBER },
              ].map((s) => (
                <div key={s.label} className="py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <div className="text-base font-bold" style={{ color: s.color }}>{s.val}</div>
                  <div className="text-[10px] text-white/30 mt-0.5 uppercase tracking-wider">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SYSTEM METRICS */}
        <div className="lg:col-span-2 rounded-xl p-5 border border-white/[0.07] bg-white/[0.03]">
          <SectionTitle icon={Activity} label="System Metrics" />
          <div className="grid grid-cols-2 gap-2">
            <MetricCell icon={DollarSign} label="Revenue" value={`$${(data?.billingTotal || 0).toFixed(2)}`} color={G} />
            <MetricCell icon={Users} label="Accounts" value={`${total}`} color={BLUE} />
            <MetricCell icon={CheckCircle2} label="Success Rate" value={`${successRate}%`} color={G} />
            <MetricCell icon={DollarSign} label="Unit Cost" value={`$${accountPrice.toFixed(2)}`} color={PURPLE} />
            {capSolverBalance !== null && (
              <MetricCell icon={Zap} label="CapSolver" value={`$${parseFloat(capSolverBalance).toFixed(2)}`} color={AMBER} sub="CAPTCHA solving" />
            )}
            {smsPoolBalance !== null && (
              <MetricCell icon={Phone} label="SMS Pool" value={`$${parseFloat(smsPoolBalance).toFixed(2)}`} color={BLUE} sub="Phone verification" />
            )}
            {data?.role !== "superadmin" && (
              <MetricCell icon={Wallet} label="Wallet" value={`$${walletBalance.toFixed(2)}`} color={G} sub={`~${Math.floor(walletBalance / accountPrice)} units`} />
            )}
          </div>
        </div>
      </div>

      {/* ── ACTIVITY + BREAKDOWN ROW ── */}
      <div className="grid gap-4 lg:grid-cols-3">

        {/* 7-DAY ACTIVITY */}
        <div className="rounded-xl p-5 border border-white/[0.07] bg-white/[0.03]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-white/25" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">7-Day Activity</span>
            </div>
            <TrendBadge current={todayCount} previous={yesterdayCount} />
          </div>
          <Sparkline data={dailyActivity} color={G} />
          <div className="flex justify-between mt-3">
            {["6d", "5d", "4d", "3d", "2d", "1d", "Today"].map((d, i) => (
              <div key={d} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] font-medium" style={{ color: dailyActivity[i] > 0 ? G : "rgba(255,255,255,0.15)" }}>
                  {dailyActivity[i]}
                </span>
                <span className="text-[9px] text-white/20">{d}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/[0.06] flex justify-between">
            <div>
              <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1">Week Total</div>
              <div className="text-lg font-bold text-emerald-400">{weekTotal}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1">Avg / Day</div>
              <div className="text-lg font-bold text-blue-400">{(weekTotal / 7).toFixed(1)}</div>
            </div>
          </div>
        </div>

        {/* PLATFORM DISTRIBUTION */}
        <div className="rounded-xl p-5 border border-white/[0.07] bg-white/[0.03]">
          <SectionTitle icon={Activity} label="Platform Distribution" />
          {topPlatforms.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-white/20 text-sm">No data yet</div>
          ) : (
            <div className="space-y-3">
              {topPlatforms.map(([platform, count], i) => {
                const color = panelColors[i % panelColors.length];
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={platform}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12px] font-medium text-white/55 capitalize">{platform}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium" style={{ color }}>{count}</span>
                        <span className="text-[10px] text-white/25">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* COUNTRY DISTRIBUTION + FREE QUOTA */}
        <div className="rounded-xl p-5 border border-white/[0.07] bg-white/[0.03] flex flex-col gap-4">
          <div>
            <SectionTitle icon={Globe} label="Top Countries" />
            {topCountries.length === 0 ? (
              <div className="flex items-center justify-center h-16 text-white/20 text-sm">No data yet</div>
            ) : (
              <div className="space-y-2">
                {topCountries.map(([country, count], i) => {
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  const rc = panelColors[i % panelColors.length];
                  return (
                    <div key={country} className="flex items-center gap-2">
                      <span className="text-[10px] font-medium w-4 text-right" style={{ color: rc }}>{i + 1}.</span>
                      <span className="text-[11px] text-white/50 flex-1 truncate">{country}</span>
                      <span className="text-[10px] font-medium w-5 text-right" style={{ color: rc }}>{count}</span>
                      <div className="w-14 h-1 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: rc }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {freeLimit > 0 && (
            <div className="border-t border-white/[0.06] pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">Free Quota</span>
                <span className="text-[11px] font-medium" style={{ color: freePct > 80 ? RED : freePct > 50 ? AMBER : G }}>
                  {freeUsed} / {freeLimit}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(freePct, 100)}%`,
                    background: freePct > 80 ? RED : freePct > 50 ? AMBER : G,
                  }}
                />
              </div>
              <div className="text-[10px] text-white/22 mt-1.5">{freePct.toFixed(0)}% used</div>
            </div>
          )}
        </div>
      </div>

      {/* ── PIPELINE DISTRIBUTION ── */}
      {total > 0 && (
        <div className="rounded-xl p-5 border border-white/[0.07] bg-white/[0.03]">
          <SectionTitle icon={Activity} label="Pipeline Distribution" />
          <div className="relative h-2.5 rounded-full overflow-hidden bg-white/[0.04] border border-white/[0.05] mb-3">
            {[
              { count: drawOkCount, color: G },
              { count: verifiedOnlyCount, color: BLUE },
              { count: drawRegCount, color: PURPLE },
              { count: processingCount, color: AMBER },
              { count: failed, color: RED },
            ].map((seg, i) =>
              seg.count > 0 ? (
                <div
                  key={i}
                  className="h-full float-left transition-all duration-700"
                  style={{ width: `${(seg.count / total) * 100}%`, background: seg.color }}
                />
              ) : null
            )}
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            {[
              { label: "Draw OK", count: drawOkCount, color: G },
              { label: "Verified", count: verifiedOnlyCount, color: BLUE },
              { label: "Draw Reg", count: drawRegCount, color: PURPLE },
              { label: "Active", count: processingCount, color: AMBER },
              { label: "Failed", count: failed, color: RED },
            ]
              .filter((s) => s.count > 0)
              .map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-[11px] text-white/40">
                    {s.label} ({s.count})
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── RECENT ACCOUNTS ── */}
      {recentAccounts.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-white/25" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-white/30">Recent Accounts</span>
            </div>
            <a
              href="/admin/accounts"
              className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/60 transition-colors"
              data-testid="link-view-all-accounts"
            >
              View all <ArrowUpRight className="w-3.5 h-3.5 ml-0.5" />
            </a>
          </div>
          <div>
            {recentAccounts.map((acc) => {
              const statusColor =
                acc.status === "completed" ? G :
                acc.status === "verified" ? BLUE :
                acc.status === "failed" ? RED :
                acc.status === "draw_registering" ? PURPLE : AMBER;
              const statusLabel =
                acc.status === "completed" ? "Draw OK" :
                acc.status === "verified" ? "Verified" :
                acc.status === "failed" ? "Failed" :
                acc.status === "draw_registering" ? "Draw Reg" :
                acc.status === "waiting_code" ? "Waiting" :
                acc.status.replace(/_/g, " ");

              return (
                <div
                  key={acc.id}
                  className="flex items-center justify-between px-5 py-3 group hover:bg-white/[0.02] transition-colors border-b border-white/[0.04] last:border-0"
                  data-testid={`row-recent-${acc.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor }} />
                    <div>
                      <div className="text-[13px] font-medium text-white/75">
                        {acc.firstName} {acc.lastName}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] text-white/30">{acc.email}</span>
                        <button
                          onClick={() => copyEmail(acc.email)}
                          className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/55 transition-all"
                          data-testid={`button-copy-recent-${acc.id}`}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {acc.platform && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-white/40 capitalize">
                        {acc.platform}
                      </span>
                    )}
                    {acc.country && (
                      <span className="text-[10px] text-white/25">{acc.country}</span>
                    )}
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded capitalize"
                      style={{ color: statusColor, background: `${statusColor}10`, border: `1px solid ${statusColor}22` }}
                    >
                      {statusLabel}
                    </span>
                    <span className="text-[10px] text-white/22 w-14 text-right tabular-nums">
                      {new Date(acc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

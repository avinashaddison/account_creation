import { useEffect, useState, useRef } from "react";
import {
  Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2,
  Wallet, Activity, Zap, Shield, ArrowUpRight, Copy, Phone,
  BarChart3, Cpu, Database, Terminal, ChevronRight, Globe,
  TrendingUp, TrendingDown, Minus, Calendar, Radio,
} from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { useAccountPrice } from "@/lib/useAccountPrice";

const G = "#00ff41";
const GA = (a: number) => `rgba(0,255,65,${a})`;
const RED = "#ff3366";
const AMBER = "#ffb000";
const BLUE = "#00aaff";
const PURPLE = "#a855f7";

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

function AnimatedNumber({ target, prefix = "", suffix = "" }: { target: number; prefix?: string; suffix?: string }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (target === 0) { setVal(0); return; }
    let start = 0;
    const step = Math.ceil(target / 30);
    const t = setInterval(() => {
      start = Math.min(start + step, target);
      setVal(start);
      if (start >= target) clearInterval(t);
    }, 30);
    return () => clearInterval(t);
  }, [target]);
  return <>{prefix}{val}{suffix}</>;
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-[10px] tabular-nums" style={{ color: GA(0.4) }}>
      {time.toUTCString().split(" ").slice(1, 5).join(" ")} UTC
    </span>
  );
}

function RingChart({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const [animDash, setAnimDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimDash(dash), 200);
    return () => clearTimeout(t);
  }, [dash]);
  return (
    <div className="relative w-36 h-36">
      <svg className="w-36 h-36 -rotate-90" viewBox="0 0 130 130">
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={G} />
            <stop offset="70%" stopColor="#aaff00" />
            <stop offset="100%" stopColor={AMBER} />
          </linearGradient>
        </defs>
        <circle cx="65" cy="65" r={r} fill="none" stroke={GA(0.06)} strokeWidth="10" />
        <circle cx="65" cy="65" r={r - 14} fill="none" stroke={GA(0.03)} strokeWidth="1" strokeDasharray="2 5" />
        <circle cx="65" cy="65" r={r} fill="none"
          stroke="url(#ringGrad)" strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${animDash} ${circ}`}
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 6px ${GA(0.6)})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] font-bold font-mono" style={{ color: G, textShadow: `0 0 20px ${GA(0.7)}` }}>
          {Math.round(pct)}%
        </span>
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] mt-0.5" style={{ color: GA(0.35) }}>success</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent, icon: Icon, pulse = false }: {
  label: string; value: number | string; sub: string;
  accent: string; icon: any; pulse?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 group transition-all duration-200"
      style={{
        background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)",
        border: `1px solid ${accent}18`,
        boxShadow: `inset 0 1px 0 ${accent}10, 0 4px 20px rgba(0,0,0,0.4)`,
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = `inset 0 1px 0 ${accent}18, 0 0 20px ${accent}18, 0 4px 20px rgba(0,0,0,0.4)`)}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = `inset 0 1px 0 ${accent}10, 0 4px 20px rgba(0,0,0,0.4)`)}
    >
      {/* corner glow */}
      <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none overflow-hidden rounded-xl">
        <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-20" style={{ background: accent, filter: "blur(18px)" }} />
      </div>
      {/* top accent line */}
      <div className="absolute top-0 inset-x-0 h-[1.5px] rounded-t-xl"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}60, transparent)` }} />

      <div className="flex items-center justify-between mb-3">
        <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: `${accent}55` }}>{label}</span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}10`, border: `1px solid ${accent}25`, boxShadow: `0 0 8px ${accent}20` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: accent, filter: `drop-shadow(0 0 5px ${accent})` }} />
        </div>
      </div>
      <div className="text-[34px] font-bold font-mono leading-none mb-2"
        style={{ color: accent, textShadow: `0 0 24px ${accent}55` }}>
        {pulse && typeof value === "number" && value > 0
          ? <span className="flex items-center gap-2">{value}
              <span className="relative flex w-2.5 h-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: accent }} />
                <span className="relative inline-flex rounded-full w-2.5 h-2.5" style={{ background: accent }} />
              </span>
            </span>
          : value}
      </div>
      <div className="text-[10px] font-mono" style={{ color: GA(0.28) }}>{sub}</div>
    </div>
  );
}

function DataCell({ icon: Icon, label, value, color, sub }: { icon: any; label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="p-4 rounded-xl transition-all duration-150"
      style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${color}12` }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = `${color}28`)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = `${color}12`)}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: `${color}70` }}>{label}</span>
      </div>
      <div className="text-[20px] font-bold font-mono" style={{ color, textShadow: `0 0 14px ${color}45` }}>{value}</div>
      {sub && <div className="text-[8px] font-mono mt-1" style={{ color: GA(0.22) }}>{sub}</div>}
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
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sparkFill-${color.replace("#", "")})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
      {data.length > 0 && (
        <circle cx={(( data.length - 1) / (data.length - 1)) * w} cy={h - (data[data.length - 1] / max) * h} r="2.5" fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      )}
    </svg>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(pct) < 1) return <Minus className="w-3 h-3" style={{ color: GA(0.3) }} />;
  return pct > 0
    ? <span className="flex items-center gap-0.5 text-[9px] font-mono" style={{ color: "#00ff88" }}><TrendingUp className="w-3 h-3" />+{pct}%</span>
    : <span className="flex items-center gap-0.5 text-[9px] font-mono" style={{ color: RED }}><TrendingDown className="w-3 h-3" />{pct}%</span>;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>([]);
  const [allAccounts, setAllAccounts] = useState<RecentAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [smsPoolBalance, setSmsPoolBalance] = useState<string | null>(null);
  const [capSolverBalance, setCapSolverBalance] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const { toast } = useToast();
  const accountPrice = useAccountPrice();

  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 1200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard", { credentials: "include" }).then(r => {
        if (r.status === 401) { handleUnauthorized(); return null; }
        return r.json();
      }),
      fetch("/api/accounts", { credentials: "include" }).then(r => r.ok ? r.json() as Promise<RecentAccount[]> : []),
      fetch("/api/smspool/balance", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/capsolver/balance", { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([dashData, accounts, smsData, capData]) => {
      if (dashData) setData(dashData);
      setAllAccounts(accounts || []);
      setRecentAccounts((accounts || []).slice(0, 8));
      if (smsData?.configured && smsData?.balance) setSmsPoolBalance(smsData.balance);
      if (capData?.balance !== undefined) setCapSolverBalance(String(capData.balance));
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const walletBalance = parseFloat(data?.walletBalance || "0");
  const total = data?.stats.total || 0;
  const verified = data?.stats.verified || 0;
  const failed = data?.stats.failed || 0;
  const pending = data?.stats.pending || 0;
  const successRate = total > 0 ? Math.round((verified / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((failed / total) * 100) : 0;

  const drawOkCount = allAccounts.filter(a => a.status === "completed").length;
  const verifiedOnlyCount = allAccounts.filter(a => a.status === "verified").length;
  const drawRegCount = allAccounts.filter(a => a.status === "draw_registering").length;
  const processingCount = Math.max(0, pending - drawRegCount);

  // --- Computed tracking metrics ---

  // 7-day activity sparkline
  const dailyActivity = (() => {
    const days: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push(allAccounts.filter(a => a.createdAt?.slice(0, 10) === dateStr).length);
    }
    return days;
  })();

  const todayCount = dailyActivity[6];
  const yesterdayCount = dailyActivity[5];
  const weekTotal = dailyActivity.reduce((s, v) => s + v, 0);

  // Platform breakdown
  const platformCounts = allAccounts.reduce<Record<string, number>>((acc, a) => {
    const p = a.platform || "unknown";
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  const topPlatforms = Object.entries(platformCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Country breakdown
  const countryCounts = allAccounts.reduce<Record<string, number>>((acc, a) => {
    const c = a.country || "—";
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  const topCountries = Object.entries(countryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Free account usage
  const freeUsed = data?.freeAccountsUsed || 0;
  const freeLimit = data?.freeAccountLimit || 0;
  const freePct = freeLimit > 0 ? (freeUsed / freeLimit) * 100 : 0;

  function copyEmail(email: string) {
    navigator.clipboard.writeText(email);
    toast({ title: "Copied", description: email });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full animate-ping" style={{ background: GA(0.06) }} />
            <div className="absolute inset-2 rounded-full border-2 animate-spin" style={{ borderColor: `${G} transparent transparent transparent` }} />
          </div>
          <p className="text-[10px] font-mono uppercase tracking-[0.3em]" style={{ color: GA(0.30) }}>
            &gt;_ Initializing systems...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center relative"
              style={{ background: GA(0.08), border: `1px solid ${GA(0.18)}`, boxShadow: `0 0 10px ${GA(0.15)}` }}>
              <Cpu className="w-4 h-4" style={{ color: G, filter: `drop-shadow(0 0 5px ${G})` }} />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow: `0 0 6px ${G}` }} />
            </div>
            <h1 className="text-[19px] font-mono font-bold tracking-tight text-white" data-testid="text-dashboard-title">
              System<span style={{ color: G }}>_</span>Overview
            </h1>
          </div>
          <p className="text-[10px] font-mono mt-1 pl-9 flex items-center gap-2" style={{ color: GA(0.30) }}>
            &gt; Realtime operational metrics
            <LiveClock />
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.role === "superadmin" && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-default"
              style={{ background: GA(0.05), border: `1px solid ${GA(0.14)}`, boxShadow: `0 0 12px ${GA(0.08)}` }}>
              <Shield className="w-3 h-3" style={{ color: G }} />
              <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: GA(0.70) }}>Root Access</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(0,255,65,0.04)", border: `1px solid ${GA(0.1)}` }}>
            <Radio className="w-3 h-3 animate-pulse" style={{ color: G }} />
            <span className="text-[9px] font-mono" style={{ color: GA(0.5) }}>LIVE</span>
          </div>
        </div>
      </div>

      {/* ── 4 STAT CARDS ── */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total_Accounts" value={total} sub={`$${(data?.billingTotal || 0).toFixed(2)} invested`} accent={G} icon={Database} />
        <StatCard label="Verified" value={verified} sub={`${successRate}% success rate`} accent={G} icon={CheckCircle2} />
        <StatCard label="Failed" value={failed} sub={`${failRate}% fail rate`} accent={RED} icon={XCircle} />
        <StatCard label="In_Progress" value={pending} sub={pending > 0 ? "Processing..." : "Queue empty"} accent={AMBER} icon={Clock} pulse={pending > 0} />
      </div>

      {/* ── MIDDLE ROW ── */}
      <div className="grid gap-3 lg:grid-cols-3">

        {/* SUCCESS METRIC */}
        <div className="rounded-xl p-5" style={{ background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}
          data-testid="card-success-ring">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-3 h-3" style={{ color: GA(0.35) }} />
            <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Success_Metric</span>
          </div>
          <div className="flex flex-col items-center">
            <RingChart value={verified} total={total} />
            <div className="grid grid-cols-3 gap-2 mt-5 w-full text-center">
              {[
                { val: verified, label: "PASS", color: G },
                { val: failed, label: "FAIL", color: RED },
                { val: pending, label: "QUEUE", color: AMBER },
              ].map(s => (
                <div key={s.label} className="py-2.5 rounded-xl"
                  style={{ background: `${s.color}0a`, border: `1px solid ${s.color}20` }}>
                  <div className="text-[16px] font-bold font-mono" style={{ color: s.color, textShadow: `0 0 12px ${s.color}55` }}>{s.val}</div>
                  <div className="text-[7px] font-mono uppercase tracking-[0.18em] mt-0.5" style={{ color: `${s.color}55` }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SYSTEM STATUS */}
        <div className="lg:col-span-2 rounded-xl p-5" style={{ background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Terminal className="w-3 h-3" style={{ color: GA(0.35) }} />
            <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>System_Status</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <DataCell icon={DollarSign} label="Revenue" value={`$${(data?.billingTotal || 0).toFixed(2)}`} color={G} />
            <DataCell icon={Users} label="Accounts" value={`${total}`} color={AMBER} />
            <DataCell icon={CheckCircle2} label="Success" value={`${successRate}%`} color={G} />
            <DataCell icon={DollarSign} label="Unit_Cost" value={`$${accountPrice.toFixed(2)}`} color={AMBER} />
            {capSolverBalance !== null && (
              <DataCell icon={Zap} label="CapSolver" value={`$${parseFloat(capSolverBalance).toFixed(2)}`} color={AMBER} sub="CAPTCHA solving" />
            )}
            {smsPoolBalance !== null && (
              <DataCell icon={Phone} label="SMS_Pool" value={`$${parseFloat(smsPoolBalance).toFixed(2)}`} color={BLUE} sub="Phone verification" />
            )}
            {data?.role !== "superadmin" && (
              <DataCell icon={Wallet} label="Wallet" value={`$${walletBalance.toFixed(2)}`} color={G} sub={`~${Math.floor(walletBalance / accountPrice)} units`} />
            )}
          </div>
        </div>
      </div>

      {/* ── ACTIVITY + BREAKDOWN ROW ── */}
      <div className="grid gap-3 lg:grid-cols-3">

        {/* 7-DAY ACTIVITY SPARKLINE */}
        <div className="rounded-xl p-5" style={{ background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)", border: `1px solid ${GA(0.10)}` }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3" style={{ color: GA(0.35) }} />
              <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Activity_7D</span>
            </div>
            <TrendBadge current={todayCount} previous={yesterdayCount} />
          </div>
          <div className="mb-3">
            <Sparkline data={dailyActivity} color={G} />
          </div>
          <div className="flex justify-between mt-2">
            {["6d", "5d", "4d", "3d", "2d", "1d", "Today"].map((d, i) => (
              <div key={d} className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] font-mono font-bold" style={{ color: dailyActivity[i] > 0 ? G : GA(0.2), textShadow: dailyActivity[i] > 0 ? `0 0 8px ${GA(0.5)}` : "none" }}>
                  {dailyActivity[i]}
                </span>
                <span className="text-[7px] font-mono" style={{ color: GA(0.2) }}>{d}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${GA(0.07)}` }}>
            <div className="flex justify-between">
              <div>
                <div className="text-[8px] font-mono uppercase tracking-wider mb-1" style={{ color: GA(0.25) }}>Week Total</div>
                <div className="text-[16px] font-bold font-mono" style={{ color: G, textShadow: `0 0 12px ${GA(0.5)}` }}>{weekTotal}</div>
              </div>
              <div className="text-right">
                <div className="text-[8px] font-mono uppercase tracking-wider mb-1" style={{ color: GA(0.25) }}>Avg/Day</div>
                <div className="text-[16px] font-bold font-mono" style={{ color: AMBER, textShadow: `0 0 12px ${AMBER}50` }}>{(weekTotal / 7).toFixed(1)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* PLATFORM DISTRIBUTION */}
        <div className="rounded-xl p-5" style={{ background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)", border: `1px solid ${GA(0.10)}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-3 h-3" style={{ color: GA(0.35) }} />
            <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Platform_Dist</span>
          </div>
          {topPlatforms.length === 0 ? (
            <div className="flex items-center justify-center h-24" style={{ color: GA(0.2) }}>
              <span className="text-[10px] font-mono">No data</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {topPlatforms.map(([platform, count], i) => {
                const colors = [G, AMBER, BLUE, PURPLE, RED];
                const color = colors[i % colors.length];
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={platform}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono capitalize" style={{ color: "rgba(255,255,255,0.55)" }}>{platform}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono" style={{ color }}>{count}</span>
                        <span className="text-[8px] font-mono" style={{ color: GA(0.25) }}>{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${color}10` }}>
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}80` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* COUNTRY DISTRIBUTION + FREE USAGE */}
        <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)", border: `1px solid ${GA(0.10)}` }}>
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-3 h-3" style={{ color: GA(0.35) }} />
              <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Country_Top5</span>
            </div>
            {topCountries.length === 0 ? (
              <div className="flex items-center justify-center h-16" style={{ color: GA(0.2) }}>
                <span className="text-[10px] font-mono">No data</span>
              </div>
            ) : (
              <div className="space-y-2">
                {topCountries.map(([country, count], i) => {
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={country} className="flex items-center gap-2">
                      <span className="text-[9px] font-mono w-5 text-right" style={{ color: GA(0.3) }}>{i + 1}.</span>
                      <span className="text-[10px] font-mono flex-1 truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{country}</span>
                      <span className="text-[9px] font-mono w-6 text-right" style={{ color: G }}>{count}</span>
                      <div className="w-16 h-1 rounded-full overflow-hidden" style={{ background: GA(0.06) }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: G, boxShadow: `0 0 4px ${GA(0.5)}` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {freeLimit > 0 && (
            <div style={{ borderTop: `1px solid ${GA(0.07)}`, paddingTop: 12 }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Free_Quota</span>
                <span className="text-[9px] font-mono" style={{ color: freePct > 80 ? RED : freePct > 50 ? AMBER : G }}>
                  {freeUsed} / {freeLimit}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: GA(0.06) }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(freePct, 100)}%`,
                    background: freePct > 80
                      ? `linear-gradient(90deg, ${AMBER}, ${RED})`
                      : `linear-gradient(90deg, ${G}, #aaff00)`,
                    boxShadow: `0 0 8px ${freePct > 80 ? RED : G}60`,
                  }} />
              </div>
              <div className="text-[8px] font-mono mt-1.5" style={{ color: GA(0.2) }}>{freePct.toFixed(0)}% used</div>
            </div>
          )}
        </div>
      </div>

      {/* ── PIPELINE DISTRIBUTION ── */}
      {total > 0 && (
        <div className="rounded-xl p-5" style={{ background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-3 h-3" style={{ color: GA(0.35) }} />
            <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Pipeline_Distribution</span>
          </div>

          <div className="relative h-3 rounded-full overflow-hidden mb-3" style={{ background: GA(0.04), border: `1px solid ${GA(0.08)}` }}>
            {[
              { count: drawOkCount, grad: `linear-gradient(90deg, #00ff88, #00ff41)`, glow: "#00ff41" },
              { count: verifiedOnlyCount, grad: `linear-gradient(90deg, #00ff41, ${BLUE})`, glow: BLUE },
              { count: drawRegCount, grad: `linear-gradient(90deg, ${AMBER}, #8b5cf6)`, glow: AMBER },
              { count: processingCount, grad: `linear-gradient(90deg, #ffcc00, #ff9900)`, glow: "#ffcc00" },
              { count: failed, grad: `linear-gradient(90deg, ${RED}, #cc0022)`, glow: RED },
            ].map((seg, i) => seg.count > 0 && (
              <div key={i} className="h-full float-left transition-all duration-700"
                style={{ width: `${(seg.count / total) * 100}%`, background: seg.grad, boxShadow: `0 0 8px ${seg.glow}60` }} />
            ))}
          </div>

          <div className="flex items-center gap-5 flex-wrap">
            {[
              { label: "Draw OK", count: drawOkCount, color: "#00ff88" },
              { label: "Verified", count: verifiedOnlyCount, color: G },
              { label: "Draw Reg", count: drawRegCount, color: AMBER },
              { label: "Active", count: processingCount, color: "#ffcc00" },
              { label: "Failed", count: failed, color: RED },
            ].filter(s => s.count > 0).map(s => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 5px ${s.color}` }} />
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.40)" }}>
                  {s.label} ({s.count})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── RECENT OPERATIONS ── */}
      {recentAccounts.length > 0 && (
        <div className="rounded-xl" style={{ background: "linear-gradient(145deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 100%)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${GA(0.07)}` }}>
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3" style={{ color: GA(0.35) }} />
              <span className="text-[8px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Recent_Operations</span>
            </div>
            <a href="/admin/accounts" className="flex items-center gap-1 text-[9px] font-mono transition-colors"
              style={{ color: GA(0.40) }}
              onMouseEnter={e => (e.currentTarget.style.color = G)}
              onMouseLeave={e => (e.currentTarget.style.color = GA(0.40))}
              data-testid="link-view-all-accounts">
              View all <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
          <div className="divide-y" style={{ borderColor: GA(0.04) }}>
            {recentAccounts.map((acc) => {
              const statusColor =
                acc.status === "completed" ? "#00ff88" :
                acc.status === "verified" ? G :
                acc.status === "failed" ? RED :
                acc.status === "draw_registering" ? AMBER : "#ffaa00";
              const statusLabel =
                acc.status === "completed" ? "DRAW_OK" :
                acc.status === "verified" ? "VERIFIED" :
                acc.status === "failed" ? "FAILED" :
                acc.status === "draw_registering" ? "DRAW_REG" :
                acc.status === "waiting_code" ? "WAIT_CODE" :
                acc.status.toUpperCase();

              return (
                <div key={acc.id}
                  className="flex items-center justify-between px-5 py-3 group transition-colors duration-100"
                  style={{ background: "transparent" }}
                  onMouseEnter={e => (e.currentTarget.style.background = GA(0.025))}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  data-testid={`row-recent-${acc.id}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
                    <div>
                      <div className="text-[12px] font-mono font-medium text-white/80">
                        {acc.firstName} {acc.lastName}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] font-mono" style={{ color: GA(0.28) }}>{acc.email}</span>
                        <button onClick={() => { sounds.click(); copyEmail(acc.email); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ color: GA(0.30) }}
                          data-testid={`button-copy-recent-${acc.id}`}>
                          <Copy className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {acc.platform && (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded capitalize" style={{ color: GA(0.35), background: GA(0.05), border: `1px solid ${GA(0.08)}` }}>
                        {acc.platform}
                      </span>
                    )}
                    {acc.country && (
                      <span className="text-[8px] font-mono" style={{ color: GA(0.28) }}>{acc.country}</span>
                    )}
                    <span className="text-[8.5px] font-mono px-2 py-1 rounded"
                      style={{ color: statusColor, background: `${statusColor}10`, border: `1px solid ${statusColor}25` }}>
                      {statusLabel}
                    </span>
                    <span className="text-[9px] font-mono w-14 text-right" style={{ color: GA(0.22) }}>
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

import { useEffect, useState, useRef } from "react";
import {
  Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2,
  Wallet, Activity, Zap, Shield, ArrowUpRight, Copy, Phone,
  BarChart3, Cpu, Database, Terminal, ChevronRight,
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
          <filter id="ringGlow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Track */}
        <circle cx="65" cy="65" r={r} fill="none" stroke={GA(0.06)} strokeWidth="9" />
        {/* Progress */}
        <circle cx="65" cy="65" r={r} fill="none"
          stroke="url(#ringGrad)" strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${animDash} ${circ}`}
          style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)", filter: `drop-shadow(0 0 5px ${GA(0.5)})` }}
        />
        {/* Subtle inner ring */}
        <circle cx="65" cy="65" r={r - 12} fill="none" stroke={GA(0.04)} strokeWidth="1" strokeDasharray="2 4" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold font-mono" style={{ color: G, textShadow: `0 0 16px ${GA(0.6)}` }}>
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
    <div className="relative overflow-hidden rounded-xl p-4 group"
      style={{ background: "rgba(0,0,0,0.50)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}>
      {/* Corner accent */}
      <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none overflow-hidden rounded-xl opacity-30">
        <div className="absolute -top-4 -right-4 w-12 h-12 rounded-full" style={{ background: accent, filter: "blur(16px)" }} />
      </div>
      {/* Top accent line */}
      <div className="absolute top-0 inset-x-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}50, transparent)` }} />

      <div className="flex items-center justify-between mb-3">
        <span className="text-[8.5px] font-mono uppercase tracking-[0.18em]" style={{ color: GA(0.30) }}>{label}</span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}12`, border: `1px solid ${accent}28` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: accent, filter: `drop-shadow(0 0 4px ${accent})` }} />
        </div>
      </div>
      <div className="text-[32px] font-bold font-mono leading-none mb-2"
        style={{ color: accent, textShadow: `0 0 20px ${accent}50` }}>
        {pulse && typeof value === "number" && value > 0
          ? <span className="flex items-center gap-2">{value}<span className="w-2 h-2 rounded-full animate-ping inline-block" style={{ background: accent }} /></span>
          : value
        }
      </div>
      <div className="text-[10px] font-mono" style={{ color: GA(0.28) }}>{sub}</div>

      {/* Hover scanline */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-xl"
        style={{ background: `linear-gradient(135deg, ${GA(0.04)}, transparent)` }} />
    </div>
  );
}

function DataCell({ icon: Icon, label, value, color, sub }: { icon: any; label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="p-4 rounded-lg" style={{ background: "rgba(0,0,0,0.40)", border: `1px solid ${GA(0.08)}` }}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[8.5px] font-mono uppercase tracking-[0.2em]" style={{ color: `${color}80` }}>{label}</span>
      </div>
      <div className="text-[19px] font-bold font-mono" style={{ color, textShadow: `0 0 12px ${color}40` }}>{value}</div>
      {sub && <div className="text-[8px] font-mono mt-1" style={{ color: GA(0.22) }}>{sub}</div>}
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
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: GA(0.08), border: `1px solid ${GA(0.18)}` }}>
              <Cpu className="w-4 h-4" style={{ color: G, filter: `drop-shadow(0 0 4px ${G})` }} />
            </div>
            <h1 className="text-[19px] font-mono font-bold tracking-tight text-white" data-testid="text-dashboard-title">
              System<span style={{ color: G }}>_</span>Overview
            </h1>
          </div>
          <p className="text-[10px] font-mono mt-1 pl-9" style={{ color: GA(0.30) }}>
            &gt; Realtime operational metrics
          </p>
        </div>
        {data?.role === "superadmin" && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-default"
            style={{ background: GA(0.05), border: `1px solid ${GA(0.14)}` }}>
            <Shield className="w-3 h-3" style={{ color: G }} />
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: GA(0.70) }}>Root Access</span>
          </div>
        )}
      </div>

      {/* ── 4 STAT CARDS ── */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total_Accounts" value={total} sub={`$${(data?.billingTotal || 0).toFixed(2)} invested`} accent={G} icon={Database}
          data-testid="card-stat-total-accounts" />
        <StatCard label="Verified" value={verified} sub={`${successRate}% rate`} accent={G} icon={CheckCircle2} />
        <StatCard label="Failed" value={failed} sub={`${failRate}% rate`} accent={RED} icon={XCircle} />
        <StatCard label="In_Progress" value={pending} sub={pending > 0 ? "Processing..." : "Queue empty"} accent={AMBER} icon={Clock} pulse={pending > 0} />
      </div>

      {/* ── MIDDLE ROW ── */}
      <div className="grid gap-3 lg:grid-cols-3">

        {/* SUCCESS METRIC */}
        <div className="rounded-xl p-5" style={{ background: "rgba(0,0,0,0.50)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}
          data-testid="card-success-ring">
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 className="w-3 h-3" style={{ color: GA(0.35) }} />
            <span className="text-[8.5px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Success_Metric</span>
          </div>
          <div className="flex flex-col items-center">
            <RingChart value={verified} total={total} />
            <div className="grid grid-cols-3 gap-2 mt-5 w-full text-center">
              {[
                { val: verified, label: "PASS", color: G },
                { val: failed, label: "FAIL", color: RED },
                { val: pending, label: "QUEUE", color: AMBER },
              ].map(s => (
                <div key={s.label} className="py-2.5 rounded-lg"
                  style={{ background: `${s.color}0c`, border: `1px solid ${s.color}20` }}>
                  <div className="text-[15px] font-bold font-mono" style={{ color: s.color, textShadow: `0 0 10px ${s.color}50` }}>{s.val}</div>
                  <div className="text-[7.5px] font-mono uppercase tracking-[0.18em] mt-0.5" style={{ color: `${s.color}50` }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SYSTEM STATUS */}
        <div className="lg:col-span-2 rounded-xl p-5" style={{ background: "rgba(0,0,0,0.50)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Terminal className="w-3 h-3" style={{ color: GA(0.35) }} />
            <span className="text-[8.5px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>System_Status</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <DataCell icon={DollarSign} label="Revenue" value={`$${(data?.billingTotal || 0).toFixed(2)}`} color={G} />
            <DataCell icon={Users} label="Accounts" value={`${total}`} color={AMBER} />
            <DataCell icon={CheckCircle2} label="Success" value={`${successRate}%`} color={G} />
            <DataCell icon={DollarSign} label="Unit_Cost" value={`$${accountPrice.toFixed(2)}`} color={AMBER} />
            {capSolverBalance !== null && (
              <DataCell icon={Zap} label="CapSolver" value={`$${parseFloat(capSolverBalance).toFixed(2)}`} color={AMBER} sub="CAPTCHA solving" data-testid="card-capsolver-balance" />
            )}
            {smsPoolBalance !== null && (
              <DataCell icon={Phone} label="SMS_Pool" value={`$${parseFloat(smsPoolBalance).toFixed(2)}`} color={BLUE} sub="Phone verification" data-testid="card-smspool-balance" />
            )}
            {data?.role !== "superadmin" && (
              <DataCell icon={Wallet} label="Wallet" value={`$${walletBalance.toFixed(2)}`} color={G} sub={`~${Math.floor(walletBalance / accountPrice)} units`} />
            )}
          </div>
        </div>
      </div>

      {/* ── PIPELINE DISTRIBUTION ── */}
      {total > 0 && (
        <div className="rounded-xl p-5" style={{ background: "rgba(0,0,0,0.50)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-3 h-3" style={{ color: GA(0.35) }} />
            <span className="text-[8.5px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Pipeline_Distribution</span>
          </div>

          {/* Bar */}
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

          {/* Legend */}
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
        <div className="rounded-xl" style={{ background: "rgba(0,0,0,0.50)", border: `1px solid ${GA(0.10)}`, boxShadow: `inset 0 1px 0 ${GA(0.06)}` }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${GA(0.07)}` }}>
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3" style={{ color: GA(0.35) }} />
              <span className="text-[8.5px] font-mono uppercase tracking-[0.2em]" style={{ color: GA(0.30) }}>Recent_Operations</span>
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
                  onMouseEnter={e => (e.currentTarget.style.background = GA(0.02))}
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

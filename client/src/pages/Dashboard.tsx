import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2, Wallet,
  TrendingUp, Activity, Zap, Shield, ArrowUpRight, Copy, Trophy, Phone,
  BarChart3, CircleDot, Cpu, Database, Terminal
} from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { useAccountPrice } from "@/lib/useAccountPrice";

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
  createdAt: string;
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentAccounts, setRecentAccounts] = useState<RecentAccount[]>([]);
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
      fetch("/api/accounts", { credentials: "include" }).then((r) => {
        if (!r.ok) return [];
        return r.json();
      }),
      fetch("/api/smspool/balance", { credentials: "include" }).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }).catch(() => null),
      fetch("/api/capsolver/balance", { credentials: "include" }).then((r) => {
        if (!r.ok) return null;
        return r.json();
      }).catch(() => null),
    ])
      .then(([dashData, accounts, smsData, capData]) => {
        if (dashData) setData(dashData);
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

  function copyEmail(email: string) {
    navigator.clipboard.writeText(email);
    toast({ title: "Copied", description: email });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-cyan-400/10 blur-md animate-glow" />
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400/60 relative" />
          </div>
          <p className="text-[10px] text-cyan-400/30 font-mono uppercase tracking-wider">Loading systems...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-float-up">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-cyan-400/50" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono" data-testid="text-dashboard-title">
              System<span className="text-cyan-400">_</span>Overview
            </h1>
          </div>
          <p className="text-cyan-400/30 mt-1 text-[11px] font-mono pl-7.5">Realtime operational metrics</p>
        </div>
        {data?.role === "superadmin" && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md" style={{ background: 'rgba(0,240,255,0.05)', border: '1px solid rgba(0,240,255,0.1)' }}>
            <Shield className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">Root Access</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "TOTAL_ACCOUNTS", value: total, color: "cyan", iconColor: "text-cyan-400", valueColor: "text-cyan-300", icon: Database, sub: `$${(data?.billingTotal || 0).toFixed(2)} invested` },
          { label: "VERIFIED", value: verified, color: "emerald", iconColor: "text-emerald-400", valueColor: "text-emerald-400", icon: CheckCircle2, sub: `${successRate}% rate` },
          { label: "FAILED", value: failed, color: "red", iconColor: "text-red-400", valueColor: "text-red-400", icon: XCircle, sub: `${total > 0 ? Math.round((failed / total) * 100) : 0}% rate` },
          { label: "IN_PROGRESS", value: pending, color: "amber", iconColor: "text-amber-400", valueColor: "text-amber-400", icon: Clock, sub: pending > 0 ? "Processing..." : "Queue empty" },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className="relative overflow-hidden rounded-lg cyber-card p-4 group glass-panel-hover transition-all duration-200 corner-bracket"
            style={{ animationDelay: `${i * 80}ms` }}
            data-testid={`card-stat-${stat.label.toLowerCase().replace(/_/g, "-")}`}
          >
            <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-mono text-cyan-400/35 uppercase tracking-[0.15em]">{stat.label}</span>
                <div className="p-1.5 rounded-md" style={{ background: `rgba(0,240,255,0.04)`, border: '1px solid rgba(0,240,255,0.08)' }}>
                  <stat.icon className={`w-3.5 h-3.5 ${stat.iconColor}`} />
                </div>
              </div>
              <div className={`text-3xl font-bold ${stat.valueColor} tracking-tight font-mono`}>{stat.value}</div>
              <div className="flex items-center gap-1.5 mt-2">
                {stat.label === "IN_PROGRESS" && pending > 0 ? (
                  <span className="text-[10px] text-amber-400/70 font-mono flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Processing...
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-600 font-mono">{stat.sub}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg cyber-card p-5" data-testid="card-success-ring">
          <h3 className="text-[9px] font-mono text-cyan-400/35 uppercase tracking-[0.15em] mb-5 flex items-center gap-2">
            <BarChart3 className="w-3 h-3 text-cyan-400/30" /> Success_Metric
          </h3>
          <div className="flex flex-col items-center">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(0,240,255,0.04)" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="url(#cyberGradient)" strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(successRate / 100) * 327} 327`}
                  className="transition-all duration-1000"
                  style={{ filter: 'drop-shadow(0 0 4px rgba(0,240,255,0.3))' }}
                />
                <defs>
                  <linearGradient id="cyberGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#00f0ff" />
                    <stop offset="100%" stopColor="#a855f7" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-cyan-300 font-mono">{successRate}%</span>
                <span className="text-[8px] text-cyan-400/30 font-mono uppercase tracking-wider mt-0.5">success</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 w-full text-center">
              {[
                { val: verified, label: "PASS", color: "text-emerald-400", bg: "rgba(0,255,136,0.04)" },
                { val: failed, label: "FAIL", color: "text-red-400", bg: "rgba(255,51,102,0.04)" },
                { val: pending, label: "QUEUE", color: "text-amber-400", bg: "rgba(255,170,0,0.04)" },
              ].map((s) => (
                <div key={s.label} className="p-2 rounded-md" style={{ background: s.bg, border: '1px solid rgba(0,240,255,0.05)' }}>
                  <div className={`text-sm font-bold ${s.color} font-mono`}>{s.val}</div>
                  <div className="text-[7px] text-cyan-400/25 font-mono uppercase tracking-wider mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {data?.role !== "superadmin" ? (
          <div className="lg:col-span-2 rounded-lg cyber-card p-5 relative overflow-hidden" data-testid="card-wallet-balance">
            <h3 className="text-[9px] font-mono text-cyan-400/35 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
              <Wallet className="w-3 h-3 text-cyan-400/30" /> Wallet_Balance
            </h3>
            <div className="mb-4">
              <div className="text-4xl font-bold text-cyan-300 tracking-tight font-mono">${walletBalance.toFixed(2)}</div>
              <p className="text-[11px] text-cyan-400/30 mt-1.5 font-mono">
                {walletBalance > 0
                  ? `Capacity: ~${Math.floor(walletBalance / accountPrice)} units @ $${accountPrice.toFixed(2)}/ea`
                  : "Insufficient funds. Deposit required."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-md" style={{ background: 'rgba(0,240,255,0.03)', border: '1px solid rgba(0,240,255,0.06)' }}>
                <div className="text-[8px] text-cyan-400/30 font-mono uppercase tracking-wider">Unit Cost</div>
                <div className="text-base font-bold text-zinc-200 mt-1 font-mono">${accountPrice.toFixed(2)}</div>
              </div>
              <div className="p-3 rounded-md" style={{ background: 'rgba(0,240,255,0.03)', border: '1px solid rgba(0,240,255,0.06)' }}>
                <div className="text-[8px] text-cyan-400/30 font-mono uppercase tracking-wider">Total Spent</div>
                <div className="text-base font-bold text-zinc-200 mt-1 font-mono">${(data?.billingTotal || 0).toFixed(2)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 rounded-lg cyber-card p-5 relative overflow-hidden">
            <h3 className="text-[9px] font-mono text-cyan-400/35 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
              <Terminal className="w-3 h-3 text-cyan-400/30" /> System_Status
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: DollarSign, label: "Revenue", value: `$${(data?.billingTotal || 0).toFixed(2)}`, color: "cyan" },
                { icon: Users, label: "Accounts", value: `${total}`, color: "violet" },
                { icon: CheckCircle2, label: "Success", value: `${successRate}%`, color: "emerald" },
                { icon: DollarSign, label: "Unit_Cost", value: `$${accountPrice.toFixed(2)}`, color: "amber" },
              ].map((item) => (
                <div key={item.label} className="p-3 rounded-md" style={{ background: `rgba(0,240,255,0.03)`, border: '1px solid rgba(0,240,255,0.06)' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <item.icon className={`w-3.5 h-3.5 text-${item.color}-400`} />
                    <span className={`text-[9px] font-mono text-${item.color}-400/60 uppercase tracking-wider`}>{item.label}</span>
                  </div>
                  <div className={`text-xl font-bold text-${item.color}-300 font-mono`}>{item.value}</div>
                </div>
              ))}
              {smsPoolBalance !== null && (
                <div className="p-3 rounded-md" style={{ background: 'rgba(0,240,255,0.03)', border: '1px solid rgba(0,240,255,0.06)' }} data-testid="card-smspool-balance">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Phone className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-[9px] font-mono text-sky-400/60 uppercase tracking-wider">SMS_Pool</span>
                  </div>
                  <div className="text-xl font-bold text-sky-300 font-mono">${parseFloat(smsPoolBalance).toFixed(2)}</div>
                  <div className="text-[8px] text-cyan-400/20 font-mono mt-0.5">Phone verification</div>
                </div>
              )}
              {capSolverBalance !== null && (
                <div className="p-3 rounded-md" style={{ background: 'rgba(0,240,255,0.03)', border: '1px solid rgba(0,240,255,0.06)' }} data-testid="card-capsolver-balance">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="w-3.5 h-3.5 text-violet-400" />
                    <span className="text-[9px] font-mono text-violet-400/60 uppercase tracking-wider">CapSolver</span>
                  </div>
                  <div className="text-xl font-bold text-violet-300 font-mono">${parseFloat(capSolverBalance).toFixed(2)}</div>
                  <div className="text-[8px] text-cyan-400/20 font-mono mt-0.5">CAPTCHA solving</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="rounded-lg cyber-card p-5">
          <h3 className="text-[9px] font-mono text-cyan-400/35 uppercase tracking-[0.15em] mb-3 flex items-center gap-2">
            <Activity className="w-3 h-3 text-cyan-400/30" /> Pipeline_Distribution
          </h3>
          <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(0,240,255,0.04)' }}>
            {verified > 0 && (
              <div
                className="h-full transition-all duration-700"
                style={{ width: `${(verified / total) * 100}%`, background: 'linear-gradient(90deg, #00ff88, #00f0ff)', boxShadow: '0 0 8px rgba(0,255,136,0.3)' }}
                title={`Verified: ${verified}`}
              />
            )}
            {pending > 0 && (
              <div
                className="h-full transition-all duration-700"
                style={{ width: `${(pending / total) * 100}%`, background: 'linear-gradient(90deg, #ffaa00, #ff8800)', boxShadow: '0 0 8px rgba(255,170,0,0.3)' }}
                title={`Pending: ${pending}`}
              />
            )}
            {failed > 0 && (
              <div
                className="h-full transition-all duration-700"
                style={{ width: `${(failed / total) * 100}%`, background: 'linear-gradient(90deg, #ff3366, #ff1144)', boxShadow: '0 0 8px rgba(255,51,102,0.3)' }}
                title={`Failed: ${failed}`}
              />
            )}
          </div>
          <div className="flex items-center gap-5 mt-2.5">
            {[
              { label: "Verified", count: verified, color: "#00ff88" },
              { label: "Active", count: pending, color: "#ffaa00" },
              { label: "Failed", count: failed, color: "#ff3366" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color, boxShadow: `0 0 4px ${s.color}` }} />
                <span className="text-[10px] text-zinc-500 font-mono">{s.label} ({s.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentAccounts.length > 0 && (
        <div className="rounded-lg cyber-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[9px] font-mono text-cyan-400/35 uppercase tracking-[0.15em] flex items-center gap-2">
              <Clock className="w-3 h-3 text-cyan-400/30" /> Recent_Operations
            </h3>
            <a href="/admin/accounts" className="text-[10px] text-cyan-400/50 hover:text-cyan-400 flex items-center gap-1 transition-colors font-mono" data-testid="link-view-all-accounts">
              View all <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
          <div className="space-y-0.5">
            {recentAccounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between p-2.5 rounded-md hover:bg-cyan-500/[0.02] transition-colors group"
                style={{ borderBottom: '1px solid rgba(0,240,255,0.03)' }}
                data-testid={`row-recent-${acc.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    acc.status === "completed" ? "bg-emerald-400 shadow-[0_0_4px_#00ff88]" :
                    acc.status === "verified" ? "bg-cyan-400 shadow-[0_0_4px_#00f0ff]" :
                    acc.status === "failed" ? "bg-red-400 shadow-[0_0_4px_#ff3366]" :
                    acc.status === "draw_registering" ? "bg-violet-400 shadow-[0_0_4px_#a855f7] animate-pulse" :
                    acc.status === "profile_saving" ? "bg-blue-400 shadow-[0_0_4px_#3b82f6] animate-pulse" :
                    "bg-amber-400 shadow-[0_0_4px_#ffaa00] animate-pulse"
                  }`} />
                  <div>
                    <div className="text-[12px] font-medium text-zinc-200 font-mono">{acc.firstName} {acc.lastName}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-cyan-400/30 font-mono">{acc.email}</span>
                      <button
                        onClick={() => { sounds.click(); copyEmail(acc.email); }}
                        className="text-cyan-400/10 hover:text-cyan-400/50 transition-colors opacity-0 group-hover:opacity-100"
                        data-testid={`button-copy-recent-${acc.id}`}
                      >
                        <Copy className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded-sm ${
                    acc.status === "completed" ? "bg-emerald-400/8 text-emerald-400 border border-emerald-400/15" :
                    acc.status === "verified" ? "bg-cyan-400/8 text-cyan-400 border border-cyan-400/15" :
                    acc.status === "failed" ? "bg-red-400/8 text-red-400 border border-red-400/15" :
                    acc.status === "draw_registering" ? "bg-violet-400/8 text-violet-400 border border-violet-400/15" :
                    acc.status === "profile_saving" ? "bg-blue-400/8 text-blue-400 border border-blue-400/15" :
                    "bg-amber-400/8 text-amber-400 border border-amber-400/15"
                  }`}>
                    {acc.status === "completed" ? "DRAW_OK" :
                     acc.status === "profile_saving" ? "PROFILE" :
                     acc.status === "draw_registering" ? "DRAW_REG" :
                     acc.status === "waiting_code" ? "WAIT_CODE" :
                     acc.status.toUpperCase()}
                  </span>
                  <span className="text-[9px] text-zinc-700 w-14 text-right font-mono">
                    {new Date(acc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

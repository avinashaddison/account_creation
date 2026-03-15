import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2, Wallet,
  TrendingUp, Activity, Zap, Shield, ArrowUpRight, Copy, Trophy, Phone,
  BarChart3, CircleDot
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
          <Loader2 className="w-8 h-8 animate-spin text-violet-500/60" />
          <p className="text-xs text-zinc-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-float-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-zinc-500 mt-0.5 text-sm">Overview of your account operations</p>
        </div>
        {data?.role === "superadmin" && (
          <Badge className="text-[10px] px-2.5 py-1 bg-violet-500/10 text-violet-300 border border-violet-500/15 font-semibold gap-1.5 hover:bg-violet-500/15">
            <Shield className="w-3 h-3" />
            Super Admin
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Accounts", value: total, gradient: "from-violet-500/10 to-purple-500/5", iconBg: "bg-violet-500/10", iconColor: "text-violet-400", valueColor: "text-white", icon: Users, sub: `$${(data?.billingTotal || 0).toFixed(2)} invested` },
          { label: "Verified", value: verified, gradient: "from-emerald-500/10 to-teal-500/5", iconBg: "bg-emerald-500/10", iconColor: "text-emerald-400", valueColor: "text-emerald-400", icon: CheckCircle2, sub: `${successRate}% success rate` },
          { label: "Failed", value: failed, gradient: "from-red-500/10 to-rose-500/5", iconBg: "bg-red-500/10", iconColor: "text-red-400", valueColor: "text-red-400", icon: XCircle, sub: `${total > 0 ? Math.round((failed / total) * 100) : 0}% failure rate` },
          { label: "In Progress", value: pending, gradient: "from-amber-500/10 to-yellow-500/5", iconBg: "bg-amber-500/10", iconColor: "text-amber-400", valueColor: "text-amber-400", icon: Clock, sub: pending > 0 ? "Processing..." : "All clear" },
        ].map((stat, i) => (
          <div
            key={stat.label}
            className="relative overflow-hidden rounded-xl glass-panel p-5 group glass-panel-hover transition-all duration-200"
            style={{ animationDelay: `${i * 80}ms` }}
            data-testid={`card-stat-${stat.label.toLowerCase().replace(/ /g, "-")}`}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${stat.gradient} opacity-40`} />
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{stat.label}</span>
                <div className={`p-2 rounded-lg ${stat.iconBg}`}>
                  <stat.icon className={`w-4 h-4 ${stat.iconColor}`} />
                </div>
              </div>
              <div className={`text-3xl font-bold ${stat.valueColor} tracking-tight`}>{stat.value}</div>
              <div className="flex items-center gap-1.5 mt-2">
                {stat.label === "In Progress" && pending > 0 ? (
                  <span className="text-[11px] text-amber-400/80 font-medium flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Processing...
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-600">{stat.sub}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl glass-panel p-6" data-testid="card-success-ring">
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-6 flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-zinc-600" /> Success Rate
          </h3>
          <div className="flex flex-col items-center">
            <div className="relative w-36 h-36">
              <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="10" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="url(#successGradient)" strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(successRate / 100) * 327} 327`}
                  className="transition-all duration-1000"
                />
                <defs>
                  <linearGradient id="successGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#a78bfa" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-white">{successRate}%</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">success</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-5 w-full text-center">
              <div className="p-2 rounded-lg bg-white/[0.02]">
                <div className="text-base font-bold text-emerald-400">{verified}</div>
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider mt-0.5">Passed</div>
              </div>
              <div className="p-2 rounded-lg bg-white/[0.02]">
                <div className="text-base font-bold text-red-400">{failed}</div>
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider mt-0.5">Failed</div>
              </div>
              <div className="p-2 rounded-lg bg-white/[0.02]">
                <div className="text-base font-bold text-amber-400">{pending}</div>
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider mt-0.5">Pending</div>
              </div>
            </div>
          </div>
        </div>

        {data?.role !== "superadmin" ? (
          <div className="lg:col-span-2 rounded-xl glass-panel p-6 relative overflow-hidden" data-testid="card-wallet-balance">
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5 text-zinc-600" /> Wallet Overview
            </h3>
            <div className="mb-5">
              <div className="text-4xl font-bold text-white tracking-tight">${walletBalance.toFixed(2)}</div>
              <p className="text-sm text-zinc-500 mt-1.5">
                {walletBalance > 0
                  ? `Can create ~${Math.floor(walletBalance / accountPrice)} accounts at $${accountPrice.toFixed(2)} each`
                  : "Add funds to your wallet to create accounts"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Cost / Account</div>
                <div className="text-lg font-bold text-zinc-200 mt-1">${accountPrice.toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Total Spent</div>
                <div className="text-lg font-bold text-zinc-200 mt-1">${(data?.billingTotal || 0).toFixed(2)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 rounded-xl glass-panel p-6 relative overflow-hidden">
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-zinc-600" /> Quick Stats
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-violet-500/5 border border-violet-500/8">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-violet-400" />
                  <span className="text-[11px] font-semibold text-violet-400">Total Revenue</span>
                </div>
                <div className="text-2xl font-bold text-violet-300">${(data?.billingTotal || 0).toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/8">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  <span className="text-[11px] font-semibold text-purple-400">Accounts Created</span>
                </div>
                <div className="text-2xl font-bold text-purple-300">{total}</div>
              </div>
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/8">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-[11px] font-semibold text-emerald-400">Success Rate</span>
                </div>
                <div className="text-2xl font-bold text-emerald-300">{successRate}%</div>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/8">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-amber-400" />
                  <span className="text-[11px] font-semibold text-amber-400">Per Account</span>
                </div>
                <div className="text-2xl font-bold text-amber-300">${accountPrice.toFixed(2)}</div>
              </div>
              {smsPoolBalance !== null && (
                <div className="p-4 rounded-xl bg-sky-500/5 border border-sky-500/8" data-testid="card-smspool-balance">
                  <div className="flex items-center gap-2 mb-2">
                    <Phone className="w-4 h-4 text-sky-400" />
                    <span className="text-[11px] font-semibold text-sky-400">SMSPool</span>
                  </div>
                  <div className="text-2xl font-bold text-sky-300">${parseFloat(smsPoolBalance).toFixed(2)}</div>
                  <div className="text-[10px] text-zinc-600 mt-1">Phone verification</div>
                </div>
              )}
              {capSolverBalance !== null && (
                <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/8" data-testid="card-capsolver-balance">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-indigo-400" />
                    <span className="text-[11px] font-semibold text-indigo-400">CapSolver</span>
                  </div>
                  <div className="text-2xl font-bold text-indigo-300">${parseFloat(capSolverBalance).toFixed(2)}</div>
                  <div className="text-[10px] text-zinc-600 mt-1">CAPTCHA solving</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="rounded-xl glass-panel p-6">
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-zinc-600" /> Status Distribution
          </h3>
          <div className="h-2.5 rounded-full bg-white/[0.03] overflow-hidden flex">
            {verified > 0 && (
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                style={{ width: `${(verified / total) * 100}%` }}
                title={`Verified: ${verified}`}
              />
            )}
            {pending > 0 && (
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-700"
                style={{ width: `${(pending / total) * 100}%` }}
                title={`Pending: ${pending}`}
              />
            )}
            {failed > 0 && (
              <div
                className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-all duration-700"
                style={{ width: `${(failed / total) * 100}%` }}
                title={`Failed: ${failed}`}
              />
            )}
          </div>
          <div className="flex items-center gap-6 mt-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-[11px] text-zinc-500">Verified ({verified})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-[11px] text-zinc-500">In Progress ({pending})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-[11px] text-zinc-500">Failed ({failed})</span>
            </div>
          </div>
        </div>
      )}

      {recentAccounts.length > 0 && (
        <div className="rounded-xl glass-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-zinc-600" /> Recent Accounts
            </h3>
            <a href="/admin/accounts" className="text-[11px] text-violet-400 hover:text-violet-300 flex items-center gap-1 transition-colors font-medium" data-testid="link-view-all-accounts">
              View all <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
          <div className="space-y-0.5">
            {recentAccounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-white/[0.02] transition-colors group"
                data-testid={`row-recent-${acc.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    acc.status === "completed" ? "bg-emerald-400" :
                    acc.status === "verified" ? "bg-teal-400" :
                    acc.status === "failed" ? "bg-red-400" :
                    acc.status === "draw_registering" ? "bg-violet-400 animate-pulse" :
                    acc.status === "profile_saving" ? "bg-blue-400 animate-pulse" :
                    "bg-amber-400 animate-pulse"
                  }`} />
                  <div>
                    <div className="text-sm font-medium text-zinc-200">{acc.firstName} {acc.lastName}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-zinc-500 font-mono">{acc.email}</span>
                      <button
                        onClick={() => { sounds.click(); copyEmail(acc.email); }}
                        className="text-zinc-700 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
                        data-testid={`button-copy-recent-${acc.id}`}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    className={`text-[10px] font-medium ${
                      acc.status === "completed" ? "bg-emerald-500/8 text-emerald-400 border-emerald-500/15 hover:bg-emerald-500/12" :
                      acc.status === "verified" ? "bg-teal-500/8 text-teal-400 border-teal-500/15 hover:bg-teal-500/12" :
                      acc.status === "failed" ? "bg-red-500/8 text-red-400 border-red-500/15 hover:bg-red-500/12" :
                      acc.status === "draw_registering" ? "bg-violet-500/8 text-violet-400 border-violet-500/15 hover:bg-violet-500/12" :
                      acc.status === "profile_saving" ? "bg-blue-500/8 text-blue-400 border-blue-500/15 hover:bg-blue-500/12" :
                      "bg-amber-500/8 text-amber-400 border-amber-500/15 hover:bg-amber-500/12"
                    }`}
                  >
                    {acc.status === "completed" ? "Draw Registered" :
                     acc.status === "profile_saving" ? "Saving Profile" :
                     acc.status === "draw_registering" ? "Draw Registration" :
                     acc.status === "waiting_code" ? "Waiting Code" :
                     acc.status}
                  </Badge>
                  <span className="text-[10px] text-zinc-600 w-16 text-right">
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

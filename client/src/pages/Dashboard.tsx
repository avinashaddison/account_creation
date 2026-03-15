import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2, Wallet,
  TrendingUp, Activity, Zap, Shield, ArrowUpRight, Copy, Trophy, Phone
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
        <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-zinc-500 mt-1 text-sm">Overview of your LA28 account operations</p>
        </div>
        {data?.role === "superadmin" && (
          <Badge className="text-xs px-3 py-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold gap-1.5 hover:bg-amber-500/15">
            <Shield className="w-3.5 h-3.5" />
            Super Admin
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Accounts", value: total, color: "red", icon: Users, sub: `$${(data?.billingTotal || 0).toFixed(2)} total invested`, subIcon: TrendingUp },
          { label: "Verified", value: verified, color: "emerald", icon: CheckCircle2, sub: `${successRate}% success rate`, subIcon: Activity },
          { label: "Failed", value: failed, color: "red", icon: XCircle, sub: `${total > 0 ? Math.round((failed / total) * 100) : 0}% failure rate`, subIcon: null },
          { label: "In Progress", value: pending, color: "amber", icon: Clock, sub: pending > 0 ? "Processing..." : "All clear", subIcon: null },
        ].map((stat) => (
          <div
            key={stat.label}
            className="relative overflow-hidden rounded-xl bg-[#111118] border border-white/5 p-5 group hover:border-white/10 transition-all"
            data-testid={`card-stat-${stat.label.toLowerCase().replace(/ /g, "-")}`}
          >
            <div className={`absolute top-0 right-0 w-32 h-32 bg-${stat.color}-500/5 rounded-full -mr-10 -mt-10`} />
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{stat.label}</span>
              <div className={`p-2 rounded-lg bg-${stat.color}-500/10`}>
                <stat.icon className={`w-4 h-4 text-${stat.color}-400`} />
              </div>
            </div>
            <div className={`text-3xl font-black text-${stat.color}-400`}>{stat.value}</div>
            <div className="flex items-center gap-1 mt-2">
              {stat.subIcon && <stat.subIcon className={`w-3 h-3 text-${stat.color}-500/60`} />}
              {stat.label === "In Progress" && pending > 0 ? (
                <span className="text-xs text-amber-500 font-medium flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Processing...
                </span>
              ) : (
                <span className="text-xs text-zinc-600">{stat.sub}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl bg-[#111118] border border-white/5 p-6" data-testid="card-success-ring">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-6">Success Rate</h3>
          <div className="flex flex-col items-center">
            <div className="relative w-40 h-40">
              <svg className="w-40 h-40 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#1a1a24" strokeWidth="12" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="url(#successGradientDark)" strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${(successRate / 100) * 327} 327`}
                  className="transition-all duration-1000"
                />
                <defs>
                  <linearGradient id="successGradientDark" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black text-white">{successRate}%</span>
                <span className="text-xs text-zinc-500">success</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-6 w-full text-center">
              <div>
                <div className="text-lg font-bold text-emerald-400">{verified}</div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Passed</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-400">{failed}</div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Failed</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-400">{pending}</div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Pending</div>
              </div>
            </div>
          </div>
        </div>

        {data?.role !== "superadmin" ? (
          <div className="lg:col-span-2 rounded-xl bg-[#111118] border border-white/5 p-6 relative overflow-hidden" data-testid="card-wallet-balance">
            <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 rounded-full" />
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Wallet className="w-4 h-4" /> Wallet Overview
            </h3>
            <div className="mb-6">
              <div className="text-4xl font-black bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">${walletBalance.toFixed(2)}</div>
              <p className="text-sm text-zinc-500 mt-1">
                {walletBalance > 0
                  ? `Can create ~${Math.floor(walletBalance / accountPrice)} accounts at $${accountPrice.toFixed(2)} each`
                  : "Add funds to your wallet to create accounts"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="text-xs text-zinc-600">Cost per Account</div>
                <div className="text-lg font-bold text-zinc-300 mt-0.5">${accountPrice.toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="text-xs text-zinc-600">Total Spent</div>
                <div className="text-lg font-bold text-zinc-300 mt-0.5">${(data?.billingTotal || 0).toFixed(2)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 rounded-xl bg-[#111118] border border-white/5 p-6 relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-gradient-to-br from-red-500/5 to-rose-500/5 rounded-full" />
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4" /> Quick Stats
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-red-500/5 border border-red-500/10">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-red-400" />
                  <span className="text-xs font-medium text-red-400">Total Revenue</span>
                </div>
                <div className="text-2xl font-black text-red-300">${(data?.billingTotal || 0).toFixed(2)}</div>
              </div>
              <div className="p-4 rounded-xl bg-rose-500/5 border border-rose-500/10">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-rose-400" />
                  <span className="text-xs font-medium text-rose-400">Accounts Created</span>
                </div>
                <div className="text-2xl font-black text-rose-300">{total}</div>
              </div>
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-400">Success Rate</span>
                </div>
                <div className="text-2xl font-black text-emerald-300">{successRate}%</div>
              </div>
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-medium text-amber-400">Per Account</span>
                </div>
                <div className="text-2xl font-black text-amber-300">${accountPrice.toFixed(2)}</div>
              </div>
              {smsPoolBalance !== null && (
                <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10" data-testid="card-smspool-balance">
                  <div className="flex items-center gap-2 mb-2">
                    <Phone className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-medium text-blue-400">SMSPool Balance</span>
                  </div>
                  <div className="text-2xl font-black text-blue-300">${parseFloat(smsPoolBalance).toFixed(2)}</div>
                  <div className="text-[10px] text-zinc-600 mt-1">Phone verification credits</div>
                </div>
              )}
              {capSolverBalance !== null && (
                <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/10" data-testid="card-capsolver-balance">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-medium text-purple-400">CapSolver Balance</span>
                  </div>
                  <div className="text-2xl font-black text-purple-300">${parseFloat(capSolverBalance).toFixed(2)}</div>
                  <div className="text-[10px] text-zinc-600 mt-1">CAPTCHA solving credits</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="rounded-xl bg-[#111118] border border-white/5 p-6">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4" /> Status Distribution
          </h3>
          <div className="h-3 rounded-full bg-[#1a1a24] overflow-hidden flex">
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
              <span className="text-xs text-zinc-500">Verified ({verified})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="text-xs text-zinc-500">In Progress ({pending})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-xs text-zinc-500">Failed ({failed})</span>
            </div>
          </div>
        </div>
      )}

      {recentAccounts.length > 0 && (
        <div className="rounded-xl bg-[#111118] border border-white/5 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4" /> Recent Accounts
            </h3>
            <a href="/admin/accounts" className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors" data-testid="link-view-all-accounts">
              View all <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
          <div className="space-y-1">
            {recentAccounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-white/[0.02] transition-colors"
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
                      <span className="text-xs text-zinc-500 font-mono">{acc.email}</span>
                      <button
                        onClick={() => { sounds.click(); copyEmail(acc.email); }}
                        className="text-zinc-600 hover:text-zinc-400 transition-colors"
                        data-testid={`button-copy-recent-${acc.id}`}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    className={`text-[10px] ${
                      acc.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15" :
                      acc.status === "verified" ? "bg-teal-500/10 text-teal-400 border-teal-500/20 hover:bg-teal-500/15" :
                      acc.status === "failed" ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/15" :
                      acc.status === "draw_registering" ? "bg-violet-500/10 text-violet-400 border-violet-500/20 hover:bg-violet-500/15" :
                      acc.status === "profile_saving" ? "bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/15" :
                      "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/15"
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

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign, TrendingUp, Users, Activity, Loader2, Clock,
  CheckCircle2, XCircle, ArrowUpRight, BarChart3
} from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useAccountPrice } from "@/lib/useAccountPrice";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AdminBreakdown = {
  id: string;
  username: string;
  email: string;
  walletBalance: string;
  totalSpent: number;
  accounts: { total: number; verified: number; failed: number; pending: number };
};

type PlatformBreakdown = {
  name: string;
  count: number;
  revenue: number;
};

type Transaction = {
  id: string;
  description: string;
  amount: string;
  adminName: string;
  adminEmail: string;
  createdAt: string;
};

type EarningsData = {
  totalRevenue: number;
  totalStats: { total: number; verified: number; failed: number; pending: number };
  totalAdmins: number;
  adminBreakdown: AdminBreakdown[];
  platformBreakdown: PlatformBreakdown[];
  recentTransactions: Transaction[];
};

export default function Earnings() {
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const accountPrice = useAccountPrice();

  useEffect(() => {
    fetch("/api/earnings", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return null; }
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (!data) return null;

  const successRate = data.totalStats.total > 0
    ? Math.round((data.totalStats.verified / data.totalStats.total) * 100)
    : 0;

  const platformColors: Record<string, string> = {
    LA28: "red",
    UEFA: "emerald",
    Ticketmaster: "sky",
    Other: "zinc",
  };

  return (
    <div className="space-y-6" data-testid="earnings-page">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-earnings-title">Earnings</h1>
        <p className="text-zinc-500 mt-1 text-sm">Revenue overview from all admin account creations</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-xl bg-[#111118] border border-white/5 p-5 group hover:border-white/10 transition-all" data-testid="card-total-revenue">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -mr-10 -mt-10" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Revenue</span>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <DollarSign className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-emerald-400">${data.totalRevenue.toFixed(2)}</div>
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="w-3 h-3 text-emerald-500/60" />
            <span className="text-xs text-zinc-600">From {data.totalStats.verified} verified accounts</span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#111118] border border-white/5 p-5 group hover:border-white/10 transition-all" data-testid="card-total-accounts">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-full -mr-10 -mt-10" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Total Accounts</span>
            <div className="p-2 rounded-lg bg-red-500/10">
              <Activity className="w-4 h-4 text-red-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-red-400">{data.totalStats.total}</div>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-xs text-zinc-600">{successRate}% success rate</span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#111118] border border-white/5 p-5 group hover:border-white/10 transition-all" data-testid="card-active-admins">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -mr-10 -mt-10" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Active Admins</span>
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Users className="w-4 h-4 text-amber-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-amber-400">{data.totalAdmins}</div>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-xs text-zinc-600">Registered admins</span>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-[#111118] border border-white/5 p-5 group hover:border-white/10 transition-all" data-testid="card-avg-per-account">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full -mr-10 -mt-10" />
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Per Account</span>
            <div className="p-2 rounded-lg bg-rose-500/10">
              <BarChart3 className="w-4 h-4 text-rose-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-rose-400">${accountPrice.toFixed(2)}</div>
          <div className="flex items-center gap-1 mt-2">
            <span className="text-xs text-zinc-600">Fixed rate</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl bg-[#111118] border border-white/5 p-6" data-testid="card-platform-breakdown">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-5 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Platform Revenue
          </h3>
          {data.platformBreakdown.length === 0 ? (
            <p className="text-zinc-600 text-sm">No revenue data yet</p>
          ) : (
            <div className="space-y-4">
              {data.platformBreakdown.map((p) => {
                const color = platformColors[p.name] || "zinc";
                const maxRevenue = Math.max(...data.platformBreakdown.map(x => x.revenue), 1);
                const pct = (p.revenue / maxRevenue) * 100;
                return (
                  <div key={p.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full bg-${color}-400`} />
                        <span className="text-sm font-medium text-zinc-300">{p.name}</span>
                        <Badge className={`text-[10px] bg-${color}-500/10 text-${color}-400 border-${color}-500/20 hover:bg-${color}-500/15`}>
                          {p.count} accounts
                        </Badge>
                      </div>
                      <span className={`text-sm font-bold text-${color}-400`}>${p.revenue.toFixed(2)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#1a1a24] overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r from-${color}-500 to-${color}-400 transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-[#111118] border border-white/5 p-6" data-testid="card-success-overview">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-5">Account Status</h3>
          <div className="flex flex-col items-center">
            <div className="relative w-36 h-36">
              <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#1a1a24" strokeWidth="12" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="url(#earningsGrad)" strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${(successRate / 100) * 327} 327`}
                  className="transition-all duration-1000"
                />
                <defs>
                  <linearGradient id="earningsGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-white">{successRate}%</span>
                <span className="text-[10px] text-zinc-500">success</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-5 w-full text-center">
              <div>
                <div className="text-lg font-bold text-emerald-400">{data.totalStats.verified}</div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Verified</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-400">{data.totalStats.failed}</div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Failed</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-400">{data.totalStats.pending}</div>
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Pending</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {data.adminBreakdown.length > 0 && (
        <div className="rounded-xl bg-[#111118] border border-white/5 p-6" data-testid="card-admin-breakdown">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Users className="w-4 h-4" /> Admin Performance
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-zinc-500 text-xs">Admin</TableHead>
                  <TableHead className="text-zinc-500 text-xs">Email</TableHead>
                  <TableHead className="text-zinc-500 text-xs text-center">Total</TableHead>
                  <TableHead className="text-zinc-500 text-xs text-center">Verified</TableHead>
                  <TableHead className="text-zinc-500 text-xs text-center">Failed</TableHead>
                  <TableHead className="text-zinc-500 text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-zinc-500 text-xs text-right">Wallet</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.adminBreakdown.map((admin) => (
                  <TableRow key={admin.id} className="border-white/5 hover:bg-white/[0.02]" data-testid={`row-admin-${admin.id}`}>
                    <TableCell className="font-medium text-zinc-200 text-sm">{admin.username}</TableCell>
                    <TableCell className="text-zinc-400 text-xs font-mono">{admin.email}</TableCell>
                    <TableCell className="text-center text-zinc-300 text-sm">{admin.accounts.total}</TableCell>
                    <TableCell className="text-center">
                      <span className="text-emerald-400 text-sm font-medium">{admin.accounts.verified}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-red-400 text-sm font-medium">{admin.accounts.failed}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-emerald-400 font-bold text-sm">${admin.totalSpent.toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-amber-400 text-sm">${parseFloat(admin.walletBalance).toFixed(2)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {data.recentTransactions.length > 0 && (
        <div className="rounded-xl bg-[#111118] border border-white/5 p-6" data-testid="card-recent-transactions">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" /> Recent Transactions
          </h3>
          <div className="space-y-1">
            {data.recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-white/[0.02] transition-colors" data-testid={`row-tx-${tx.id}`}>
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-zinc-200">{tx.description}</div>
                    <div className="text-xs text-zinc-500">by {tx.adminName}</div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-bold text-emerald-400">+${parseFloat(tx.amount).toFixed(2)}</span>
                  <span className="text-[10px] text-zinc-600 w-20 text-right">
                    {new Date(tx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
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

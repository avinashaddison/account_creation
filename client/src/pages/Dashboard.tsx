import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2, Wallet,
  TrendingUp, Activity, Zap, Shield, ArrowUpRight, Copy
} from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

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
  const { toast } = useToast();

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
    ])
      .then(([dashData, accounts]) => {
        if (dashData) setData(dashData);
        setRecentAccounts((accounts || []).slice(0, 8));
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
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your LA28 account operations</p>
        </div>
        {data?.role === "superadmin" && (
          <Badge variant="outline" className="text-xs px-3 py-1.5 border-amber-300 text-amber-700 bg-amber-50 font-semibold gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Super Admin
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden" data-testid="card-stat-total-accounts">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full -mr-8 -mt-8" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Accounts</CardTitle>
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20">
              <Users className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black">{total}</div>
            <div className="flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3 text-blue-500" />
              <span className="text-xs text-muted-foreground">${(data?.billingTotal || 0).toFixed(2)} total invested</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden" data-testid="card-stat-verified">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-8 -mt-8" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Verified</CardTitle>
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-emerald-600">{verified}</div>
            <div className="flex items-center gap-1 mt-1">
              <Activity className="w-3 h-3 text-emerald-500" />
              <span className="text-xs text-muted-foreground">{successRate}% success rate</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden" data-testid="card-stat-failed">
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/5 rounded-full -mr-8 -mt-8" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500 to-red-600 text-white shadow-lg shadow-red-500/20">
              <XCircle className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-red-500">{failed}</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-xs text-muted-foreground">{total > 0 ? Math.round((failed / total) * 100) : 0}% failure rate</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden" data-testid="card-stat-in-progress">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full -mr-8 -mt-8" />
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In Progress</CardTitle>
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/20">
              <Clock className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-amber-600">{pending}</div>
            <div className="flex items-center gap-1 mt-1">
              {pending > 0 ? (
                <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Processing...
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">All clear</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1" data-testid="card-success-ring">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center pb-6">
            <div className="relative w-40 h-40">
              <svg className="w-40 h-40 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#f1f5f9" strokeWidth="12" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="url(#successGradient)" strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={`${(successRate / 100) * 327} 327`}
                  className="transition-all duration-1000"
                />
                <defs>
                  <linearGradient id="successGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black">{successRate}%</span>
                <span className="text-xs text-muted-foreground">success</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 w-full text-center">
              <div>
                <div className="text-lg font-bold text-emerald-600">{verified}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Passed</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-500">{failed}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-600">{pending}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {data?.role !== "superadmin" ? (
          <Card className="lg:col-span-2 relative overflow-hidden" data-testid="card-wallet-balance">
            <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 rounded-full" />
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Wallet className="w-4 h-4" /> Wallet Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-4xl font-black text-emerald-600">${walletBalance.toFixed(2)}</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {walletBalance > 0
                    ? `Can create ~${Math.floor(walletBalance / 0.11)} accounts at $0.11 each`
                    : "Add funds to your wallet to create accounts"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border">
                  <div className="text-xs text-muted-foreground">Cost per Account</div>
                  <div className="text-lg font-bold mt-0.5">$0.11</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border">
                  <div className="text-xs text-muted-foreground">Total Spent</div>
                  <div className="text-lg font-bold mt-0.5">${(data?.billingTotal || 0).toFixed(2)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="lg:col-span-2 relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 rounded-full" />
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Zap className="w-4 h-4" /> Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-100">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-purple-600" />
                    <span className="text-xs font-medium text-purple-700">Total Revenue</span>
                  </div>
                  <div className="text-2xl font-black text-purple-700">${(data?.billingTotal || 0).toFixed(2)}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-medium text-blue-700">Accounts Created</span>
                  </div>
                  <div className="text-2xl font-black text-blue-700">{total}</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-medium text-emerald-700">Success Rate</span>
                  </div>
                  <div className="text-2xl font-black text-emerald-700">{successRate}%</div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-medium text-amber-700">Per Account</span>
                  </div>
                  <div className="text-2xl font-black text-amber-700">$0.11</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {total > 0 && (
        <Card className="relative overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" /> Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-4 rounded-full bg-slate-100 overflow-hidden flex">
              {verified > 0 && (
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700"
                  style={{ width: `${(verified / total) * 100}%` }}
                  title={`Verified: ${verified}`}
                />
              )}
              {pending > 0 && (
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-700"
                  style={{ width: `${(pending / total) * 100}%` }}
                  title={`Pending: ${pending}`}
                />
              )}
              {failed > 0 && (
                <div
                  className="h-full bg-gradient-to-r from-red-400 to-red-500 transition-all duration-700"
                  style={{ width: `${(failed / total) * 100}%` }}
                  title={`Failed: ${failed}`}
                />
              )}
            </div>
            <div className="flex items-center gap-6 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs text-muted-foreground">Verified ({verified})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-xs text-muted-foreground">In Progress ({pending})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="text-xs text-muted-foreground">Failed ({failed})</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {recentAccounts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" /> Recent Accounts
              </CardTitle>
              <a href="/admin/accounts" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1" data-testid="link-view-all-accounts">
                View all <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200"
                  data-testid={`row-recent-${acc.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      acc.status === "verified" ? "bg-emerald-500" :
                      acc.status === "failed" ? "bg-red-500" :
                      "bg-amber-500 animate-pulse"
                    }`} />
                    <div>
                      <div className="text-sm font-medium">{acc.firstName} {acc.lastName}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground font-mono">{acc.email}</span>
                        <button
                          onClick={() => copyEmail(acc.email)}
                          className="text-muted-foreground hover:text-foreground"
                          data-testid={`button-copy-recent-${acc.id}`}
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        acc.status === "verified" ? "default" :
                        acc.status === "failed" ? "destructive" : "secondary"
                      }
                      className="text-[10px] capitalize"
                    >
                      {acc.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground w-16 text-right">
                      {new Date(acc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

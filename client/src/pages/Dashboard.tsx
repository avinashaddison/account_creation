import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2, Shield } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";

type DashboardData = {
  stats: { total: number; verified: number; failed: number; pending: number };
  billingTotal: number;
  freeAccountsUsed: number;
  freeAccountLimit: number;
  role: string;
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return null; }
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { title: "Total Accounts", value: data?.stats.total || 0, icon: Users, color: "text-blue-600 bg-blue-50" },
    { title: "Verified", value: data?.stats.verified || 0, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
    { title: "Failed", value: data?.stats.failed || 0, icon: XCircle, color: "text-red-600 bg-red-50" },
    { title: "In Progress", value: data?.stats.pending || 0, icon: Clock, color: "text-yellow-600 bg-yellow-50" },
    { title: "Total Cost", value: `$${(data?.billingTotal || 0).toFixed(2)}`, icon: DollarSign, color: "text-purple-600 bg-purple-50" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your LA28 account operations</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.title} data-testid={`card-stat-${card.title.toLowerCase().replace(/ /g, "-")}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <div className={`p-2 rounded-lg ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data && data.role !== "superadmin" && (
        <Card data-testid="card-free-limit">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Free Account Usage</CardTitle>
            <div className="p-2 rounded-lg text-orange-600 bg-orange-50">
              <Shield className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.freeAccountsUsed} / {data.freeAccountLimit}</div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  data.freeAccountsUsed >= data.freeAccountLimit ? "bg-red-500" : "bg-green-500"
                }`}
                style={{ width: `${Math.min(100, (data.freeAccountsUsed / data.freeAccountLimit) * 100)}%` }}
              />
            </div>
            {data.freeAccountsUsed >= data.freeAccountLimit && (
              <p className="text-xs text-red-500 mt-2">Free limit reached. Contact admin for payment to continue.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

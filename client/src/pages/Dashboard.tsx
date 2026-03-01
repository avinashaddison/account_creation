import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle2, XCircle, Clock, DollarSign, Loader2, Wallet } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";

type DashboardData = {
  stats: { total: number; verified: number; failed: number; pending: number };
  billingTotal: number;
  freeAccountsUsed: number;
  freeAccountLimit: number;
  walletBalance: string;
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

  const walletBalance = parseFloat(data?.walletBalance || "0");

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
        <Card data-testid="card-wallet-balance">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Wallet Balance</CardTitle>
            <div className="p-2 rounded-lg text-green-600 bg-green-50">
              <Wallet className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">${walletBalance.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {walletBalance > 0
                ? `Can create ~${Math.floor(walletBalance / 0.11)} accounts at $0.11 each`
                : "Add funds to your wallet to create accounts"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CheckCircle2, XCircle, Clock, DollarSign } from "lucide-react";

type DashboardData = {
  stats: { total: number; verified: number; failed: number; pending: number };
  billingTotal: number;
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error);
  }, []);

  const cards = [
    { title: "Total Accounts", value: data?.stats.total || 0, icon: Users, color: "text-blue-600 bg-blue-50" },
    { title: "Verified", value: data?.stats.verified || 0, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
    { title: "Failed", value: data?.stats.failed || 0, icon: XCircle, color: "text-red-600 bg-red-50" },
    { title: "In Progress", value: data?.stats.pending || 0, icon: Clock, color: "text-yellow-600 bg-yellow-50" },
    { title: "Total Cost", value: `$${(data?.billingTotal || 0).toFixed(2)}`, icon: DollarSign, color: "text-purple-600 bg-purple-50" },
  ];

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
    </div>
  );
}

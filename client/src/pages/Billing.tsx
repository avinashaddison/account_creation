import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, Receipt, TrendingUp, Loader2 } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";

type BillingRecord = {
  id: string;
  accountId: string;
  amount: string;
  description: string;
  createdAt: string;
};

type BillingData = {
  records: BillingRecord[];
  total: number;
};

export default function Billing() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/billing", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return null; }
        return r.json();
      })
      .then((d) => { if (d) setData(d); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const totalCost = data?.total || 0;
  const totalRecords = data?.records.length || 0;

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
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-billing-title">Billing</h1>
        <p className="text-muted-foreground mt-1">Track costs for account creation ($0.11 per account)</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-total-cost">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Cost</CardTitle>
            <div className="p-2 rounded-lg text-green-600 bg-green-50">
              <DollarSign className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">${totalCost.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-charges">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Charges</CardTitle>
            <div className="p-2 rounded-lg text-blue-600 bg-blue-50">
              <Receipt className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalRecords}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-rate">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rate per Account</CardTitle>
            <div className="p-2 rounded-lg text-purple-600 bg-purple-50">
              <TrendingUp className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">$0.11</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Billing History</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.records.length === 0 ? (
            <p className="text-center text-muted-foreground py-8" data-testid="text-no-billing">No billing records yet</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.records.map((rec, i) => (
                    <TableRow key={rec.id} data-testid={`row-billing-${rec.id}`}>
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell className="text-sm">{rec.description}</TableCell>
                      <TableCell>
                        <span className="font-mono font-medium text-green-600">${parseFloat(rec.amount).toFixed(2)}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(rec.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

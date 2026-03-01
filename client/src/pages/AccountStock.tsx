import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Copy, CheckCircle2, XCircle, Clock, Loader2, Download } from "lucide-react";
import { subscribe } from "@/lib/ws";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

type Account = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  la28Password: string;
  country: string;
  status: string;
  verificationCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "outline" },
  registering: { label: "Registering", variant: "secondary" },
  waiting_code: { label: "Waiting Code", variant: "secondary" },
  verifying: { label: "Verifying", variant: "secondary" },
  verified: { label: "Verified", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

export default function AccountStock() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  function fetchAccounts() {
    setLoading(true);
    fetch("/api/accounts", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        return r.json();
      })
      .then((data) => { setAccounts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    fetchAccounts();
    const unsub = subscribe((msg) => {
      if (msg.type === "account_update") {
        setAccounts((prev) => {
          const idx = prev.findIndex((a) => a.id === msg.account.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = msg.account;
            return updated;
          }
          return [msg.account, ...prev];
        });
      }
    });
    return unsub;
  }, []);

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Copied to clipboard" });
  }

  function exportVerified() {
    const verified = accounts.filter((a) => a.status === "verified");
    if (verified.length === 0) {
      toast({ title: "No data", description: "No verified accounts to export" });
      return;
    }
    const csv = ["Email,Password,Name,Country,Code,Created"]
      .concat(
        verified.map(
          (a) =>
            `${a.email},${a.la28Password},${a.firstName} ${a.lastName},${a.country},${a.verificationCode || ""},${new Date(a.createdAt).toISOString()}`
        )
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `addison-accounts-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "verified": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed": return <XCircle className="w-4 h-4 text-red-500" />;
      case "pending": return <Clock className="w-4 h-4 text-yellow-500" />;
      default: return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    }
  }

  const verified = accounts.filter((a) => a.status === "verified");
  const inProgress = accounts.filter((a) => !["verified", "failed"].includes(a.status));
  const failed = accounts.filter((a) => a.status === "failed");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-account-stock-title">Account Stock</h1>
          <p className="text-muted-foreground mt-1">
            {verified.length} verified, {inProgress.length} in progress, {failed.length} failed
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportVerified} data-testid="button-export-accounts">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={fetchAccounts} data-testid="button-refresh-accounts">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-center text-muted-foreground py-8" data-testid="text-no-accounts">No accounts yet</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Password</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((acc, i) => {
                    const badge = statusBadge[acc.status] || statusBadge.pending;
                    return (
                      <TableRow key={acc.id} data-testid={`row-account-${acc.id}`}>
                        <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(acc.status)}
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{acc.firstName} {acc.lastName}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{acc.email}</code>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{acc.la28Password}</code>
                        </TableCell>
                        <TableCell>
                          {acc.verificationCode ? (
                            <code className="text-xs font-bold text-green-600">{acc.verificationCode}</code>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(acc.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {acc.status === "verified" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(`${acc.email}\t${acc.la28Password}`)}
                              data-testid={`button-copy-${acc.id}`}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

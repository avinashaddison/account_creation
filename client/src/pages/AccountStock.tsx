import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Copy, CheckCircle2, XCircle, Clock, Loader2, Download, Check, RotateCcw, Trophy, UserCheck, Ticket } from "lucide-react";
import { subscribe } from "@/lib/ws";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";

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
  platform: string;
  isUsed: boolean;
  createdAt: string;
};

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "outline" },
  registering: { label: "Registering", variant: "secondary" },
  waiting_code: { label: "Waiting Code", variant: "secondary" },
  verifying: { label: "Verifying", variant: "secondary" },
  verified: { label: "Verified", variant: "default" },
  profile_saving: { label: "Saving Profile", variant: "secondary" },
  draw_registering: { label: "Draw Registration", variant: "secondary" },
  completed: { label: "Draw Registered", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

const platformLabel: Record<string, { name: string; color: string }> = {
  la28: { name: "LA28", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  ticketmaster: { name: "Ticketmaster", color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  uefa: { name: "UEFA", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
};

export default function AccountStock() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = useState<string>("all");
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

  async function toggleUsed(accountId: string) {
    setToggling(accountId);
    try {
      const res = await fetch(`/api/accounts/${accountId}/toggle-used`, {
        method: "PUT",
        credentials: "include",
      });
      if (res.ok) {
        const updated = await res.json();
        setAccounts((prev) => prev.map((a) => a.id === accountId ? updated : a));
        toast({ title: updated.isUsed ? "Marked as used" : "Marked as available" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    } finally {
      setToggling(null);
    }
  }

  function exportVerified() {
    const verified = accounts.filter((a) => a.status === "verified" || a.status === "completed");
    if (verified.length === 0) {
      toast({ title: "No data", description: "No verified accounts to export" });
      return;
    }
    const csv = ["Platform,Email,Password,Name,Country,Code,Status,Created"]
      .concat(
        verified.map(
          (a) =>
            `${(platformLabel[a.platform]?.name || a.platform)},${a.email},${a.la28Password},${a.firstName} ${a.lastName},${a.country},${a.verificationCode || ""},${a.isUsed ? "Used" : "Available"},${new Date(a.createdAt).toISOString()}`
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
      case "completed": return <Trophy className="w-4 h-4 text-emerald-400" />;
      case "verified": return <CheckCircle2 className="w-4 h-4 text-teal-400" />;
      case "profile_saving": return <UserCheck className="w-4 h-4 text-blue-400 animate-pulse" />;
      case "draw_registering": return <Ticket className="w-4 h-4 text-violet-400 animate-pulse" />;
      case "failed": return <XCircle className="w-4 h-4 text-red-400" />;
      case "pending": return <Clock className="w-4 h-4 text-amber-400" />;
      default: return <Loader2 className="w-4 h-4 text-red-400 animate-spin" />;
    }
  }

  const verified = accounts.filter((a) => a.status === "verified" || a.status === "completed");
  const inProgress = accounts.filter((a) => !["verified", "completed", "failed"].includes(a.status));
  const failed = accounts.filter((a) => a.status === "failed");

  const filteredAccounts = platformFilter === "all"
    ? accounts
    : accounts.filter((a) => a.platform === platformFilter);

  const availableAccounts = filteredAccounts.filter((a) => !a.isUsed && (a.status === "verified" || a.status === "completed"));
  const usedAccounts = filteredAccounts.filter((a) => a.isUsed && (a.status === "verified" || a.status === "completed"));
  const otherAccounts = filteredAccounts.filter((a) => a.status !== "verified" && a.status !== "completed");

  const platforms = [...new Set(accounts.map((a) => a.platform))];

  function renderTable(items: Account[], showToggle: boolean, toggleLabel: string, toggleIcon: React.ReactNode) {
    if (items.length === 0) {
      return (
        <p className="text-center text-zinc-500 py-8" data-testid="text-no-accounts">No accounts in this category</p>
      );
    }
    return (
      <div className="rounded-md border border-white/5 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/5 hover:bg-transparent">
              <TableHead className="w-8 text-zinc-500">#</TableHead>
              <TableHead className="text-zinc-500">Status</TableHead>
              <TableHead className="text-zinc-500">Platform</TableHead>
              <TableHead className="text-zinc-500">Name</TableHead>
              <TableHead className="text-zinc-500">Email</TableHead>
              <TableHead className="text-zinc-500">Password</TableHead>
              <TableHead className="text-zinc-500">Code</TableHead>
              <TableHead className="text-zinc-500">Created</TableHead>
              <TableHead className="w-24 text-zinc-500">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((acc, i) => {
              const badge = statusBadge[acc.status] || statusBadge.pending;
              const plat = platformLabel[acc.platform] || { name: acc.platform, color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" };
              return (
                <TableRow key={acc.id} className="border-white/5 hover:bg-white/[0.02]" data-testid={`row-account-${acc.id}`}>
                  <TableCell className="text-zinc-600 text-xs">{i + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(acc.status)}
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-[10px] ${plat.color} hover:opacity-80`} data-testid={`badge-platform-${acc.id}`}>
                      {plat.name}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-zinc-200">{acc.firstName} {acc.lastName}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded text-zinc-300">{acc.email}</code>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded text-zinc-300">{acc.la28Password}</code>
                  </TableCell>
                  <TableCell>
                    {acc.verificationCode ? (
                      <code className="text-xs font-bold text-emerald-400">{acc.verificationCode}</code>
                    ) : (
                      <span className="text-xs text-zinc-600">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">
                    {new Date(acc.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {(acc.status === "verified" || acc.status === "completed") && showToggle && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => { sounds.toggle(); toggleUsed(acc.id); }}
                          disabled={toggling === acc.id}
                          data-testid={`button-toggle-${acc.id}`}
                        >
                          {toggling === acc.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            toggleIcon
                          )}
                          <span className="ml-1">{toggleLabel}</span>
                        </Button>
                      )}
                      {(acc.status === "verified" || acc.status === "completed") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => { sounds.click(); copyToClipboard(`${acc.email}\t${acc.la28Password}`); }}
                          data-testid={`button-copy-${acc.id}`}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-account-stock-title">Account Stock</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            {verified.length} verified, {inProgress.length} in progress, {failed.length} failed
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportVerified} className="border-white/10 text-zinc-300 hover:bg-white/5" data-testid="button-export-accounts">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={fetchAccounts} className="border-white/10 text-zinc-300 hover:bg-white/5" data-testid="button-refresh-accounts">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-500 uppercase tracking-wider mr-1">Filter:</span>
        <Button
          variant={platformFilter === "all" ? "default" : "outline"}
          size="sm"
          className={`h-7 text-xs ${platformFilter === "all" ? "bg-red-600 hover:bg-red-700" : "border-white/10 text-zinc-400 hover:bg-white/5"}`}
          onClick={() => setPlatformFilter("all")}
          data-testid="filter-all"
        >
          All ({accounts.length})
        </Button>
        {platforms.map((p) => {
          const plat = platformLabel[p] || { name: p, color: "" };
          const cnt = accounts.filter((a) => a.platform === p).length;
          return (
            <Button
              key={p}
              variant={platformFilter === p ? "default" : "outline"}
              size="sm"
              className={`h-7 text-xs ${platformFilter === p ? "bg-red-600 hover:bg-red-700" : "border-white/10 text-zinc-400 hover:bg-white/5"}`}
              onClick={() => setPlatformFilter(p)}
              data-testid={`filter-${p}`}
            >
              {plat.name} ({cnt})
            </Button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
        </div>
      ) : (
        <Tabs defaultValue="available" className="space-y-4">
          <TabsList className="bg-[#111118] border border-white/5">
            <TabsTrigger value="available" className="data-[state=active]:bg-emerald-600/20 data-[state=active]:text-emerald-400" data-testid="tab-available">
              Available ({availableAccounts.length})
            </TabsTrigger>
            <TabsTrigger value="used" className="data-[state=active]:bg-amber-600/20 data-[state=active]:text-amber-400" data-testid="tab-used">
              Used ({usedAccounts.length})
            </TabsTrigger>
            <TabsTrigger value="other" className="data-[state=active]:bg-zinc-600/20 data-[state=active]:text-zinc-300" data-testid="tab-other">
              Other ({otherAccounts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="available">
            <Card className="bg-[#111118] border-white/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-zinc-400">Available Accounts</CardTitle>
              </CardHeader>
              <CardContent>
                {renderTable(
                  availableAccounts,
                  true,
                  "Use",
                  <Check className="w-3.5 h-3.5 text-amber-400" />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="used">
            <Card className="bg-[#111118] border-white/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-zinc-400">Used Accounts</CardTitle>
              </CardHeader>
              <CardContent>
                {renderTable(
                  usedAccounts,
                  true,
                  "Undo",
                  <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="other">
            <Card className="bg-[#111118] border-white/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-zinc-400">Pending, In Progress & Failed</CardTitle>
              </CardHeader>
              <CardContent>
                {renderTable(
                  otherAccounts,
                  false,
                  "",
                  null
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

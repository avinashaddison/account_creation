import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Copy, CheckCircle2, XCircle, Clock, Loader2, Download, Check, RotateCcw, Trophy, UserCheck, Ticket, Database } from "lucide-react";
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
  zipCode: string | null;
  status: string;
  verificationCode: string | null;
  errorMessage: string | null;
  platform: string;
  isUsed: boolean;
  createdAt: string;
};

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "PENDING", variant: "outline" },
  registering: { label: "REGISTER", variant: "secondary" },
  waiting_code: { label: "WAIT_CODE", variant: "secondary" },
  verifying: { label: "VERIFY", variant: "secondary" },
  verified: { label: "VERIFIED", variant: "default" },
  profile_saving: { label: "PROFILE", variant: "secondary" },
  draw_registering: { label: "DRAW_REG", variant: "secondary" },
  completed: { label: "DRAW_OK", variant: "default" },
  failed: { label: "FAILED", variant: "destructive" },
};

const platformLabel: Record<string, { name: string; color: string }> = {
  la28: { name: "LA28", color: "bg-red-500/8 text-red-400 border-red-500/15" },
  ticketmaster: { name: "TM", color: "bg-sky-500/8 text-sky-400 border-sky-500/15" },
  uefa: { name: "UEFA", color: "bg-emerald-500/8 text-emerald-400 border-emerald-500/15" },
  brunomars: { name: "BM", color: "bg-purple-500/8 text-purple-400 border-purple-500/15" },
};

export default function AccountStock() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
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

  async function retryDraw(accountId: string) {
    setRetrying(accountId);
    try {
      const res = await fetch(`/api/accounts/${accountId}/retry-draw`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Draw Retry", description: "Draw registration re-queued." });
        setAccounts((prev) => prev.map((a) => a.id === accountId ? { ...a, status: "draw_registering" } : a));
      } else {
        toast({ title: "Error", description: data.error || "Failed to retry", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to retry draw", variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  }

  function exportVerified() {
    const verified = accounts.filter((a) => a.status === "verified" || a.status === "completed");
    if (verified.length === 0) {
      toast({ title: "No data", description: "No verified accounts to export" });
      return;
    }
    const csv = ["Platform,Email,Password,Name,Country,PostalCode,Code,Status,Created"]
      .concat(
        verified.map(
          (a) =>
            `${(platformLabel[a.platform]?.name || a.platform)},${a.email},${a.la28Password},${a.firstName} ${a.lastName},${a.country},${a.zipCode || ""},${a.verificationCode || ""},${a.isUsed ? "Used" : "Available"},${new Date(a.createdAt).toISOString()}`
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
      case "completed": return <Trophy className="w-3.5 h-3.5 text-emerald-400" />;
      case "verified": return <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />;
      case "profile_saving": return <UserCheck className="w-3.5 h-3.5 text-blue-400 animate-pulse" />;
      case "draw_registering": return <Ticket className="w-3.5 h-3.5 text-violet-400 animate-pulse" />;
      case "failed": return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      case "pending": return <Clock className="w-3.5 h-3.5 text-amber-400" />;
      default: return <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin" />;
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
        <div className="text-center py-8 font-mono" data-testid="text-no-accounts">
          <p className="text-cyan-400/20 text-[11px]">[ No records in this category ]</p>
        </div>
      );
    }
    return (
      <div className="rounded-md overflow-x-auto" style={{ border: '1px solid rgba(0,240,255,0.06)' }}>
        <Table>
          <TableHeader>
            <TableRow className="border-cyan-500/[0.06] hover:bg-transparent">
              <TableHead className="w-8 text-cyan-400/25 font-mono text-[10px]">#</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Status</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Module</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Identity</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Email</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Zip</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Passkey</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Code</TableHead>
              <TableHead className="text-cyan-400/25 font-mono text-[10px]">Timestamp</TableHead>
              <TableHead className="w-24 text-cyan-400/25 font-mono text-[10px]">Ops</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((acc, i) => {
              const badge = statusBadge[acc.status] || statusBadge.pending;
              const plat = platformLabel[acc.platform] || { name: acc.platform, color: "bg-zinc-500/8 text-zinc-400 border-zinc-500/15" };
              return (
                <TableRow key={acc.id} className="border-cyan-500/[0.04] hover:bg-cyan-500/[0.02]" data-testid={`row-account-${acc.id}`}>
                  <TableCell className="text-zinc-600 text-[10px] font-mono">{i + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {getStatusIcon(acc.status)}
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${
                        acc.status === "completed" ? "bg-emerald-400/8 text-emerald-400 border-emerald-400/15" :
                        acc.status === "verified" ? "bg-cyan-400/8 text-cyan-400 border-cyan-400/15" :
                        acc.status === "failed" ? "bg-red-400/8 text-red-400 border-red-400/15" :
                        "bg-amber-400/8 text-amber-400 border-amber-400/15"
                      }`}>{badge.label}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${plat.color}`} data-testid={`badge-platform-${acc.id}`}>
                      {plat.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-zinc-300">{acc.firstName} {acc.lastName}</TableCell>
                  <TableCell>
                    <code className="text-[10px] text-cyan-400/50 font-mono">{acc.email}</code>
                  </TableCell>
                  <TableCell>
                    {acc.zipCode ? (
                      <code className="text-[10px] text-zinc-400 font-mono" data-testid={`text-zip-${acc.id}`}>{acc.zipCode}</code>
                    ) : (
                      <span className="text-[10px] text-zinc-700 font-mono">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="text-[10px] text-zinc-400 font-mono">{acc.la28Password}</code>
                  </TableCell>
                  <TableCell>
                    {acc.verificationCode ? (
                      <code className="text-[10px] font-bold text-emerald-400 font-mono">{acc.verificationCode}</code>
                    ) : (
                      <span className="text-[10px] text-zinc-700 font-mono">--</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[10px] text-zinc-600 font-mono">
                    {new Date(acc.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      {acc.platform === "la28" && ["verified", "profile_saving", "draw_registering"].includes(acc.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/8 font-mono"
                          onClick={() => { sounds.click(); retryDraw(acc.id); }}
                          disabled={retrying === acc.id}
                          data-testid={`button-retry-draw-${acc.id}`}
                        >
                          {retrying === acc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        </Button>
                      )}
                      {(acc.status === "verified" || acc.status === "completed") && showToggle && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px] font-mono"
                          onClick={() => { sounds.toggle(); toggleUsed(acc.id); }}
                          disabled={toggling === acc.id}
                          data-testid={`button-toggle-${acc.id}`}
                        >
                          {toggling === acc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : toggleIcon}
                        </Button>
                      )}
                      {(acc.status === "verified" || acc.status === "completed") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-cyan-400/30 hover:text-cyan-400"
                          onClick={() => { sounds.click(); copyToClipboard(`${acc.email}\t${acc.la28Password}`); }}
                          data-testid={`button-copy-${acc.id}`}
                        >
                          <Copy className="w-3 h-3" />
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
    <div className="space-y-5 animate-float-up">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-cyan-400/50" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono" data-testid="text-account-stock-title">
              Account<span className="text-cyan-400">_</span>Stock
            </h1>
          </div>
          <p className="text-cyan-400/30 mt-1 text-[11px] font-mono pl-7.5">
            {verified.length} verified / {inProgress.length} active / {failed.length} failed
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportVerified} className="border-cyan-500/15 text-cyan-400/60 hover:bg-cyan-500/5 hover:text-cyan-400 hover:border-cyan-500/25 font-mono text-[11px] h-8" data-testid="button-export-accounts">
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Export
          </Button>
          <Button variant="outline" onClick={fetchAccounts} className="border-cyan-500/15 text-cyan-400/60 hover:bg-cyan-500/5 hover:text-cyan-400 hover:border-cyan-500/25 font-mono text-[11px] h-8" data-testid="button-refresh-accounts">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Sync
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[9px] text-cyan-400/20 font-mono uppercase tracking-wider mr-1">Filter:</span>
        <Button
          variant={platformFilter === "all" ? "default" : "outline"}
          size="sm"
          className={`h-6 text-[10px] font-mono ${platformFilter === "all" ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/25 hover:bg-cyan-500/20" : "border-cyan-500/10 text-zinc-500 hover:bg-cyan-500/[0.03] hover:text-zinc-400"}`}
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
              className={`h-6 text-[10px] font-mono ${platformFilter === p ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/25 hover:bg-cyan-500/20" : "border-cyan-500/10 text-zinc-500 hover:bg-cyan-500/[0.03] hover:text-zinc-400"}`}
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
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400/40" />
        </div>
      ) : (
        <Tabs defaultValue="available" className="space-y-3">
          <TabsList className="bg-black/30 border border-cyan-500/[0.08]">
            <TabsTrigger value="available" className="data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 font-mono text-[11px]" data-testid="tab-available">
              Available ({availableAccounts.length})
            </TabsTrigger>
            <TabsTrigger value="used" className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 font-mono text-[11px]" data-testid="tab-used">
              Used ({usedAccounts.length})
            </TabsTrigger>
            <TabsTrigger value="other" className="data-[state=active]:bg-zinc-500/10 data-[state=active]:text-zinc-300 font-mono text-[11px]" data-testid="tab-other">
              Other ({otherAccounts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="available">
            <div className="cyber-card rounded-lg">
              <div className="px-4 py-3 border-b border-cyan-500/[0.06]">
                <span className="text-[9px] font-mono text-cyan-400/30 uppercase tracking-wider">Available Records</span>
              </div>
              <div className="p-3">
                {renderTable(availableAccounts, true, "Use", <Check className="w-3 h-3 text-amber-400" />)}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="used">
            <div className="cyber-card rounded-lg">
              <div className="px-4 py-3 border-b border-cyan-500/[0.06]">
                <span className="text-[9px] font-mono text-cyan-400/30 uppercase tracking-wider">Used Records</span>
              </div>
              <div className="p-3">
                {renderTable(usedAccounts, true, "Undo", <RotateCcw className="w-3 h-3 text-emerald-400" />)}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="other">
            <div className="cyber-card rounded-lg">
              <div className="px-4 py-3 border-b border-cyan-500/[0.06]">
                <span className="text-[9px] font-mono text-cyan-400/30 uppercase tracking-wider">Pending / Active / Failed</span>
              </div>
              <div className="p-3">
                {renderTable(otherAccounts, false, "", null)}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

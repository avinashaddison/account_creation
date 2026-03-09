import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { handleUnauthorized } from "@/lib/auth";
import { useAccountPrice } from "@/lib/useAccountPrice";
import { subscribe } from "@/lib/ws";
import {
  Rocket, ArrowLeft, Hash, DollarSign, Loader2, CheckCircle2, XCircle,
  Terminal, Music, Globe, Filter, Clock, Shield, Wallet
} from "lucide-react";

const QUICK_AMOUNTS = [1, 3, 5, 10, 25];

type LogEntry = { accountId: string; message: string; timestamp: string };
type BatchAccount = { id: string; email: string; firstName: string; lastName: string; status: string };

function getLogColor(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("error") || m.includes("failed") || m.includes("fail")) return "text-red-400";
  if (m.includes("completed") || m.includes("success") || m.includes("signed up")) return "text-emerald-400";
  if (m.includes("selecting") || m.includes("event")) return "text-amber-400";
  if (m.includes("form") || m.includes("filling") || m.includes("submit")) return "text-blue-400";
  if (m.includes("navigat") || m.includes("connect") || m.includes("loading") || m.includes("browser")) return "text-cyan-400";
  if (m.includes("status:")) return "text-sky-400";
  if (m.includes("starting") || m.includes("creating")) return "text-zinc-300";
  return "text-zinc-500";
}

function getStepInfo(status: string): { label: string; color: string; icon: React.ReactNode } {
  switch (status) {
    case "completed": return { label: "Signed Up", color: "text-emerald-400", icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
    case "failed": return { label: "Failed", color: "text-red-400", icon: <XCircle className="w-3.5 h-3.5" /> };
    case "registering": return { label: "Loading Page", color: "text-cyan-400", icon: <Globe className="w-3.5 h-3.5" /> };
    case "filling_form": return { label: "Filling Form", color: "text-blue-400", icon: <Shield className="w-3.5 h-3.5" /> };
    case "selecting_events": return { label: "Selecting Events", color: "text-amber-400", icon: <Music className="w-3.5 h-3.5" /> };
    case "submitting": return { label: "Submitting", color: "text-violet-400", icon: <Rocket className="w-3.5 h-3.5" /> };
    case "pending": return { label: "Queued", color: "text-zinc-500", icon: <Clock className="w-3.5 h-3.5" /> };
    default: return { label: "Processing", color: "text-sky-400", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> };
  }
}

export default function BrunoMarsCreate() {
  const [count, setCount] = useState(1);
  const [proxyUrl, setProxyUrl] = useState("wss://brd-customer-hl_86b34e68-zone-scraping_browser1:xov21cay1g29@brd.superproxy.io:9222");
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BatchAccount[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const [userRole, setUserRole] = useState<string>("");
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const batchIdRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()).then(d => {
      if (d.role) setUserRole(d.role);
      if (d.walletBalance) setWalletBalance(parseFloat(d.walletBalance));
    }).catch(() => {});
  }, []);
  const { toast } = useToast();

  const accountPrice = useAccountPrice();
  const estimatedCost = (count * accountPrice).toFixed(2);

  useEffect(() => {
    const unsub = subscribe((data) => {
      if (data.type === "log" && data.batchId === batchIdRef.current) {
        setLogs((prev) => [...prev, { accountId: data.accountId, message: data.message, timestamp: data.timestamp }]);
      } else if (data.type === "account_update" && data.batchId === batchIdRef.current && data.account) {
        setAccounts((prev) => prev.map((a) => a.id === data.account.id ? { ...a, status: data.account.status } : a));
      } else if (data.type === "batch_complete" && data.batchId === batchIdRef.current) {
        setIsRunning(false);
        toast({ title: "Batch Complete", description: "All Bruno Mars signups finished." });
        fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()).then(d => {
          if (d.walletBalance) setWalletBalance(parseFloat(d.walletBalance));
        }).catch(() => {});
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, filterAccountId]);

  async function startBatch() {
    setIsRunning(true);
    setError("");
    setLogs([]);
    setAccounts([]);
    setBatchId(null);
    batchIdRef.current = null;
    setFilterAccountId(null);

    try {
      const res = await fetch("/api/brunomars-create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ count, proxyUrl: proxyUrl || undefined }),
      });

      if (res.status === 401) { handleUnauthorized(); return; }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start batch");
        setIsRunning(false);
        return;
      }

      setBatchId(data.batchId);
      batchIdRef.current = data.batchId;
      setAccounts(data.accounts.map((a: any) => ({
        id: a.id, email: a.email, firstName: a.firstName, lastName: a.lastName, status: a.status,
      })));
      setWalletBalance(prev => prev - count * accountPrice);

      setTimeout(async () => {
        try {
          const logsRes = await fetch(`/api/batch-logs/${data.batchId}`, { credentials: "include" });
          if (logsRes.ok) {
            const logsData = await logsRes.json();
            if (logsData.logs?.length) {
              setLogs((prev) => {
                const existing = new Set(prev.map(l => l.timestamp + l.message));
                const newLogs = logsData.logs.filter((l: any) => !existing.has(l.timestamp + l.message));
                return [...prev, ...newLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
              });
            }
          }
        } catch {}
      }, 1000);
    } catch (err: any) {
      setError(err.message);
      setIsRunning(false);
    }
  }

  const filteredLogs = filterAccountId
    ? logs.filter(l => l.accountId === filterAccountId)
    : logs;

  const completed = accounts.filter(a => a.status === "completed").length;
  const failed = accounts.filter(a => a.status === "failed").length;
  const processing = accounts.filter(a => !["completed", "failed", "pending"].includes(a.status)).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/admin/create-server">
          <div className="p-2 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors" data-testid="button-back-brunomars">
            <ArrowLeft className="w-4 h-4" />
          </div>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-brunomars-title">TM - Bruno Mars</h1>
            <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/15 text-[10px]">Presale</Badge>
          </div>
          <p className="text-zinc-500 text-sm mt-0.5">Automated presale signup on signup.ticketmaster.ca/brunomars</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
          <Wallet className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-400" data-testid="text-brunomars-wallet">${walletBalance.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-xl bg-[#111118] border border-white/5 p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white">
                <Rocket className="w-3.5 h-3.5" />
              </div>
              <span className="text-sm font-semibold text-zinc-200">Configuration</span>
            </div>

            <div className="space-y-4">
              {userRole === "superadmin" && (
              <div className="space-y-2">
                <Label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3 h-3" /> Browser API Proxy
                </Label>
                <Input
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  disabled={isRunning}
                  placeholder="wss://... Browser API URL"
                  className="h-8 text-xs bg-white/[0.02] border-white/5 text-zinc-300 placeholder:text-zinc-600 font-mono"
                  data-testid="input-brunomars-proxy"
                />
              </div>
              )}

              <div className="space-y-2">
                <Label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3 h-3" /> Signups
                </Label>
                <div className="flex gap-1.5">
                  {QUICK_AMOUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      disabled={isRunning}
                      className={`flex-1 h-8 text-xs font-semibold rounded-lg border transition-all ${
                        count === n
                          ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 border-purple-500/30 text-white shadow-lg shadow-purple-500/20"
                          : "bg-white/[0.02] border-white/5 text-zinc-400 hover:bg-white/5 hover:text-zinc-300"
                      } disabled:opacity-50`}
                      data-testid={`button-brunomars-count-${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={100}
                  placeholder="Custom amount"
                  disabled={isRunning}
                  className="h-8 text-xs bg-white/[0.02] border-white/5 text-zinc-300"
                  data-testid="input-brunomars-custom-count"
                />
              </div>

              <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Signups</span>
                  <span className="font-semibold text-zinc-300">{count}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Price/signup</span>
                  <span className="text-zinc-400">${accountPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-white/5 pt-1.5">
                  <span className="font-semibold text-zinc-300 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Total
                  </span>
                  <span className="font-bold text-base bg-gradient-to-r from-purple-400 to-fuchsia-400 bg-clip-text text-transparent">${estimatedCost}</span>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400" data-testid="text-brunomars-error">
                  {error}
                </div>
              )}

              <Button
                onClick={startBatch}
                disabled={isRunning || count < 1}
                className="w-full h-10 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 text-white font-semibold shadow-lg shadow-purple-500/20"
                data-testid="button-start-brunomars"
              >
                {isRunning ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running...</>
                ) : (
                  <><Music className="w-4 h-4 mr-2" /> Start Signup ({count})</>
                )}
              </Button>
            </div>
          </div>

          {accounts.length > 0 && (
            <div className="rounded-xl bg-[#111118] border border-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Signups ({accounts.length})</p>
                <div className="flex gap-2 text-[10px]">
                  {completed > 0 && <span className="text-emerald-400">{completed} done</span>}
                  {processing > 0 && <span className="text-purple-400">{processing} active</span>}
                  {failed > 0 && <span className="text-red-400">{failed} failed</span>}
                </div>
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => setFilterAccountId(null)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                    !filterAccountId ? "bg-purple-500/10 border border-purple-500/20 text-purple-300" : "hover:bg-white/5 text-zinc-500 border border-transparent"
                  }`}
                  data-testid="button-brunomars-filter-all"
                >
                  <Filter className="w-3 h-3" />
                  All Logs
                  <span className="ml-auto text-[10px] text-zinc-600">{logs.length}</span>
                </button>
                {accounts.map((acc) => {
                  const { label, color, icon } = getStepInfo(acc.status);
                  const acctLogCount = logs.filter(l => l.accountId === acc.id).length;
                  const isSelected = filterAccountId === acc.id;
                  return (
                    <button
                      key={acc.id}
                      onClick={() => setFilterAccountId(isSelected ? null : acc.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all ${
                        isSelected ? "bg-purple-500/10 border border-purple-500/20" : "hover:bg-white/5 border border-transparent"
                      }`}
                      data-testid={`button-brunomars-filter-${acc.id}`}
                    >
                      <div className={color}>{icon}</div>
                      <div className="min-w-0 text-left flex-1">
                        <p className="font-medium text-zinc-300 truncate">{acc.firstName} {acc.lastName}</p>
                        <p className={`text-[10px] ${color}`}>{label}</p>
                      </div>
                      <span className="text-[10px] text-zinc-600">{acctLogCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-8">
          <div className="rounded-xl bg-[#0a0a0f] border border-white/5 overflow-hidden flex flex-col" style={{ height: accounts.length > 0 ? "calc(100vh - 160px)" : "500px" }}>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.02] border-b border-white/5">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-semibold text-zinc-400">Live Output</span>
              {filterAccountId && (
                <Badge className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20">
                  Filtered: {accounts.find(a => a.id === filterAccountId)?.firstName || "Account"}
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                {batchId && (
                  <Badge className="text-[10px] bg-white/5 text-zinc-500 border-white/10">
                    Batch: {batchId.substring(0, 8)}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {filteredLogs.length} entries
                </Badge>
              </div>
            </div>

            {isRunning && accounts.length > 0 && (
              <div className="px-4 py-2 border-b border-white/5 bg-white/[0.01]">
                <div className="flex items-center gap-3 text-[10px]">
                  {accounts.map((acc) => {
                    const isDone = acc.status === "completed";
                    const isFailed = acc.status === "failed";
                    const isCurrent = !isDone && !isFailed && acc.status !== "pending";
                    return (
                      <div key={acc.id} className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${isDone ? "bg-emerald-400" : isFailed ? "bg-red-400" : isCurrent ? "bg-purple-400 animate-pulse" : "bg-zinc-700"}`} />
                        <span className={isDone ? "text-emerald-400" : isFailed ? "text-red-400" : isCurrent ? "text-purple-300" : "text-zinc-600"}>
                          {acc.firstName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <ScrollArea className="flex-1">
              <div ref={scrollRef} className="p-4 space-y-0.5 font-mono text-[11px]">
                {filteredLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-zinc-600 text-sm gap-3">
                    {isRunning ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                        <span className="text-zinc-500">Starting signup process...</span>
                      </>
                    ) : (
                      <>
                        <Terminal className="w-10 h-10 text-zinc-800" />
                        <span className="text-zinc-600">Logs will appear here when you start signups</span>
                        <span className="text-zinc-700 text-xs">Each signup goes through: Load Page &rarr; Fill Form &rarr; Select Events &rarr; Submit</span>
                      </>
                    )}
                  </div>
                ) : (
                  filteredLogs.map((log, i) => {
                    const acct = accounts.find(a => a.id === log.accountId);
                    return (
                      <div key={i} className="flex gap-2 py-0.5 leading-relaxed group hover:bg-white/[0.02] px-1 -mx-1 rounded" data-testid={`log-brunomars-${i}`}>
                        <span className="text-zinc-700 shrink-0 select-none w-[72px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        {!filterAccountId && accounts.length > 1 && acct && (
                          <span className="text-zinc-600 shrink-0 w-[60px] truncate">[{acct.firstName}]</span>
                        )}
                        <span className={getLogColor(log.message)}>{log.message}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}

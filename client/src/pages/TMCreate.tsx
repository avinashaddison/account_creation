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
  Terminal, Ticket, AlertTriangle, Globe, Filter, User, Mail, Phone,
  Shield, Clock, ChevronDown, Copy, Wallet
} from "lucide-react";

const QUICK_AMOUNTS = [1, 3, 5, 10];

type LogEntry = { accountId: string; message: string; timestamp: string };
type BatchAccount = { id: string; email: string; firstName: string; lastName: string; status: string };

function getLogColor(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("error") || m.includes("failed") || m.includes("fail")) return "text-red-400";
  if (m.includes("verified") || m.includes("success") || m.includes("phone verification completed")) return "text-emerald-400";
  if (m.includes("code") || m.includes("otp") || m.includes("sms")) return "text-amber-400";
  if (m.includes("phone") || m.includes("smspool")) return "text-violet-400";
  if (m.includes("email") || m.includes("mail")) return "text-sky-400";
  if (m.includes("password") || m.includes("form") || m.includes("filled") || m.includes("submit")) return "text-blue-400";
  if (m.includes("navigat") || m.includes("connect") || m.includes("browser")) return "text-cyan-400";
  if (m.includes("status:")) return "text-sky-400";
  if (m.includes("starting") || m.includes("creating")) return "text-zinc-300";
  return "text-zinc-500";
}

function getStepFromLogs(logs: LogEntry[], accountId: string): { step: string; color: string; icon: React.ReactNode } {
  const acctLogs = logs.filter(l => l.accountId === accountId);
  if (acctLogs.length === 0) return { step: "Queued", color: "text-zinc-500", icon: <Clock className="w-3.5 h-3.5" /> };
  const last = acctLogs[acctLogs.length - 1].message.toLowerCase();
  if (last.includes("verified") || last.includes("success") || last.includes("phone verification completed")) return { step: "Verified", color: "text-emerald-400", icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  if (last.includes("failed") || last.includes("error")) return { step: "Failed", color: "text-red-400", icon: <XCircle className="w-3.5 h-3.5" /> };
  if (last.includes("phone") || last.includes("sms")) return { step: "Phone Verify", color: "text-violet-400", icon: <Phone className="w-3.5 h-3.5" /> };
  if (last.includes("code") || last.includes("otp")) return { step: "Email Verify", color: "text-amber-400", icon: <Mail className="w-3.5 h-3.5" /> };
  if (last.includes("password") || last.includes("submit") || last.includes("form")) return { step: "Registering", color: "text-blue-400", icon: <Shield className="w-3.5 h-3.5" /> };
  if (last.includes("navigat") || last.includes("connect")) return { step: "Connecting", color: "text-cyan-400", icon: <Globe className="w-3.5 h-3.5" /> };
  return { step: "Processing", color: "text-sky-400", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> };
}

export default function TMCreate() {
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
        toast({ title: "Batch Complete", description: "All TM accounts have been processed." });
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

  async function startBatch(numAccounts: number) {
    setError("");
    setLogs([]);
    setAccounts([]);
    setBatchId(null);
    batchIdRef.current = null;
    setFilterAccountId(null);
    setIsRunning(true);

    try {
      const res = await fetch("/api/tm-create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: numAccounts, proxyUrl: proxyUrl || undefined }),
        credentials: "include",
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
      setAccounts(data.accounts.map((a: any) => ({ id: a.id, email: a.email, firstName: a.firstName, lastName: a.lastName, status: a.status })));
      setWalletBalance(prev => prev - numAccounts * accountPrice);

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

  const verified = accounts.filter(a => a.status === "verified").length;
  const failed = accounts.filter(a => a.status === "failed").length;
  const processing = accounts.filter(a => a.status !== "verified" && a.status !== "failed" && a.status !== "pending").length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/admin/create-server">
          <div className="p-2 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors" data-testid="link-back-to-servers">
            <ArrowLeft className="w-4 h-4" />
          </div>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-tm-create-title">Ticketmaster Account Creator</h1>
            <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/15 text-[10px]">TM</Badge>
          </div>
          <p className="text-zinc-500 text-sm mt-0.5">Automated Ticketmaster registration with email + phone verification</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
          <Wallet className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-sm font-semibold text-emerald-400" data-testid="text-tm-wallet">${walletBalance.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-xl bg-[#111118] border border-white/5 p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white">
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
                  data-testid="input-tm-proxy"
                />
              </div>
              )}

              <div className="space-y-2">
                <Label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3 h-3" /> Accounts
                </Label>
                <div className="flex gap-1.5">
                  {QUICK_AMOUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      disabled={isRunning}
                      className={`flex-1 h-8 text-xs font-semibold rounded-lg border transition-all ${
                        count === n
                          ? "bg-gradient-to-r from-sky-600 to-blue-600 border-sky-500/30 text-white shadow-lg shadow-sky-500/20"
                          : "bg-white/[0.02] border-white/5 text-zinc-400 hover:bg-white/5 hover:text-zinc-300"
                      } disabled:opacity-50`}
                      data-testid={`button-tm-count-${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={30}
                  disabled={isRunning}
                  className="h-8 text-xs bg-white/[0.02] border-white/5 text-zinc-300"
                  data-testid="input-tm-custom-count"
                />
              </div>

              <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Accounts</span>
                  <span className="font-semibold text-zinc-300">{count}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Price/account</span>
                  <span className="text-zinc-400">${accountPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-white/5 pt-1.5">
                  <span className="font-semibold text-zinc-300 flex items-center gap-1">
                    <DollarSign className="w-3 h-3" /> Total
                  </span>
                  <span className="font-bold text-base bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">${estimatedCost}</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400" data-testid="text-tm-batch-error">
                  {error}
                </div>
              )}

              <Button
                className="w-full h-10 text-sm font-semibold bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-700 hover:to-blue-700 shadow-lg shadow-sky-500/20 border-0"
                onClick={() => startBatch(count)}
                disabled={isRunning}
                data-testid="button-tm-start-batch"
              >
                {isRunning ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
                ) : (
                  <><Ticket className="w-4 h-4 mr-2" />Create {count} TM Account{count > 1 ? "s" : ""}</>
                )}
              </Button>
            </div>
          </div>

          {accounts.length > 0 && (
            <div className="rounded-xl bg-[#111118] border border-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Accounts ({accounts.length})</p>
                <div className="flex gap-2 text-[10px]">
                  {verified > 0 && <span className="text-emerald-400">{verified} done</span>}
                  {processing > 0 && <span className="text-sky-400">{processing} active</span>}
                  {failed > 0 && <span className="text-red-400">{failed} failed</span>}
                </div>
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => setFilterAccountId(null)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                    !filterAccountId ? "bg-sky-500/10 border border-sky-500/20 text-sky-300" : "hover:bg-white/5 text-zinc-500 border border-transparent"
                  }`}
                  data-testid="button-tm-filter-all"
                >
                  <Filter className="w-3 h-3" />
                  All Logs
                  <span className="ml-auto text-[10px] text-zinc-600">{logs.length}</span>
                </button>
                {accounts.map((acc) => {
                  const { step, color, icon } = getStepFromLogs(logs, acc.id);
                  const acctLogCount = logs.filter(l => l.accountId === acc.id).length;
                  const isSelected = filterAccountId === acc.id;
                  const isFinal = acc.status === "verified" || acc.status === "failed";
                  return (
                    <button
                      key={acc.id}
                      onClick={() => setFilterAccountId(isSelected ? null : acc.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all ${
                        isSelected ? "bg-sky-500/10 border border-sky-500/20" : "hover:bg-white/5 border border-transparent"
                      }`}
                      data-testid={`button-tm-filter-${acc.id}`}
                    >
                      <div className={color}>{icon}</div>
                      <div className="min-w-0 text-left flex-1">
                        <p className="font-medium text-zinc-300 truncate">{acc.firstName} {acc.lastName}</p>
                        <p className={`text-[10px] ${color}`}>{isFinal ? acc.status.charAt(0).toUpperCase() + acc.status.slice(1) : step}</p>
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
              <Terminal className="w-4 h-4 text-sky-400" />
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
                <div className="flex gap-3">
                  {accounts.length > 0 && (
                    <div className="flex items-center gap-4 text-[10px]">
                      <div className="flex items-center gap-3">
                        {accounts.map((acc, i) => {
                          const isCurrent = acc.status !== "verified" && acc.status !== "failed" && acc.status !== "pending";
                          const isDone = acc.status === "verified";
                          const isFailed = acc.status === "failed";
                          return (
                            <div key={acc.id} className="flex items-center gap-1">
                              <div className={`w-2 h-2 rounded-full ${isDone ? "bg-emerald-400" : isFailed ? "bg-red-400" : isCurrent ? "bg-sky-400 animate-pulse" : "bg-zinc-700"}`} />
                              <span className={isDone ? "text-emerald-400" : isFailed ? "text-red-400" : isCurrent ? "text-sky-300" : "text-zinc-600"}>
                                {acc.firstName}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <ScrollArea className="flex-1">
              <div ref={scrollRef} className="p-4 space-y-0.5 font-mono text-[11px]">
                {filteredLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-zinc-600 text-sm gap-3">
                    {isRunning ? (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                        <span className="text-zinc-500">Connecting to browser...</span>
                      </>
                    ) : (
                      <>
                        <Terminal className="w-10 h-10 text-zinc-800" />
                        <span className="text-zinc-600">Logs will appear here when you start creating accounts</span>
                        <span className="text-zinc-700 text-xs">Each account goes through: Register &rarr; Email Verify &rarr; Phone Verify</span>
                      </>
                    )}
                  </div>
                ) : (
                  filteredLogs.map((log, i) => {
                    const acct = accounts.find(a => a.id === log.accountId);
                    return (
                      <div key={i} className="flex gap-2 py-0.5 leading-relaxed group hover:bg-white/[0.02] px-1 -mx-1 rounded" data-testid={`log-tm-${i}`}>
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

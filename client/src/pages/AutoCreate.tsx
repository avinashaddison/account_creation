import { useState, useEffect, useRef, useCallback } from "react";
import { useServiceGuard } from "@/lib/useServiceGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, Zap, Terminal, ArrowLeft,
  DollarSign, Globe, Languages, Hash, Rocket, Trophy, StopCircle
} from "lucide-react";
import { subscribe } from "@/lib/ws";
import { Link } from "wouter";
import { sounds } from "@/lib/sounds";
import { useAccountPrice } from "@/lib/useAccountPrice";

type LogEntry = {
  accountId: string;
  message: string;
  timestamp: string;
};

type BatchAccount = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
};

const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

export default function AutoCreate() {
  const { checking } = useServiceGuard("la28");
  const [count, setCount] = useState(1);
  const [proxyList] = useState("");
  const [country, setCountry] = useState("United States");
  const [language, setLanguage] = useState("English");
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchAccounts, setBatchAccounts] = useState<BatchAccount[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollSinceRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsReceivedRef = useRef(false);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => { if (d.role) setUserRole(d.role); }).catch(() => {});
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const batchIdRef = useRef<string | null>(null);
  const batchAccountsRef = useRef<BatchAccount[]>([]);
  batchIdRef.current = batchId;
  batchAccountsRef.current = batchAccounts;

  useEffect(() => {
    const unsub = subscribe((msg) => {
      wsReceivedRef.current = true;
      if (msg.type === "log" && msg.batchId === batchIdRef.current) {
        setLogs((prev) => [...prev, { accountId: msg.accountId, message: msg.message, timestamp: msg.timestamp }]);
      }
      if (msg.type === "account_update" && batchAccountsRef.current.some((a) => a.id === msg.account.id)) {
        if (msg.account.status === "completed") sounds.notification();
        else if (msg.account.status === "verified") sounds.notification();
        else if (msg.account.status === "failed") sounds.warning();
        setBatchAccounts((prev) =>
          prev.map((a) => (a.id === msg.account.id ? { ...a, status: msg.account.status } : a))
        );
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
        sounds.complete();
        setIsRunning(false);
      }
    });
    return unsub;
  }, []);

  const pollForLogs = useCallback(async () => {
    const currentBatchId = batchIdRef.current;
    if (!currentBatchId) return;

    try {
      const res = await fetch(`/api/batch-logs/${currentBatchId}?since=${pollSinceRef.current}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data.logs.length > 0) {
        setLogs((prev) => {
          const existingSet = new Set(prev.map((l) => `${l.timestamp}-${l.message}`));
          const newLogs = data.logs.filter(
            (l: LogEntry) => !existingSet.has(`${l.timestamp}-${l.message}`) && l.message !== "Batch complete"
          );
          return [...prev, ...newLogs];
        });
      }
      pollSinceRef.current = data.nextSince;

      if (data.accounts) {
        setBatchAccounts((prev) =>
          prev.map((a) => {
            const updated = data.accounts.find((u: any) => u.id === a.id);
            return updated ? { ...a, status: updated.status } : a;
          })
        );
      }

      if (data.isComplete) {
        setIsRunning(false);
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isRunning && batchId) {
      pollSinceRef.current = 0;
      const timer = setInterval(pollForLogs, 2000);
      pollTimerRef.current = timer;
      pollForLogs();
      return () => {
        clearInterval(timer);
        pollTimerRef.current = null;
      };
    }
  }, [isRunning, batchId, pollForLogs]);

  async function startBatch(numAccounts: number) {
    setIsRunning(true);
    setLogs([]);
    setBatchAccounts([]);
    setBatchId(null);
    setError(null);
    wsReceivedRef.current = false;
    pollSinceRef.current = 0;

    try {
      const res = await fetch("/api/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: numAccounts, country, language, proxyList: proxyList.trim() ? proxyList.trim().split('\n').map(p => p.trim()).filter(Boolean) : undefined }),
        credentials: "include",
      });
      if (res.status === 401) { const { handleUnauthorized } = await import("@/lib/auth"); handleUnauthorized(); return; }
      const data = await res.json();

      if (res.status === 403) {
        setError(data.error);
        setIsRunning(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || "Failed to start batch");
        setIsRunning(false);
        return;
      }

      setBatchId(data.batchId);
      setBatchAccounts(
        data.accounts.map((a: any) => ({
          id: a.id,
          email: a.email,
          firstName: a.firstName,
          lastName: a.lastName,
          status: a.status,
        }))
      );
    } catch (err) {
      console.error(err);
      setIsRunning(false);
    }
  }

  async function cancelBatch() {
    if (!batchId) return;
    try {
      await fetch(`/api/cancel-batch/${batchId}`, { method: "POST", credentials: "include" });
    } catch (err) {
      console.error("Failed to cancel batch", err);
    }
  }

  const completedCount = batchAccounts.filter((a) => a.status === "completed" || a.status === "verified").length;
  const failedCount = batchAccounts.filter((a) => a.status === "failed").length;
  const totalCount = batchAccounts.length;
  const doneCount = completedCount + failedCount;
  const accountPrice = useAccountPrice();
  const estimatedCost = (count * accountPrice).toFixed(2);

  if (checking) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-6 animate-float-up">
      <div className="flex items-center gap-3">
        <Link href="/admin/create-server" data-testid="button-back-platforms">
          <div className="p-2 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-zinc-500" />
          </div>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-auto-create-title">LA28 Account Creator</h1>
            <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/15 hover:bg-amber-500/15 text-[10px]">Olympic ID</Badge>
          </div>
          <p className="text-zinc-500 text-sm mt-0.5">Full flow: Register, Verify, Profile, Draw Registration</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl glass-panel p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-600 to-amber-700 text-white">
                <Rocket className="w-3.5 h-3.5" />
              </div>
              <span className="text-sm font-semibold text-zinc-200">Configuration</span>
            </div>

            <div className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3 h-3" /> Number of Accounts
                </Label>
                <div className="flex gap-1.5">
                  {QUICK_AMOUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => { sounds.click(); setCount(n); }}
                      disabled={isRunning}
                      className={`flex-1 h-9 text-sm font-semibold rounded-lg border transition-all ${
                        count === n
                          ? "bg-gradient-to-r from-amber-600 to-amber-600 border-amber-500/30 text-white shadow-lg shadow-amber-900/20"
                          : "bg-white/[0.02] border-white/5 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-300"
                      } disabled:opacity-50`}
                      data-testid={`button-count-${n}`}
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
                  placeholder="Enter any number"
                  disabled={isRunning}
                  className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300 placeholder:text-zinc-600"
                  data-testid="input-custom-count"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="w-3 h-3" /> Country
                  </Label>
                  <Input value={country} onChange={(e) => setCountry(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300" data-testid="input-batch-country" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Languages className="w-3 h-3" /> Language
                  </Label>
                  <Input value={language} onChange={(e) => setLanguage(e.target.value)} disabled={isRunning} className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300" data-testid="input-batch-language" />
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Accounts</span>
                  <span className="font-semibold text-zinc-300">{count}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Cost per account</span>
                  <span className="font-medium text-zinc-400">${accountPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-white/5 pt-2 mt-1">
                  <span className="font-semibold text-zinc-300 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> Total
                  </span>
                  <span className="font-bold text-lg bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">${estimatedCost}</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400" data-testid="text-batch-error">
                  {error}
                </div>
              )}

              <Button
                className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-amber-600 to-amber-600 hover:from-amber-500 hover:to-amber-500 shadow-lg shadow-amber-900/25 border-0"
                onClick={() => { sounds.start(); startBatch(count); }}
                disabled={isRunning}
                data-testid="button-start-batch"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating... ({doneCount}/{totalCount})
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Create {count} Account{count > 1 ? "s" : ""}
                  </>
                )}
              </Button>

              {isRunning && (
                <Button
                  className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-red-700 to-red-700 hover:from-red-600 hover:to-red-600 shadow-lg shadow-red-900/25 border-0"
                  onClick={cancelBatch}
                  data-testid="button-stop-batch"
                >
                  <StopCircle className="w-4 h-4 mr-2" />
                  Stop Batch
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 rounded-xl glass-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300">
                <Terminal className="w-3.5 h-3.5" />
              </div>
              <span className="text-sm font-semibold text-zinc-200">Live Logs</span>
            </div>
            {totalCount > 0 && (
              <div className="flex items-center gap-2">
                <Badge className="bg-white/5 text-zinc-400 border-white/10 text-xs">{doneCount}/{totalCount} done</Badge>
                {batchAccounts.filter(a => a.status === "completed").length > 0 && (
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                    {batchAccounts.filter(a => a.status === "completed").length} draw_ok
                  </Badge>
                )}
                {batchAccounts.filter(a => a.status === "verified").length > 0 && (
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                    {batchAccounts.filter(a => a.status === "verified").length} no_draw
                  </Badge>
                )}
                {failedCount > 0 && <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-xs">{failedCount} failed</Badge>}
              </div>
            )}
          </div>

          {batchAccounts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {batchAccounts.map((acc) => {
                const chipStyle = acc.status === "completed"
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : acc.status === "verified"
                  ? "bg-teal-500/10 border-teal-500/20 text-teal-400"
                  : acc.status === "failed"
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : acc.status === "draw_registering"
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                  : acc.status === "profile_saving"
                  ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-400";
                const chipLabel = acc.status === "registering" ? "Registering"
                  : acc.status === "waiting_code" ? "Waiting Code"
                  : acc.status === "verifying" ? "Verifying"
                  : acc.status === "verified" ? "Verified (No Draw)"
                  : acc.status === "profile_saving" ? "Saving Profile"
                  : acc.status === "draw_registering" ? "Draw Registration"
                  : acc.status === "completed" ? "Draw OK"
                  : acc.status === "failed" ? "Failed"
                  : "Pending";
                return (
                  <div
                    key={acc.id}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium ${chipStyle}`}
                    data-testid={`badge-batch-account-${acc.id}`}
                  >
                    {acc.status === "completed" ? (
                      <Trophy className="w-3 h-3" />
                    ) : acc.status === "verified" ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : acc.status === "failed" ? (
                      <XCircle className="w-3 h-3" />
                    ) : (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {acc.firstName} {acc.lastName}
                    <span className="text-[10px] opacity-70">({chipLabel})</span>
                  </div>
                );
              })}
            </div>
          )}

          <ScrollArea className="h-[420px] rounded-xl border border-white/[0.04] bg-[#07071a] p-4">
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-sm gap-2">
                {isRunning ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                    <span className="text-zinc-500">Waiting for logs...</span>
                  </>
                ) : (
                  <>
                    <Terminal className="w-8 h-8 text-zinc-800" />
                    <span className="text-zinc-600">Logs will appear here when you start creating accounts</span>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-0.5 font-mono text-xs">
                {logs.map((log, i) => {
                  const msg = log.message;
                  const isDrawOk = msg.includes("DRAW COMPLETE") || msg.includes("success page reached") || msg.includes("mydatasuccess") || msg.includes("Draw registration complete");
                  const isSuccess = !isDrawOk && (msg.includes("Full flow complete") || msg.includes("completed") || msg.includes("Draw registered"));
                  const isVerified = !isDrawOk && !isSuccess && (msg.includes("verified") || msg.includes("successfully") || msg.includes("SUCCESS"));
                  const isDrawFail = msg.includes("DRAW FAILED") || msg.includes("NOT confirmed") || msg.includes("NOT reached") || msg.includes("Draw NOT confirmed") || msg.includes("success page NOT");
                  const isFail = !isDrawFail && (msg.includes("Failed") || msg.includes("Error") || msg.includes("Timed out") || msg.includes("error:"));
                  const isCode = msg.includes("code") || msg.includes("Code");
                  const isDraw = msg.includes("draw_registering") || msg.includes("DRAW") || msg.includes("draw form") || msg.includes("tickets.la28.org") || msg.includes("Ticket") || msg.includes("form fill") || msg.includes("form submitted");
                  const isProfile = msg.includes("profile_saving") || msg.includes("Profile") || msg.includes("Gigya");
                  const isStatus = msg.includes("Status:");
                  const isZenRows = msg.includes("Addison Proxy") || msg.includes("Akamai") || msg.includes("Access Denied");

                  const colorClass = isDrawOk ? "text-emerald-400 font-bold"
                    : isSuccess ? "text-emerald-400 font-semibold"
                    : isDrawFail ? "text-orange-400 font-semibold"
                    : isFail ? "text-red-400"
                    : isVerified ? "text-emerald-400"
                    : isCode ? "text-amber-400"
                    : isDraw ? "text-amber-400"
                    : isProfile ? "text-blue-400"
                    : isZenRows ? "text-rose-300"
                    : isStatus ? "text-sky-400"
                    : "text-zinc-400";

                  const prefix = isDrawOk ? "+" : isDrawFail ? "!" : isFail ? "x" : isStatus ? ">" : " ";

                  return (
                    <div key={i} className={`flex gap-2 py-0.5 ${isDrawOk ? "bg-emerald-400/[0.03] rounded px-1 -mx-1" : isDrawFail ? "bg-orange-400/[0.03] rounded px-1 -mx-1" : isFail ? "bg-red-400/[0.02] rounded px-1 -mx-1" : ""}`} data-testid={`log-entry-${i}`}>
                      <span className="text-zinc-700 shrink-0 select-none">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-zinc-700 shrink-0 w-2 text-center select-none">{prefix}</span>
                      <span className={colorClass}>
                        {msg}
                      </span>
                    </div>
                  );
                })}
                <div ref={logsEndRef} />
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

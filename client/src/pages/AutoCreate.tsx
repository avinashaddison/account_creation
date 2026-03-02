import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, Zap, Terminal, ArrowLeft,
  DollarSign, Globe, Languages, Hash, Rocket
} from "lucide-react";
import { subscribe } from "@/lib/ws";
import { Link } from "wouter";

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

const QUICK_AMOUNTS = [1, 5, 10, 20, 30];

export default function AutoCreate() {
  const [count, setCount] = useState(1);
  const [country, setCountry] = useState("United States");
  const [language, setLanguage] = useState("English");
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchAccounts, setBatchAccounts] = useState<BatchAccount[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollSinceRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsReceivedRef = useRef(false);

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
        setBatchAccounts((prev) =>
          prev.map((a) => (a.id === msg.account.id ? { ...a, status: msg.account.status } : a))
        );
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
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
        body: JSON.stringify({ count: numAccounts, country, language }),
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

  const completedCount = batchAccounts.filter((a) => a.status === "verified").length;
  const failedCount = batchAccounts.filter((a) => a.status === "failed").length;
  const totalCount = batchAccounts.length;
  const doneCount = completedCount + failedCount;
  const estimatedCost = (count * 0.11).toFixed(2);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/create-server" data-testid="button-back-platforms">
          <div className="p-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </div>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-auto-create-title">LA28 Account Creator</h1>
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 text-[10px]">Olympic ID</Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-0.5">Automated LA28 registration with email verification</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-0 shadow-md">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                  <Rocket className="w-3.5 h-3.5" />
                </div>
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3 h-3" /> Number of Accounts
                </Label>
                <div className="flex gap-1.5">
                  {QUICK_AMOUNTS.map((n) => (
                    <Button
                      key={n}
                      variant={count === n ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCount(n)}
                      disabled={isRunning}
                      className={`flex-1 h-9 text-sm font-semibold ${count === n ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700" : ""}`}
                      data-testid={`button-count-${n}`}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
                <Input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={30}
                  disabled={isRunning}
                  className="h-9 text-sm"
                  data-testid="input-custom-count"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="w-3 h-3" /> Country
                  </Label>
                  <Input value={country} onChange={(e) => setCountry(e.target.value)} disabled={isRunning} className="h-9 text-sm" data-testid="input-batch-country" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Languages className="w-3 h-3" /> Language
                  </Label>
                  <Input value={language} onChange={(e) => setLanguage(e.target.value)} disabled={isRunning} className="h-9 text-sm" data-testid="input-batch-language" />
                </div>
              </div>

              <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 border p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Accounts</span>
                  <span className="font-semibold">{count}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Cost per account</span>
                  <span className="font-medium text-slate-600">$0.11</span>
                </div>
                <div className="flex justify-between text-sm border-t pt-2 mt-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> Total
                  </span>
                  <span className="font-bold text-lg bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">${estimatedCost}</span>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700" data-testid="text-batch-error">
                  {error}
                </div>
              )}

              <Button
                className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-500/25"
                onClick={() => startBatch(count)}
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
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-3 border-0 shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-zinc-900 text-white">
                <Terminal className="w-3.5 h-3.5" />
              </div>
              Live Logs
            </CardTitle>
            {totalCount > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{doneCount}/{totalCount} done</Badge>
                {completedCount > 0 && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-xs">{completedCount} verified</Badge>}
                {failedCount > 0 && <Badge variant="destructive" className="text-xs">{failedCount} failed</Badge>}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {batchAccounts.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {batchAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium ${
                      acc.status === "verified"
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                        : acc.status === "failed"
                        ? "bg-red-50 border-red-200 text-red-700"
                        : "bg-blue-50 border-blue-200 text-blue-700"
                    }`}
                    data-testid={`badge-batch-account-${acc.id}`}
                  >
                    {acc.status === "verified" ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : acc.status === "failed" ? (
                      <XCircle className="w-3 h-3" />
                    ) : (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {acc.firstName} {acc.lastName}
                  </div>
                ))}
              </div>
            )}

            <ScrollArea className="h-[420px] rounded-xl border bg-zinc-950 p-4">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-sm gap-2">
                  {isRunning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                      <span className="text-zinc-400">Waiting for logs...</span>
                    </>
                  ) : (
                    <>
                      <Terminal className="w-8 h-8 text-zinc-700" />
                      <span>Logs will appear here when you start creating accounts</span>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-1 font-mono text-xs">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2" data-testid={`log-entry-${i}`}>
                      <span className="text-zinc-600 shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={
                        log.message.includes("verified") || log.message.includes("successfully")
                          ? "text-emerald-400"
                          : log.message.includes("Failed") || log.message.includes("Error") || log.message.includes("Timed out")
                          ? "text-red-400"
                          : log.message.includes("code") || log.message.includes("Code")
                          ? "text-amber-400"
                          : log.message.includes("Status:")
                          ? "text-blue-400"
                          : "text-zinc-300"
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

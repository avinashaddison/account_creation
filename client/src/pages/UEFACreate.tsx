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
import {
  Rocket, ArrowLeft, Hash, DollarSign, Loader2, CheckCircle2, XCircle,
  Terminal, Trophy
} from "lucide-react";
import { sounds } from "@/lib/sounds";

const QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];

type LogEntry = { accountId: string; message: string; timestamp: string };
type BatchAccount = { id: string; firstName: string; lastName: string; status: string };

export default function UEFACreate() {
  const [count, setCount] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BatchAccount[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const accountPrice = useAccountPrice();
  const estimatedCost = (count * accountPrice).toFixed(2);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "log") {
        setLogs((prev) => [...prev, { accountId: data.accountId, message: data.message, timestamp: data.timestamp }]);
      } else if (data.type === "account_update") {
        if (data.account.status === "verified") sounds.notification();
        else if (data.account.status === "failed") sounds.warning();
        setAccounts((prev) => prev.map((a) => a.id === data.account.id ? { ...a, status: data.account.status } : a));
      } else if (data.type === "batch_complete") {
        sounds.complete();
        setIsRunning(false);
        toast({ title: "Batch Complete", description: "All UEFA accounts have been processed" });
      }
    };

    return () => { ws.close(); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  async function startBatch(numAccounts: number) {
    setError("");
    setLogs([]);
    setAccounts([]);
    setBatchId(null);
    setIsRunning(true);

    try {
      const res = await fetch("/api/uefa-create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: numAccounts }),
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
      setAccounts(data.accounts.map((a: any) => ({ id: a.id, firstName: a.firstName, lastName: a.lastName, status: a.status })));
    } catch (err: any) {
      setError(err.message);
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/admin/create-server">
          <div className="p-2 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors" data-testid="link-back-to-servers">
            <ArrowLeft className="w-4 h-4" />
          </div>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-uefa-create-title">UEFA Account Creator</h1>
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15 text-[10px]">UEFA</Badge>
          </div>
          <p className="text-zinc-500 text-sm mt-0.5">Automated UEFA account registration with email verification</p>
        </div>
      </div>


      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl glass-panel bg-transparent border border-white/[0.04] p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
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
                          ? "bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-500/30 text-white shadow-lg shadow-emerald-500/20"
                          : "bg-white/[0.02] border-white/5 text-zinc-400 hover:bg-white/5 hover:text-zinc-300"
                      } disabled:opacity-50`}
                      data-testid={`button-uefa-count-${n}`}
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
                  className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300"
                  data-testid="input-uefa-custom-count"
                />
              </div>

              <div className="rounded-xl bg-white/[0.02] border border-white/[0.04] p-4 space-y-2">
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
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400" data-testid="text-uefa-batch-error">
                  {error}
                </div>
              )}

              <Button
                className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg shadow-emerald-500/20 border-0"
                onClick={() => { sounds.start(); startBatch(count); }}
                disabled={isRunning}
                data-testid="button-uefa-start-batch"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating Accounts...
                  </>
                ) : (
                  <>
                    <Trophy className="w-4 h-4 mr-2" />
                    Create {count} UEFA Account{count > 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="rounded-xl glass-panel bg-transparent border border-white/[0.04] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-zinc-500" />
                <span className="text-sm font-semibold text-zinc-300">Live Output</span>
              </div>
              {batchId && (
                <Badge className="text-[10px] bg-white/5 text-zinc-500 border-white/10">
                  Batch: {batchId.substring(0, 8)}
                </Badge>
              )}
            </div>

            {accounts.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-4">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium ${
                      acc.status === "verified"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                        : acc.status === "failed"
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-teal-500/10 border-teal-500/20 text-teal-400"
                    }`}
                    data-testid={`badge-uefa-batch-account-${acc.id}`}
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

            <ScrollArea className="h-[420px] rounded-xl border border-white/[0.04] bg-[#07071a] p-4">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 text-sm gap-2">
                  {isRunning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
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
                <div ref={scrollRef} className="space-y-0.5 font-mono text-xs">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2 py-0.5">
                      <span className="text-zinc-700 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className={
                        log.message.includes("Error") || log.message.includes("Failed") || log.message.includes("failed")
                          ? "text-red-400"
                          : log.message.includes("verified") || log.message.includes("success") || log.message.includes("Success")
                          ? "text-emerald-400"
                          : log.message.includes("code") || log.message.includes("Code")
                          ? "text-amber-400"
                          : log.message.includes("Status:")
                          ? "text-teal-400"
                          : "text-zinc-400"
                      }>
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}

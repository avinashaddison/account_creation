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
  Terminal, Music, Globe
} from "lucide-react";

const QUICK_AMOUNTS = [1, 3, 5, 10, 25];

type LogEntry = { accountId: string; message: string; timestamp: string };
type BatchAccount = { id: string; firstName: string; lastName: string; status: string };

export default function BrunoMarsCreate() {
  const [count, setCount] = useState(1);
  const [proxyUrl, setProxyUrl] = useState("wss://brd-customer-hl_86b34e68-zone-scraping_browser1:xov21cay1g29@brd.superproxy.io:9222");
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BatchAccount[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const [userRole, setUserRole] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => { if (d.role) setUserRole(d.role); }).catch(() => {});
  }, []);
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
        setAccounts((prev) => prev.map((a) => a.id === data.account.id ? { ...a, status: data.account.status } : a));
      } else if (data.type === "batch_complete") {
        setIsRunning(false);
        toast({ title: "Batch Complete", description: "All Bruno Mars signups finished." });
      }
    };

    return () => { ws.close(); };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function startBatch() {
    setIsRunning(true);
    setError("");
    setLogs([]);
    setAccounts([]);
    setBatchId(null);

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
      setAccounts(data.accounts.map((a: any) => ({
        id: a.id,
        firstName: a.firstName,
        lastName: a.lastName,
        status: a.status,
      })));
    } catch (err: any) {
      setError(err.message);
      setIsRunning(false);
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case "failed": return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      case "pending": return <div className="w-3.5 h-3.5 rounded-full bg-zinc-600" />;
      default: return <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />;
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case "pending": return "Pending";
      case "registering": return "Loading Page";
      case "filling_form": return "Filling Form";
      case "selecting_events": return "Selecting Events";
      case "submitting": return "Submitting";
      case "completed": return "Signed Up";
      case "failed": return "Failed";
      default: return status;
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Link href="/admin/create-server">
          <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white" data-testid="button-back-brunomars">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-brunomars-title">TM - Bruno Mars</h1>
            <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/15 text-[10px]">Presale</Badge>
          </div>
          <p className="text-zinc-500 text-sm mt-0.5">Automated presale signup on signup.ticketmaster.ca/brunomars</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl bg-[#111118] border border-white/5 p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-1.5 rounded-lg bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white">
                <Rocket className="w-3.5 h-3.5" />
              </div>
              <span className="text-sm font-semibold text-zinc-200">Configuration</span>
            </div>

            <div className="space-y-5">
              {userRole === "superadmin" && (
              <div className="space-y-2.5">
                <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="w-3 h-3" /> Proxy URL
                </Label>
                <Input
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  disabled={isRunning}
                  placeholder="wss://... Browser API URL"
                  className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300 placeholder:text-zinc-600 font-mono"
                  data-testid="input-brunomars-proxy"
                />
              </div>
              )}

              <div className="space-y-2.5">
                <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Hash className="w-3 h-3" /> Number of Signups
                </Label>
                <div className="flex gap-1.5">
                  {QUICK_AMOUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setCount(n)}
                      disabled={isRunning}
                      className={`flex-1 h-9 text-sm font-semibold rounded-lg border transition-all ${
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
                  className="h-9 text-sm bg-white/[0.02] border-white/5 text-zinc-300"
                  data-testid="input-brunomars-custom-count"
                />
              </div>

              <div className="rounded-lg bg-purple-500/5 border border-purple-500/10 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Estimated Cost</span>
                  <span className="text-sm font-bold text-purple-400 flex items-center gap-1" data-testid="text-brunomars-cost">
                    <DollarSign className="w-3.5 h-3.5" />{estimatedCost}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-600 mt-1">${accountPrice}/signup x {count} signups</p>
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400" data-testid="text-brunomars-error">
                  {error}
                </div>
              )}

              <Button
                onClick={startBatch}
                disabled={isRunning || count < 1}
                className="w-full h-11 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 text-white font-semibold shadow-lg shadow-purple-500/20"
                data-testid="button-start-brunomars"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running...
                  </>
                ) : (
                  <>
                    <Music className="w-4 h-4 mr-2" /> Start Signup ({count})
                  </>
                )}
              </Button>
            </div>
          </div>

          {accounts.length > 0 && (
            <div className="rounded-xl bg-[#111118] border border-white/5 p-5">
              <p className="text-xs font-semibold text-zinc-500 uppercase mb-3">Signup Status</p>
              <div className="grid grid-cols-2 gap-2">
                {accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center gap-2 rounded-lg bg-white/[0.02] border border-white/5 px-3 py-2"
                    data-testid={`status-brunomars-${acc.id}`}
                  >
                    {getStatusIcon(acc.status)}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-300 truncate">{acc.firstName} {acc.lastName}</p>
                      <p className="text-[10px] text-zinc-600">{getStatusLabel(acc.status)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          <div className="rounded-xl bg-[#0a0a0f] border border-white/5 overflow-hidden h-[600px] flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 bg-white/[0.02] border-b border-white/5">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-semibold text-zinc-400">Live Output</span>
              <Badge variant="outline" className="ml-auto text-[10px]">
                {logs.length} entries
              </Badge>
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-1 font-mono text-[11px]">
                {logs.length === 0 && (
                  <p className="text-zinc-600 italic">Waiting for activity...</p>
                )}
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-2 leading-relaxed" data-testid={`log-brunomars-${i}`}>
                    <span className="text-zinc-600 shrink-0 select-none">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={
                      log.message.toLowerCase().includes("success") || log.message.toLowerCase().includes("completed")
                        ? "text-emerald-400"
                        : log.message.toLowerCase().includes("error") || log.message.toLowerCase().includes("failed")
                        ? "text-red-400"
                        : "text-zinc-400"
                    }>
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}

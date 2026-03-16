import { useState, useEffect, useRef, useCallback } from "react";
import { useServiceGuard } from "@/lib/useServiceGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, Terminal, ArrowLeft,
  Mail, Plus, Copy, UserPlus
} from "lucide-react";
import { subscribe } from "@/lib/ws";
import { Link } from "wouter";
import { sounds } from "@/lib/sounds";

type LogEntry = {
  message: string;
  timestamp: string;
};

type CreatedAccount = {
  email: string;
  password: string;
};

export default function OutlookCreate() {
  const { checking } = useServiceGuard("outlook");
  const [count, setCount] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [accounts, setAccounts] = useState<CreatedAccount[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const batchIdRef = useRef<string | null>(null);
  batchIdRef.current = batchId;

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === "log" && msg.batchId === batchIdRef.current) {
        setLogs((prev) => [...prev, { message: msg.message, timestamp: msg.timestamp }]);
      }
      if (msg.type === "outlook_create_result" && msg.batchId === batchIdRef.current) {
        if (msg.success && msg.email && msg.password) {
          setAccounts((prev) => [...prev, { email: msg.email, password: msg.password }]);
          setCompletedCount((c) => c + 1);
          sounds.complete();
        } else {
          setFailedCount((c) => c + 1);
          sounds.warning();
        }
      }
      if (msg.type === "outlook_create_complete" && msg.batchId === batchIdRef.current) {
        setIsDone(true);
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
        setIsRunning(false);
      }
    });
    return unsub;
  }, []);

  const handleCreate = useCallback(async () => {
    setError(null);
    setAccounts([]);
    setCompletedCount(0);
    setFailedCount(0);
    setIsDone(false);
    setLogs([]);
    setIsRunning(true);
    setCopied(false);
    sounds.navigate();

    try {
      const res = await fetch("/api/outlook-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start");
        setIsRunning(false);
        return;
      }
      setBatchId(data.batchId);
    } catch (err: any) {
      setError(err.message || "Network error");
      setIsRunning(false);
    }
  }, [count]);

  const copyAll = useCallback(() => {
    const text = accounts.map((a) => `${a.email}:${a.password}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [accounts]);

  if (checking) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/create-server">
            <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-300 hover:bg-cyan-500/5 font-mono text-xs" data-testid="button-back-create-server">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(168,85,247,0.1) 100%)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <UserPlus className="w-4 h-4 text-blue-400" />
              </div>
              <h1 className="text-lg font-bold text-white font-mono tracking-tight" data-testid="text-page-title">Create Outlook Accounts</h1>
            </div>
            <p className="text-[10px] text-cyan-400/30 font-mono mt-0.5 tracking-wide">AUTOMATED MICROSOFT ACCOUNT CREATION</p>
          </div>
        </div>
        {isRunning && (
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 font-mono text-[10px] animate-pulse" data-testid="badge-running">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            CREATING {completedCount + failedCount}/{count}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'linear-gradient(135deg, rgba(15,21,32,0.8) 0%, rgba(13,17,23,0.9) 100%)', border: '1px solid rgba(0,240,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Mail className="w-3.5 h-3.5 text-cyan-400/50" />
              <span className="text-[10px] font-mono text-cyan-400/40 uppercase tracking-wider">Account Settings</span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
                <Plus className="w-3 h-3" />
                Number of Accounts (1-10)
              </Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={count}
                onChange={(e) => setCount(Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                disabled={isRunning}
                className="h-9 bg-black/30 border-cyan-500/10 text-cyan-50 font-mono text-sm rounded-lg w-32"
                data-testid="input-outlook-count"
              />
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="text-error">
                <p className="text-xs text-red-400 font-mono">{error}</p>
              </div>
            )}

            <Button
              onClick={handleCreate}
              disabled={isRunning}
              className="w-full h-10 font-mono text-sm rounded-lg"
              style={{ background: isRunning ? 'rgba(59,130,246,0.2)' : 'linear-gradient(135deg, rgba(59,130,246,0.3) 0%, rgba(168,85,247,0.2) 100%)', border: '1px solid rgba(59,130,246,0.3)' }}
              data-testid="button-outlook-create"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating accounts...
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Create {count} Account{count > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>

          {accounts.length > 0 && (
            <div className="rounded-xl p-4 space-y-3 bg-emerald-500/10 border border-emerald-500/20" data-testid="outlook-create-results">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-mono font-bold text-emerald-300">
                    {accounts.length} Account{accounts.length > 1 ? "s" : ""} Created
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-emerald-400/60 hover:text-emerald-300 font-mono"
                  onClick={copyAll}
                  data-testid="button-copy-accounts"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  {copied ? "Copied!" : "Copy All"}
                </Button>
              </div>
              <div className="space-y-1.5">
                {accounts.map((acc, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-black/30" data-testid={`account-row-${i}`}>
                    <Mail className="w-3 h-3 text-emerald-400/50 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-emerald-300/90 truncate" data-testid={`account-email-${i}`}>{acc.email}</p>
                      <p className="text-[10px] font-mono text-zinc-500 truncate" data-testid={`account-password-${i}`}>{acc.password}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-zinc-500 hover:text-emerald-300"
                      onClick={() => navigator.clipboard.writeText(`${acc.email}:${acc.password}`)}
                      data-testid={`button-copy-account-${i}`}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
              {failedCount > 0 && (
                <div className="flex items-center gap-2 mt-1">
                  <XCircle className="w-3 h-3 text-red-400/60" />
                  <span className="text-[10px] font-mono text-red-400/60">{failedCount} failed</span>
                </div>
              )}
            </div>
          )}

          {isDone && accounts.length === 0 && (
            <div className="rounded-xl p-4 bg-red-500/10 border border-red-500/20" data-testid="outlook-create-failed">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-400" />
                <span className="text-sm font-mono font-bold text-red-300">All accounts failed</span>
              </div>
              <p className="text-xs text-red-400/60 font-mono mt-1.5">Check logs for details</p>
            </div>
          )}

          <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(15,21,32,0.5)', border: '1px solid rgba(0,240,255,0.05)' }}>
            <span className="text-[10px] font-mono text-cyan-400/30 uppercase tracking-wider">Notes</span>
            <ul className="space-y-1.5 text-[11px] text-zinc-500 font-mono">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                Auto-generates random name, email, password & DOB
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                FunCaptcha (Arkose Labs) auto-solved via CapSolver
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                May fail if Microsoft detects automation
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                Accounts created sequentially (1 at a time)
              </li>
            </ul>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(0,240,255,0.08)' }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'rgba(0,240,255,0.03)', borderBottom: '1px solid rgba(0,240,255,0.06)' }}>
            <Terminal className="w-3.5 h-3.5 text-cyan-400/50" />
            <span className="text-[10px] font-mono text-cyan-400/40 uppercase tracking-wider">Live Logs</span>
            {logs.length > 0 && (
              <Badge variant="outline" className="ml-auto border-cyan-500/15 text-cyan-400/40 text-[9px] font-mono" data-testid="badge-log-count">
                {logs.length}
              </Badge>
            )}
          </div>
          <ScrollArea className="h-[500px]">
            <div className="p-3 space-y-0.5 font-mono text-[11px]">
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-zinc-600 text-xs" data-testid="text-no-logs">
                  Logs will appear here when creation starts...
                </div>
              ) : (
                logs.map((log, i) => {
                  const isError = log.message.toLowerCase().includes("error") || log.message.toLowerCase().includes("failed");
                  const isSuccess = log.message.includes("created") || log.message.includes("success");
                  return (
                    <div
                      key={i}
                      className={`py-1 px-2 rounded ${isError ? 'text-red-400/80 bg-red-500/5' : isSuccess ? 'text-emerald-400/80 bg-emerald-500/5' : 'text-zinc-400'}`}
                      data-testid={`log-entry-${i}`}
                    >
                      <span className="text-cyan-400/20 mr-2">
                        {new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false })}
                      </span>
                      {log.message}
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

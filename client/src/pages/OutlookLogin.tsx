import { useState, useEffect, useRef, useCallback } from "react";
import { useServiceGuard } from "@/lib/useServiceGuard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, Terminal, ArrowLeft,
  Mail, Lock, LogIn, Shield, PlayCircle, RotateCcw,
  CheckCheck, AlertCircle, Clock
} from "lucide-react";
import { subscribe } from "@/lib/ws";
import { Link } from "wouter";
import { sounds } from "@/lib/sounds";

type LogEntry = { message: string; timestamp: string };
type PrivateOutlookAccount = { id: string; email: string; password: string; status: string; createdAt: string };

type AccountResult = {
  accountId: string;
  email: string;
  success: boolean;
  error?: string;
  cookieCount?: number;
  index: number;
  total: number;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "working")
    return <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/15 text-green-300 border border-green-500/30"><CheckCircle2 className="w-3 h-3" />Working</span>;
  if (status === "dead")
    return <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/15 text-red-300 border border-red-500/30"><XCircle className="w-3 h-3" />Dead</span>;
  if (status === "testing")
    return <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 animate-pulse"><Loader2 className="w-3 h-3 animate-spin" />Testing</span>;
  return <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-zinc-700/30 text-zinc-400 border border-zinc-600/30"><Clock className="w-3 h-3" />Untested</span>;
}

export default function OutlookLogin() {
  const { checking } = useServiceGuard("outlook");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"manual" | "bulk">("bulk");

  // Manual login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<{ success: boolean; error?: string; cookieCount?: number; cookies?: Array<{ name: string; value: string; domain: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bulk login state
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkBatchId, setBulkBatchId] = useState<string | null>(null);
  const [bulkLogs, setBulkLogs] = useState<LogEntry[]>([]);
  const [bulkResults, setBulkResults] = useState<Map<string, AccountResult>>(new Map());
  const [bulkComplete, setBulkComplete] = useState<{ passed: number; failed: number; total: number } | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Map<string, string>>(new Map());

  const logsEndRef = useRef<HTMLDivElement>(null);
  const bulkLogsEndRef = useRef<HTMLDivElement>(null);
  const batchIdRef = useRef<string | null>(null);
  const bulkBatchIdRef = useRef<string | null>(null);
  batchIdRef.current = batchId;
  bulkBatchIdRef.current = bulkBatchId;

  const { data: storedAccounts = [], isLoading: accountsLoading } = useQuery<PrivateOutlookAccount[]>({
    queryKey: ["/api/private/outlook"],
    queryFn: async () => {
      const res = await fetch("/api/private/outlook", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load accounts");
      return res.json();
    },
  });

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => { bulkLogsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [bulkLogs]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      // Manual login
      if (msg.type === "log" && msg.batchId === batchIdRef.current) {
        setLogs((prev) => [...prev, { message: msg.message, timestamp: msg.timestamp }]);
      }
      if (msg.type === "outlook_login_result" && msg.batchId === batchIdRef.current) {
        setResult({ success: msg.success, error: msg.error, cookieCount: msg.cookieCount, cookies: msg.cookies });
        if (msg.success) sounds.complete(); else sounds.warning();
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
        setIsRunning(false);
      }

      // Bulk login
      if (msg.type === "log" && msg.batchId === bulkBatchIdRef.current) {
        setBulkLogs((prev) => [...prev, { message: msg.message, timestamp: msg.timestamp }]);
      }
      if (msg.type === "outlook_bulk_login_result" && msg.batchId === bulkBatchIdRef.current) {
        setBulkResults((prev) => {
          const next = new Map(prev);
          next.set(msg.accountId, msg);
          return next;
        });
        setLocalStatuses((prev) => {
          const next = new Map(prev);
          next.set(msg.accountId, msg.success ? "working" : "dead");
          return next;
        });
        if (msg.success) sounds.complete(); else sounds.warning();
      }
      if (msg.type === "outlook_bulk_complete" && msg.batchId === bulkBatchIdRef.current) {
        setBulkComplete({ passed: msg.passed, failed: msg.failed, total: msg.total });
        queryClient.invalidateQueries({ queryKey: ["/api/private/outlook"] });
      }
      if (msg.type === "batch_complete" && msg.batchId === bulkBatchIdRef.current) {
        setBulkRunning(false);
      }
    });
    return unsub;
  }, []);

  const handleManualLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) { setError("Email and password are required"); return; }
    setError(null); setResult(null); setLogs([]); setIsRunning(true);
    sounds.navigate();
    try {
      const res = await fetch("/api/outlook-login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to start login"); setIsRunning(false); return; }
      setLoginId(data.loginId); setBatchId(data.batchId);
    } catch (err: any) { setError(err.message || "Network error"); setIsRunning(false); }
  }, [email, password]);

  const handleBulkLogin = useCallback(async () => {
    setBulkLogs([]); setBulkResults(new Map()); setBulkComplete(null); setBulkRunning(true);
    setLocalStatuses(new Map());
    sounds.navigate();
    try {
      const res = await fetch("/api/outlook-bulk-login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Failed to start"); setBulkRunning(false); return; }
      setBulkBatchId(data.batchId);
    } catch (err: any) { alert(err.message); setBulkRunning(false); }
  }, []);

  if (checking) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full" /></div>;

  const workingCount = [...localStatuses.values()].filter(s => s === "working").length +
    storedAccounts.filter(a => a.status === "working" && !localStatuses.has(a.id)).length;
  const deadCount = [...localStatuses.values()].filter(s => s === "dead").length +
    storedAccounts.filter(a => a.status === "dead" && !localStatuses.has(a.id)).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/create-server">
            <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-300 font-mono text-xs" data-testid="button-back-create-server">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />Back
            </Button>
          </Link>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(99,102,241,0.2))', border: '1px solid rgba(59,130,246,0.3)' }}>
            <Mail className="w-4.5 h-4.5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white font-mono" data-testid="text-page-title">Outlook Login</h1>
            <p className="text-[10px] text-zinc-500 font-mono">Microsoft Account Automation</p>
          </div>
        </div>
        {(isRunning || bulkRunning) && (
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 font-mono text-[10px] animate-pulse" data-testid="badge-running">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />RUNNING
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <button
          onClick={() => setTab("bulk")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "bulk" ? "bg-blue-600 text-white shadow-lg" : "text-zinc-400 hover:text-zinc-200"}`}
          data-testid="tab-bulk"
        >
          Test Stored Accounts
          {storedAccounts.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold bg-white/15">{storedAccounts.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab("manual")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "manual" ? "bg-blue-600 text-white shadow-lg" : "text-zinc-400 hover:text-zinc-200"}`}
          data-testid="tab-manual"
        >
          Manual Login
        </button>
      </div>

      {/* ── BULK TAB ── */}
      {tab === "bulk" && (
        <div className="space-y-4">
          {/* Stats */}
          {storedAccounts.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "Total", value: storedAccounts.length, color: "text-zinc-300", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)" },
                { label: "Working", value: workingCount, color: "text-green-300", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)" },
                { label: "Dead", value: deadCount, color: "text-red-300", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)" },
                { label: "Untested", value: storedAccounts.length - workingCount - deadCount, color: "text-zinc-400", bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.07)" },
              ].map(({ label, value, color, bg, border }) => (
                <div key={label} className="rounded-xl p-4" style={{ background: bg, border: `1px solid ${border}` }}>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Test All Button */}
          <div className="flex items-center gap-3">
            <Button
              onClick={handleBulkLogin}
              disabled={bulkRunning || storedAccounts.length === 0}
              className="h-10 px-6 rounded-xl font-semibold text-sm"
              style={{ background: bulkRunning ? 'rgba(99,102,241,0.3)' : 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 0 15px rgba(99,102,241,0.3)' }}
              data-testid="button-test-all"
            >
              {bulkRunning
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Testing {storedAccounts.length} accounts...</>
                : <><PlayCircle className="w-4 h-4 mr-2" />Test All {storedAccounts.length} Accounts</>
              }
            </Button>
            {bulkComplete && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-300 font-semibold">{bulkComplete.passed} passed</span>
                <span className="text-zinc-600">·</span>
                <span className="text-red-300 font-semibold">{bulkComplete.failed} failed</span>
              </div>
            )}
          </div>

          {/* Account List */}
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <Mail className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-semibold text-zinc-200">Stored Outlook Accounts</span>
            </div>

            {accountsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-5 h-5 animate-spin text-blue-400/50" />
              </div>
            ) : storedAccounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <AlertCircle className="w-8 h-8 text-zinc-700" />
                <p className="text-sm text-zinc-500">No stored Outlook accounts found</p>
                <p className="text-xs text-zinc-700">Create accounts via Outlook Create first</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {storedAccounts.map((acct) => {
                  const res = bulkResults.get(acct.id);
                  const liveStatus = localStatuses.get(acct.id);
                  const isTesting = bulkRunning && !res && bulkBatchId !== null;
                  const displayStatus = liveStatus || (isTesting && bulkRunning && !res ? "testing" : acct.status);

                  return (
                    <div
                      key={acct.id}
                      className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                      data-testid={`row-outlook-${acct.id}`}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
                        <Mail className="w-3.5 h-3.5 text-blue-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-200 truncate">{acct.email}</p>
                        {res && !res.success && res.error && (
                          <p className="text-xs text-red-400/70 truncate mt-0.5">{res.error}</p>
                        )}
                        {res && res.success && (
                          <p className="text-xs text-green-400/70 mt-0.5">{res.cookieCount} session cookies obtained</p>
                        )}
                      </div>
                      <StatusBadge status={displayStatus} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bulk Logs */}
          {bulkLogs.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Live Logs</span>
                <Badge variant="outline" className="ml-auto border-zinc-700 text-zinc-500 text-[9px] font-mono">{bulkLogs.length}</Badge>
              </div>
              <ScrollArea className="h-[280px]">
                <div className="p-3 space-y-0.5 font-mono text-[11px]">
                  {bulkLogs.map((log, i) => {
                    const isError = log.message.includes("✗") || log.message.toLowerCase().includes("failed") || log.message.toLowerCase().includes("error");
                    const isSuccess = log.message.includes("✓") || log.message.includes("successful");
                    return (
                      <div key={i} className={`py-0.5 px-2 rounded ${isError ? "text-red-400/80 bg-red-500/5" : isSuccess ? "text-green-400/80 bg-green-500/5" : "text-zinc-400"}`} data-testid={`bulk-log-${i}`}>
                        <span className="text-zinc-700 mr-2">{new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false })}</span>
                        {log.message}
                      </div>
                    );
                  })}
                  <div ref={bulkLogsEndRef} />
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      )}

      {/* ── MANUAL TAB ── */}
      {tab === "manual" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-4">
            <div className="rounded-xl p-5 space-y-4" style={{ background: 'rgba(15,21,32,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-3.5 h-3.5 text-blue-400/60" />
                <span className="text-xs font-mono text-zinc-400">Manual Login Credentials</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400 font-mono flex items-center gap-1.5"><Mail className="w-3 h-3" />Outlook Email</Label>
                <Input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@outlook.com" disabled={isRunning}
                  className="h-9 bg-black/30 border-white/10 text-zinc-200 font-mono text-sm rounded-lg placeholder:text-zinc-600"
                  data-testid="input-outlook-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400 font-mono flex items-center gap-1.5"><Lock className="w-3 h-3" />Password</Label>
                <Input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Account password" disabled={isRunning}
                  className="h-9 bg-black/30 border-white/10 text-zinc-200 font-mono text-sm rounded-lg placeholder:text-zinc-600"
                  onKeyDown={(e) => { if (e.key === "Enter" && !isRunning) handleManualLogin(); }}
                  data-testid="input-outlook-password"
                />
              </div>
              {error && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="text-error">
                  <p className="text-xs text-red-400 font-mono">{error}</p>
                </div>
              )}
              <Button
                onClick={handleManualLogin}
                disabled={isRunning || !email.trim() || !password.trim()}
                className="w-full h-10 font-mono text-sm rounded-lg"
                style={{ background: isRunning ? 'rgba(59,130,246,0.2)' : 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 0 15px rgba(99,102,241,0.2)' }}
                data-testid="button-outlook-login"
              >
                {isRunning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Logging in...</> : <><LogIn className="w-4 h-4 mr-2" />Login to Outlook</>}
              </Button>
            </div>

            {result && (
              <div className={`rounded-xl p-4 ${result.success ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"}`} data-testid="outlook-login-result">
                <div className="flex items-center gap-2">
                  {result.success ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
                  <span className={`text-sm font-mono font-bold ${result.success ? "text-green-300" : "text-red-300"}`}>
                    {result.success ? "Login Successful" : "Login Failed"}
                  </span>
                </div>
                {result.success && result.cookieCount !== undefined && (
                  <p className="text-xs text-green-400/60 font-mono mt-1.5">Session established with {result.cookieCount} cookies</p>
                )}
                {result.error && <p className="text-xs text-red-400/80 font-mono mt-1.5">{result.error}</p>}
                {result.success && result.cookies && result.cookies.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">Session Cookies</span>
                      <Button variant="ghost" size="sm" className="h-5 px-2 text-[9px] font-mono text-zinc-500 hover:text-zinc-300"
                        onClick={() => { const s = result.cookies!.map(c => `${c.name}=${c.value}`).join("; "); navigator.clipboard.writeText(s); }}
                        data-testid="button-copy-cookies"
                      >Copy All</Button>
                    </div>
                    <div className="max-h-[120px] overflow-y-auto rounded bg-black/30 p-2 space-y-0.5">
                      {result.cookies.map((c, i) => (
                        <div key={i} className="text-[10px] font-mono text-zinc-500 truncate" data-testid={`cookie-${i}`}>
                          <span className="text-zinc-600">{c.domain}</span><span className="text-zinc-700 mx-1">/</span><span className="text-zinc-400">{c.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(15,21,32,0.5)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">Notes</span>
              <ul className="space-y-1.5 text-[11px] text-zinc-600 font-mono">
                <li className="flex items-start gap-2"><span className="text-zinc-700 mt-0.5">*</span>Uses Addison Proxy residential browser to bypass bot detection</li>
                <li className="flex items-start gap-2"><span className="text-zinc-700 mt-0.5">*</span>FunCaptcha (Arkose Labs) auto-solved via CapSolver</li>
                <li className="flex items-start gap-2"><span className="text-zinc-700 mt-0.5">*</span>2FA (phone/authenticator) is not supported</li>
                <li className="flex items-start gap-2"><span className="text-zinc-700 mt-0.5">*</span>Credentials are not stored</li>
              </ul>
            </div>
          </div>

          {/* Manual logs */}
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <Terminal className="w-3.5 h-3.5 text-zinc-600" />
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">Live Logs</span>
              {logs.length > 0 && <Badge variant="outline" className="ml-auto border-zinc-800 text-zinc-600 text-[9px] font-mono" data-testid="badge-log-count">{logs.length}</Badge>}
            </div>
            <ScrollArea className="h-[500px]">
              <div className="p-3 space-y-0.5 font-mono text-[11px]">
                {logs.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-zinc-700 text-xs" data-testid="text-no-logs">Logs will appear here when login starts...</div>
                ) : logs.map((log, i) => {
                  const isError = log.message.toLowerCase().includes("error") || log.message.toLowerCase().includes("failed");
                  const isSuccess = log.message.includes("successful");
                  return (
                    <div key={i} className={`py-1 px-2 rounded ${isError ? "text-red-400/80 bg-red-500/5" : isSuccess ? "text-green-400/80 bg-green-500/5" : "text-zinc-400"}`} data-testid={`log-entry-${i}`}>
                      <span className="text-zinc-700 mr-2">{new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false })}</span>
                      {log.message}
                    </div>
                  );
                })}
                <div ref={logsEndRef} />
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

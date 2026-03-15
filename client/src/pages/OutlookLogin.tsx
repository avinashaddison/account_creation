import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, Terminal, ArrowLeft,
  Mail, Lock, LogIn, Shield
} from "lucide-react";
import { subscribe } from "@/lib/ws";
import { Link } from "wouter";
import { sounds } from "@/lib/sounds";

type LogEntry = {
  message: string;
  timestamp: string;
};

export default function OutlookLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<{ success: boolean; error?: string; cookieCount?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      if (msg.type === "outlook_login_result" && msg.batchId === batchIdRef.current) {
        setResult({ success: msg.success, error: msg.error, cookieCount: msg.cookieCount });
        if (msg.success) sounds.complete();
        else sounds.warning();
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
        setIsRunning(false);
      }
    });
    return unsub;
  }, []);

  const handleLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }
    setError(null);
    setResult(null);
    setLogs([]);
    setIsRunning(true);
    sounds.navigate();

    try {
      const res = await fetch("/api/outlook-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start login");
        setIsRunning(false);
        return;
      }
      setLoginId(data.loginId);
      setBatchId(data.batchId);
    } catch (err: any) {
      setError(err.message || "Network error");
      setIsRunning(false);
    }
  }, [email, password]);

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
                <Mail className="w-4 h-4 text-blue-400" />
              </div>
              <h1 className="text-lg font-bold text-white font-mono tracking-tight" data-testid="text-page-title">Outlook Login</h1>
            </div>
            <p className="text-[10px] text-cyan-400/30 font-mono mt-0.5 tracking-wide">MICROSOFT ACCOUNT AUTOMATION</p>
          </div>
        </div>
        {isRunning && (
          <Badge variant="outline" className="border-blue-500/30 text-blue-400 font-mono text-[10px] animate-pulse" data-testid="badge-running">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            LOGGING IN
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'linear-gradient(135deg, rgba(15,21,32,0.8) 0%, rgba(13,17,23,0.9) 100%)', border: '1px solid rgba(0,240,255,0.08)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-3.5 h-3.5 text-cyan-400/50" />
              <span className="text-[10px] font-mono text-cyan-400/40 uppercase tracking-wider">Login Credentials</span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
                <Mail className="w-3 h-3" />
                Outlook Email
              </Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@outlook.com"
                disabled={isRunning}
                className="h-9 bg-black/30 border-cyan-500/10 text-cyan-50 font-mono text-sm rounded-lg placeholder:text-zinc-600"
                data-testid="input-outlook-email"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
                <Lock className="w-3 h-3" />
                Password
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Account password"
                disabled={isRunning}
                className="h-9 bg-black/30 border-cyan-500/10 text-cyan-50 font-mono text-sm rounded-lg placeholder:text-zinc-600"
                onKeyDown={(e) => { if (e.key === "Enter" && !isRunning) handleLogin(); }}
                data-testid="input-outlook-password"
              />
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="text-error">
                <p className="text-xs text-red-400 font-mono">{error}</p>
              </div>
            )}

            <Button
              onClick={handleLogin}
              disabled={isRunning || !email.trim() || !password.trim()}
              className="w-full h-10 font-mono text-sm rounded-lg"
              style={{ background: isRunning ? 'rgba(59,130,246,0.2)' : 'linear-gradient(135deg, rgba(59,130,246,0.3) 0%, rgba(168,85,247,0.2) 100%)', border: '1px solid rgba(59,130,246,0.3)' }}
              data-testid="button-outlook-login"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4 mr-2" />
                  Login to Outlook
                </>
              )}
            </Button>
          </div>

          {result && (
            <div
              className={`rounded-xl p-4 ${result.success ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}
              data-testid="outlook-login-result"
            >
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <span className={`text-sm font-mono font-bold ${result.success ? 'text-emerald-300' : 'text-red-300'}`}>
                  {result.success ? "Login Successful" : "Login Failed"}
                </span>
              </div>
              {result.success && result.cookieCount !== undefined && (
                <p className="text-xs text-emerald-400/60 font-mono mt-1.5">
                  Session established with {result.cookieCount} cookies
                </p>
              )}
              {result.error && (
                <p className="text-xs text-red-400/80 font-mono mt-1.5">{result.error}</p>
              )}
            </div>
          )}

          <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(15,21,32,0.5)', border: '1px solid rgba(0,240,255,0.05)' }}>
            <span className="text-[10px] font-mono text-cyan-400/30 uppercase tracking-wider">Notes</span>
            <ul className="space-y-1.5 text-[11px] text-zinc-500 font-mono">
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                Uses ZenRows residential browser to bypass bot detection
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                FunCaptcha (Arkose Labs) auto-solved via CapSolver
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                2FA (phone/authenticator) is not supported
              </li>
              <li className="flex items-start gap-2">
                <span className="text-cyan-400/30 mt-0.5">*</span>
                Credentials are not stored
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
                  Logs will appear here when login starts...
                </div>
              ) : (
                logs.map((log, i) => {
                  const isError = log.message.toLowerCase().includes("error") || log.message.toLowerCase().includes("failed");
                  const isSuccess = log.message.includes("successful") || log.message.includes("Login successful");
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

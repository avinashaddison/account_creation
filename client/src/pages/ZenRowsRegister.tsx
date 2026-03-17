import { useState, useEffect, useRef, useCallback } from "react";
import { useServiceGuard } from "@/lib/useServiceGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, Terminal, ArrowLeft,
  Mail, Lock, Key, Zap, Globe, ChevronDown, ChevronUp, Copy, Rocket
} from "lucide-react";
import { subscribe } from "@/lib/ws";
import { Link } from "wouter";
import { sounds } from "@/lib/sounds";

type LogEntry = {
  message: string;
  timestamp: string;
};

type Result = {
  success: boolean;
  error?: string;
  apiKey?: string;
  outlookEmail?: string;
  outlookPassword?: string;
};

export default function ZenRowsRegister() {
  const { checking } = useServiceGuard("zenrows");
  const [showManual, setShowManual] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
      if (msg.type === "zenrows_register_result" && msg.batchId === batchIdRef.current) {
        setResult({ success: msg.success, error: msg.error, apiKey: msg.apiKey, outlookEmail: msg.outlookEmail, outlookPassword: msg.outlookPassword });
        if (msg.success) sounds.complete();
        else sounds.warning();
      }
      if (msg.type === "batch_complete" && msg.batchId === batchIdRef.current) {
        setIsRunning(false);
      }
    });
    return unsub;
  }, []);

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const startRegistration = useCallback(async (outlookEmail?: string, outlookPassword?: string) => {
    setError(null);
    setResult(null);
    setLogs([]);
    setIsRunning(true);
    sounds.navigate();

    try {
      const body: Record<string, string> = {};
      if (outlookEmail && outlookPassword) {
        body.outlookEmail = outlookEmail;
        body.outlookPassword = outlookPassword;
      }
      const res = await fetch("/api/zenrows-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start registration");
        setIsRunning(false);
        return;
      }
      setBatchId(data.batchId);
    } catch (err: any) {
      setError(err.message || "Network error");
      setIsRunning(false);
    }
  }, []);

  const handleAutoRegister = useCallback(() => {
    startRegistration();
  }, [startRegistration]);

  const handleManualRegister = useCallback(() => {
    if (!email.trim() || !password.trim()) {
      setError("Both Outlook email and password are required");
      return;
    }
    startRegistration(email.trim(), password.trim());
  }, [email, password, startRegistration]);

  if (checking) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/create-server">
            <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-300 hover:bg-emerald-500/5 font-mono text-xs" data-testid="button-back-create-server">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(16,185,129,0.1) 100%)', border: '1px solid rgba(34,197,94,0.2)' }}>
                <Globe className="w-4 h-4 text-emerald-400" />
              </div>
              <h1 className="text-lg font-bold text-white font-mono tracking-tight" data-testid="text-page-title">ZenRows Register</h1>
            </div>
            <p className="text-[10px] text-emerald-400/30 font-mono mt-0.5 tracking-wide">AUTO-CREATE ZENROWS ACCOUNT & EXTRACT API KEY</p>
          </div>
        </div>
        {isRunning && (
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 font-mono text-[10px] animate-pulse" data-testid="badge-running">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            REGISTERING
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <div className="rounded-xl p-5 space-y-4" style={{ background: 'linear-gradient(135deg, rgba(15,21,32,0.8) 0%, rgba(13,17,23,0.9) 100%)', border: '1px solid rgba(34,197,94,0.15)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Rocket className="w-3.5 h-3.5 text-emerald-400/70" />
              <span className="text-[10px] font-mono text-emerald-400/60 uppercase tracking-wider">One-Click Auto Registration</span>
            </div>

            <p className="text-xs text-zinc-400 font-mono leading-relaxed">
              Automatically creates a fresh Outlook account, registers it on ZenRows, verifies via email, and extracts the API key. No manual input needed.
            </p>

            {error && !showManual && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="text-error">
                <p className="text-xs text-red-400 font-mono">{error}</p>
              </div>
            )}

            <Button
              onClick={handleAutoRegister}
              disabled={isRunning}
              className="w-full h-12 font-mono text-sm rounded-lg text-white"
              style={{ background: isRunning ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg, rgba(34,197,94,0.4) 0%, rgba(16,185,129,0.3) 100%)', border: '1px solid rgba(34,197,94,0.4)' }}
              data-testid="button-auto-register"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating Account & Extracting API Key...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Create Account & Get API Key
                </>
              )}
            </Button>

            <div className="pt-2 space-y-1.5">
              <span className="text-[10px] font-mono text-emerald-400/30 uppercase tracking-wider">What happens</span>
              <ul className="space-y-1 text-[11px] text-zinc-500 font-mono">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400/40 mt-0.5">1</span>
                  Creates a fresh Outlook email account automatically
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400/40 mt-0.5">2</span>
                  Registers a new ZenRows account with that email
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400/40 mt-0.5">3</span>
                  Logs into Outlook to find & click the verification link
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400/40 mt-0.5">4</span>
                  Extracts the ZenRows API key and saves it
                </li>
              </ul>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(15,21,32,0.6) 0%, rgba(13,17,23,0.7) 100%)', border: '1px solid rgba(0,255,65,0.06)' }}>
            <button
              onClick={() => setShowManual(!showManual)}
              disabled={isRunning}
              className="w-full px-5 py-3 flex items-center justify-between text-left"
              data-testid="button-toggle-manual"
            >
              <div className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5 text-zinc-500/40" />
                <span className="text-[10px] font-mono text-zinc-500/50 uppercase tracking-wider">Use Existing Outlook Account</span>
              </div>
              {showManual ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
            </button>

            {showManual && (
              <div className="px-5 pb-5 space-y-3">
                <p className="text-[11px] text-zinc-500 font-mono leading-relaxed">
                  Already have an Outlook account? Enter it here to register on ZenRows directly.
                </p>

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
                    className="h-9 bg-black/30 border-emerald-500/10 text-emerald-50 font-mono text-sm rounded-lg placeholder:text-zinc-600"
                    data-testid="input-outlook-email"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
                    <Lock className="w-3 h-3" />
                    Outlook Password
                  </Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Outlook account password"
                    disabled={isRunning}
                    className="h-9 bg-black/30 border-emerald-500/10 text-emerald-50 font-mono text-sm rounded-lg placeholder:text-zinc-600"
                    onKeyDown={(e) => { if (e.key === "Enter" && !isRunning && email.trim() && password.trim()) handleManualRegister(); }}
                    data-testid="input-outlook-password"
                  />
                </div>

                {error && showManual && (
                  <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20" data-testid="text-error-manual">
                    <p className="text-xs text-red-400 font-mono">{error}</p>
                  </div>
                )}

                <Button
                  onClick={handleManualRegister}
                  disabled={isRunning || !email.trim() || !password.trim()}
                  className="w-full h-9 font-mono text-xs rounded-lg"
                  style={{ background: 'rgba(0,255,65,0.1)', border: '1px solid rgba(0,255,65,0.15)' }}
                  data-testid="button-manual-register"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 mr-1.5" />
                      Register with Existing Outlook
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {result && (
            <div
              className={`rounded-xl p-4 ${result.success ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}
              data-testid="zenrows-register-result"
            >
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400" />
                )}
                <span className={`text-sm font-mono font-bold ${result.success ? 'text-emerald-300' : 'text-red-300'}`}>
                  {result.success ? "Registration Successful" : "Registration Failed"}
                </span>
              </div>

              {result.success && result.outlookEmail && (
                <div className="mt-3 space-y-2 p-3 rounded-lg bg-black/20">
                  <span className="text-[10px] font-mono text-blue-400/50 uppercase tracking-wider">Outlook Account Created</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500 w-12">Email</span>
                    <code className="flex-1 text-xs font-mono text-blue-300 truncate" data-testid="text-outlook-email">{result.outlookEmail}</code>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[9px] text-blue-400/40 hover:text-blue-300 font-mono shrink-0" onClick={() => handleCopy(result.outlookEmail!, "email")} data-testid="button-copy-email">
                      {copied === "email" ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500 w-12">Pass</span>
                    <code className="flex-1 text-xs font-mono text-blue-300 truncate" data-testid="text-outlook-password">{result.outlookPassword}</code>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[9px] text-blue-400/40 hover:text-blue-300 font-mono shrink-0" onClick={() => handleCopy(result.outlookPassword!, "pass")} data-testid="button-copy-password">
                      {copied === "pass" ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
              )}

              {result.success && result.apiKey && (
                <div className="mt-3 space-y-1.5">
                  <span className="text-[10px] font-mono text-emerald-400/40 uppercase tracking-wider">ZenRows API Key</span>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono text-emerald-300 bg-black/30 px-3 py-2 rounded-lg truncate" data-testid="text-api-key">
                      {result.apiKey}
                    </code>
                    <Button variant="ghost" size="sm" className="h-8 px-3 text-[10px] text-emerald-400/50 hover:text-emerald-300 font-mono shrink-0" onClick={() => handleCopy(result.apiKey!, "apikey")} data-testid="button-copy-api-key">
                      {copied === "apikey" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              )}

              {result.error && (
                <p className="text-xs text-red-400/80 font-mono mt-1.5">{result.error}</p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(13,17,23,0.9)', border: '1px solid rgba(0,255,65,0.08)' }}>
          <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: 'rgba(0,255,65,0.03)', borderBottom: '1px solid rgba(0,255,65,0.06)' }}>
            <Terminal className="w-3.5 h-3.5 text-emerald-400/50" />
            <span className="text-[10px] font-mono text-emerald-400/40 uppercase tracking-wider">Live Logs</span>
            {logs.length > 0 && (
              <Badge variant="outline" className="ml-auto border-emerald-500/15 text-emerald-400/40 text-[9px] font-mono" data-testid="badge-log-count">
                {logs.length}
              </Badge>
            )}
          </div>
          <ScrollArea className="h-[500px]">
            <div className="p-3 space-y-0.5 font-mono text-[11px]">
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-zinc-600 text-xs" data-testid="text-no-logs">
                  Logs will appear here when registration starts...
                </div>
              ) : (
                logs.map((log, i) => {
                  const isError = log.message.toLowerCase().includes("error") || log.message.toLowerCase().includes("failed");
                  const isSuccess = log.message.includes("API Key") || log.message.includes("successful") || log.message.includes("solved") || log.message.includes("Complete!");
                  const isStep = log.message.startsWith("Step ");
                  return (
                    <div
                      key={i}
                      className={`py-1 px-2 rounded ${isError ? 'text-red-400/80 bg-red-500/5' : isSuccess ? 'text-emerald-400/80 bg-emerald-500/5' : isStep ? 'text-blue-400/80 bg-blue-500/5' : 'text-zinc-400'}`}
                      data-testid={`log-entry-${i}`}
                    >
                      <span className="text-emerald-400/20 mr-2">
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

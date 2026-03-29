import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Terminal, Zap, CheckCircle2, XCircle, Copy, Trash2, Key, Mail, Radio, RefreshCw } from "lucide-react";
import { sounds } from "@/lib/sounds";
import { useToast } from "@/hooks/use-toast";
import type { ElevenLabsAccount } from "@shared/schema";

const B = "#f97316";  // ElevenLabs orange
const BA = (a: number) => `rgba(249,115,22,${a})`;
const G = "#22c55e";
const GA = (a: number) => `rgba(34,197,94,${a})`;

function getLogStyle(text: string): { color: string } {
  if (text.startsWith("━━━") || text.startsWith("---")) return { color: "rgba(255,255,255,0.08)" };
  if (text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("created") || text.toLowerCase().includes("verified"))
    return { color: G };
  if (text.toLowerCase().includes("error") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("fail"))
    return { color: "#ef4444" };
  if (text.toLowerCase().includes("warn") || text.toLowerCase().includes("retry") || text.toLowerCase().includes("timeout"))
    return { color: "#f59e0b" };
  if (text.toLowerCase().includes("proxy") || text.toLowerCase().includes("soax") || text.toLowerCase().includes("browser") || text.toLowerCase().includes("launch"))
    return { color: "rgba(251,191,36,0.85)" };
  if (text.toLowerCase().includes("mail") || text.toLowerCase().includes("poll") || text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox"))
    return { color: "rgba(99,179,237,0.85)" };
  if (text.toLowerCase().includes("api key") || text.toLowerCase().includes("extract"))
    return { color: B };
  if (text.toLowerCase().includes("step") || text.toLowerCase().includes("navigat"))
    return { color: BA(0.8) };
  return { color: "rgba(255,255,255,0.55)" };
}

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type LogLine = { text: string; time: string };
type Result = { success: boolean; email?: string; password?: string; apiKey?: string; error?: string };

export default function ElevenLabsCreate() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [tick, setTick] = useState(true);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeBatchId = useRef<string | null>(null);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<ElevenLabsAccount[]>({
    queryKey: ["/api/elevenlabs-accounts"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/elevenlabs-accounts/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/elevenlabs-accounts"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => { const t = setInterval(() => setTick(p => !p), 600); return () => clearInterval(t); }, []);

  function addLog(text: string) {
    setLogs(prev => [...prev, { text, time: nowTime() }]);
  }

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.batchId && data.batchId !== activeBatchId.current) return;
        if (data.type === "log" && data.batchId === activeBatchId.current) {
          addLog(data.message);
        } else if (data.type === "elevenlabs_create_result" && data.batchId === activeBatchId.current) {
          setResult({ success: data.success, email: data.email, password: data.password, apiKey: data.apiKey, error: data.error });
          if (data.success) { sounds.complete(); queryClient.invalidateQueries({ queryKey: ["/api/elevenlabs-accounts"] }); }
          else sounds.warning();
        } else if (data.type === "batch_complete" && data.batchId === activeBatchId.current) {
          setRunning(false);
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const handleCreate = useCallback(async () => {
    setLogs([]);
    setResult(null);
    setRunning(true);
    sounds.navigate();
    addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    addLog("🚀 Starting ElevenLabs account creation...");

    try {
      const res = await fetch("/api/elevenlabs-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        addLog("❌ " + (data.error || "Failed to start"));
        setRunning(false);
        return;
      }
      activeBatchId.current = data.batchId;
      addLog(`[batch: ${data.batchId}]`);
    } catch (err: any) {
      addLog("❌ Network error: " + err.message);
      setRunning(false);
    }
  }, []);

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const border = `1px solid rgba(255,255,255,0.07)`;

  return (
    <div className="min-h-screen font-mono" style={{ background: "#08090a", color: "rgba(255,255,255,0.85)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: border, background: BA(0.03) }}>
        <div className="flex items-center gap-3">
          {/* ElevenLabs logo-ish */}
          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ background: BA(0.15), border: `1px solid ${BA(0.35)}` }}>
            <span className="text-[11px] font-black" style={{ color: B }}>11</span>
          </div>
          <div>
            <div className="text-sm font-bold tracking-wide" style={{ color: "rgba(255,255,255,0.9)" }}>
              ElevenLabs
            </div>
            <div className="text-[9px] tracking-[0.2em] uppercase mt-0.5" style={{ color: BA(0.5) }}>
              Auto-create · mail.gw temp email · SOAX proxy
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-[10px] px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.04)", border, color: "rgba(255,255,255,0.35)" }}>
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} saved
          </div>
          {running && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] tracking-widest uppercase"
              style={{ background: BA(0.08), border: `1px solid ${BA(0.3)}`, color: B }}>
              <Radio className="w-3 h-3 animate-pulse" />RUNNING
            </div>
          )}
          {result?.success && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] tracking-widest uppercase"
              style={{ background: GA(0.08), border: `1px solid ${GA(0.3)}`, color: G }}>
              <CheckCircle2 className="w-3 h-3" />SUCCESS
            </div>
          )}
          {result && !result.success && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] tracking-widest uppercase"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444" }}>
              <XCircle className="w-3 h-3" />FAILED
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] h-[calc(100vh-65px)]">

        {/* Left panel */}
        <div className="flex flex-col gap-0 overflow-y-auto" style={{ borderRight: border }}>

          {/* What happens */}
          <div className="p-5" style={{ borderBottom: border }}>
            <div className="text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: BA(0.5) }}>
              01 / How It Works
            </div>
            <div className="space-y-2">
              {[
                { icon: Mail, label: "mail.gw temp email", desc: "Random address generated" },
                { icon: Zap, label: "SOAX proxy", desc: "US residential IP assigned" },
                { icon: Terminal, label: "Browser signup", desc: "Navigates to elevenlabs.io" },
                { icon: Mail, label: "Verification", desc: "Polls inbox for email link" },
                { icon: Key, label: "API key", desc: "Extracted from settings" },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-center gap-3 text-[10px]">
                  <div className="w-6 h-6 rounded flex items-center justify-center shrink-0"
                    style={{ background: BA(0.08), border: `1px solid ${BA(0.15)}` }}>
                    <Icon className="w-3 h-3" style={{ color: B }} />
                  </div>
                  <span style={{ color: "rgba(255,255,255,0.6)" }}>{label}</span>
                  <span className="ml-auto" style={{ color: "rgba(255,255,255,0.3)" }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Launch button */}
          <div className="p-5" style={{ borderBottom: border }}>
            <div className="text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: BA(0.5) }}>
              02 / Create Account
            </div>
            <button
              onClick={handleCreate}
              disabled={running}
              className="w-full py-3 rounded flex items-center justify-center gap-2 text-sm tracking-wide font-bold transition-all"
              style={{
                background: running ? BA(0.06) : BA(0.15),
                border: `1px solid ${running ? BA(0.15) : BA(0.5)}`,
                color: running ? BA(0.4) : B,
                cursor: running ? "not-allowed" : "pointer",
                boxShadow: !running ? `0 0 24px ${BA(0.12)}` : "none",
              }}
              data-testid="button-create-elevenlabs"
            >
              {running ? (
                <>
                  <span className="inline-block w-3 h-3 border border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: `${BA(0.6)} transparent transparent transparent` }} />
                  Creating account...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Create ElevenLabs Account
                </>
              )}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className="p-5" style={{ borderBottom: border }}>
              <div className="text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: result.success ? GA(0.5) : "rgba(239,68,68,0.5)" }}>
                03 / Result
              </div>

              {result.success && (
                <div className="space-y-2">
                  {[
                    { label: "Email", value: result.email, key: "email", icon: Mail },
                    { label: "Password", value: result.password, key: "pwd", icon: Key },
                    ...(result.apiKey ? [{ label: "API Key", value: result.apiKey, key: "apikey", icon: Key }] : []),
                  ].map(({ label, value, key, icon: Icon }) => (
                    <div key={key} className="p-3 rounded" style={{ background: GA(0.04), border: `1px solid ${GA(0.15)}` }}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 text-[9px] tracking-widest uppercase" style={{ color: GA(0.5) }}>
                          <Icon className="w-3 h-3" />{label}
                        </div>
                        <button
                          onClick={() => handleCopy(value!, key)}
                          className="p-1 rounded transition-colors"
                          style={{ color: copied === key ? G : "rgba(255,255,255,0.3)", background: GA(0.06) }}
                          data-testid={`button-copy-${key}`}
                        >
                          {copied === key ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <div className="text-[11px] break-all" style={{ color: "rgba(255,255,255,0.8)" }}
                        data-testid={`text-${key}`}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {!result.success && result.error && (
                <div className="p-3 rounded" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <div className="text-[9px] tracking-widest uppercase mb-1.5" style={{ color: "rgba(239,68,68,0.5)" }}>Error</div>
                  <div className="text-[11px]" style={{ color: "#f87171" }} data-testid="text-error">{result.error}</div>
                </div>
              )}
            </div>
          )}

          {/* Saved accounts */}
          <div className="p-5 flex-1">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[9px] tracking-[0.25em] uppercase" style={{ color: BA(0.5) }}>
                04 / Saved Accounts ({accounts.length})
              </div>
              <button onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/elevenlabs-accounts"] })}
                className="p-1 rounded" style={{ color: "rgba(255,255,255,0.3)" }}
                data-testid="button-refresh-accounts">
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            {accountsLoading ? (
              <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>Loading...</div>
            ) : accounts.length === 0 ? (
              <div className="text-[10px] text-center py-4" style={{ color: "rgba(255,255,255,0.2)" }}>
                No accounts yet — create one above
              </div>
            ) : (
              <div className="space-y-1.5">
                {accounts.map(acc => (
                  <div key={acc.id} className="flex items-center gap-2 p-2.5 rounded"
                    style={{ background: "rgba(255,255,255,0.03)", border }}
                    data-testid={`account-${acc.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] truncate" style={{ color: "rgba(255,255,255,0.7)" }}>{acc.email}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{ background: acc.status === "active" ? GA(0.1) : "rgba(255,255,255,0.05)", color: acc.status === "active" ? G : "rgba(255,255,255,0.3)", border: `1px solid ${acc.status === "active" ? GA(0.2) : "rgba(255,255,255,0.07)"}` }}>
                          {acc.status}
                        </span>
                        {acc.apiKey && <span className="text-[9px]" style={{ color: BA(0.5) }}>has API key</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleCopy(`Email: ${acc.email}\nPassword: ${acc.password}${acc.apiKey ? `\nAPI Key: ${acc.apiKey}` : ""}`, `acc-${acc.id}`)}
                        className="p-1.5 rounded" style={{ color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.04)" }}
                        data-testid={`button-copy-account-${acc.id}`}>
                        {copied === `acc-${acc.id}` ? <CheckCircle2 className="w-3 h-3" style={{ color: G }} /> : <Copy className="w-3 h-3" />}
                      </button>
                      <button onClick={() => deleteMutation.mutate(acc.id)}
                        className="p-1.5 rounded" style={{ color: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.04)" }}
                        data-testid={`button-delete-account-${acc.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — terminal */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom: border, background: "rgba(255,255,255,0.015)" }}>
            <Terminal className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>Live Terminal</span>
            {running && (
              <span className="text-[9px]" style={{ color: BA(0.5) }}>
                {tick ? "█" : " "} recording
              </span>
            )}
            {logs.length > 0 && (
              <span className="ml-auto text-[9px] px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", border, color: "rgba(255,255,255,0.25)" }}>
                {logs.length} lines
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4" style={{ background: "#060708" }}>
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-12 h-12 rounded flex items-center justify-center" style={{ background: BA(0.06), border: `1px solid ${BA(0.15)}` }}>
                  <span className="text-lg font-black" style={{ color: BA(0.4) }}>11</span>
                </div>
                <div className="text-xs text-center" style={{ color: "rgba(255,255,255,0.2)" }}>
                  Click "Create ElevenLabs Account" to start<br />
                  <span style={{ color: "rgba(255,255,255,0.12)" }}>logs stream here in real-time</span>
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((log, i) => {
                  const { color } = getLogStyle(log.text);
                  const isSep = log.text.startsWith("━━━") || log.text.startsWith("---");
                  return (
                    <div key={i} className={`flex items-start gap-2 text-[11px] leading-relaxed ${isSep ? "my-1" : ""}`}
                      data-testid={`log-${i}`}>
                      <span className="shrink-0 text-[9px] mt-0.5 tabular-nums" style={{ color: "rgba(255,255,255,0.15)", minWidth: "60px" }}>{log.time}</span>
                      <span style={{ color }}>{log.text}</span>
                    </div>
                  );
                })}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>

          <div className="px-4 py-2 shrink-0 flex items-center gap-4" style={{ borderTop: border, background: "rgba(255,255,255,0.01)" }}>
            <span className="text-[9px] tracking-widest" style={{ color: "rgba(255,255,255,0.15)" }}>mail.gw · SOAX · elevenlabs.io/app/sign-up</span>
            <span className="ml-auto text-[9px]" style={{ color: running ? BA(0.5) : result?.success ? GA(0.5) : "rgba(255,255,255,0.15)" }}>
              {running ? "● active" : result?.success ? "● done" : "○ idle"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

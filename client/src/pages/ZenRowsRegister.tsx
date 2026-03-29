import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServiceGuard } from "@/lib/useServiceGuard";
import { sounds } from "@/lib/sounds";
import { ArrowLeft, Terminal, Key, CheckCircle2, XCircle, Copy, ChevronDown, Zap, Radio } from "lucide-react";
import { Link } from "wouter";

type OutlookAccount = { id: string; email: string; password: string; status: string };
type LogLine = { text: string; time: string };

const G = "#00ff41";
const GA = (a: number) => `rgba(0,255,65,${a})`;

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━") || text.startsWith("---")) return { color: GA(0.2), prefix: "" };
  if (text.toLowerCase().includes("api key") || text.toLowerCase().includes("success") || text.toLowerCase().includes("complete") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("extracted"))
    return { color: G, prefix: "+" };
  if (text.toLowerCase().includes("error") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("fail"))
    return { color: "#ff4141", prefix: "!" };
  if (text.toLowerCase().includes("warn") || text.toLowerCase().includes("retry") || text.toLowerCase().includes("timeout"))
    return { color: "#ffaa00", prefix: "~" };
  if (text.toLowerCase().includes("soax") || text.toLowerCase().includes("proxy") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser"))
    return { color: GA(0.75), prefix: ">" };
  if (text.toLowerCase().includes("captcha") || text.toLowerCase().includes("turnstile") || text.toLowerCase().includes("recaptcha"))
    return { color: "rgba(255,200,50,0.85)", prefix: "~" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("outlook") || text.toLowerCase().includes("verif"))
    return { color: "rgba(0,200,255,0.75)", prefix: "·" };
  if (text.toLowerCase().includes("step "))
    return { color: "rgba(180,120,255,0.9)", prefix: "»" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("register") || text.toLowerCase().includes("login"))
    return { color: GA(0.65), prefix: ">" };
  return { color: GA(0.45), prefix: "·" };
}

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ZenRowsRegister() {
  const { checking } = useServiceGuard("zenrows");

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; apiKey?: string; error?: string; outlookEmail?: string } | null>(null);
  const [selectedOutlookId, setSelectedOutlookId] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [tick, setTick] = useState(true);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeBatchId = useRef<string | null>(null);

  const { data: outlookAccounts = [] } = useQuery<OutlookAccount[]>({
    queryKey: ["/api/private/outlook"],
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
        } else if (data.type === "zenrows_register_result" && data.batchId === activeBatchId.current) {
          setResult({ success: data.success, apiKey: data.apiKey, error: data.error, outlookEmail: data.outlookEmail });
          if (data.success) { sounds.complete(); addLog("✅ API key extracted and saved!"); }
          else { sounds.warning(); addLog("❌ Registration failed: " + (data.error || "Unknown error")); }
        } else if (data.type === "batch_complete" && data.batchId === activeBatchId.current) {
          setRunning(false);
        }
      } catch {}
    };
    return () => { ws.close(); };
  }, []);

  const selectedOutlook = outlookAccounts.find(a => a.id === selectedOutlookId);

  const handleRegister = useCallback(async () => {
    if (!selectedOutlookId || !selectedOutlook) {
      addLog("❌ Select an Outlook account first");
      return;
    }
    setLogs([]);
    setResult(null);
    setRunning(true);
    sounds.navigate();
    addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    addLog(`🚀 Starting ZenRows registration via SOAX proxy...`);
    addLog(`📧 Using Outlook: ${selectedOutlook.email}`);

    try {
      const res = await fetch("/api/zenrows-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ outlookEmail: selectedOutlook.email, outlookPassword: selectedOutlook.password }),
      });
      const data = await res.json();
      if (!res.ok) {
        addLog("❌ " + (data.error || "Failed to start registration"));
        setRunning(false);
        return;
      }
      activeBatchId.current = data.batchId;
      addLog(`[batch: ${data.batchId}]`);
    } catch (err: any) {
      addLog("❌ Network error: " + err.message);
      setRunning(false);
    }
  }, [selectedOutlookId, selectedOutlook]);

  const handleCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-t-transparent rounded-full" style={{ borderColor: `${G} transparent transparent transparent` }} />
      </div>
    );
  }

  const border = `1px solid ${GA(0.12)}`;
  const panelBg = "rgba(8,12,8,0.97)";

  return (
    <div className="min-h-screen font-mono" style={{ background: "#060a06", color: G }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: border, background: "rgba(0,255,65,0.02)" }}>
        <div className="flex items-center gap-4">
          <Link href="/admin/create-server">
            <button className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: GA(0.45) }}
              onMouseEnter={e => (e.currentTarget.style.color = GA(0.8))}
              onMouseLeave={e => (e.currentTarget.style.color = GA(0.45))}
              data-testid="button-back">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          </Link>
          <div style={{ width: "1px", height: "16px", background: GA(0.15) }} />
          <div>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4" style={{ color: G }} />
              <span className="text-sm font-bold tracking-widest uppercase" style={{ color: G }}>
                ZenRows Register
              </span>
            </div>
            <div className="text-[9px] tracking-[0.25em] uppercase mt-0.5" style={{ color: GA(0.3) }}>
              Auto-register via SOAX residential proxy · extract API key
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {running && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded text-[10px] tracking-widest uppercase"
              style={{ background: GA(0.06), border: `1px solid ${GA(0.2)}`, color: G }}>
              <Radio className="w-3 h-3 animate-pulse" />
              RUNNING
            </div>
          )}
          {result?.success && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded text-[10px] tracking-widest uppercase"
              style={{ background: "rgba(0,255,65,0.08)", border: `1px solid ${GA(0.3)}`, color: G }}>
              <CheckCircle2 className="w-3 h-3" />
              SUCCESS
            </div>
          )}
          {result && !result.success && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded text-[10px] tracking-widest uppercase"
              style={{ background: "rgba(255,65,65,0.08)", border: "1px solid rgba(255,65,65,0.3)", color: "#ff4141" }}>
              <XCircle className="w-3 h-3" />
              FAILED
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] h-[calc(100vh-65px)]">

        {/* Left panel - Controls */}
        <div className="flex flex-col gap-0" style={{ borderRight: border }}>

          {/* Outlook account selector */}
          <div className="p-5" style={{ borderBottom: border }}>
            <div className="text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: GA(0.35) }}>
              01 / Select Outlook Account
            </div>

            {/* Dropdown */}
            <div className="relative">
              <button
                onClick={() => !running && setDropdownOpen(o => !o)}
                disabled={running}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs rounded"
                style={{ background: "rgba(0,255,65,0.04)", border: `1px solid ${GA(selectedOutlook ? 0.25 : 0.1)}`, color: selectedOutlook ? G : GA(0.35), cursor: running ? "not-allowed" : "pointer" }}
                data-testid="button-select-outlook"
              >
                <span className="truncate">
                  {selectedOutlook ? selectedOutlook.email : "— select outlook account —"}
                </span>
                <ChevronDown className="w-3.5 h-3.5 shrink-0 ml-2" style={{ color: GA(0.4) }} />
              </button>

              {dropdownOpen && !running && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded overflow-hidden"
                  style={{ background: "#0a120a", border: `1px solid ${GA(0.2)}`, maxHeight: "240px", overflowY: "auto" }}>
                  {outlookAccounts.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[11px]" style={{ color: GA(0.3) }}>
                      No Outlook accounts found
                    </div>
                  ) : (
                    outlookAccounts.map(acc => (
                      <button
                        key={acc.id}
                        onClick={() => { setSelectedOutlookId(acc.id); setDropdownOpen(false); }}
                        className="w-full text-left px-3 py-2.5 text-xs transition-colors block"
                        style={{ color: selectedOutlookId === acc.id ? G : GA(0.55), background: selectedOutlookId === acc.id ? GA(0.06) : "transparent", borderBottom: `1px solid ${GA(0.06)}` }}
                        onMouseEnter={e => { if (selectedOutlookId !== acc.id) (e.currentTarget as HTMLElement).style.background = GA(0.04); }}
                        onMouseLeave={e => { if (selectedOutlookId !== acc.id) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        data-testid={`option-outlook-${acc.id}`}
                      >
                        <div className="truncate">{acc.email}</div>
                        <div className="text-[9px] mt-0.5" style={{ color: GA(0.25) }}>{acc.status}</div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {selectedOutlook && (
              <div className="mt-2 px-2 py-1.5 rounded text-[10px]" style={{ background: GA(0.04), border: `1px solid ${GA(0.08)}` }}>
                <span style={{ color: GA(0.35) }}>password: </span>
                <span style={{ color: GA(0.6) }}>{selectedOutlook.password.substring(0, 6)}••••••</span>
              </div>
            )}
          </div>

          {/* Info section */}
          <div className="p-5" style={{ borderBottom: border }}>
            <div className="text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: GA(0.35) }}>
              02 / What Happens
            </div>
            <div className="space-y-2">
              {[
                ["SOAX proxy", "US residential IP assigned"],
                ["Browser", "Navigates to app.zenrows.com/register"],
                ["Signup", "Registers with selected Outlook email"],
                ["Verification", "Checks Outlook inbox for confirm link"],
                ["API Key", "Extracts key, auto-saves to settings"],
              ].map(([label, desc]) => (
                <div key={label} className="flex items-start gap-2 text-[10px]">
                  <span style={{ color: GA(0.3) }}>›</span>
                  <span style={{ color: GA(0.5) }}>{label}:</span>
                  <span style={{ color: GA(0.35) }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Register button */}
          <div className="p-5" style={{ borderBottom: border }}>
            <div className="text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: GA(0.35) }}>
              03 / Execute
            </div>
            <button
              onClick={handleRegister}
              disabled={running || !selectedOutlookId}
              className="w-full py-3 rounded flex items-center justify-center gap-2 text-xs tracking-widest uppercase transition-all font-bold"
              style={{
                background: running ? GA(0.06) : selectedOutlookId ? GA(0.12) : "rgba(0,255,65,0.03)",
                border: `1px solid ${running ? GA(0.2) : selectedOutlookId ? GA(0.45) : GA(0.08)}`,
                color: running ? GA(0.4) : selectedOutlookId ? G : GA(0.2),
                cursor: running || !selectedOutlookId ? "not-allowed" : "pointer",
                boxShadow: (!running && selectedOutlookId) ? `0 0 20px ${GA(0.08)}` : "none",
              }}
              data-testid="button-register"
            >
              {running ? (
                <>
                  <span className="inline-block w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: `${GA(0.6)} transparent transparent transparent` }} />
                  Registering...
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Register &amp; Extract API Key
                </>
              )}
            </button>
          </div>

          {/* Result */}
          {result && (
            <div className="p-5 flex-1 overflow-y-auto">
              <div className="text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: result.success ? GA(0.4) : "rgba(255,65,65,0.4)" }}>
                04 / Result
              </div>

              {result.success && result.apiKey && (
                <div className="space-y-3">
                  <div className="p-3 rounded" style={{ background: GA(0.05), border: `1px solid ${GA(0.2)}` }}>
                    <div className="text-[9px] tracking-widest uppercase mb-2" style={{ color: GA(0.35) }}>
                      <Key className="w-3 h-3 inline mr-1" />API Key
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[11px] break-all" style={{ color: G }} data-testid="text-api-key">
                        {result.apiKey}
                      </code>
                      <button
                        onClick={() => handleCopy(result.apiKey!, "apikey")}
                        className="shrink-0 p-1.5 rounded transition-colors"
                        style={{ color: copied === "apikey" ? G : GA(0.35), background: GA(0.06) }}
                        data-testid="button-copy-api-key"
                      >
                        {copied === "apikey" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] px-1" style={{ color: GA(0.3) }}>
                    Auto-saved to settings as active ZenRows key.
                  </div>
                </div>
              )}

              {result.success && result.outlookEmail && (
                <div className="mt-3 p-3 rounded" style={{ background: "rgba(0,200,255,0.04)", border: "1px solid rgba(0,200,255,0.15)" }}>
                  <div className="text-[9px] tracking-widest uppercase mb-2" style={{ color: "rgba(0,200,255,0.4)" }}>Outlook Used</div>
                  <div className="text-[11px]" style={{ color: "rgba(0,200,255,0.7)" }} data-testid="text-outlook-email">{result.outlookEmail}</div>
                </div>
              )}

              {!result.success && result.error && (
                <div className="p-3 rounded" style={{ background: "rgba(255,65,65,0.06)", border: "1px solid rgba(255,65,65,0.2)" }}>
                  <div className="text-[9px] tracking-widest uppercase mb-1.5" style={{ color: "rgba(255,65,65,0.5)" }}>Error</div>
                  <div className="text-[11px]" style={{ color: "#ff7070" }} data-testid="text-error">{result.error}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel - Terminal logs */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom: border, background: "rgba(0,255,65,0.02)" }}>
            <Terminal className="w-3.5 h-3.5" style={{ color: GA(0.45) }} />
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: GA(0.35) }}>Live Terminal</span>
            {running && (
              <span className="text-[9px] tracking-widest ml-1" style={{ color: GA(0.4) }}>
                {tick ? "█" : " "} recording
              </span>
            )}
            {logs.length > 0 && (
              <span className="ml-auto text-[9px] px-2 py-0.5 rounded" style={{ background: GA(0.05), border: `1px solid ${GA(0.1)}`, color: GA(0.35) }}>
                {logs.length} lines
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4" style={{ background: panelBg }}>
            {logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Terminal className="w-8 h-8" style={{ color: GA(0.12) }} />
                <div className="text-xs text-center" style={{ color: GA(0.2) }}>
                  Select an Outlook account and click Register<br />
                  <span style={{ color: GA(0.15) }}>logs will stream here in real-time</span>
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((log, i) => {
                  const { color, prefix } = getLogStyle(log.text);
                  const isSep = log.text.startsWith("━━━") || log.text.startsWith("---");
                  return (
                    <div key={i} className={`flex items-start gap-2 text-[11px] leading-relaxed ${isSep ? "my-1" : ""}`} data-testid={`log-${i}`}>
                      <span className="shrink-0 text-[9px] mt-0.5 tabular-nums" style={{ color: GA(0.2), minWidth: "60px" }}>{log.time}</span>
                      {prefix && <span className="shrink-0 w-3" style={{ color }}>{prefix}</span>}
                      <span style={{ color }}>{log.text}</span>
                    </div>
                  );
                })}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>

          {/* Terminal footer */}
          <div className="px-4 py-2 shrink-0 flex items-center gap-4" style={{ borderTop: border, background: "rgba(0,255,65,0.015)" }}>
            <span className="text-[9px] tracking-widest" style={{ color: GA(0.25) }}>SOAX · US RESIDENTIAL · ZENROWS REG</span>
            <span className="ml-auto text-[9px]" style={{ color: GA(0.2) }}>
              {running ? "● active" : result?.success ? "● done" : "○ idle"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

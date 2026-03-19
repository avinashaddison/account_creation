import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { Layers, Play, Mail, Key, Hash, ChevronRight, Cpu, Radio, Trash2, User } from "lucide-react";

type OutlookAccount = { id: string; email: string; password: string; status: string };
type AdobeAccount = { id: string; email: string; password: string | null; firstName: string | null; lastName: string | null; outlookEmail: string | null; status: string; error: string | null; createdAt: string };
type LogLine = { text: string; ts: number; time: string };

const R = "#ff4500";
const RA = (a: number) => `rgba(255,69,0,${a})`;

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━") || text.startsWith("---")) return { color: RA(0.25), prefix: "" };
  if (text.startsWith("🚀") || text.startsWith("🏁")) return { color: R, prefix: ">" };
  if (text.includes("✅") || text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("verified") || text.toLowerCase().includes("complete"))
    return { color: R, prefix: "+" };
  if (text.includes("❌") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("error"))
    return { color: "#ff4141", prefix: "!" };
  if (text.includes("⚠️") || text.toLowerCase().includes("warn"))
    return { color: "#ffaa00", prefix: "~" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser"))
    return { color: RA(0.7), prefix: ">" };
  if (text.toLowerCase().includes("name") || text.toLowerCase().includes("password") || text.toLowerCase().includes("generated") || text.toLowerCase().includes("dob"))
    return { color: RA(0.9), prefix: "»" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox") || text.toLowerCase().includes("outlook") || text.toLowerCase().includes("code"))
    return { color: "rgba(0,200,255,0.7)", prefix: "·" };
  return { color: RA(0.45), prefix: "·" };
}

export default function AdobeCreate() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [outlookEmail, setOutlookEmail] = useState("");
  const [outlookPassword, setOutlookPassword] = useState("");
  const [selectedOutlookId, setSelectedOutlookId] = useState("");
  const [count, setCount] = useState(1);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [tick, setTick] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeBatchId = useRef<string | null>(null);

  const { data: outlookAccounts = [] } = useQuery<OutlookAccount[]>({ queryKey: ["/api/private/outlook"] });
  const { data: adobeAccounts = [], refetch: refetchAdobe } = useQuery<AdobeAccount[]>({ queryKey: ["/api/adobe-accounts"], refetchInterval: running ? 4000 : false });

  const usedEmails = new Set(adobeAccounts.map((a) => a.outlookEmail?.toLowerCase()).filter(Boolean));
  const availableOutlookAccounts = outlookAccounts.filter((a) => !usedEmails.has(a.email.toLowerCase()));

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => { const t = setInterval(() => setTick((p) => !p), 600); return () => clearInterval(t); }, []);

  function nowTime() { return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function addLog(text: string) { setLogs((prev) => [...prev, { text, ts: Date.now(), time: nowTime() }]); }

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.batchId && data.batchId === activeBatchId.current) {
          if (data.type === "log") { addLog(data.message); }
          else if (data.type === "batch_complete") {
            setRunning(false);
            sounds.complete();
            qc.invalidateQueries({ queryKey: ["/api/adobe-accounts"] });
            qc.invalidateQueries({ queryKey: ["/api/private/outlook"] });
          } else if (data.type === "adobe_create_result") {
            if (data.success) {
              setCompletedCount((p) => p + 1);
              sounds.success();
              toast({ title: "✅ Adobe Account Created", description: data.email });
            } else {
              sounds.error();
              toast({ title: "❌ Creation Failed", description: data.error || "Unknown error", variant: "destructive" });
            }
          }
        }
      } catch {}
    };
    return () => ws.close();
  }, []);

  const handleOutlookSelect = (id: string) => {
    sounds.click();
    setSelectedOutlookId(id);
    const acct = availableOutlookAccounts.find((a) => a.id === id);
    if (acct) { setOutlookEmail(acct.email); setOutlookPassword(acct.password); }
  };

  const handleCreate = async () => {
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);

    if (count > 1) {
      setTotalCount(count);
      try {
        const res = await apiRequest("POST", "/api/adobe-create/bulk", { count });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to start bulk");
        activeBatchId.current = data.batchId;
        setTotalCount(data.count);
        addLog(`🚀 Bulk job started — ${data.count} Adobe account(s) queued [${data.batchId}]`);
      } catch (err: any) {
        sounds.error();
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setRunning(false);
      }
    } else {
      if (!outlookEmail || !outlookPassword) {
        sounds.error();
        toast({ title: "Missing fields", description: "Select or enter an Outlook account", variant: "destructive" });
        setRunning(false);
        return;
      }
      setTotalCount(1);
      try {
        const res = await apiRequest("POST", "/api/adobe-create", { outlookEmail, outlookPassword });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to start");
        activeBatchId.current = data.batchId;
        addLog(`Job started: ${data.batchId}`);
      } catch (err: any) {
        sounds.error();
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setRunning(false);
      }
    }
  };

  const handleDelete = async (id: string) => {
    sounds.click();
    try {
      await apiRequest("DELETE", `/api/adobe-accounts/${id}`);
      qc.invalidateQueries({ queryKey: ["/api/adobe-accounts"] });
    } catch {}
  };

  const isBulk = count > 1;
  const canCreate = isBulk ? availableOutlookAccounts.length > 0 : (!!outlookEmail && !!outlookPassword);
  const maxCount = Math.min(20, availableOutlookAccounts.length || 1);
  const pct = maxCount > 1 ? ((count - 1) / (maxCount - 1)) * 100 : 100;

  return (
    <div className="space-y-6 animate-float-up">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 flex items-center justify-center" style={{ filter: `drop-shadow(0 0 8px ${R})` }}>
              <svg viewBox="0 0 24 24" fill={R} width="18" height="18"><path d="M13.966 22.624l-1.69-4.281H8.122l4.294-8.835 4.808 13.116zM3 6.834l3.682 10.093H1.212zm17.786 0L18 16.927h5.47z"/></svg>
            </div>
            <h1 className="text-lg font-mono font-bold tracking-tight" style={{ color: R, textShadow: `0 0 24px ${RA(0.55)}` }}>
              adobe_create<span style={{ color: R }}>{tick ? "_" : "\u00a0"}</span>
            </h1>
          </div>
          <p className="text-[11px] font-mono mt-0.5 pl-8" style={{ color: RA(0.32) }}>
            automate adobe account creation via outlook credentials
          </p>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] font-mono">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: RA(0.05), border: `1px solid ${RA(0.18)}` }}>
            <Cpu className="w-3 h-3" style={{ color: RA(0.55) }} />
            <span style={{ color: R, textShadow: `0 0 8px ${RA(0.5)}` }}>{availableOutlookAccounts.length}</span>
            <span style={{ color: RA(0.3) }}>avail</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ color: "rgba(255,255,255,0.3)" }}>{usedEmails.size}</span>
            <span style={{ color: "rgba(255,255,255,0.14)" }}>created</span>
          </div>
        </div>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Config panel */}
        <div className="rounded-xl p-5 space-y-5 relative overflow-hidden" style={{ background: "rgba(0,0,0,0.55)", border: `1px solid ${RA(0.14)}`, boxShadow: `0 0 40px ${RA(0.04)} inset` }}>
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,69,0,0.012) 2px, rgba(255,69,0,0.012) 4px)", borderRadius: "inherit" }} />

          <div className="flex items-center gap-2">
            <ChevronRight className="w-3.5 h-3.5" style={{ color: R }} />
            <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: RA(0.55) }}>Configuration</span>
            <div className="flex-1 h-px" style={{ background: RA(0.1) }} />
          </div>

          {/* Count slider */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest mb-2.5" style={{ color: RA(0.4) }}>
              <Hash className="w-3 h-3" />
              Accounts to Create
            </label>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  type="range" min={1} max={maxCount} value={count}
                  onChange={(e) => { sounds.toggle(); setCount(parseInt(e.target.value)); }}
                  className="w-full h-1.5 rounded-full cursor-pointer appearance-none"
                  style={{ background: `linear-gradient(to right, ${RA(0.7)} ${pct}%, rgba(255,255,255,0.07) ${pct}%)`, accentColor: R }}
                  data-testid="input-count-slider"
                />
              </div>
              <div className="w-11 h-8 rounded-lg flex items-center justify-center text-base font-mono font-bold flex-shrink-0" style={{ background: RA(0.08), border: `1px solid ${RA(0.35)}`, color: R, textShadow: `0 0 10px ${R}`, boxShadow: `0 0 12px ${RA(0.1)} inset` }}>
                {count}
              </div>
            </div>
            {isBulk && (
              <p className="text-[10px] font-mono mt-2 flex items-center gap-1.5" style={{ color: RA(0.32) }}>
                <Layers className="w-3 h-3" />
                bulk mode — picks {count} random from {availableOutlookAccounts.length} pool
              </p>
            )}
          </div>

          {!isBulk && (
            <>
              {availableOutlookAccounts.length > 0 && (
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: RA(0.4) }}>Stored Outlook Account</label>
                  <select
                    value={selectedOutlookId} onChange={(e) => handleOutlookSelect(e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none"
                    style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${RA(0.18)}`, color: "rgba(255,255,255,0.75)" }}
                    data-testid="select-outlook-account"
                  >
                    <option value="">— Select account —</option>
                    {availableOutlookAccounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: RA(0.4) }}>
                  <Mail className="w-2.5 h-2.5 inline mr-1" />Outlook Email
                </label>
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${RA(0.14)}` }}>
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: RA(0.38) }} />
                  <input
                    type="email" value={outlookEmail} onChange={(e) => setOutlookEmail(e.target.value)}
                    onKeyDown={() => sounds.keypress()} placeholder="yourname@outlook.com"
                    className="bg-transparent flex-1 text-xs font-mono focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.8)", caretColor: R }}
                    data-testid="input-outlook-email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: RA(0.4) }}>
                  <Key className="w-2.5 h-2.5 inline mr-1" />Outlook Password
                </label>
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${RA(0.14)}` }}>
                  <Key className="w-3.5 h-3.5 flex-shrink-0" style={{ color: RA(0.38) }} />
                  <input
                    type="password" value={outlookPassword} onChange={(e) => setOutlookPassword(e.target.value)}
                    onKeyDown={() => sounds.keypress()} placeholder="••••••••"
                    className="bg-transparent flex-1 text-xs font-mono focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.8)", caretColor: R }}
                    data-testid="input-outlook-password"
                  />
                </div>
              </div>
            </>
          )}

          {/* Create button */}
          <button
            onClick={handleCreate} disabled={running || !canCreate}
            className="relative w-full flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200 overflow-hidden"
            style={{
              background: running || !canCreate ? RA(0.04) : `linear-gradient(135deg, ${RA(0.2)}, ${RA(0.08)})`,
              border: `1px solid ${running || !canCreate ? RA(0.08) : RA(0.5)}`,
              color: running || !canCreate ? RA(0.25) : R,
              textShadow: running || !canCreate ? "none" : `0 0 14px ${R}`,
              boxShadow: running || !canCreate ? "none" : `0 0 25px ${RA(0.1)}, inset 0 1px 0 ${RA(0.12)}`,
              cursor: running || !canCreate ? "not-allowed" : "pointer",
            }}
            data-testid="button-create-adobe"
          >
            {!(running || !canCreate) && <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,69,0,0.025) 2px, rgba(255,69,0,0.025) 4px)" }} />}
            <Play className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
            <span className="relative z-10">
              {running
                ? totalCount > 1 ? `creating ${completedCount}/${totalCount}...` : "creating account..."
                : isBulk ? `bulk_create ${count} account${count > 1 ? "s" : ""}` : "create_adobe_account"}
            </span>
          </button>

          {running && totalCount > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: RA(0.38) }}>
                <span>progress</span>
                <span style={{ color: R, textShadow: `0 0 8px ${RA(0.5)}` }}>{completedCount}/{totalCount}</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(completedCount / totalCount) * 100}%`, background: `linear-gradient(90deg, ${R}, rgba(255,100,0,0.7))`, boxShadow: `0 0 10px ${RA(0.7)}` }} />
              </div>
            </div>
          )}
        </div>

        {/* Terminal panel */}
        <div className="min-w-0">
          <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: "rgba(0,0,0,0.75)", border: `1px solid ${RA(0.12)}`, boxShadow: `0 0 40px ${RA(0.03)}` }}>
            <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ background: RA(0.03), borderBottom: `1px solid ${RA(0.08)}` }}>
              <div className="flex items-center gap-2.5">
                <Radio className="w-3 h-3" style={{ color: running ? R : RA(0.28), filter: running ? `drop-shadow(0 0 5px ${R})` : "none" }} />
                <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: RA(0.45) }}>live_output</span>
                {running && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: R, boxShadow: `0 0 6px ${R}` }} />
                    <span className="text-[9px] font-mono font-bold" style={{ color: RA(0.65) }}>RUNNING</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,59,48,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,149,0,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: RA(0.55) }} />
              </div>
            </div>

            <div className="overflow-y-auto overflow-x-hidden p-4 space-y-0.5 font-mono" style={{ height: "380px", wordBreak: "break-all", overflowWrap: "anywhere" }} data-testid="container-logs">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <p className="text-[10px] font-mono" style={{ color: RA(0.18) }}>waiting for output...</p>
                </div>
              ) : (
                logs.map((line, i) => {
                  const { color, prefix } = getLogStyle(line.text);
                  const isSep = line.text.startsWith("━━━") || line.text.startsWith("---");
                  return (
                    <div key={i} className={`flex items-start gap-2 min-w-0 ${isSep ? "mt-2 mb-1 opacity-30" : "py-px"}`}>
                      <span className="text-[9px] flex-shrink-0 mt-0.5 tabular-nums" style={{ color: RA(0.22) }}>{line.time}</span>
                      <span className="text-[10px] flex-shrink-0 mt-0.5 w-3 text-center font-bold" style={{ color }}>{prefix}</span>
                      <span className="text-[11px] leading-relaxed break-words min-w-0 overflow-hidden" style={{ color, textShadow: color === R ? `0 0 8px ${RA(0.4)}` : "none" }}>{line.text}</span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="px-4 py-2 flex items-center gap-2" style={{ background: RA(0.02), borderTop: `1px solid ${RA(0.07)}` }}>
              <span className="text-[9px] font-mono" style={{ color: RA(0.25) }}>addison@panel:~$</span>
              <span className="text-[9px] font-mono" style={{ color: RA(0.4) }}>{running ? "executing adobe_create..." : "ready"}</span>
              <span className="w-1.5 h-3 ml-px" style={{ background: tick && !running ? R : "transparent", boxShadow: tick && !running ? `0 0 6px ${R}` : "none" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Accounts table */}
      {adobeAccounts.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${RA(0.1)}` }}>
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: RA(0.03), borderBottom: `1px solid ${RA(0.08)}` }}>
            <User className="w-3.5 h-3.5" style={{ color: RA(0.55) }} />
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: RA(0.4) }}>Created Adobe Accounts</span>
            <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: RA(0.1), color: R }}>{adobeAccounts.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr style={{ borderBottom: `1px solid ${RA(0.07)}` }}>
                  {["Email", "Name", "Password", "Outlook", "Created", ""].map((h) => (
                    <th key={h} className="px-4 py-2 text-left font-medium" style={{ color: RA(0.35) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adobeAccounts.map((acc) => (
                  <tr key={acc.id} style={{ borderBottom: `1px solid ${RA(0.05)}` }} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5" style={{ color: "rgba(255,255,255,0.75)" }}>{acc.email}</td>
                    <td className="px-4 py-2.5" style={{ color: "rgba(255,255,255,0.55)" }}>{acc.firstName} {acc.lastName}</td>
                    <td className="px-4 py-2.5" style={{ color: RA(0.7) }}>{acc.password || "—"}</td>
                    <td className="px-4 py-2.5" style={{ color: "rgba(255,255,255,0.4)" }}>{acc.outlookEmail || "—"}</td>
                    <td className="px-4 py-2.5" style={{ color: "rgba(255,255,255,0.3)" }}>{new Date(acc.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => handleDelete(acc.id)} className="p-1 rounded hover:bg-red-500/10 transition-colors" data-testid={`button-delete-adobe-${acc.id}`}>
                        <Trash2 className="w-3 h-3" style={{ color: "rgba(255,100,100,0.5)" }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

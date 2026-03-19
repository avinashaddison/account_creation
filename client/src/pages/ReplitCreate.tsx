import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Code2, Play, Mail, Key, Hash, Layers, ChevronRight, Cpu, Radio } from "lucide-react";

type OutlookAccount = {
  id: string;
  email: string;
  password: string;
  status: string;
};

type ReplitAccount = {
  id: string;
  username: string;
  email: string;
  password: string;
  outlookEmail: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

type LogLine = { text: string; ts: number; time: string };

const G = "#00ff41";
const GA = (a: number) => `rgba(0,255,65,${a})`;

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━") || text.startsWith("---")) return { color: GA(0.25), prefix: "" };
  if (text.startsWith("🚀") || text.startsWith("🏁")) return { color: G, prefix: ">" };
  if (text.includes("✅") || text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("verified") || text.toLowerCase().includes("created"))
    return { color: G, prefix: "+" };
  if (text.includes("❌") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("error"))
    return { color: "#ff4141", prefix: "!" };
  if (text.includes("⚠️") || text.toLowerCase().includes("warn"))
    return { color: "#ffaa00", prefix: "~" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser"))
    return { color: GA(0.7), prefix: ">" };
  if (text.toLowerCase().includes("username") || text.toLowerCase().includes("password") || text.toLowerCase().includes("generated"))
    return { color: GA(0.9), prefix: "»" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox") || text.toLowerCase().includes("outlook") || text.toLowerCase().includes("owa"))
    return { color: "rgba(0,200,255,0.7)", prefix: "·" };
  return { color: GA(0.45), prefix: "·" };
}

export default function ReplitCreate() {
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

  const { data: outlookAccounts = [] } = useQuery<OutlookAccount[]>({
    queryKey: ["/api/private/outlook"],
  });

  const { data: replitAccounts = [] } = useQuery<ReplitAccount[]>({
    queryKey: ["/api/replit-accounts"],
    refetchInterval: running ? 4000 : false,
  });

  const usedEmails = new Set(replitAccounts.map((a) => a.outlookEmail?.toLowerCase()).filter(Boolean));
  const availableOutlookAccounts = outlookAccounts.filter((a) => !usedEmails.has(a.email.toLowerCase()));

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const t = setInterval(() => setTick((p) => !p), 600);
    return () => clearInterval(t);
  }, []);

  function nowTime() {
    return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function addLog(text: string) {
    setLogs((prev) => [...prev, { text, ts: Date.now(), time: nowTime() }]);
  }

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.batchId && data.batchId === activeBatchId.current) {
          if (data.type === "log") {
            addLog(data.message);
          } else if (data.type === "batch_complete") {
            setRunning(false);
            qc.invalidateQueries({ queryKey: ["/api/replit-accounts"] });
            qc.invalidateQueries({ queryKey: ["/api/private/outlook"] });
          } else if (data.type === "replit_create_result") {
            if (data.success) {
              setCompletedCount((p) => p + 1);
              toast({ title: "✅ Account Created", description: `@${data.username}` });
            } else {
              toast({ title: "❌ Creation Failed", description: data.error || "Unknown error", variant: "destructive" });
            }
          }
        }
      } catch {}
    };

    return () => ws.close();
  }, []);

  const handleOutlookSelect = (id: string) => {
    setSelectedOutlookId(id);
    const acct = availableOutlookAccounts.find((a) => a.id === id);
    if (acct) {
      setOutlookEmail(acct.email);
      setOutlookPassword(acct.password);
    }
  };

  const handleCreate = async () => {
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);

    if (count > 1) {
      setTotalCount(count);
      try {
        const res = await apiRequest("POST", "/api/replit-create/bulk", { count });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to start bulk");
        activeBatchId.current = data.batchId;
        setTotalCount(data.count);
        addLog(`🚀 Bulk job started — ${data.count} account(s) queued [${data.batchId}]`);
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setRunning(false);
      }
    } else {
      if (!outlookEmail || !outlookPassword) {
        toast({ title: "Missing fields", description: "Select or enter an Outlook account", variant: "destructive" });
        setRunning(false);
        return;
      }
      setTotalCount(1);
      try {
        const res = await apiRequest("POST", "/api/replit-create", { outlookEmail, outlookPassword });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to start");
        activeBatchId.current = data.batchId;
        addLog(`Job started: ${data.batchId}`);
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setRunning(false);
      }
    }
  };

  const isBulk = count > 1;
  const canCreate = isBulk ? availableOutlookAccounts.length > 0 : (!!outlookEmail && !!outlookPassword);
  const maxCount = Math.min(20, availableOutlookAccounts.length || 1);
  const pct = maxCount > 1 ? ((count - 1) / (maxCount - 1)) * 100 : 100;

  return (
    <div className="space-y-5 animate-float-up">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4" style={{ color: G, filter: `drop-shadow(0 0 6px ${G})` }} />
            <h1 className="text-base font-mono font-bold tracking-tight" style={{ color: G, textShadow: `0 0 20px ${GA(0.5)}` }}>
              replit_create<span className="animate-pulse" style={{ color: G }}>{tick ? "_" : "\u00a0"}</span>
            </h1>
          </div>
          <p className="text-[10px] font-mono mt-0.5 pl-6" style={{ color: GA(0.3) }}>
            automate account creation via stored outlook credentials
          </p>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded" style={{ background: GA(0.05), border: `1px solid ${GA(0.15)}` }}>
            <Cpu className="w-2.5 h-2.5" style={{ color: GA(0.5) }} />
            <span style={{ color: GA(0.5) }}>{availableOutlookAccounts.length}</span>
            <span style={{ color: GA(0.25) }}>avail</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <span style={{ color: "rgba(255,255,255,0.25)" }}>{usedEmails.size}</span>
            <span style={{ color: "rgba(255,255,255,0.12)" }}>used</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Config panel */}
        <div
          className="rounded-xl p-4 space-y-4 relative overflow-hidden"
          style={{ background: "rgba(0,0,0,0.55)", border: `1px solid ${GA(0.12)}`, boxShadow: `0 0 30px ${GA(0.04)} inset` }}
        >
          {/* scanline overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.012) 2px, rgba(0,255,65,0.012) 4px)", borderRadius: "inherit" }} />

          {/* section label */}
          <div className="flex items-center gap-2">
            <ChevronRight className="w-3 h-3" style={{ color: G }} />
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: GA(0.5) }}>Configuration</span>
            <div className="flex-1 h-px" style={{ background: GA(0.08) }} />
          </div>

          {/* Count slider */}
          <div>
            <label className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: GA(0.35) }}>
              <Hash className="w-2.5 h-2.5" />
              Accounts to Create
            </label>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  type="range"
                  min={1}
                  max={maxCount}
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value))}
                  className="w-full h-1 rounded-full cursor-pointer appearance-none"
                  style={{
                    background: `linear-gradient(to right, ${GA(0.7)} ${pct}%, rgba(255,255,255,0.06) ${pct}%)`,
                    accentColor: G,
                  }}
                  data-testid="input-count-slider"
                />
              </div>
              <div
                className="w-9 h-7 rounded-md flex items-center justify-center text-sm font-mono font-bold flex-shrink-0"
                style={{ background: GA(0.08), border: `1px solid ${GA(0.3)}`, color: G, textShadow: `0 0 8px ${G}`, boxShadow: `0 0 10px ${GA(0.1)} inset` }}
              >
                {count}
              </div>
            </div>
            {isBulk && (
              <p className="text-[9px] font-mono mt-1.5 flex items-center gap-1" style={{ color: GA(0.3) }}>
                <Layers className="w-2.5 h-2.5" />
                bulk mode — picks {count} random from {availableOutlookAccounts.length} pool
              </p>
            )}
          </div>

          {!isBulk && (
            <>
              {availableOutlookAccounts.length > 0 && (
                <div>
                  <label className="block text-[9px] font-mono uppercase tracking-widest mb-1.5" style={{ color: GA(0.35) }}>
                    Stored Outlook Account
                  </label>
                  <select
                    value={selectedOutlookId}
                    onChange={(e) => handleOutlookSelect(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-[11px] font-mono focus:outline-none"
                    style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${GA(0.15)}`, color: "rgba(255,255,255,0.7)", caretColor: G }}
                    data-testid="select-outlook-account"
                  >
                    <option value="">— Select account —</option>
                    {availableOutlookAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.email}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[9px] font-mono uppercase tracking-widest mb-1.5" style={{ color: GA(0.35) }}>
                  <Mail className="w-2.5 h-2.5 inline mr-1" />
                  Outlook Email
                </label>
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2 transition-all"
                  style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${GA(0.12)}` }}
                >
                  <Mail className="w-3 h-3 flex-shrink-0" style={{ color: GA(0.35) }} />
                  <input
                    type="email"
                    value={outlookEmail}
                    onChange={(e) => setOutlookEmail(e.target.value)}
                    placeholder="yourname@outlook.com"
                    className="bg-transparent flex-1 text-[11px] font-mono focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.75)", caretColor: G }}
                    data-testid="input-outlook-email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-mono uppercase tracking-widest mb-1.5" style={{ color: GA(0.35) }}>
                  <Key className="w-2.5 h-2.5 inline mr-1" />
                  Outlook Password
                </label>
                <div
                  className="flex items-center gap-2 rounded-lg px-3 py-2"
                  style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${GA(0.12)}` }}
                >
                  <Key className="w-3 h-3 flex-shrink-0" style={{ color: GA(0.35) }} />
                  <input
                    type="password"
                    value={outlookPassword}
                    onChange={(e) => setOutlookPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-transparent flex-1 text-[11px] font-mono focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.75)", caretColor: G }}
                    data-testid="input-outlook-password"
                  />
                </div>
              </div>
            </>
          )}

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={running || !canCreate}
            className="relative w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[11px] font-mono font-bold tracking-widest uppercase transition-all duration-200 overflow-hidden"
            style={{
              background: running || !canCreate
                ? GA(0.04)
                : `linear-gradient(135deg, ${GA(0.18)}, ${GA(0.08)})`,
              border: `1px solid ${running || !canCreate ? GA(0.08) : GA(0.45)}`,
              color: running || !canCreate ? GA(0.25) : G,
              textShadow: running || !canCreate ? "none" : `0 0 12px ${G}`,
              boxShadow: running || !canCreate ? "none" : `0 0 20px ${GA(0.08)}, inset 0 1px 0 ${GA(0.1)}`,
              cursor: running || !canCreate ? "not-allowed" : "pointer",
            }}
            data-testid="button-create-replit"
          >
            {!(running || !canCreate) && (
              <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.02) 2px, rgba(0,255,65,0.02) 4px)" }} />
            )}
            <Play className={`w-3.5 h-3.5 relative z-10 ${running ? "animate-pulse" : ""}`} />
            <span className="relative z-10">
              {running
                ? totalCount > 1
                  ? `creating ${completedCount}/${totalCount}...`
                  : "creating account..."
                : isBulk
                ? `bulk_create ${count} account${count > 1 ? "s" : ""}`
                : "create_replit_account"}
            </span>
          </button>

          {/* Progress bar */}
          {running && totalCount > 1 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[9px] font-mono" style={{ color: GA(0.35) }}>
                <span>progress</span>
                <span style={{ color: G }}>{completedCount}/{totalCount}</span>
              </div>
              <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(completedCount / totalCount) * 100}%`,
                    background: `linear-gradient(90deg, ${G}, rgba(0,200,50,0.7))`,
                    boxShadow: `0 0 8px ${GA(0.6)}`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Terminal panel */}
        <div className="min-w-0">
          <div
            className="rounded-xl overflow-hidden flex flex-col"
            style={{ background: "rgba(0,0,0,0.75)", border: `1px solid ${GA(0.1)}`, boxShadow: `0 0 40px ${GA(0.03)}` }}
          >
            {/* Terminal title bar */}
            <div
              className="flex items-center justify-between px-3.5 py-2 flex-shrink-0"
              style={{ background: GA(0.03), borderBottom: `1px solid ${GA(0.08)}` }}
            >
              <div className="flex items-center gap-2">
                <Radio className="w-2.5 h-2.5" style={{ color: running ? G : GA(0.25), filter: running ? `drop-shadow(0 0 4px ${G})` : "none" }} />
                <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: GA(0.4) }}>live_output</span>
                {running && (
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: G, boxShadow: `0 0 6px ${G}` }} />
                    <span className="text-[8px] font-mono" style={{ color: GA(0.6) }}>RUNNING</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: "rgba(255,59,48,0.5)" }} />
                <span className="w-2 h-2 rounded-full" style={{ background: "rgba(255,149,0,0.5)" }} />
                <span className="w-2 h-2 rounded-full" style={{ background: `${GA(0.5)}` }} />
              </div>
            </div>

            {/* Log body */}
            <div
              className="h-96 overflow-y-auto overflow-x-hidden p-3 space-y-px font-mono"
              style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
              data-testid="container-logs"
            >
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <div className="text-center space-y-1">
                    <p className="text-[10px] font-mono" style={{ color: GA(0.2) }}>{">"}_</p>
                    <p className="text-[9px] font-mono" style={{ color: GA(0.15) }}>waiting for output...</p>
                  </div>
                </div>
              ) : (
                logs.map((line, i) => {
                  const { color, prefix } = getLogStyle(line.text);
                  const isSeparator = line.text.startsWith("━━━") || line.text.startsWith("---");
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-1.5 py-px min-w-0 ${isSeparator ? "mt-1.5 mb-0.5 opacity-30" : ""}`}
                    >
                      <span className="text-[8.5px] flex-shrink-0 mt-px tabular-nums" style={{ color: GA(0.2) }}>{line.time}</span>
                      <span className="text-[9px] flex-shrink-0 mt-px w-2.5 text-center font-bold" style={{ color }}>{prefix}</span>
                      <span
                        className="text-[10px] leading-relaxed break-words min-w-0 overflow-hidden"
                        style={{ color, textShadow: color === G ? `0 0 8px ${GA(0.4)}` : "none" }}
                      >
                        {line.text}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Terminal footer */}
            <div
              className="px-3.5 py-1.5 flex items-center gap-2"
              style={{ background: GA(0.02), borderTop: `1px solid ${GA(0.06)}` }}
            >
              <span className="text-[8px] font-mono" style={{ color: GA(0.2) }}>addison@panel:~$</span>
              <span className="text-[8px] font-mono" style={{ color: GA(0.35) }}>
                {running ? "executing replit_create..." : "ready"}
              </span>
              <span className="w-1.5 h-2.5 ml-px" style={{ background: tick && !running ? G : "transparent", boxShadow: tick && !running ? `0 0 6px ${G}` : "none" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

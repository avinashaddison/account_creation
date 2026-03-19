import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { Heart, Play, Mail, Key, Hash, Layers, ChevronRight, Radio } from "lucide-react";

type OutlookAccount = {
  id: string;
  email: string;
  password: string;
  status: string;
};

type LovableAccount = {
  id: string;
  email: string;
  password: string | null;
  outlookEmail: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

type LogLine = { text: string; ts: number; time: string };

const P = "#ec4899";
const PA = (a: number) => `rgba(236,72,153,${a})`;

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━") || text.startsWith("---")) return { color: PA(0.25), prefix: "" };
  if (text.startsWith("🚀") || text.startsWith("🏁")) return { color: P, prefix: ">" };
  if (text.includes("✅") || text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("verified") || text.toLowerCase().includes("created") || text.toLowerCase().includes("complete"))
    return { color: "#4ade80", prefix: "+" };
  if (text.includes("❌") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("error"))
    return { color: "#f87171", prefix: "!" };
  if (text.includes("⚠️") || text.toLowerCase().includes("warn"))
    return { color: "#fbbf24", prefix: "~" };
  if (text.toLowerCase().includes("magic") || text.toLowerCase().includes("link") || text.toLowerCase().includes("verification") || text.toLowerCase().includes("confirm"))
    return { color: PA(0.85), prefix: "›" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser"))
    return { color: PA(0.6), prefix: ">" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox") || text.toLowerCase().includes("outlook") || text.toLowerCase().includes("owa"))
    return { color: "rgba(147,197,253,0.75)", prefix: "·" };
  return { color: PA(0.4), prefix: "·" };
}

export default function LovableCreate() {
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

  const { data: lovableAccounts = [] } = useQuery<LovableAccount[]>({
    queryKey: ["/api/lovable-accounts"],
    refetchInterval: running ? 4000 : false,
  });

  const usedEmails = new Set(lovableAccounts.map((a) => a.outlookEmail?.toLowerCase()).filter(Boolean));
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
            sounds.complete();
            qc.invalidateQueries({ queryKey: ["/api/lovable-accounts"] });
            qc.invalidateQueries({ queryKey: ["/api/private/outlook"] });
          } else if (data.type === "lovable_create_result") {
            if (data.success) {
              setCompletedCount((p) => p + 1);
              sounds.success();
              toast({ title: "✅ Account Created", description: data.email });
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
    if (acct) {
      setOutlookEmail(acct.email);
      setOutlookPassword(acct.password);
    }
  };

  const handleCreate = async () => {
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);

    if (count > 1) {
      setTotalCount(count);
      try {
        const res = await apiRequest("POST", "/api/lovable-create/bulk", { count });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to start bulk");
        activeBatchId.current = data.batchId;
        setTotalCount(data.count);
        addLog(`🚀 Bulk job started — ${data.count} account(s) queued [${data.batchId}]`);
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
        const res = await apiRequest("POST", "/api/lovable-create", { outlookEmail, outlookPassword });
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

  const isBulk = count > 1;
  const canCreate = isBulk ? availableOutlookAccounts.length > 0 : (!!outlookEmail && !!outlookPassword);
  const maxCount = Math.min(10, availableOutlookAccounts.length || 1);
  const pct = maxCount > 1 ? ((count - 1) / (maxCount - 1)) * 100 : 100;

  return (
    <div className="space-y-6 animate-float-up">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Heart className="w-5 h-5" style={{ color: P, filter: `drop-shadow(0 0 8px ${PA(0.5)})` }} />
            <h1 className="text-lg font-mono font-bold tracking-tight" style={{ color: P, textShadow: `0 0 24px ${PA(0.4)}` }}>
              Lovable<span style={{ color: P }}>{tick ? "_" : "\u00a0"}</span>Create
            </h1>
          </div>
          <p className="text-[11px] font-mono mt-0.5 pl-8" style={{ color: PA(0.28) }}>
            Automate Lovable.dev account creation using stored Outlook emails
          </p>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] font-mono">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: PA(0.05), border: `1px solid ${PA(0.15)}` }}>
            <Heart className="w-3 h-3" style={{ color: PA(0.5) }} />
            <span style={{ color: P, textShadow: `0 0 8px ${PA(0.5)}` }}>{availableOutlookAccounts.length}</span>
            <span style={{ color: PA(0.3) }}>avail</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ color: "rgba(255,255,255,0.3)" }}>{usedEmails.size}</span>
            <span style={{ color: "rgba(255,255,255,0.14)" }}>used</span>
          </div>
        </div>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Config panel */}
        <div
          className="rounded-xl p-5 space-y-5 relative overflow-hidden"
          style={{ background: "rgba(0,0,0,0.55)", border: `1px solid ${PA(0.14)}`, boxShadow: `0 0 40px ${PA(0.04)} inset` }}
        >
          {/* scanline overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${PA(0.012)} 2px, ${PA(0.012)} 4px)`, borderRadius: "inherit" }} />

          {/* section label */}
          <div className="flex items-center gap-2">
            <ChevronRight className="w-3.5 h-3.5" style={{ color: P }} />
            <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: PA(0.5) }}>Configuration</span>
            <div className="flex-1 h-px" style={{ background: PA(0.1) }} />
          </div>

          {/* Count slider */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest mb-2.5" style={{ color: PA(0.4) }}>
              <Hash className="w-3 h-3" />
              Accounts to Create
            </label>
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  type="range"
                  min={1}
                  max={maxCount}
                  value={count}
                  onChange={(e) => { sounds.toggle(); setCount(parseInt(e.target.value)); }}
                  className="w-full h-1.5 rounded-full cursor-pointer appearance-none"
                  style={{
                    background: `linear-gradient(to right, ${PA(0.65)} ${pct}%, rgba(255,255,255,0.07) ${pct}%)`,
                    accentColor: P,
                  }}
                  data-testid="input-count-slider"
                />
              </div>
              <div
                className="w-11 h-8 rounded-lg flex items-center justify-center text-base font-mono font-bold flex-shrink-0"
                style={{ background: PA(0.1), border: `1px solid ${PA(0.35)}`, color: P, textShadow: `0 0 10px ${P}`, boxShadow: `0 0 12px ${PA(0.1)} inset` }}
              >
                {count}
              </div>
            </div>
            {isBulk && (
              <p className="text-[10px] font-mono mt-2 flex items-center gap-1.5" style={{ color: PA(0.32) }}>
                <Layers className="w-3 h-3" />
                bulk mode — picks {count} random from {availableOutlookAccounts.length} pool
              </p>
            )}
          </div>

          {!isBulk && (
            <>
              {availableOutlookAccounts.length > 0 && (
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.4) }}>
                    Stored Outlook Account
                  </label>
                  <select
                    value={selectedOutlookId}
                    onChange={(e) => handleOutlookSelect(e.target.value)}
                    className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none"
                    style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${PA(0.18)}`, color: "rgba(255,255,255,0.75)" }}
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
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.4) }}>
                  <Mail className="w-2.5 h-2.5 inline mr-1" />
                  Outlook Email
                </label>
                <div
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
                  style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${PA(0.14)}` }}
                >
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: PA(0.38) }} />
                  <input
                    type="email"
                    value={outlookEmail}
                    onChange={(e) => setOutlookEmail(e.target.value)}
                    onKeyDown={() => sounds.keypress()}
                    placeholder="yourname@outlook.com"
                    className="bg-transparent flex-1 text-xs font-mono focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.8)", caretColor: P }}
                    data-testid="input-outlook-email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.4) }}>
                  <Key className="w-2.5 h-2.5 inline mr-1" />
                  Outlook Password
                </label>
                <div
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
                  style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${PA(0.14)}` }}
                >
                  <Key className="w-3.5 h-3.5 flex-shrink-0" style={{ color: PA(0.38) }} />
                  <input
                    type="password"
                    value={outlookPassword}
                    onChange={(e) => setOutlookPassword(e.target.value)}
                    onKeyDown={() => sounds.keypress()}
                    placeholder="••••••••"
                    className="bg-transparent flex-1 text-xs font-mono focus:outline-none"
                    style={{ color: "rgba(255,255,255,0.8)", caretColor: P }}
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
            className="relative w-full flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200 overflow-hidden"
            style={{
              background: running || !canCreate
                ? PA(0.04)
                : `linear-gradient(135deg, ${PA(0.25)}, ${PA(0.1)})`,
              border: `1px solid ${running || !canCreate ? PA(0.08) : PA(0.5)}`,
              color: running || !canCreate ? PA(0.25) : P,
              textShadow: running || !canCreate ? "none" : `0 0 14px ${P}`,
              boxShadow: running || !canCreate ? "none" : `0 0 25px ${PA(0.1)}, inset 0 1px 0 ${PA(0.12)}`,
              cursor: running || !canCreate ? "not-allowed" : "pointer",
            }}
            data-testid="button-create-lovable"
          >
            {!(running || !canCreate) && (
              <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${PA(0.025)} 2px, ${PA(0.025)} 4px)` }} />
            )}
            <Play className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
            <span className="relative z-10">
              {running
                ? totalCount > 1
                  ? `creating ${completedCount}/${totalCount}...`
                  : "creating account..."
                : isBulk
                ? `bulk_create ${count} account${count > 1 ? "s" : ""}`
                : "create_lovable_account"}
            </span>
          </button>

          {/* Progress bar */}
          {running && totalCount > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: PA(0.38) }}>
                <span>progress</span>
                <span style={{ color: P, textShadow: `0 0 8px ${PA(0.5)}` }}>{completedCount}/{totalCount}</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${(completedCount / totalCount) * 100}%`,
                    background: `linear-gradient(90deg, ${P}, rgba(244,114,182,0.7))`,
                    boxShadow: `0 0 10px ${PA(0.7)}`,
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
            style={{ background: "rgba(0,0,0,0.75)", border: `1px solid ${PA(0.12)}`, boxShadow: `0 0 40px ${PA(0.03)}` }}
          >
            {/* Terminal title bar */}
            <div
              className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
              style={{ background: PA(0.03), borderBottom: `1px solid ${PA(0.08)}` }}
            >
              <div className="flex items-center gap-2.5">
                <Radio className="w-3 h-3" style={{ color: running ? P : PA(0.28), filter: running ? `drop-shadow(0 0 5px ${P})` : "none" }} />
                <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: PA(0.45) }}>live_output</span>
                {running && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: P, boxShadow: `0 0 6px ${P}` }} />
                    <span className="text-[9px] font-mono font-bold" style={{ color: PA(0.65) }}>RUNNING</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,59,48,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,149,0,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: PA(0.55) }} />
              </div>
            </div>

            {/* Log body */}
            <div
              className="overflow-y-auto overflow-x-hidden p-4 space-y-0.5 font-mono"
              style={{ height: "420px", wordBreak: "break-all", overflowWrap: "anywhere" }}
              data-testid="container-logs"
            >
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <div className="text-center space-y-1.5">
                    <p className="text-[11px] font-mono" style={{ color: PA(0.22) }}>{">"}_</p>
                    <p className="text-[10px] font-mono" style={{ color: PA(0.16) }}>waiting for output...</p>
                  </div>
                </div>
              ) : (
                logs.map((line, i) => {
                  const { color, prefix } = getLogStyle(line.text);
                  const isSeparator = line.text.startsWith("━━━") || line.text.startsWith("---");
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 min-w-0 ${isSeparator ? "mt-2 mb-1 opacity-30" : "py-px"}`}
                    >
                      <span className="text-[9px] flex-shrink-0 mt-0.5 tabular-nums" style={{ color: PA(0.22) }}>{line.time}</span>
                      <span className="text-[10px] flex-shrink-0 mt-0.5 w-3 text-center font-bold" style={{ color }}>{prefix}</span>
                      <span
                        className="text-[11px] leading-relaxed break-words min-w-0 overflow-hidden"
                        style={{ color, textShadow: color === P ? `0 0 8px ${PA(0.4)}` : "none" }}
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
              className="px-4 py-2 flex items-center gap-2"
              style={{ background: PA(0.02), borderTop: `1px solid ${PA(0.07)}` }}
            >
              <span className="text-[9px] font-mono" style={{ color: PA(0.25) }}>addison@panel:~$</span>
              <span className="text-[9px] font-mono" style={{ color: PA(0.4) }}>
                {running ? "executing lovable_create..." : "ready"}
              </span>
              <span
                className="w-1.5 h-3 ml-px"
                style={{
                  background: tick && !running ? P : "transparent",
                  boxShadow: tick && !running ? `0 0 6px ${P}` : "none",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

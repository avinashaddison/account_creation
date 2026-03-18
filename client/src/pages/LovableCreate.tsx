import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Heart, Play, Mail, Key, Hash, Layers, Terminal } from "lucide-react";

type OutlookAccount = {
  id: string;
  email: string;
  password: string;
  status: string;
};

type LovableAccount = {
  id: string;
  email: string;
  outlookEmail: string | null;
  status: string;
  error: string | null;
  createdAt: string;
};

type LogLine = { text: string; ts: number; time: string };

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━")) return { color: "text-pink-400/60", prefix: "" };
  if (text.startsWith("🚀") || text.startsWith("🏁")) return { color: "text-pink-300", prefix: "" };
  if (text.includes("✅") || text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("verified") || text.toLowerCase().includes("created") || text.toLowerCase().includes("complete")) return { color: "text-emerald-400", prefix: "▸" };
  if (text.includes("❌") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("error")) return { color: "text-red-400", prefix: "▸" };
  if (text.includes("⚠️") || text.toLowerCase().includes("warn")) return { color: "text-amber-400", prefix: "▸" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser")) return { color: "text-sky-400/80", prefix: "›" };
  if (text.toLowerCase().includes("magic") || text.toLowerCase().includes("link") || text.toLowerCase().includes("verification") || text.toLowerCase().includes("confirm")) return { color: "text-pink-300/90", prefix: "›" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox") || text.toLowerCase().includes("outlook") || text.toLowerCase().includes("owa")) return { color: "text-blue-300/80", prefix: "›" };
  return { color: "text-cyan-300/60", prefix: "·" };
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
            qc.invalidateQueries({ queryKey: ["/api/lovable-accounts"] });
            qc.invalidateQueries({ queryKey: ["/api/private/outlook"] });
          } else if (data.type === "lovable_create_result") {
            if (data.success) {
              setCompletedCount((p) => p + 1);
              toast({ title: "✅ Account Created", description: data.email });
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
        const res = await apiRequest("POST", "/api/lovable-create/bulk", { count });
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
        const res = await apiRequest("POST", "/api/lovable-create", { outlookEmail, outlookPassword });
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

  const accentColor = "rgba(236,72,153,0.";
  const accentSolid = "rgb(236,72,153)";
  const accentMuted = "rgba(236,72,153,";

  return (
    <div className="space-y-6 animate-float-up">
      <div>
        <div className="flex items-center gap-2.5">
          <Heart className="w-5 h-5 text-pink-400/60" />
          <h1 className="text-xl font-bold tracking-tight text-white font-mono">
            Lovable<span className="text-pink-400">_</span>Create
          </h1>
        </div>
        <p className="text-pink-400/30 mt-1 text-[11px] font-mono pl-7.5">Automate Lovable.dev account creation using stored Outlook emails</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="min-w-0 rounded-xl p-5 space-y-4" style={{ background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.15)" }}>
          <div className="flex items-center gap-2">
            <Heart className="w-3.5 h-3.5 text-pink-400/60" />
            <span className="text-[11px] font-mono text-pink-400/60 uppercase tracking-wider">Configuration</span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-white/25">{availableOutlookAccounts.length} available</span>
              <span className="text-[10px] font-mono text-white/15">·</span>
              <span className="text-[10px] font-mono text-white/25">{usedEmails.size} used</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-white/40 mb-1.5 uppercase tracking-wider">
              <Hash className="w-2.5 h-2.5 inline mr-1" />
              Accounts to Create
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={Math.min(20, availableOutlookAccounts.length || 1)}
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="flex-1 h-1.5 rounded-full cursor-pointer accent-pink-500"
                style={{ background: `linear-gradient(to right, rgba(236,72,153,0.6) ${((count - 1) / (Math.max(1, Math.min(20, availableOutlookAccounts.length || 1)) - 1)) * 100}%, rgba(255,255,255,0.08) 0%)` }}
                data-testid="input-count-slider"
              />
              <div
                className="w-10 h-7 rounded-lg flex items-center justify-center text-sm font-mono font-bold flex-shrink-0"
                style={{ background: "rgba(236,72,153,0.2)", border: "1px solid rgba(236,72,153,0.3)", color: "rgb(244,114,182)" }}
              >
                {count}
              </div>
            </div>
            {isBulk && (
              <p className="text-[10px] font-mono text-pink-400/40 mt-1.5">
                <Layers className="w-2.5 h-2.5 inline mr-1" />
                Bulk mode — randomly picks {count} from {availableOutlookAccounts.length} available accounts
              </p>
            )}
          </div>

          {!isBulk && (
            <>
              {availableOutlookAccounts.length > 0 && (
                <div>
                  <label className="block text-[10px] font-mono text-white/40 mb-1.5 uppercase tracking-wider">Stored Outlook Account</label>
                  <select
                    value={selectedOutlookId}
                    onChange={(e) => handleOutlookSelect(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none"
                    style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(236,72,153,0.2)" }}
                    data-testid="select-outlook-account"
                  >
                    <option value="">— Select account —</option>
                    {availableOutlookAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-mono text-white/40 mb-1.5 uppercase tracking-wider">Outlook Email</label>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(236,72,153,0.2)" }}>
                  <Mail className="w-3 h-3 text-pink-400/40 flex-shrink-0" />
                  <input
                    type="email"
                    value={outlookEmail}
                    onChange={(e) => setOutlookEmail(e.target.value)}
                    placeholder="yourname@outlook.com"
                    className="bg-transparent flex-1 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none"
                    data-testid="input-outlook-email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-white/40 mb-1.5 uppercase tracking-wider">Outlook Password</label>
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(236,72,153,0.2)" }}>
                  <Key className="w-3 h-3 text-pink-400/40 flex-shrink-0" />
                  <input
                    type="password"
                    value={outlookPassword}
                    onChange={(e) => setOutlookPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-transparent flex-1 text-xs font-mono text-white placeholder:text-white/20 focus:outline-none"
                    data-testid="input-outlook-password"
                  />
                </div>
              </div>
            </>
          )}

          <button
            onClick={handleCreate}
            disabled={running || !canCreate}
            className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-mono font-bold tracking-wider transition-all duration-200"
            style={{
              background: running || !canCreate ? "rgba(236,72,153,0.07)" : isBulk ? "rgba(236,72,153,0.3)" : "rgba(236,72,153,0.2)",
              border: `1px solid ${running || !canCreate ? "rgba(236,72,153,0.15)" : "rgba(236,72,153,0.5)"}`,
              color: running || !canCreate ? "rgba(244,114,182,0.3)" : "rgb(244,114,182)",
              cursor: running || !canCreate ? "not-allowed" : "pointer",
            }}
            data-testid="button-create-lovable"
          >
            <Play className={`w-3.5 h-3.5 ${running ? "animate-pulse" : ""}`} />
            {running
              ? totalCount > 1
                ? `CREATING ${completedCount}/${totalCount}...`
                : "CREATING ACCOUNT..."
              : isBulk
              ? `BULK CREATE ${count} ACCOUNT${count > 1 ? "S" : ""}`
              : "CREATE LOVABLE ACCOUNT"}
          </button>

          {running && totalCount > 1 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-white/30">
                <span>Progress</span>
                <span>{completedCount}/{totalCount}</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(completedCount / totalCount) * 100}%`, background: "rgba(236,72,153,0.7)" }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 sticky top-4">
          <div className="rounded-xl overflow-hidden flex flex-col min-w-0" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(236,72,153,0.12)" }}>
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(236,72,153,0.08)", background: "rgba(236,72,153,0.04)" }}>
              <div className="flex items-center gap-2">
                <Terminal className="w-3 h-3 text-pink-400/50" />
                <span className="text-[10px] font-mono text-pink-400/50 uppercase tracking-wider">Live Output</span>
                {running && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
                    <span className="text-[9px] font-mono text-pink-400/70">RUNNING</span>
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/40" />
              </div>
            </div>

            <div className="flex-1 h-96 overflow-y-auto overflow-x-hidden p-3 space-y-px font-mono" style={{ wordBreak: "break-all", overflowWrap: "anywhere" }} data-testid="container-logs">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <Terminal className="w-6 h-6 text-white/10" />
                  <p className="text-[10px] font-mono text-white/15">waiting for output...</p>
                </div>
              ) : (
                logs.map((line, i) => {
                  const { color, prefix } = getLogStyle(line.text);
                  const isSeparator = line.text.startsWith("━━━");
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 py-px min-w-0 ${isSeparator ? "mt-2 mb-1" : ""}`}
                    >
                      <span className="text-[9px] text-white/15 flex-shrink-0 mt-px tabular-nums">{line.time}</span>
                      {prefix && <span className={`text-[9px] flex-shrink-0 mt-px ${color}`}>{prefix}</span>}
                      <span className={`text-[10px] leading-relaxed break-words min-w-0 overflow-hidden ${color} ${isSeparator ? "font-semibold tracking-wide" : ""}`}>
                        {line.text}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

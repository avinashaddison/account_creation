import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Code2, Play, Trash2, Copy, CheckCircle, User, Mail, Key, Eye, EyeOff, Hash, Layers, Terminal } from "lucide-react";

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

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━")) return { color: "text-violet-400/60", prefix: "" };
  if (text.startsWith("🚀") || text.startsWith("🏁")) return { color: "text-violet-300", prefix: "" };
  if (text.includes("✅") || text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("verified") || text.toLowerCase().includes("created")) return { color: "text-emerald-400", prefix: "▸" };
  if (text.includes("❌") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("error")) return { color: "text-red-400", prefix: "▸" };
  if (text.includes("⚠️") || text.toLowerCase().includes("warn")) return { color: "text-amber-400", prefix: "▸" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser")) return { color: "text-sky-400/80", prefix: "›" };
  if (text.toLowerCase().includes("username") || text.toLowerCase().includes("password") || text.toLowerCase().includes("generated")) return { color: "text-violet-300/90", prefix: "›" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox") || text.toLowerCase().includes("outlook") || text.toLowerCase().includes("owa")) return { color: "text-blue-300/80", prefix: "›" };
  return { color: "text-cyan-300/60", prefix: "·" };
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeBatchId = useRef<string | null>(null);

  const { data: outlookAccounts = [] } = useQuery<OutlookAccount[]>({
    queryKey: ["/api/private/outlook"],
  });

  const { data: replitAccounts = [], isLoading: accountsLoading } = useQuery<ReplitAccount[]>({
    queryKey: ["/api/replit-accounts"],
    refetchInterval: running ? 4000 : false,
  });

  const usedEmails = new Set(replitAccounts.map((a) => a.outlookEmail?.toLowerCase()).filter(Boolean));
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

  const handleDelete = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/replit-accounts/${id}`);
      qc.invalidateQueries({ queryKey: ["/api/replit-accounts"] });
      toast({ title: "Deleted", description: "Account removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isBulk = count > 1;
  const canCreate = isBulk ? availableOutlookAccounts.length > 0 : (!!outlookEmail && !!outlookPassword);

  return (
    <div className="space-y-6 animate-float-up">
      <div>
        <div className="flex items-center gap-2.5">
          <Code2 className="w-5 h-5 text-violet-400/60" />
          <h1 className="text-xl font-bold tracking-tight text-white font-mono">
            Replit<span className="text-violet-400">_</span>Create
          </h1>
        </div>
        <p className="text-violet-400/30 mt-1 text-[11px] font-mono pl-7.5">Automate Replit account creation using stored Outlook emails</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl p-5 space-y-4" style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)" }}>
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-violet-400/60" />
            <span className="text-[11px] font-mono text-violet-400/60 uppercase tracking-wider">Configuration</span>
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
                className="flex-1 h-1.5 rounded-full cursor-pointer accent-violet-500"
                style={{ background: `linear-gradient(to right, rgba(124,58,237,0.6) ${((count - 1) / (Math.max(1, Math.min(20, availableOutlookAccounts.length || 1)) - 1)) * 100}%, rgba(255,255,255,0.08) 0%)` }}
                data-testid="input-count-slider"
              />
              <div
                className="w-10 h-7 rounded-lg flex items-center justify-center text-sm font-mono font-bold flex-shrink-0"
                style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.3)", color: "rgb(167,139,250)" }}
              >
                {count}
              </div>
            </div>
            {isBulk && (
              <p className="text-[10px] font-mono text-violet-400/40 mt-1.5">
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
                    style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(124,58,237,0.2)" }}
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
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(124,58,237,0.2)" }}>
                  <Mail className="w-3 h-3 text-violet-400/40 flex-shrink-0" />
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
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(124,58,237,0.2)" }}>
                  <Key className="w-3 h-3 text-violet-400/40 flex-shrink-0" />
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
              background: running || !canCreate ? "rgba(124,58,237,0.07)" : isBulk ? "rgba(124,58,237,0.3)" : "rgba(124,58,237,0.2)",
              border: `1px solid ${running || !canCreate ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.5)"}`,
              color: running || !canCreate ? "rgba(167,139,250,0.3)" : "rgb(167,139,250)",
              cursor: running || !canCreate ? "not-allowed" : "pointer",
            }}
            data-testid="button-create-replit"
          >
            <Play className={`w-3.5 h-3.5 ${running ? "animate-pulse" : ""}`} />
            {running
              ? totalCount > 1
                ? `CREATING ${completedCount}/${totalCount}...`
                : "CREATING ACCOUNT..."
              : isBulk
              ? `BULK CREATE ${count} ACCOUNT${count > 1 ? "S" : ""}`
              : "CREATE REPLIT ACCOUNT"}
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
                  style={{ width: `${(completedCount / totalCount) * 100}%`, background: "rgba(124,58,237,0.7)" }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(124,58,237,0.12)" }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(124,58,237,0.08)", background: "rgba(124,58,237,0.04)" }}>
            <div className="flex items-center gap-2">
              <Terminal className="w-3 h-3 text-violet-400/50" />
              <span className="text-[10px] font-mono text-violet-400/50 uppercase tracking-wider">Live Output</span>
              {running && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                  <span className="text-[9px] font-mono text-violet-400/70">RUNNING</span>
                </span>
              )}
            </div>
            <div className="flex gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/40" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/40" />
            </div>
          </div>

          <div className="flex-1 h-64 overflow-y-auto p-3 space-y-px font-mono" data-testid="container-logs">
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
                    className={`flex items-start gap-2 py-px ${isSeparator ? "mt-2 mb-1" : ""}`}
                  >
                    <span className="text-[9px] text-white/15 flex-shrink-0 mt-px tabular-nums">{line.time}</span>
                    {prefix && <span className={`text-[9px] flex-shrink-0 mt-px ${color}`}>{prefix}</span>}
                    <span className={`text-[10px] leading-relaxed break-all ${color} ${isSeparator ? "font-semibold tracking-wide" : ""}`}>
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

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Code2 className="w-3.5 h-3.5 text-violet-400/40" />
            <span className="text-[11px] font-mono text-violet-400/40 uppercase tracking-wider">
              Created Accounts ({replitAccounts.length})
            </span>
          </div>
        </div>

        {accountsLoading ? (
          <div className="rounded-xl p-8 text-center" style={{ border: "1px solid rgba(124,58,237,0.1)" }}>
            <p className="text-[11px] font-mono text-white/30">Loading...</p>
          </div>
        ) : replitAccounts.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ border: "1px solid rgba(124,58,237,0.08)" }}>
            <Code2 className="w-8 h-8 text-violet-400/20 mx-auto mb-2" />
            <p className="text-[11px] font-mono text-white/20">No Replit accounts created yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {replitAccounts.map((acct) => (
              <div
                key={acct.id}
                className="rounded-xl px-4 py-3 flex items-center justify-between gap-4"
                style={{ background: "rgba(124,58,237,0.05)", border: "1px solid rgba(124,58,237,0.12)" }}
                data-testid={`row-replit-${acct.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(124,58,237,0.15)" }}>
                    <Code2 className="w-3.5 h-3.5 text-violet-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-white font-bold truncate" data-testid={`text-username-${acct.id}`}>
                        @{acct.username}
                      </span>
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm flex-shrink-0"
                        style={{
                          background: acct.status === "created" ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
                          color: acct.status === "created" ? "rgb(52,211,153)" : "rgb(239,68,68)",
                          border: `1px solid ${acct.status === "created" ? "rgba(52,211,153,0.2)" : "rgba(239,68,68,0.2)"}`,
                        }}
                      >
                        {acct.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-white/40 truncate">{acct.email}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Key className="w-2.5 h-2.5 text-violet-400/30 flex-shrink-0" />
                      <span className="text-[10px] font-mono text-white/35 truncate" data-testid={`text-password-${acct.id}`}>
                        {revealedIds.has(acct.id) ? acct.password : "••••••••••••"}
                      </span>
                      <button
                        onClick={() => setRevealedIds((prev) => {
                          const next = new Set(prev);
                          next.has(acct.id) ? next.delete(acct.id) : next.add(acct.id);
                          return next;
                        })}
                        className="text-violet-400/30 hover:text-violet-400/60 transition-colors flex-shrink-0"
                        data-testid={`button-reveal-${acct.id}`}
                      >
                        {revealedIds.has(acct.id) ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                    {acct.outlookEmail && (
                      <p className="text-[9px] font-mono text-white/25 truncate">via {acct.outlookEmail}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => copyToClipboard(`Username: ${acct.username}\nEmail: ${acct.email}\nPassword: ${acct.password}`, acct.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-violet-400/10"
                    style={{ border: "1px solid rgba(124,58,237,0.15)" }}
                    title="Copy credentials"
                    data-testid={`button-copy-${acct.id}`}
                  >
                    {copiedId === acct.id ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-violet-400/60" />}
                  </button>
                  <button
                    onClick={() => handleDelete(acct.id)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-red-400/10"
                    style={{ border: "1px solid rgba(239,68,68,0.15)" }}
                    title="Delete account"
                    data-testid={`button-delete-${acct.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400/60" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

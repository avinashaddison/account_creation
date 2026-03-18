import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Code2, Play, Trash2, Copy, CheckCircle, User, Mail, Key, ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";

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

type LogLine = { text: string; ts: number };

export default function ReplitCreate() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [outlookEmail, setOutlookEmail] = useState("");
  const [outlookPassword, setOutlookPassword] = useState("");
  const [selectedOutlookId, setSelectedOutlookId] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
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
    refetchInterval: running ? 5000 : false,
  });

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.batchId && data.batchId === activeBatchId.current) {
          if (data.type === "log") {
            setLogs((prev) => [...prev, { text: data.message, ts: Date.now() }]);
          } else if (data.type === "batch_complete") {
            setRunning(false);
            qc.invalidateQueries({ queryKey: ["/api/replit-accounts"] });
          } else if (data.type === "replit_create_result") {
            if (data.success) {
              toast({ title: "✅ Replit Account Created", description: `Username: ${data.username}` });
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
    const acct = outlookAccounts.find((a) => a.id === id);
    if (acct) {
      setOutlookEmail(acct.email);
      setOutlookPassword(acct.password);
    }
  };

  const handleCreate = async () => {
    if (!outlookEmail || !outlookPassword) {
      toast({ title: "Missing fields", description: "Please provide Outlook email and password", variant: "destructive" });
      return;
    }
    setLogs([]);
    setRunning(true);
    setShowLogs(true);

    try {
      const res = await apiRequest("POST", "/api/replit-create", { outlookEmail, outlookPassword });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start");
      activeBatchId.current = data.batchId;
      setLogs([{ text: `Job started: ${data.batchId}`, ts: Date.now() }]);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/replit-accounts/${id}`);
      qc.invalidateQueries({ queryKey: ["/api/replit-accounts"] });
      toast({ title: "Deleted", description: "Account removed from database" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getLogColor = (text: string) => {
    if (text.includes("✅") || text.includes("success") || text.includes("created")) return "text-emerald-400";
    if (text.includes("❌") || text.includes("failed") || text.includes("Error")) return "text-red-400";
    if (text.includes("⚠️") || text.includes("Warning")) return "text-amber-400";
    if (text.startsWith("Generated") || text.includes("username") || text.includes("password")) return "text-violet-300";
    return "text-cyan-300/80";
  };

  return (
    <div className="space-y-6 animate-float-up">
      <div>
        <div className="flex items-center gap-2.5">
          <Code2 className="w-5 h-5 text-violet-400/60" />
          <h1 className="text-xl font-bold tracking-tight text-white font-mono">
            Replit<span className="text-violet-400">_</span>Create
          </h1>
        </div>
        <p className="text-violet-400/30 mt-1 text-[11px] font-mono pl-7.5">Create Replit accounts using stored Outlook emails</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl p-5 space-y-4" style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)" }}>
          <div className="flex items-center gap-2 mb-1">
            <User className="w-3.5 h-3.5 text-violet-400/60" />
            <span className="text-[11px] font-mono text-violet-400/60 uppercase tracking-wider">Outlook Source</span>
          </div>

          {outlookAccounts.length > 0 && (
            <div>
              <label className="block text-[10px] font-mono text-white/40 mb-1.5 uppercase tracking-wider">Stored Outlook Account</label>
              <select
                value={selectedOutlookId}
                onChange={(e) => handleOutlookSelect(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none"
                style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(124,58,237,0.2)" }}
                data-testid="select-outlook-account"
              >
                <option value="">— Select stored account —</option>
                {outlookAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email} ({a.status})
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

          <button
            onClick={handleCreate}
            disabled={running}
            className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-mono font-bold tracking-wider transition-all duration-200"
            style={{
              background: running ? "rgba(124,58,237,0.1)" : "rgba(124,58,237,0.25)",
              border: "1px solid rgba(124,58,237,0.4)",
              color: running ? "rgba(167,139,250,0.4)" : "rgb(167,139,250)",
              cursor: running ? "not-allowed" : "pointer",
            }}
            data-testid="button-create-replit"
          >
            <Play className={`w-3.5 h-3.5 ${running ? "animate-pulse" : ""}`} />
            {running ? "CREATING ACCOUNT..." : "CREATE REPLIT ACCOUNT"}
          </button>

          <div className="rounded-lg p-3 space-y-1" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[10px] font-mono text-white/25 uppercase tracking-wider mb-2">How it works</p>
            <p className="text-[10px] font-mono text-white/40">1. Opens Replit signup with anti-bot browser</p>
            <p className="text-[10px] font-mono text-white/40">2. Auto-generates username + secure password</p>
            <p className="text-[10px] font-mono text-white/40">3. Fills & submits the signup form</p>
            <p className="text-[10px] font-mono text-white/40">4. Logs into OWA browser to read verification email</p>
            <p className="text-[10px] font-mono text-white/40">5. Clicks verification link automatically</p>
            <p className="text-[10px] font-mono text-white/40">6. Saves credentials to database</p>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(124,58,237,0.1)" }}>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="w-full flex items-center justify-between px-4 py-3 text-[10px] font-mono text-violet-400/50 uppercase tracking-wider hover:bg-violet-400/5 transition-colors"
            data-testid="button-toggle-logs"
          >
            <span>Live Logs {running && <span className="animate-pulse text-violet-400">● RUNNING</span>}</span>
            {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showLogs && (
            <div className="h-64 overflow-y-auto p-3 space-y-0.5" data-testid="container-logs">
              {logs.length === 0 ? (
                <p className="text-[10px] font-mono text-white/20 text-center py-8">No logs yet — start a job to see output</p>
              ) : (
                logs.map((line, i) => (
                  <p key={i} className={`text-[10px] font-mono leading-relaxed ${getLogColor(line.text)}`}>
                    {line.text}
                  </p>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          )}
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
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(124,58,237,0.15)" }}
                  >
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
                        onClick={() => setRevealedIds(prev => {
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
                    {copiedId === acct.id ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-violet-400/60" />
                    )}
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

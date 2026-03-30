import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Copy, Trash2, Mail, Key, Plus, RefreshCw, Check, Eye, EyeOff, Shield, Database, Loader2, X, Zap, Download, Inbox, User, Calendar, Code2, Link, ExternalLink } from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";

type OutlookAccount = {
  id: string;
  email: string;
  password: string;
  status: string;
  createdBy: string | null;
  createdAt: string;
};

type ZenrowsKey = {
  id: string;
  apiKey: string;
  outlookEmail: string | null;
  outlookPassword: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
};

type ReplitAccount = {
  id: string;
  username: string;
  email: string;
  password: string;
  outlookEmail: string | null;
  status: string;
  credits: string | null;
  warmedAt: string | null;
  createdAt: string;
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

type TabType = "outlook" | "zenrows" | "replit" | "lovable";

type ZenrowsRegJob = {
  regId: string;
  batchId: string;
  outlookEmail: string;
  status: "running" | "success" | "failed";
  logs: string[];
  apiKey?: string;
  error?: string;
};


export default function PrivateAccount() {
  const [tab, setTab] = useState<TabType>("outlook");
  const [outlookAccounts, setOutlookAccounts] = useState<OutlookAccount[]>([]);
  const [zenrowsKeys, setZenrowsKeys] = useState<ZenrowsKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [addOutlookOpen, setAddOutlookOpen] = useState(false);
  const [addZenrowsOpen, setAddZenrowsOpen] = useState(false);
  const [newOutlookEmail, setNewOutlookEmail] = useState("");
  const [newOutlookPassword, setNewOutlookPassword] = useState("");
  const [newZenrowsKey, setNewZenrowsKey] = useState("");
  const [newZenrowsEmail, setNewZenrowsEmail] = useState("");
  const [newZenrowsPassword, setNewZenrowsPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [zenrowsRegJobs, setZenrowsRegJobs] = useState<Record<string, ZenrowsRegJob>>({});
  const [registeringAccountIds, setRegisteringAccountIds] = useState<Set<string>>(new Set());
  const [replitAccounts, setReplitAccounts] = useState<ReplitAccount[]>([]);
  const [lovableShowPasswords, setLovableShowPasswords] = useState<Record<string, boolean>>({});
  const [lovableAccounts, setLovableAccounts] = useState<LovableAccount[]>([]);
  const [bulkCopyCount, setBulkCopyCount] = useState(10);
  const [bulkCopyCredits, setBulkCopyCredits] = useState<"any" | "5" | "20">("any");
  const [bulkCopiedIds, setBulkCopiedIds] = useState<string[] | null>(null);
  const [replitBulkCopyCount, setReplitBulkCopyCount] = useState(10);
  const [replitBulkCopiedIds, setReplitBulkCopiedIds] = useState<string[] | null>(null);
  const [replitBulkStatusFilter, setReplitBulkStatusFilter] = useState<"any" | "processing" | "available" | "working" | "sold_out">("any");
  const [replitBulkStatusTarget, setReplitBulkStatusTarget] = useState("sold_out");
  const [replitBulkApplying, setReplitBulkApplying] = useState(false);
  const [bulkStatusTarget, setBulkStatusTarget] = useState("sold_out");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [warmLogs, setWarmLogs] = useState<string[]>([]);
  const [warmRunning, setWarmRunning] = useState(false);
  const [warmBatchId, setWarmBatchId] = useState<string | null>(null);
  const [purgeLogs, setPurgeLogs] = useState<string[]>([]);
  const [purgeRunning, setPurgeRunning] = useState(false);
  const [selectedReplitIds, setSelectedReplitIds] = useState<Set<string>>(new Set());
  const warmLogsEndRef = useRef<HTMLDivElement | null>(null);
  const purgeLogsEndRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "log" && data.batchId?.startsWith("zenrows-reg-")) {
        setZenrowsRegJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          const newLogs = [...job.logs, data.message].slice(-50);
          return { ...prev, [data.batchId]: { ...job, logs: newLogs } };
        });
      }
      if (data.type === "zenrows_register_result") {
        setZenrowsRegJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          return {
            ...prev,
            [data.batchId]: {
              ...job,
              status: data.success ? "success" : "failed",
              apiKey: data.apiKey,
              error: data.error,
            },
          };
        });
        if (data.success) {
          fetchZenrows();
          toast({ title: "Proxy API Key Generated", description: `API key created using ${data.outlookEmail || "Outlook account"}` });
          sounds.navigate();
        } else {
          toast({ title: "Registration Failed", description: data.error || "Unknown error", variant: "destructive" });
        }
        setRegisteringAccountIds((prev) => {
          const next = new Set(prev);
          for (const [, job] of Object.entries(zenrowsRegJobs)) {
            if (job.batchId === data.batchId) {
              for (const acc of outlookAccounts) {
                if (acc.email === job.outlookEmail) next.delete(acc.id);
              }
            }
          }
          return next;
        });
      }
      if (data.type === "batch_complete" && data.batchId?.startsWith("zenrows-reg-")) {
        setZenrowsRegJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          if (job.status === "running") {
            return { ...prev, [data.batchId]: { ...job, status: "failed", error: "Batch completed without result" } };
          }
          return prev;
        });
      }

      if (data.type === "replit_create_result") {
        fetchReplit();
      }

      if (data.type === "log" && data.batchId?.startsWith("replit-warm-")) {
        setWarmBatchId((prev) => prev || data.batchId);
        setWarmLogs((prev) => [...prev, data.message].slice(-200));
      }
      if (data.type === "batch_complete" && data.batchId?.startsWith("replit-warm-")) {
        setWarmRunning(false);
        fetchReplit();
      }

      if (data.type === "log" && data.batchId?.startsWith("replit-purge-")) {
        setPurgeLogs((prev) => [...prev, data.message].slice(-300));
      }
      if (data.type === "batch_complete" && data.batchId?.startsWith("replit-purge-")) {
        setPurgeRunning(false);
        fetchReplit();
      }
      if (data.type === "replit_account_deleted") {
        setReplitAccounts((prev) => prev.filter((a) => a.id !== data.id));
      }

      if (data.type === "account_update" && data.account) {
        const acc = data.account;
        if (acc.username !== undefined && acc.email !== undefined) {
          setReplitAccounts((prev) => {
            const idx = prev.findIndex((a) => a.id === acc.id);
            if (idx === -1) {
              fetchReplit();
              return prev;
            }
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              status: acc.status ?? updated[idx].status,
              credits: acc.credits ?? updated[idx].credits,
              username: acc.username ?? updated[idx].username,
            };
            return updated;
          });
        }
      }

      if (data.type === "outlook_login_result" || data.type === "outlook_bulk_login_result") {
        fetchOutlook();
      }
    } catch {}
  }, [outlookAccounts, zenrowsRegJobs, toast]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = handleWsMessage;
    ws.onclose = () => {
      setTimeout(() => {
        const newWs = new WebSocket(`${protocol}//${window.location.host}/ws`);
        wsRef.current = newWs;
        newWs.onmessage = handleWsMessage;
      }, 3000);
    };
    return () => { ws.close(); };
  }, [handleWsMessage]);

  function fetchOutlook() {
    fetch("/api/private/outlook", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        return r.json();
      })
      .then(setOutlookAccounts)
      .catch(() => {});
  }

  function fetchZenrows() {
    fetch("/api/private/zenrows", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        return r.json();
      })
      .then(setZenrowsKeys)
      .catch(() => {});
  }

  function fetchReplit() {
    fetch("/api/replit-accounts", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        return r.json();
      })
      .then(setReplitAccounts)
      .catch(() => {});
  }

  function fetchLovable() {
    fetch("/api/lovable-accounts", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        return r.json();
      })
      .then(setLovableAccounts)
      .catch(() => {});
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchOutlook(), fetchZenrows(), fetchReplit(), fetchLovable()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    warmLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [warmLogs]);

  useEffect(() => {
    purgeLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [purgeLogs]);

  useEffect(() => {
    const fetchers: Record<TabType, () => void> = {
      outlook: fetchOutlook,
      zenrows: fetchZenrows,
      replit: fetchReplit,
      lovable: fetchLovable,
    };
    const interval = setInterval(() => {
      fetchers[tab]?.();
    }, 30000);
    return () => clearInterval(interval);
  }, [tab]);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    sounds.navigate();
    setTimeout(() => setCopied(null), 1500);
  }

  function togglePassword(id: string) {
    setShowPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleWarmAccounts() {
    const hasSelection = selectedReplitIds.size > 0;
    const candidates = hasSelection
      ? replitAccounts.filter(a => selectedReplitIds.has(a.id) && !a.warmedAt && a.email && a.password)
      : replitAccounts.filter(a => !a.warmedAt && a.email && a.password);
    if (candidates.length === 0) {
      toast({
        title: "Nothing to warm",
        description: hasSelection ? "All selected accounts are already warmed" : "All accounts are already warmed",
      });
      return;
    }
    setWarmLogs([`Starting warmup for ${candidates.length} account(s)...`]);
    setWarmRunning(true);
    setWarmBatchId(null);
    try {
      const res = await fetch("/api/replit-warm-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountIds: candidates.map(a => a.id) }),
      });
      const data = await res.json();
      if (!data.success) {
        setWarmRunning(false);
        toast({ title: "Warmup failed", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      setWarmRunning(false);
      toast({ title: "Warmup error", description: err.message, variant: "destructive" });
    }
  }

  async function handlePurgeBanned() {
    const processing = replitAccounts.filter(a => a.status === "processing");
    if (processing.length === 0) {
      toast({ title: "Nothing to scan", description: 'No "processing" accounts in the list' });
      return;
    }
    setPurgeLogs([`Starting ban scan for ${processing.length} processing account(s)...`]);
    setPurgeRunning(true);
    try {
      const res = await fetch("/api/replit-purge-banned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setPurgeRunning(false);
        toast({ title: "Scan failed", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      setPurgeRunning(false);
      toast({ title: "Scan error", description: err.message, variant: "destructive" });
    }
  }

  async function addOutlookAccount() {
    if (!newOutlookEmail.trim() || !newOutlookPassword.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/private/outlook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newOutlookEmail.trim(), password: newOutlookPassword.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "Account added", description: "Outlook account saved successfully" });
        sounds.navigate();
        setNewOutlookEmail("");
        setNewOutlookPassword("");
        setAddOutlookOpen(false);
        fetchOutlook();
      }
    } catch {} finally { setSaving(false); }
  }

  async function addZenrowsKey() {
    if (!newZenrowsKey.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/private/zenrows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: newZenrowsKey.trim(), outlookEmail: newZenrowsEmail.trim() || null, outlookPassword: newZenrowsPassword.trim() || null }),
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "API Key added", description: "Proxy API key saved successfully" });
        sounds.navigate();
        setNewZenrowsKey("");
        setNewZenrowsEmail("");
        setNewZenrowsPassword("");
        setAddZenrowsOpen(false);
        fetchZenrows();
      }
    } catch {} finally { setSaving(false); }
  }

  async function deleteOutlook(id: string) {
    try {
      await fetch(`/api/private/outlook/${id}`, { method: "DELETE", credentials: "include" });
      sounds.navigate();
      fetchOutlook();
    } catch {}
  }

  async function deleteZenrows(id: string) {
    try {
      await fetch(`/api/private/zenrows/${id}`, { method: "DELETE", credentials: "include" });
      sounds.navigate();
      fetchZenrows();
    } catch {}
  }

  async function registerZenrowsWithOutlook(acc: OutlookAccount) {
    if (registeringAccountIds.has(acc.id)) return;
    setRegisteringAccountIds((prev) => new Set(prev).add(acc.id));
    try {
      const res = await fetch("/api/zenrows-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outlookEmail: acc.email, outlookPassword: acc.password }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        toast({ title: "Failed to start", description: err.error || "Unknown error", variant: "destructive" });
        setRegisteringAccountIds((prev) => { const n = new Set(prev); n.delete(acc.id); return n; });
        return;
      }
      const data = await res.json();
      setZenrowsRegJobs((prev) => ({
        ...prev,
        [data.batchId]: {
          regId: data.regId,
          batchId: data.batchId,
          outlookEmail: acc.email,
          status: "running",
          logs: ["Starting proxy registration with " + acc.email + "..."],
        },
      }));
      toast({ title: "Registration Started", description: `Registering proxy with ${acc.email}` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to start registration", variant: "destructive" });
      setRegisteringAccountIds((prev) => { const n = new Set(prev); n.delete(acc.id); return n; });
    }
  }

  function dismissJob(batchId: string) {
    setZenrowsRegJobs((prev) => {
      const next = { ...prev };
      const job = next[batchId];
      if (job) {
        setRegisteringAccountIds((ids) => {
          const n = new Set(ids);
          for (const a of outlookAccounts) {
            if (a.email === job.outlookEmail) n.delete(a.id);
          }
          return n;
        });
      }
      delete next[batchId];
      return next;
    });
  }

  function timeAgo(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const activeOutlook = outlookAccounts.filter((a) => a.status === "active").length;
  const activeZenrows = zenrowsKeys.filter((k) => k.status === "active").length;
  const activeJobs = Object.values(zenrowsRegJobs).filter((j) => j.status !== "running" || j.logs.length > 0);

  const statCards = [
    {
      id: "outlook" as TabType,
      label: "Outlook Accounts",
      count: outlookAccounts.length,
      sub: `${activeOutlook} active`,
      color: "#3b82f6",
      glow: "rgba(59,130,246,0.18)",
      border: "rgba(59,130,246,0.25)",
      textColor: "text-blue-400",
      icon: <Mail className="w-4 h-4" />,
      testId: "card-outlook-summary",
    },
    {
      id: "zenrows" as TabType,
      label: "Proxy API Stock",
      count: zenrowsKeys.length,
      sub: `${activeZenrows} active`,
      color: "#a855f7",
      glow: "rgba(168,85,247,0.18)",
      border: "rgba(168,85,247,0.25)",
      textColor: "text-purple-400",
      icon: <Key className="w-4 h-4" />,
      testId: "card-zenrows-summary",
    },
    {
      id: "replit" as TabType,
      label: "Replit Accounts",
      count: replitAccounts.length,
      sub: `${replitAccounts.filter((a) => a.status === "available" || a.status === "working").length} ready`,
      color: "#7c3aed",
      glow: "rgba(124,58,237,0.18)",
      border: "rgba(124,58,237,0.25)",
      textColor: "text-violet-400",
      icon: <Code2 className="w-4 h-4" />,
      testId: "card-replit-summary",
    },
    {
      id: "lovable" as TabType,
      label: "Lovable Accounts",
      count: lovableAccounts.length,
      sub: `${lovableAccounts.filter((a) => a.status === "created").length} ready`,
      color: "#ec4899",
      glow: "rgba(236,72,153,0.18)",
      border: "rgba(236,72,153,0.25)",
      textColor: "text-pink-400",
      icon: <Shield className="w-4 h-4" />,
      testId: "card-lovable-summary",
    },
  ];

  return (
    <div className="flex flex-col h-full p-7 gap-5">
      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-5 gap-3 shrink-0">
        {statCards.map((s) => (
          <div
            key={s.id}
            onClick={() => { setTab(s.id); sounds.hover(); }}
            data-testid={s.testId}
            className="relative rounded-xl cursor-pointer group overflow-hidden transition-all duration-200"
            style={{
              background: tab === s.id ? `linear-gradient(135deg, ${s.glow} 0%, rgba(0,0,0,0.6) 100%)` : "rgba(0,0,0,0.35)",
              border: `1px solid ${tab === s.id ? s.border : "rgba(255,255,255,0.06)"}`,
              boxShadow: tab === s.id ? `0 0 24px ${s.glow}` : "none",
            }}
          >
            {/* top accent bar */}
            <div className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl transition-all duration-200" style={{ background: tab === s.id ? `linear-gradient(90deg, transparent, ${s.color}, transparent)` : "transparent" }} />
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200" style={{ background: `${s.glow}`, border: `1px solid ${s.border}`, color: s.color }}>
                  {s.icon}
                </div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full transition-all duration-200" style={{ color: s.color, background: `${s.glow}`, border: `1px solid ${s.border}` }}>
                  {s.sub}
                </span>
              </div>
              <p className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>{s.label}</p>
              <p className="text-2xl font-black font-mono leading-none transition-all duration-200" style={{ color: tab === s.id ? s.color : "#f1f5f9" }} data-testid={`text-${s.id}-count`}>
                {s.count}
              </p>
            </div>
          </div>
        ))}
      </div>

      {activeJobs.length > 0 && (
        <div className="space-y-3 shrink-0">
          {Object.values(zenrowsRegJobs).map((job) => (
            <Card key={job.batchId} className={`border-emerald-500/10 bg-black/20 ${job.status === "success" ? "border-emerald-500/20" : job.status === "failed" ? "border-red-500/20" : "border-purple-500/20"}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {job.status === "running" && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
                    {job.status === "success" && <Check className="w-4 h-4 text-emerald-400" />}
                    {job.status === "failed" && <X className="w-4 h-4 text-red-400" />}
                    <span className="text-xs font-mono text-emerald-50">
                      Proxy Registration — {job.outlookEmail}
                    </span>
                    <Badge variant="outline" className={`text-[9px] font-mono ${
                      job.status === "running" ? "border-purple-500/20 text-purple-400" :
                      job.status === "success" ? "border-emerald-500/20 text-emerald-400" :
                      "border-red-500/20 text-red-400"
                    }`} data-testid={`badge-reg-status-${job.regId}`}>
                      {job.status.toUpperCase()}
                    </Badge>
                  </div>
                  {job.status !== "running" && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-zinc-500 hover:text-zinc-300" onClick={() => dismissJob(job.batchId)} data-testid={`button-dismiss-job-${job.regId}`}>
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                {job.apiKey && (
                  <div className="mb-3 p-3 rounded-lg border border-emerald-500/15" style={{ background: "rgba(16,185,129,0.04)" }}>
                    <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">Generated API Key</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-emerald-400 break-all" data-testid={`text-generated-key-${job.regId}`}>{job.apiKey}</span>
                      <button onClick={() => copyToClipboard(job.apiKey!, `gen-${job.regId}`)} className="text-zinc-600 hover:text-emerald-400 transition-colors flex-shrink-0" data-testid={`button-copy-generated-key-${job.regId}`}>
                        {copied === `gen-${job.regId}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                )}
                {job.error && (
                  <div className="mb-3 p-2 rounded border border-red-500/15" style={{ background: "rgba(239,68,68,0.04)" }}>
                    <p className="text-[10px] text-red-400 font-mono">{job.error}</p>
                  </div>
                )}
                <div className="max-h-32 overflow-y-auto rounded border border-emerald-500/8 p-2" style={{ background: "rgba(0,0,0,0.3)" }}>
                  {job.logs.map((log, i) => (
                    <p key={i} className="text-[10px] text-zinc-500 font-mono leading-relaxed">{log}</p>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "outlook" && (
        <Card className="border-emerald-500/10 bg-black/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono text-emerald-50 flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-400" />
                Outlook Accounts
                <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/15 text-emerald-400/60 ml-2">{outlookAccounts.length} total</Badge>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 font-mono text-xs"
                onClick={() => { setAddOutlookOpen(!addOutlookOpen); sounds.navigate(); }}
                data-testid="button-add-outlook"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Manual
              </Button>
            </div>
          </CardHeader>

          {addOutlookOpen && (
            <div className="mx-6 mb-4 p-4 rounded-lg border border-emerald-500/10" style={{ background: "rgba(0,255,65,0.02)" }}>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-3">Add Outlook Account</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Input
                  placeholder="email@outlook.com"
                  value={newOutlookEmail}
                  onChange={(e) => setNewOutlookEmail(e.target.value)}
                  className="h-8 text-xs bg-black/30 border-emerald-500/10 text-emerald-50 font-mono"
                  data-testid="input-outlook-email"
                />
                <Input
                  placeholder="Password"
                  value={newOutlookPassword}
                  onChange={(e) => setNewOutlookPassword(e.target.value)}
                  className="h-8 text-xs bg-black/30 border-emerald-500/10 text-emerald-50 font-mono"
                  data-testid="input-outlook-password"
                />
              </div>
              <Button size="sm" className="bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 font-mono text-xs" onClick={addOutlookAccount} disabled={saving} data-testid="button-save-outlook">
                {saving ? "Saving..." : "Save Account"}
              </Button>
            </div>
          )}

          <CardContent className="pt-0">
            {outlookAccounts.length === 0 ? (
              <div className="text-center py-12">
                <Mail className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-sm text-zinc-500 font-mono">No Outlook accounts yet</p>
                <p className="text-xs text-zinc-600 font-mono mt-1">Accounts are auto-saved when created via Outlook Create</p>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/8 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-emerald-500/8 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Email</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Password</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Status</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Created</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outlookAccounts.map((acc) => (
                      <TableRow key={acc.id} className="border-emerald-500/5 hover:bg-emerald-500/[0.02]" data-testid={`row-outlook-${acc.id}`}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-emerald-50" data-testid={`text-email-${acc.id}`}>{acc.email}</span>
                            <button onClick={() => copyToClipboard(acc.email, `e-${acc.id}`)} className="text-zinc-600 hover:text-emerald-400 transition-colors" data-testid={`button-copy-email-${acc.id}`}>
                              {copied === `e-${acc.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-zinc-400" data-testid={`text-password-${acc.id}`}>
                              {showPasswords[acc.id] ? acc.password : "••••••••"}
                            </span>
                            <button onClick={() => togglePassword(acc.id)} className="text-zinc-600 hover:text-emerald-400 transition-colors" data-testid={`button-toggle-password-${acc.id}`}>
                              {showPasswords[acc.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                            <button onClick={() => copyToClipboard(acc.password, `p-${acc.id}`)} className="text-zinc-600 hover:text-emerald-400 transition-colors" data-testid={`button-copy-password-${acc.id}`}>
                              {copied === `p-${acc.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="outline" className={`text-[9px] font-mono ${acc.status === "active" ? "border-emerald-500/20 text-emerald-400" : "border-red-500/20 text-red-400"}`} data-testid={`badge-status-${acc.id}`}>
                            {acc.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[10px] text-zinc-600 font-mono" title={formatDate(acc.createdAt)}>{timeAgo(acc.createdAt)}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-6 px-2 font-mono text-[10px] ${
                                registeringAccountIds.has(acc.id)
                                  ? "text-purple-400/50 cursor-not-allowed"
                                  : "text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/10"
                              }`}
                              onClick={() => registerZenrowsWithOutlook(acc)}
                              disabled={registeringAccountIds.has(acc.id) || acc.status !== "active"}
                              data-testid={`button-register-zenrows-${acc.id}`}
                            >
                              {registeringAccountIds.has(acc.id) ? (
                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              ) : (
                                <Zap className="w-3 h-3 mr-1" />
                              )}
                              {registeringAccountIds.has(acc.id) ? "Registering..." : "Register"}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10" onClick={() => deleteOutlook(acc.id)} data-testid={`button-delete-outlook-${acc.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "zenrows" && (
        <Card className="border-emerald-500/10 bg-black/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono text-emerald-50 flex items-center gap-2">
                <Key className="w-4 h-4 text-purple-400" />
                Addison Proxy Key Stock
                <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/15 text-emerald-400/60 ml-2">{zenrowsKeys.length} total</Badge>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 font-mono text-xs"
                onClick={() => { setAddZenrowsOpen(!addZenrowsOpen); sounds.navigate(); }}
                data-testid="button-add-zenrows"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Manual
              </Button>
            </div>
          </CardHeader>

          {addZenrowsOpen && (
            <div className="mx-6 mb-4 p-4 rounded-lg border border-purple-500/10" style={{ background: "rgba(255,176,0,0.02)" }}>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-3">Add Proxy API Key</p>
              <div className="space-y-3 mb-3">
                <Input
                  placeholder="API Key (40+ char hex string)"
                  value={newZenrowsKey}
                  onChange={(e) => setNewZenrowsKey(e.target.value)}
                  className="h-8 text-xs bg-black/30 border-purple-500/10 text-emerald-50 font-mono"
                  data-testid="input-zenrows-key"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    placeholder="Outlook email (optional)"
                    value={newZenrowsEmail}
                    onChange={(e) => setNewZenrowsEmail(e.target.value)}
                    className="h-8 text-xs bg-black/30 border-purple-500/10 text-emerald-50 font-mono"
                    data-testid="input-zenrows-email"
                  />
                  <Input
                    placeholder="Outlook password (optional)"
                    value={newZenrowsPassword}
                    onChange={(e) => setNewZenrowsPassword(e.target.value)}
                    className="h-8 text-xs bg-black/30 border-purple-500/10 text-emerald-50 font-mono"
                    data-testid="input-zenrows-password"
                  />
                </div>
              </div>
              <Button size="sm" className="bg-purple-500/15 text-purple-400 border border-purple-500/20 hover:bg-purple-500/25 font-mono text-xs" onClick={addZenrowsKey} disabled={saving} data-testid="button-save-zenrows">
                {saving ? "Saving..." : "Save API Key"}
              </Button>
            </div>
          )}

          <CardContent className="pt-0">
            {zenrowsKeys.length === 0 ? (
              <div className="text-center py-12">
                <Key className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-sm text-zinc-500 font-mono">No proxy API keys yet</p>
                <p className="text-xs text-zinc-600 font-mono mt-1">Keys are auto-saved when created via Proxy Register</p>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/8 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-emerald-500/8 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">API Key</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Outlook Email</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Status</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Created</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zenrowsKeys.map((key) => (
                      <TableRow key={key.id} className="border-emerald-500/5 hover:bg-emerald-500/[0.02]" data-testid={`row-zenrows-${key.id}`}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-emerald-50" data-testid={`text-apikey-${key.id}`}>
                              {showPasswords[`zk-${key.id}`] ? key.apiKey : key.apiKey.substring(0, 8) + "••••••••"}
                            </span>
                            <button onClick={() => togglePassword(`zk-${key.id}`)} className="text-zinc-600 hover:text-purple-400 transition-colors" data-testid={`button-toggle-key-${key.id}`}>
                              {showPasswords[`zk-${key.id}`] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                            <button onClick={() => copyToClipboard(key.apiKey, `k-${key.id}`)} className="text-zinc-600 hover:text-purple-400 transition-colors" data-testid={`button-copy-key-${key.id}`}>
                              {copied === `k-${key.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-xs font-mono text-zinc-400">{key.outlookEmail || "—"}</span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="outline" className={`text-[9px] font-mono ${key.status === "active" ? "border-emerald-500/20 text-emerald-400" : "border-red-500/20 text-red-400"}`} data-testid={`badge-zenrows-status-${key.id}`}>
                            {key.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[10px] text-zinc-600 font-mono" title={formatDate(key.createdAt)}>{timeAgo(key.createdAt)}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10" onClick={() => deleteZenrows(key.id)} data-testid={`button-delete-zenrows-${key.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "replit" && (
        <div
          className="rounded-xl border flex flex-col flex-1 min-h-0 overflow-hidden"
          style={{
            borderColor: "rgba(124,58,237,0.2)",
            background: "linear-gradient(135deg, rgba(10,0,30,0.98) 0%, rgba(20,5,45,0.98) 100%)",
            boxShadow: "0 0 40px rgba(124,58,237,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          {/* ── Header bar ── */}
          <div
            className="flex items-center justify-between px-5 py-3 border-b"
            style={{ borderColor: "rgba(124,58,237,0.15)", background: "rgba(124,58,237,0.06)" }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <Code2 className="w-4 h-4" style={{ color: "#a78bfa", filter: "drop-shadow(0 0 6px rgba(167,139,250,0.8))" }} />
                <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-violet-400 animate-ping" style={{ animationDuration: "2s" }} />
              </div>
              <span
                className="text-sm font-black font-mono uppercase tracking-widest"
                style={{ color: "#a78bfa", textShadow: "0 0 20px rgba(167,139,250,0.5)" }}
              >
                Replit Accounts
              </span>
              <div
                className="px-2 py-0.5 rounded font-mono text-[10px] font-bold"
                style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.35)", color: "#c4b5fd" }}
                data-testid="text-replit-count"
              >
                {replitAccounts.length} total
              </div>
              {replitAccounts.filter((a) => a.status === "available").length > 0 && (
                <div
                  className="px-2 py-0.5 rounded font-mono text-[10px] font-bold flex items-center gap-1"
                  style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                  {replitAccounts.filter((a) => a.status === "available").length} ready
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(selectedReplitIds.size > 0 || replitAccounts.filter(a => !a.warmedAt).length > 0) && (
                <button
                  onClick={handleWarmAccounts}
                  disabled={warmRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-xs font-semibold transition-all duration-150"
                  style={{
                    background: warmRunning ? "rgba(251,146,60,0.06)" : "rgba(251,146,60,0.12)",
                    border: "1px solid rgba(251,146,60,0.35)",
                    color: warmRunning ? "rgba(251,146,60,0.4)" : "#fb923c",
                    cursor: warmRunning ? "not-allowed" : "pointer",
                  }}
                  data-testid="button-warm-accounts"
                >
                  <Zap className={`w-3 h-3 ${warmRunning ? "animate-pulse" : ""}`} />
                  {warmRunning
                    ? "warming..."
                    : selectedReplitIds.size > 0
                      ? `Warm Selected (${selectedReplitIds.size})`
                      : `Warm All Unwarmed (${replitAccounts.filter(a => !a.warmedAt).length})`}
                </button>
              )}
              {replitAccounts.filter(a => a.status === "processing").length > 0 && (
                <button
                  onClick={handlePurgeBanned}
                  disabled={purgeRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-xs font-semibold transition-all duration-150"
                  style={{
                    background: purgeRunning ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.35)",
                    color: purgeRunning ? "rgba(239,68,68,0.4)" : "#f87171",
                    cursor: purgeRunning ? "not-allowed" : "pointer",
                  }}
                  data-testid="button-purge-banned"
                >
                  <Trash2 className={`w-3 h-3 ${purgeRunning ? "animate-pulse" : ""}`} />
                  {purgeRunning
                    ? "scanning..."
                    : `Purge Banned (${replitAccounts.filter(a => a.status === "processing").length})`}
                </button>
              )}
              {replitAccounts.length > 0 && (
                <button
                  onClick={() => window.open("/api/replit-accounts/export-csv", "_blank")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded font-mono text-xs font-semibold transition-all duration-150"
                  style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.3)", color: "#a78bfa" }}
                  data-testid="button-export-replit-csv"
                >
                  <Download className="w-3 h-3" />
                  CSV
                </button>
              )}
              <button
                onClick={fetchReplit}
                className="flex items-center justify-center w-7 h-7 rounded transition-all duration-150"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#71717a" }}
                data-testid="button-refresh-replit"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* ── Warm log drawer ── */}
          {warmLogs.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(251,146,60,0.15)", background: "rgba(0,0,0,0.6)" }}>
              <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid rgba(251,146,60,0.08)" }}>
                <div className="flex items-center gap-2">
                  <Zap className="w-3 h-3" style={{ color: warmRunning ? "#fb923c" : "rgba(251,146,60,0.4)" }} />
                  <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: warmRunning ? "#fb923c" : "rgba(251,146,60,0.4)" }}>
                    {warmRunning ? "warming_accounts" : "warmup_complete"}
                  </span>
                  {warmRunning && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />}
                </div>
                <button
                  onClick={() => { setWarmLogs([]); setWarmBatchId(null); }}
                  className="text-[10px] font-mono"
                  style={{ color: "rgba(255,255,255,0.2)" }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="px-4 py-2 max-h-40 overflow-y-auto font-mono text-[10px] space-y-0.5">
                {warmLogs.map((line, i) => (
                  <div key={i} style={{
                    color: line.includes("✅") ? "#4ade80" : line.includes("❌") ? "#f87171" : line.includes("⚠️") ? "#facc15" : "rgba(251,146,60,0.6)",
                  }}>
                    {line}
                  </div>
                ))}
                <div ref={warmLogsEndRef} />
              </div>
            </div>
          )}

          {/* ── Purge Banned log drawer ── */}
          {purgeLogs.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(239,68,68,0.15)", background: "rgba(0,0,0,0.6)" }}>
              <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid rgba(239,68,68,0.08)" }}>
                <div className="flex items-center gap-2">
                  <Trash2 className="w-3 h-3" style={{ color: purgeRunning ? "#f87171" : "rgba(239,68,68,0.4)" }} />
                  <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: purgeRunning ? "#f87171" : "rgba(239,68,68,0.4)" }}>
                    {purgeRunning ? "scanning_accounts" : "scan_complete"}
                  </span>
                  {purgeRunning && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />}
                </div>
                <button
                  onClick={() => setPurgeLogs([])}
                  className="text-[10px] font-mono"
                  style={{ color: "rgba(255,255,255,0.2)" }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="px-4 py-2 max-h-48 overflow-y-auto font-mono text-[10px] space-y-0.5">
                {purgeLogs.map((line, i) => (
                  <div key={i} style={{
                    color: line.includes("✅") ? "#4ade80"
                      : line.includes("🚫") || line.includes("BANNED") ? "#f87171"
                      : line.includes("⚠️") ? "#facc15"
                      : line.includes("🔎") || line.includes("🔍") ? "#a78bfa"
                      : "rgba(239,68,68,0.6)",
                  }}>
                    {line}
                  </div>
                ))}
                <div ref={purgeLogsEndRef} />
              </div>
            </div>
          )}

          {/* ── Spreadsheet Table ── */}
          {replitAccounts.length === 0 ? (
            <div className="text-center py-16">
              <Code2 className="w-8 h-8 mx-auto mb-3" style={{ color: "rgba(124,58,237,0.3)" }} />
              <p className="text-sm font-mono" style={{ color: "rgba(167,139,250,0.4)" }}>No Replit accounts yet</p>
              <p className="text-xs font-mono mt-1" style={{ color: "rgba(255,255,255,0.2)" }}>Create accounts in the Replit Create module</p>
            </div>
          ) : (
            <div className="overflow-auto flex-1 min-h-0">
              {/* ── Spreadsheet grid ── */}
              <div style={{ minWidth: "820px" }}>

                {/* Column-letter row (Google Sheets style) */}
                <div
                  className="grid sticky top-0 z-20 font-mono text-[9px] font-bold text-center select-none"
                  style={{
                    gridTemplateColumns: "30px 36px 1fr 160px 70px 180px 100px 72px",
                    background: "#0f0f1e",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {/* row-number gutter label */}
                  <div className="py-1" style={{ borderRight: "1px solid rgba(255,255,255,0.06)", color: "#2a2a3f" }} />
                  {/* checkbox gutter */}
                  <div
                    className="py-1 flex items-center justify-center"
                    style={{ borderRight: "1px solid rgba(255,255,255,0.06)", color: "#3a3a55" }}
                  >
                    <input
                      type="checkbox"
                      className="w-3 h-3 cursor-pointer"
                      style={{ accentColor: "#a78bfa" }}
                      checked={replitAccounts.length > 0 && selectedReplitIds.size === replitAccounts.length}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedReplitIds(new Set(replitAccounts.map(a => a.id)));
                        else setSelectedReplitIds(new Set());
                      }}
                      title="Select all"
                      data-testid="checkbox-replit-select-all"
                    />
                  </div>
                  {(["B", "C", "D", "E", "F", "G"] as const).map((letter, i) => (
                    <div
                      key={letter}
                      className="py-1"
                      style={{
                        borderRight: i < 5 ? "1px solid rgba(255,255,255,0.06)" : "none",
                        color: "rgba(255,255,255,0.18)",
                        letterSpacing: "0.15em",
                      }}
                    >
                      {letter}
                    </div>
                  ))}
                </div>

                {/* Colored column-header row */}
                <div
                  className="grid sticky font-mono text-[10px] font-black uppercase tracking-widest z-10"
                  style={{
                    top: "22px",
                    gridTemplateColumns: "30px 36px 1fr 160px 70px 180px 100px 72px",
                    borderBottom: "2px solid rgba(0,0,0,0.4)",
                  }}
                >
                  {/* row-number gutter header */}
                  <div style={{ background: "#0b0b18", borderRight: "1px solid rgba(255,255,255,0.06)" }} />
                  {/* checkbox gutter header */}
                  <div style={{ background: "#0b0b18", borderRight: "1px solid rgba(255,255,255,0.06)" }} />

                  <div
                    className="px-3 py-2 flex items-center"
                    style={{
                      background: "linear-gradient(90deg, #7f1d1d 0%, #b91c1c 100%)",
                      color: "#fecaca",
                      textShadow: "0 0 10px rgba(239,68,68,0.5)",
                      borderRight: "1px solid rgba(0,0,0,0.35)",
                    }}
                  >
                    E-Mail Address
                  </div>
                  <div
                    className="px-3 py-2"
                    style={{
                      background: "linear-gradient(90deg, #78350f 0%, #b45309 100%)",
                      color: "#fde68a",
                      textShadow: "0 0 10px rgba(245,158,11,0.5)",
                      borderRight: "1px solid rgba(0,0,0,0.35)",
                    }}
                  >
                    Password
                  </div>
                  <div
                    className="px-3 py-2"
                    style={{
                      background: "linear-gradient(90deg, #1e3a8a 0%, #1d4ed8 100%)",
                      color: "#bfdbfe",
                      textShadow: "0 0 10px rgba(59,130,246,0.5)",
                      borderRight: "1px solid rgba(0,0,0,0.35)",
                    }}
                  >
                    Credits
                  </div>
                  <div
                    className="px-3 py-2"
                    style={{
                      background: "linear-gradient(90deg, #14532d 0%, #15803d 100%)",
                      color: "#bbf7d0",
                      textShadow: "0 0 10px rgba(34,197,94,0.5)",
                      borderRight: "1px solid rgba(0,0,0,0.35)",
                    }}
                  >
                    Status
                  </div>
                  <div
                    className="px-3 py-2"
                    style={{
                      background: "linear-gradient(90deg, #1e3a5f 0%, #1d4ed8 100%)",
                      color: "#bae6fd",
                      textShadow: "0 0 10px rgba(59,130,246,0.5)",
                      borderRight: "1px solid rgba(0,0,0,0.35)",
                    }}
                  >
                    Checkout Link
                  </div>
                  <div
                    className="px-3 py-2 text-right"
                    style={{ background: "#0b0b18", color: "rgba(255,255,255,0.2)" }}
                  >
                    Actions
                  </div>
                </div>

                {/* Data rows */}
                {[...replitAccounts].sort((a, b) => {
                  const rank: Record<string, number> = { processing: 0, available: 1, working: 2, sold_out: 3, error: 4 };
                  return (rank[a.status] ?? 1) - (rank[b.status] ?? 1);
                }).map((acct, idx) => {
                  const st = acct.status;
                  type StatusCfg = { label: string; icon: string; color: string; glow: string; bg: string; border: string };
                  const statusConfig: Record<string, StatusCfg> = {
                    processing:  { label: "Processing",  icon: "◌", color: "#f97316", glow: "rgba(249,115,22,0.25)",  bg: "rgba(249,115,22,0.07)",  border: "rgba(249,115,22,0.35)"  },
                    available:   { label: "Available",   icon: "✓", color: "#38bdf8", glow: "rgba(56,189,248,0.25)",  bg: "rgba(56,189,248,0.07)",  border: "rgba(56,189,248,0.35)"  },
                    working:     { label: "Working",     icon: "●", color: "#4ade80", glow: "rgba(74,222,128,0.25)",  bg: "rgba(74,222,128,0.07)",  border: "rgba(74,222,128,0.35)"  },
                    sold_out:    { label: "Stock Out",   icon: "⊘", color: "#94a3b8", glow: "rgba(148,163,184,0.2)", bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.25)" },
                    error:       { label: "Error",       icon: "✕", color: "#ef4444", glow: "rgba(239,68,68,0.25)",   bg: "rgba(239,68,68,0.07)",   border: "rgba(239,68,68,0.3)"    },
                  };
                  const cfg = statusConfig[st] ?? statusConfig.processing;
                  const rowBg = idx % 2 === 0 ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.18)";
                  const cellBorder = "1px solid rgba(255,255,255,0.05)";
                  return (
                    <div
                      key={acct.id}
                      className="grid transition-colors duration-100 group"
                      style={{ gridTemplateColumns: "30px 36px 1fr 160px 70px 180px 100px 72px", background: rowBg }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(124,58,237,0.055)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                      data-testid={`row-replit-private-${acct.id}`}
                    >
                      {/* Row number */}
                      <div
                        className="flex items-center justify-center font-mono text-[9px] select-none"
                        style={{
                          background: "#0b0b18",
                          borderRight: cellBorder,
                          borderBottom: cellBorder,
                          color: "rgba(255,255,255,0.2)",
                          minHeight: "38px",
                        }}
                      >
                        {idx + 1}
                      </div>

                      {/* Checkbox */}
                      <div
                        className="flex items-center justify-center"
                        style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                      >
                        <input
                          type="checkbox"
                          className="w-3 h-3 cursor-pointer"
                          style={{ accentColor: "#a78bfa" }}
                          checked={selectedReplitIds.has(acct.id)}
                          onChange={(e) => {
                            setSelectedReplitIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(acct.id);
                              else next.delete(acct.id);
                              return next;
                            });
                          }}
                          data-testid={`checkbox-replit-${acct.id}`}
                        />
                      </div>

                      {/* Email */}
                      <div
                        className="px-3 py-2 flex items-center min-w-0"
                        style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                      >
                        <button
                          onClick={() => copyToClipboard(acct.email, `re-${acct.id}`)}
                          className="text-left font-mono text-xs truncate w-full"
                          style={{ color: copied === `re-${acct.id}` ? "#4ade80" : "#e2e8f0" }}
                          title="Click to copy"
                          data-testid={`button-copy-replit-email-${acct.id}`}
                        >
                          {copied === `re-${acct.id}` ? "✓ Copied!" : acct.email}
                        </button>
                      </div>

                      {/* Password */}
                      <div
                        className="px-3 py-2 flex items-center"
                        style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                      >
                        <button
                          onClick={() => copyToClipboard(acct.password, `rp-${acct.id}`)}
                          className="text-left font-mono text-xs truncate w-full"
                          style={{ color: copied === `rp-${acct.id}` ? "#4ade80" : "#a1a1aa" }}
                          title="Click to copy"
                          data-testid={`button-copy-replit-pw-${acct.id}`}
                        >
                          {copied === `rp-${acct.id}` ? "✓ Copied!" : acct.password}
                        </button>
                      </div>

                      {/* Credits */}
                      <div
                        className="px-3 py-2 flex items-center justify-center"
                        style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                      >
                        <span
                          className="text-xs font-black font-mono"
                          style={{ color: "#fb923c", textShadow: "0 0 12px rgba(251,146,60,0.5)" }}
                          data-testid={`text-replit-credits-${acct.id}`}
                        >
                          20$
                        </span>
                      </div>

                      {/* Status */}
                      <div
                        className="px-2 py-2 flex items-center"
                        style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                      >
                        <select
                          value={st}
                          onChange={async (e) => {
                            await fetch(`/api/replit-accounts/${acct.id}/status`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({ status: e.target.value }),
                            });
                            fetchReplit();
                          }}
                          className="w-full appearance-none rounded px-2 py-1 text-[10px] font-mono font-bold cursor-pointer focus:outline-none"
                          style={{
                            background: cfg.bg,
                            border: `1px solid ${cfg.border}`,
                            color: cfg.color,
                            boxShadow: `0 0 8px ${cfg.glow}`,
                          }}
                          data-testid={`select-replit-status-${acct.id}`}
                        >
                          <option value="processing">◌ Processing</option>
                          <option value="available">✓ Available</option>
                          <option value="working">● Working</option>
                          <option value="sold_out">⊘ Stock Out</option>
                          <option value="error">✕ Error</option>
                        </select>
                      </div>

                      {/* Checkout Link */}
                      <div
                        className="px-2 py-2 flex items-center justify-center"
                        style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                      >
                        {acct.checkoutUrl ? (
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => copyToClipboard(acct.checkoutUrl!, `rurl-${acct.id}`)}
                              className="w-6 h-6 rounded flex items-center justify-center"
                              style={{ color: copied === `rurl-${acct.id}` ? "#4ade80" : "#38bdf8" }}
                              title="Copy checkout link"
                              data-testid={`button-copy-replit-url-${acct.id}`}
                            >
                              {copied === `rurl-${acct.id}` ? <Check className="w-3 h-3" /> : <Link className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => window.open(acct.checkoutUrl!, "_blank")}
                              className="w-6 h-6 rounded flex items-center justify-center"
                              style={{ color: "rgba(148,163,184,0.4)" }}
                              title="Open checkout link"
                              data-testid={`button-open-replit-url-${acct.id}`}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <span className="font-mono text-[9px]" style={{ color: "rgba(255,255,255,0.12)" }}>—</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div
                        className="px-2 py-2 flex items-center justify-end gap-0.5"
                        style={{ borderBottom: cellBorder }}
                      >
                        <button
                          onClick={() => copyToClipboard(
                            `Email 📧: ${acct.email}\n\nPassword 🔑: ${acct.password}\n\nCredits ✈︎: $${acct.credits || "20"} 💰`,
                            `rall-${acct.id}`
                          )}
                          className="w-7 h-7 rounded flex items-center justify-center"
                          style={{ color: copied === `rall-${acct.id}` ? "#4ade80" : "rgba(113,113,122,0.6)" }}
                          title="Copy all"
                          data-testid={`button-copy-replit-all-${acct.id}`}
                        >
                          {copied === `rall-${acct.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await fetch(`/api/replit-accounts/${acct.id}`, { method: "DELETE", credentials: "include" });
                              fetchReplit();
                              toast({ title: "Deleted", description: "Replit account removed" });
                            } catch {}
                          }}
                          className="w-7 h-7 rounded flex items-center justify-center"
                          style={{ color: "rgba(239,68,68,0.3)" }}
                          title="Delete"
                          data-testid={`button-delete-replit-${acct.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Bottom spreadsheet "add row" footer */}
                <div
                  className="grid font-mono text-[9px] select-none"
                  style={{
                    gridTemplateColumns: "30px 36px 1fr 160px 70px 180px 100px 72px",
                    background: "#0b0b18",
                    borderTop: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div
                    className="py-1.5 text-center"
                    style={{ borderRight: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.12)" }}
                  >
                    {replitAccounts.length + 1}
                  </div>
                  <div style={{ borderRight: "1px solid rgba(255,255,255,0.05)" }} />
                  <div className="px-3 py-1.5 col-span-6" style={{ color: "rgba(255,255,255,0.1)" }}>
                    {replitAccounts.length} row{replitAccounts.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Replit Bulk copy toolbar */}
          {replitAccounts.length > 0 && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-violet-500/10 flex-wrap">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Bulk Copy</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={replitBulkCopyCount}
                onChange={(e) => setReplitBulkCopyCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 h-7 rounded-md px-2 text-xs font-mono text-center bg-black/40 border border-violet-500/20 text-violet-300 focus:outline-none focus:border-violet-500/50"
                data-testid="input-replit-bulk-copy-count"
              />
              {/* Status filter toggle */}
              <div className="flex items-center rounded-md overflow-hidden border border-violet-500/20" data-testid="toggle-replit-bulk-status-filter">
                {(["any", "processing", "available", "working", "sold_out"] as const).map((opt, i, arr) => (
                  <button
                    key={opt}
                    onClick={() => setReplitBulkStatusFilter(opt)}
                    className="h-7 px-2.5 text-[10px] font-mono transition-colors"
                    style={{
                      background: replitBulkStatusFilter === opt ? "rgba(139,92,246,0.2)" : "rgba(0,0,0,0.4)",
                      color: replitBulkStatusFilter === opt ? "#c4b5fd" : "rgba(255,255,255,0.3)",
                      borderRight: i < arr.length - 1 ? "1px solid rgba(139,92,246,0.2)" : "none",
                    }}
                    data-testid={`button-replit-filter-${opt}`}
                  >
                    {opt === "any" ? "any" : opt === "processing" ? "processing" : opt === "available" ? "available" : opt === "working" ? "working" : "sold out"}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 font-mono text-xs border border-violet-500/20"
                style={{ color: "#a78bfa" }}
                onClick={() => {
                  const eligible = replitAccounts.filter((a) => {
                    if (replitBulkStatusFilter === "any") return true;
                    return a.status === replitBulkStatusFilter;
                  });
                  const slice = eligible.slice(0, replitBulkCopyCount);
                  if (slice.length === 0) {
                    toast({ title: "No accounts", description: `No ${replitBulkStatusFilter === "any" ? "" : replitBulkStatusFilter + " "}Replit accounts available` });
                    return;
                  }
                  const text = slice.map((a) => `Email 📧: ${a.email}\n\nPassword 🔑: ${a.password || ""}\n\nCredits ✈︎: $${a.credits || "20"} 💰`).join("\n\n---\n\n");
                  navigator.clipboard.writeText(text).then(() => {
                    setReplitBulkCopiedIds(slice.map((a) => String(a.id)));
                    toast({ title: `Copied ${slice.length} accounts`, description: "Email + Password + Credits format" });
                  }).catch(() => {
                    toast({ title: "Clipboard error", description: "Could not write to clipboard — check browser permissions", variant: "destructive" });
                  });
                }}
                data-testid="button-replit-bulk-copy"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy {Math.min(replitBulkCopyCount, replitAccounts.filter((a) => replitBulkStatusFilter === "any" || a.status === replitBulkStatusFilter).length)}
              </Button>
              <span className="text-[10px] font-mono text-zinc-600">
                {replitAccounts.filter((a) => replitBulkStatusFilter === "any" || a.status === replitBulkStatusFilter).length} ready
              </span>
            </div>
          )}

          {/* Post-copy status bar */}
          {replitBulkCopiedIds && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2.5 rounded-lg flex-wrap" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <span className="text-[11px] font-mono text-violet-300 font-semibold">
                {replitBulkCopiedIds.length} copied
              </span>
              <span className="text-[10px] font-mono text-zinc-500">· set status:</span>
              <select
                value={replitBulkStatusTarget}
                onChange={(e) => setReplitBulkStatusTarget(e.target.value)}
                className="h-7 rounded-md px-2 text-xs font-mono bg-black/40 border border-violet-500/20 text-violet-200 focus:outline-none"
                data-testid="select-replit-bulk-status-target"
              >
                <option value="processing">Processing</option>
                <option value="available">Available</option>
                <option value="working">Working</option>
                <option value="sold_out">Sold Out</option>
                <option value="error">Error</option>
              </select>
              <Button
                variant="ghost"
                size="sm"
                disabled={replitBulkApplying}
                className="h-7 px-3 font-mono text-xs border border-violet-500/25"
                style={{ color: "#a78bfa" }}
                onClick={async () => {
                  setReplitBulkApplying(true);
                  try {
                    const res = await fetch("/api/replit-accounts/bulk-status", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ ids: replitBulkCopiedIds.map(Number), status: replitBulkStatusTarget }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed");
                    toast({ title: `Updated ${data.updated ?? replitBulkCopiedIds.length} accounts`, description: `Status set to ${replitBulkStatusTarget.replace("_", " ")}` });
                    setReplitBulkCopiedIds(null);
                    fetchReplit();
                  } catch (err: any) {
                    toast({ title: "Error", description: err.message, variant: "destructive" });
                  } finally {
                    setReplitBulkApplying(false);
                  }
                }}
                data-testid="button-replit-bulk-status-apply"
              >
                {replitBulkApplying ? "Applying..." : "Apply"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-zinc-600 hover:text-zinc-400"
                onClick={() => setReplitBulkCopiedIds(null)}
                data-testid="button-replit-bulk-status-dismiss"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === "lovable" && (
        <Card className="border-pink-500/10 bg-black/20 flex flex-col flex-1 min-h-0 overflow-hidden">
          <CardHeader className="pb-3 shrink-0">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <CardTitle className="text-sm font-mono text-zinc-300 flex items-center gap-2">
                <Mail className="w-4 h-4 text-pink-400" />
                Lovable Accounts
                <Badge variant="outline" className="text-[9px] font-mono border-pink-500/15 text-pink-400/60 ml-2">{lovableAccounts.length} total</Badge>
              </CardTitle>
              <div className="flex items-center gap-1">
                {lovableAccounts.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-zinc-400 hover:text-pink-400 hover:bg-pink-500/10 font-mono text-xs"
                    onClick={() => window.open("/api/lovable-accounts/export-csv", "_blank")}
                    data-testid="button-export-lovable-csv"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    CSV
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-500 hover:text-zinc-300" onClick={fetchLovable} data-testid="button-refresh-lovable">
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Bulk copy toolbar */}
            {lovableAccounts.filter((a) => a.status === "created").length > 0 && (
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-pink-500/10 flex-wrap">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Bulk Copy</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={bulkCopyCount}
                  onChange={(e) => setBulkCopyCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 h-7 rounded-md px-2 text-xs font-mono text-center bg-black/40 border border-pink-500/20 text-pink-300 focus:outline-none focus:border-pink-500/50"
                  data-testid="input-bulk-copy-count"
                />
                {/* Credits filter toggle */}
                <div className="flex items-center rounded-md overflow-hidden border border-pink-500/20" data-testid="toggle-bulk-copy-credits">
                  {(["any", "5", "20"] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setBulkCopyCredits(opt)}
                      className="h-7 px-2.5 text-[10px] font-mono transition-colors"
                      style={{
                        background: bulkCopyCredits === opt ? "rgba(236,72,153,0.2)" : "rgba(0,0,0,0.4)",
                        color: bulkCopyCredits === opt ? "#f9a8d4" : "rgba(255,255,255,0.3)",
                        borderRight: opt !== "20" ? "1px solid rgba(236,72,153,0.2)" : "none",
                      }}
                      data-testid={`button-credits-filter-${opt}`}
                    >
                      {opt === "any" ? "any" : `${opt} cr`}
                    </button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-3 text-pink-400 hover:text-pink-300 hover:bg-pink-500/10 font-mono text-xs border border-pink-500/20"
                  onClick={() => {
                    const eligible = lovableAccounts.filter((a) => {
                      if (a.status !== "created") return false;
                      if (bulkCopyCredits === "5") return (a.credits ?? 5) === 5;
                      if (bulkCopyCredits === "20") return (a.credits ?? 5) >= 20;
                      return true;
                    });
                    const slice = eligible.slice(0, bulkCopyCount);
                    if (slice.length === 0) {
                      toast({ title: "No accounts", description: `No Account Created accounts with ${bulkCopyCredits === "any" ? "any" : bulkCopyCredits} credits available` });
                      return;
                    }
                    const text = slice.map((a) => `Email 📧 : ${a.email}\nPassword 🗝️ : ${a.password || ""}`).join("\n\n");
                    navigator.clipboard.writeText(text).then(() => {
                      setBulkCopiedIds(slice.map((a) => a.id));
                      toast({ title: `Copied ${slice.length} accounts`, description: `${bulkCopyCredits === "any" ? "Any credits" : `${bulkCopyCredits} credits`} · Email + Password format` });
                    }).catch(() => {
                      toast({ title: "Clipboard error", description: "Could not write to clipboard — check browser permissions", variant: "destructive" });
                    });
                  }}
                  data-testid="button-bulk-copy"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy {Math.min(bulkCopyCount, lovableAccounts.filter((a) => {
                    if (a.status !== "created") return false;
                    if (bulkCopyCredits === "5") return (a.credits ?? 5) === 5;
                    if (bulkCopyCredits === "20") return (a.credits ?? 5) >= 20;
                    return true;
                  }).length)}
                </Button>
                <span className="text-[10px] font-mono text-zinc-600">
                  {lovableAccounts.filter((a) => {
                    if (a.status !== "created") return false;
                    if (bulkCopyCredits === "5") return (a.credits ?? 5) === 5;
                    if (bulkCopyCredits === "20") return (a.credits ?? 5) >= 20;
                    return true;
                  }).length} ready
                </span>
              </div>
            )}

            {/* Post-copy status bar */}
            {bulkCopiedIds && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2.5 rounded-lg flex-wrap" style={{ background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.2)" }}>
                <span className="text-[11px] font-mono text-pink-300 font-semibold">
                  {bulkCopiedIds.length} copied
                </span>
                <span className="text-[10px] font-mono text-zinc-500">· set status:</span>
                <select
                  value={bulkStatusTarget}
                  onChange={(e) => setBulkStatusTarget(e.target.value)}
                  className="h-7 rounded-md px-2 text-xs font-mono bg-black/40 border border-pink-500/20 text-pink-200 focus:outline-none"
                  data-testid="select-bulk-status-target"
                >
                  <option value="created">Account Created</option>
                  <option value="pending_verification">Pending Verification</option>
                  <option value="verified">Verified</option>
                  <option value="failed">Failed</option>
                  <option value="sold_out">Sold Out</option>
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={bulkApplying}
                  className="h-7 px-3 text-pink-400 hover:text-pink-300 hover:bg-pink-500/10 font-mono text-xs border border-pink-500/25"
                  onClick={async () => {
                    setBulkApplying(true);
                    try {
                      const res = await fetch("/api/lovable-accounts/bulk-status", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ ids: bulkCopiedIds, status: bulkStatusTarget }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast({ title: `Updated ${data.updated} accounts`, description: `Status set to ${bulkStatusTarget.replace("_", " ")}` });
                      setBulkCopiedIds(null);
                      fetchLovable();
                    } catch (err: any) {
                      toast({ title: "Error", description: err.message, variant: "destructive" });
                    } finally {
                      setBulkApplying(false);
                    }
                  }}
                  data-testid="button-bulk-status-apply"
                >
                  {bulkApplying ? "Applying..." : "Apply"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-zinc-600 hover:text-zinc-400"
                  onClick={() => setBulkCopiedIds(null)}
                  data-testid="button-bulk-status-dismiss"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
            {lovableAccounts.length === 0 ? (
              <div className="text-center py-12">
                <Mail className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-600 text-sm font-mono">No Lovable accounts yet</p>
                <p className="text-zinc-700 text-xs font-mono mt-1">Use the Lovable Create module to create accounts</p>
              </div>
            ) : (
              <div className="overflow-auto flex-1 min-h-0">
                <div style={{ minWidth: "680px" }}>

                  {/* Column-letter row */}
                  <div
                    className="grid sticky top-0 z-20 font-mono text-[9px] font-bold text-center select-none"
                    style={{
                      gridTemplateColumns: "30px 1fr 160px 190px 80px 72px",
                      background: "#0f0f1e",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div className="py-1" style={{ borderRight: "1px solid rgba(255,255,255,0.06)", color: "#2a2a3f" }} />
                    {(["B", "C", "D", "E", "F"] as const).map((letter, i) => (
                      <div
                        key={letter}
                        className="py-1"
                        style={{
                          borderRight: i < 4 ? "1px solid rgba(255,255,255,0.06)" : "none",
                          color: "rgba(255,255,255,0.18)",
                          letterSpacing: "0.15em",
                        }}
                      >
                        {letter}
                      </div>
                    ))}
                  </div>

                  {/* Colored column-header row */}
                  <div
                    className="grid sticky font-mono text-[10px] font-black uppercase tracking-widest z-10"
                    style={{
                      top: "22px",
                      gridTemplateColumns: "30px 1fr 160px 190px 80px 72px",
                      borderBottom: "2px solid rgba(0,0,0,0.4)",
                    }}
                  >
                    <div style={{ background: "#0b0b18", borderRight: "1px solid rgba(255,255,255,0.06)" }} />
                    <div
                      className="px-3 py-2 flex items-center"
                      style={{
                        background: "linear-gradient(90deg, #7f1d1d 0%, #b91c1c 100%)",
                        color: "#fecaca",
                        textShadow: "0 0 10px rgba(239,68,68,0.5)",
                        borderRight: "1px solid rgba(0,0,0,0.35)",
                      }}
                    >
                      E-Mail Address
                    </div>
                    <div
                      className="px-3 py-2"
                      style={{
                        background: "linear-gradient(90deg, #78350f 0%, #b45309 100%)",
                        color: "#fde68a",
                        textShadow: "0 0 10px rgba(245,158,11,0.5)",
                        borderRight: "1px solid rgba(0,0,0,0.35)",
                      }}
                    >
                      Password
                    </div>
                    <div
                      className="px-3 py-2"
                      style={{
                        background: "linear-gradient(90deg, #14532d 0%, #15803d 100%)",
                        color: "#bbf7d0",
                        textShadow: "0 0 10px rgba(34,197,94,0.5)",
                        borderRight: "1px solid rgba(0,0,0,0.35)",
                      }}
                    >
                      Status
                    </div>
                    <div
                      className="px-3 py-2"
                      style={{
                        background: "linear-gradient(90deg, #581c87 0%, #7e22ce 100%)",
                        color: "#e9d5ff",
                        textShadow: "0 0 10px rgba(168,85,247,0.5)",
                        borderRight: "1px solid rgba(0,0,0,0.35)",
                      }}
                    >
                      Credits
                    </div>
                    <div
                      className="px-3 py-2 text-right"
                      style={{ background: "#0b0b18", color: "rgba(255,255,255,0.2)" }}
                    >
                      Actions
                    </div>
                  </div>

                  {/* Data rows */}
                  {lovableAccounts.map((acct, idx) => {
                    const st = acct.status;
                    const statusConfig: Record<string, { label: string; color: string; glow: string; bg: string; border: string }> = {
                      created:              { label: "Account Created", color: "#22c55e", glow: "rgba(34,197,94,0.2)",   bg: "rgba(34,197,94,0.09)",  border: "rgba(34,197,94,0.4)"  },
                      pending_verification: { label: "Pending",         color: "#facc15", glow: "rgba(250,204,21,0.2)",  bg: "rgba(250,204,21,0.08)", border: "rgba(250,204,21,0.4)" },
                      verified:             { label: "Verified",         color: "#22c55e", glow: "rgba(34,197,94,0.2)",   bg: "rgba(34,197,94,0.09)",  border: "rgba(34,197,94,0.4)"  },
                      failed:               { label: "Failed",           color: "#71717a", glow: "rgba(113,113,122,0.15)",bg: "rgba(113,113,122,0.07)",border: "rgba(113,113,122,0.3)"},
                      sold_out:             { label: "Sold Out",         color: "#ef4444", glow: "rgba(239,68,68,0.2)",   bg: "rgba(239,68,68,0.09)",  border: "rgba(239,68,68,0.4)"  },
                    };
                    const cfg = statusConfig[st] ?? statusConfig.pending_verification;
                    const rowBg = idx % 2 === 0 ? "rgba(255,255,255,0.012)" : "rgba(0,0,0,0.18)";
                    const cellBorder = "1px solid rgba(255,255,255,0.05)";
                    return (
                      <div
                        key={acct.id}
                        className="grid transition-colors duration-100"
                        style={{ gridTemplateColumns: "30px 1fr 160px 190px 80px 72px", background: rowBg }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(236,72,153,0.04)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                        data-testid={`row-lovable-${acct.id}`}
                      >
                        {/* Row number */}
                        <div
                          className="flex items-center justify-center font-mono text-[9px] select-none"
                          style={{
                            background: "#0b0b18",
                            borderRight: cellBorder,
                            borderBottom: cellBorder,
                            color: "rgba(255,255,255,0.2)",
                            minHeight: "38px",
                          }}
                        >
                          {idx + 1}
                        </div>

                        {/* Email */}
                        <div
                          className="px-3 py-2 min-w-0"
                          style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                        >
                          <button
                            onClick={() => copyToClipboard(acct.email, `le-${acct.id}`)}
                            className="text-left font-mono text-xs truncate w-full block"
                            style={{ color: copied === `le-${acct.id}` ? "#4ade80" : "#e2e8f0" }}
                            title="Click to copy email"
                            data-testid={`button-copy-lovable-email-${acct.id}`}
                          >
                            {copied === `le-${acct.id}` ? "✓ Copied!" : acct.email}
                          </button>
                        </div>

                        {/* Password */}
                        <div
                          className="px-3 py-2 flex items-center gap-1.5"
                          style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                        >
                          <button
                            onClick={() => copyToClipboard(acct.password || "", `lp-${acct.id}`)}
                            className="text-left font-mono text-xs flex-1 truncate"
                            style={{ color: copied === `lp-${acct.id}` ? "#4ade80" : "#a1a1aa" }}
                            title="Click to copy password"
                            data-testid={`button-copy-lovable-pw-${acct.id}`}
                          >
                            {copied === `lp-${acct.id}`
                              ? "✓ Copied!"
                              : lovableShowPasswords[acct.id]
                                ? (acct.password || "—")
                                : "••••••••"}
                          </button>
                          <button
                            onClick={() => setLovableShowPasswords((p) => ({ ...p, [acct.id]: !p[acct.id] }))}
                            className="flex-shrink-0"
                            style={{ color: "rgba(113,113,122,0.5)" }}
                            data-testid={`button-toggle-lovable-pw-${acct.id}`}
                          >
                            {lovableShowPasswords[acct.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>

                        {/* Status */}
                        <div
                          className="px-2 py-2 flex items-center"
                          style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                        >
                          <select
                            value={st}
                            onChange={async (e) => {
                              await fetch(`/api/lovable-accounts/${acct.id}/status`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                credentials: "include",
                                body: JSON.stringify({ status: e.target.value }),
                              });
                              fetchLovable();
                            }}
                            className="w-full appearance-none rounded px-2 py-1 text-[10px] font-mono font-bold cursor-pointer focus:outline-none"
                            style={{
                              background: cfg.bg,
                              border: `1px solid ${cfg.border}`,
                              color: cfg.color,
                              boxShadow: `0 0 8px ${cfg.glow}`,
                            }}
                            data-testid={`select-lovable-status-${acct.id}`}
                          >
                            <option value="created">Account Created</option>
                            <option value="pending_verification">Pending</option>
                            <option value="verified">Verified</option>
                            <option value="failed">Failed</option>
                            <option value="sold_out">Sold Out</option>
                          </select>
                        </div>

                        {/* Credits */}
                        <div
                          className="px-3 py-2 flex items-center justify-center"
                          style={{ borderRight: cellBorder, borderBottom: cellBorder }}
                        >
                          <span
                            className="font-mono text-xs font-black tabular-nums"
                            style={{
                              color: acct.credits != null && acct.credits >= 20 ? "#a855f7" : "#22c55e",
                              textShadow: acct.credits != null && acct.credits >= 20
                                ? "0 0 12px rgba(168,85,247,0.5)"
                                : "0 0 12px rgba(34,197,94,0.4)",
                            }}
                            data-testid={`text-lovable-credits-${acct.id}`}
                          >
                            {acct.credits ?? 5}
                          </span>
                        </div>

                        {/* Actions */}
                        <div
                          className="px-2 py-2 flex items-center justify-end gap-0.5"
                          style={{ borderBottom: cellBorder }}
                        >
                          {st === "created" && (
                            <button
                              onClick={() => copyToClipboard(`Email: ${acct.email}\nPassword: ${acct.password || ""}`, `lall-${acct.id}`)}
                              className="w-7 h-7 rounded flex items-center justify-center"
                              style={{ color: copied === `lall-${acct.id}` ? "#4ade80" : "rgba(113,113,122,0.6)" }}
                              title="Copy credentials"
                              data-testid={`button-copy-lovable-all-${acct.id}`}
                            >
                              {copied === `lall-${acct.id}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                await fetch(`/api/lovable-accounts/${acct.id}`, { method: "DELETE", credentials: "include" });
                                fetchLovable();
                                toast({ title: "Deleted", description: "Lovable account removed" });
                              } catch {}
                            }}
                            className="w-7 h-7 rounded flex items-center justify-center"
                            style={{ color: "rgba(239,68,68,0.3)" }}
                            title="Delete"
                            data-testid={`button-delete-lovable-${acct.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Footer row */}
                  <div
                    className="grid font-mono text-[9px] select-none"
                    style={{
                      gridTemplateColumns: "30px 1fr 160px 190px 80px 72px",
                      background: "#0b0b18",
                      borderTop: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div
                      className="py-1.5 text-center"
                      style={{ borderRight: "1px solid rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.12)" }}
                    >
                      {lovableAccounts.length + 1}
                    </div>
                    <div className="px-3 py-1.5 col-span-5" style={{ color: "rgba(255,255,255,0.1)" }}>
                      {lovableAccounts.length} row{lovableAccounts.length !== 1 ? "s" : ""}
                    </div>
                  </div>

                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

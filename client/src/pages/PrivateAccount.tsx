import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Copy, Trash2, Mail, Key, Plus, RefreshCw, Check, Eye, EyeOff, Shield, Database, Loader2, X, Zap } from "lucide-react";
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

type TabType = "outlook" | "zenrows";

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
          toast({ title: "ZenRows API Key Generated", description: `API key created using ${data.outlookEmail || "Outlook account"}` });
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

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchOutlook(), fetchZenrows()]).finally(() => setLoading(false));
  }, []);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    sounds.navigate();
    setTimeout(() => setCopied(null), 1500);
  }

  function togglePassword(id: string) {
    setShowPasswords((prev) => ({ ...prev, [id]: !prev[id] }));
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
        toast({ title: "API Key added", description: "ZenRows API key saved successfully" });
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
          logs: ["Starting ZenRows registration with " + acc.email + "..."],
        },
      }));
      toast({ title: "Registration Started", description: `Registering ZenRows with ${acc.email}` });
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

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const activeOutlook = outlookAccounts.filter((a) => a.status === "active").length;
  const activeZenrows = zenrowsKeys.filter((k) => k.status === "active").length;
  const activeJobs = Object.values(zenrowsRegJobs).filter((j) => j.status !== "running" || j.logs.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono text-emerald-50 flex items-center gap-2" data-testid="text-page-title">
            <Shield className="w-5 h-5 text-emerald-400" />
            Private Account
          </h1>
          <p className="text-xs text-zinc-500 font-mono mt-1">Superadmin private account stock management</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/5 font-mono text-xs"
          onClick={() => { fetchOutlook(); fetchZenrows(); sounds.navigate(); }}
          data-testid="button-refresh-private"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="border-emerald-500/10 bg-black/20 cursor-pointer transition-all hover:border-emerald-500/25" onClick={() => { setTab("outlook"); sounds.hover(); }} data-testid="card-outlook-summary">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}>
                <Mail className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Outlook Accounts</p>
                <p className="text-xl font-bold text-emerald-50 font-mono" data-testid="text-outlook-count">{outlookAccounts.length}</p>
              </div>
              <Badge variant="outline" className="ml-auto text-[9px] font-mono border-emerald-500/20 text-emerald-400">
                {activeOutlook} active
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/10 bg-black/20 cursor-pointer transition-all hover:border-emerald-500/25" onClick={() => { setTab("zenrows"); sounds.hover(); }} data-testid="card-zenrows-summary">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,176,0,0.08)", border: "1px solid rgba(255,176,0,0.15)" }}>
                <Key className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">ZenRows API Stock</p>
                <p className="text-xl font-bold text-emerald-50 font-mono" data-testid="text-zenrows-count">{zenrowsKeys.length}</p>
              </div>
              <Badge variant="outline" className="ml-auto text-[9px] font-mono border-emerald-500/20 text-emerald-400">
                {activeZenrows} active
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {activeJobs.length > 0 && (
        <div className="space-y-3">
          {Object.values(zenrowsRegJobs).map((job) => (
            <Card key={job.batchId} className={`border-emerald-500/10 bg-black/20 ${job.status === "success" ? "border-emerald-500/20" : job.status === "failed" ? "border-red-500/20" : "border-purple-500/20"}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {job.status === "running" && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
                    {job.status === "success" && <Check className="w-4 h-4 text-emerald-400" />}
                    {job.status === "failed" && <X className="w-4 h-4 text-red-400" />}
                    <span className="text-xs font-mono text-emerald-50">
                      ZenRows Registration — {job.outlookEmail}
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

      <div className="flex gap-2">
        <Button
          variant={tab === "outlook" ? "default" : "ghost"}
          size="sm"
          className={`font-mono text-xs ${tab === "outlook" ? "bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20" : "text-zinc-500 hover:text-zinc-300"}`}
          onClick={() => { setTab("outlook"); sounds.hover(); }}
          data-testid="tab-outlook"
        >
          <Mail className="w-3.5 h-3.5 mr-1.5" />
          Outlook Accounts
        </Button>
        <Button
          variant={tab === "zenrows" ? "default" : "ghost"}
          size="sm"
          className={`font-mono text-xs ${tab === "zenrows" ? "bg-purple-500/15 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20" : "text-zinc-500 hover:text-zinc-300"}`}
          onClick={() => { setTab("zenrows"); sounds.hover(); }}
          data-testid="tab-zenrows"
        >
          <Key className="w-3.5 h-3.5 mr-1.5" />
          ZenRows API Stock
        </Button>
      </div>

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
                          <span className="text-[10px] text-zinc-600 font-mono">{formatDate(acc.createdAt)}</span>
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
                              {registeringAccountIds.has(acc.id) ? "Registering..." : "ZenRows"}
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
                ZenRows API Key Stock
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
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-3">Add ZenRows API Key</p>
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
                <p className="text-sm text-zinc-500 font-mono">No ZenRows API keys yet</p>
                <p className="text-xs text-zinc-600 font-mono mt-1">Keys are auto-saved when created via ZenRows Register</p>
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
                          <span className="text-[10px] text-zinc-600 font-mono">{formatDate(key.createdAt)}</span>
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
    </div>
  );
}

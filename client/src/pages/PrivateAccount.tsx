import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Copy, Trash2, Mail, Key, Plus, RefreshCw, Check, Eye, EyeOff, Shield, Database, Loader2, X, Zap, Download, Inbox, User, Calendar, Code2 } from "lucide-react";
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

type GmailAccount = {
  id: string;
  email: string;
  password: string;
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

type TabType = "outlook" | "zenrows" | "gmail" | "replit" | "lovable";

type ZenrowsRegJob = {
  regId: string;
  batchId: string;
  outlookEmail: string;
  status: "running" | "success" | "failed";
  logs: string[];
  apiKey?: string;
  error?: string;
};

type GmailCheckJob = {
  checkId: string;
  batchId: string;
  accountId: string;
  email: string;
  status: "running" | "success" | "failed";
  logs: string[];
  error?: string;
};

type GmailLoginJob = {
  loginId: string;
  batchId: string;
  accountId: string;
  email: string;
  status: "running" | "success" | "failed" | "2fa";
  logs: string[];
  error?: string;
  cookieCount?: number;
};

type GmailCreateJob = {
  createId: string;
  batchId: string;
  status: "running" | "success" | "failed";
  logs: string[];
  email?: string;
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
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([]);
  const [addGmailOpen, setAddGmailOpen] = useState(false);
  const [newGmailEmail, setNewGmailEmail] = useState("");
  const [newGmailPassword, setNewGmailPassword] = useState("");
  const [zenrowsRegJobs, setZenrowsRegJobs] = useState<Record<string, ZenrowsRegJob>>({});
  const [registeringAccountIds, setRegisteringAccountIds] = useState<Set<string>>(new Set());
  const [gmailCheckJobs, setGmailCheckJobs] = useState<Record<string, GmailCheckJob>>({});
  const [checkingGmailIds, setCheckingGmailIds] = useState<Set<string>>(new Set());
  const [gmailLoginJobs, setGmailLoginJobs] = useState<Record<string, GmailLoginJob>>({});
  const [loggingInGmailIds, setLoggingInGmailIds] = useState<Set<string>>(new Set());
  const [gmailCreateJobs, setGmailCreateJobs] = useState<Record<string, GmailCreateJob>>({});
  const [creatingGmail, setCreatingGmail] = useState(false);
  const [replitAccounts, setReplitAccounts] = useState<ReplitAccount[]>([]);
  const [replitShowPasswords, setReplitShowPasswords] = useState<Record<string, boolean>>({});
  const [lovableShowPasswords, setLovableShowPasswords] = useState<Record<string, boolean>>({});
  const [lovableAccounts, setLovableAccounts] = useState<LovableAccount[]>([]);
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

      if (data.type === "log" && data.batchId?.startsWith("gmail-check-")) {
        setGmailCheckJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          const newLogs = [...job.logs, data.message].slice(-200);
          return { ...prev, [data.batchId]: { ...job, logs: newLogs } };
        });
      }

      if (data.type === "gmail_check_result") {
        setGmailCheckJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          return {
            ...prev,
            [data.batchId]: {
              ...job,
              status: data.success ? "success" : "failed",
              error: data.error,
            },
          };
        });
        setCheckingGmailIds((prev) => {
          const next = new Set(prev);
          next.delete(data.accountId);
          return next;
        });
        if (data.success) {
          fetchGmail();
          toast({ title: "Gmail Login Verified", description: "Account credentials are valid!" });
          sounds.navigate();
        } else {
          fetchGmail();
          toast({ title: "Gmail Login Failed", description: data.error || "Invalid credentials", variant: "destructive" });
        }
      }

      if (data.type === "batch_complete" && data.batchId?.startsWith("gmail-check-")) {
        setGmailCheckJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          if (job.status === "running") {
            return { ...prev, [data.batchId]: { ...job, status: "failed", error: "Check completed without result" } };
          }
          return prev;
        });
      }

      if (data.type === "log" && data.batchId?.startsWith("gmail-login-")) {
        setGmailLoginJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          const newLogs = [...job.logs, data.message].slice(-200);
          return { ...prev, [data.batchId]: { ...job, logs: newLogs } };
        });
      }

      if (data.type === "gmail_login_result") {
        setGmailLoginJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          const is2fa = data.note?.startsWith("2fa") || data.credentialsValid;
          return {
            ...prev,
            [data.batchId]: {
              ...job,
              status: data.success ? "success" : is2fa ? "2fa" : "failed",
              error: data.error,
              cookieCount: data.cookieCount,
            },
          };
        });
        setLoggingInGmailIds((prev) => {
          const next = new Set(prev);
          next.delete(data.accountId);
          return next;
        });
        if (data.success) {
          fetchGmail();
          toast({ title: "Google Login Successful", description: `Session captured with ${data.cookieCount || 0} cookies` });
          sounds.navigate();
        } else if (data.credentialsValid || data.note?.startsWith("2fa")) {
          fetchGmail();
          toast({ title: "2FA Required", description: "Credentials are valid — 2FA step reached" });
        } else {
          fetchGmail();
          toast({ title: "Google Login Failed", description: data.error || "Login failed", variant: "destructive" });
        }
      }

      if (data.type === "batch_complete" && data.batchId?.startsWith("gmail-login-")) {
        setGmailLoginJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          if (job.status === "running") {
            return { ...prev, [data.batchId]: { ...job, status: "failed", error: "Login completed without result" } };
          }
          return prev;
        });
      }

      if (data.type === "log" && data.batchId?.startsWith("gmail-create-")) {
        setGmailCreateJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          const newLogs = [...job.logs, data.message].slice(-200);
          return { ...prev, [data.batchId]: { ...job, logs: newLogs } };
        });
      }

      if (data.type === "gmail_create_result") {
        setGmailCreateJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          return {
            ...prev,
            [data.batchId]: { ...job, status: data.success ? "success" : "failed", email: data.email, error: data.error },
          };
        });
        setCreatingGmail(false);
        if (data.success) {
          fetchGmail();
          toast({ title: "Gmail Account Created", description: `New account: ${data.email}` });
          sounds.navigate();
        } else {
          toast({ title: "Gmail Creation Failed", description: data.error || "Unknown error", variant: "destructive" });
        }
      }

      if (data.type === "batch_complete" && data.batchId?.startsWith("gmail-create-")) {
        setGmailCreateJobs((prev) => {
          const job = prev[data.batchId];
          if (!job) return prev;
          if (job.status === "running") {
            return { ...prev, [data.batchId]: { ...job, status: "failed", error: "Creation completed without result" } };
          }
          return prev;
        });
        setCreatingGmail(false);
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

  function fetchGmail() {
    fetch("/api/private/gmail", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return []; }
        return r.json();
      })
      .then(setGmailAccounts)
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
    Promise.all([fetchOutlook(), fetchZenrows(), fetchGmail(), fetchReplit(), fetchLovable()]).finally(() => setLoading(false));
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

  async function addGmailAccount() {
    if (!newGmailEmail.trim() || !newGmailPassword.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/private/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newGmailEmail.trim(), password: newGmailPassword.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        toast({ title: "Account added", description: "Gmail account saved successfully" });
        sounds.navigate();
        setNewGmailEmail("");
        setNewGmailPassword("");
        setAddGmailOpen(false);
        fetchGmail();
      }
    } catch {} finally { setSaving(false); }
  }

  async function deleteGmail(id: string) {
    try {
      await fetch(`/api/private/gmail/${id}`, { method: "DELETE", credentials: "include" });
      sounds.navigate();
      fetchGmail();
    } catch {}
  }

  async function checkGmailLogin(acc: GmailAccount) {
    if (checkingGmailIds.has(acc.id)) return;
    setCheckingGmailIds((prev) => new Set(prev).add(acc.id));
    try {
      const res = await fetch(`/api/private/gmail/${acc.id}/check`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        setCheckingGmailIds((prev) => { const n = new Set(prev); n.delete(acc.id); return n; });
        toast({ title: "Check Failed", description: "Could not start Gmail check", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setGmailCheckJobs((prev) => ({
        ...prev,
        [data.batchId]: {
          checkId: data.checkId,
          batchId: data.batchId,
          accountId: acc.id,
          email: acc.email,
          status: "running",
          logs: [],
        },
      }));
      toast({ title: "Gmail Check Started", description: `Checking login for ${acc.email}` });
    } catch (err: any) {
      setCheckingGmailIds((prev) => { const n = new Set(prev); n.delete(acc.id); return n; });
      toast({ title: "Error", description: err.message || "Failed to start check", variant: "destructive" });
    }
  }

  async function loginGmailWeb(acc: GmailAccount) {
    if (loggingInGmailIds.has(acc.id)) return;
    setLoggingInGmailIds((prev) => new Set(prev).add(acc.id));
    try {
      const res = await fetch(`/api/private/gmail/${acc.id}/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        setLoggingInGmailIds((prev) => { const n = new Set(prev); n.delete(acc.id); return n; });
        toast({ title: "Login Failed", description: "Could not start Google login", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setGmailLoginJobs((prev) => ({
        ...prev,
        [data.batchId]: {
          loginId: data.loginId,
          batchId: data.batchId,
          accountId: acc.id,
          email: acc.email,
          status: "running",
          logs: [],
        },
      }));
      toast({ title: "Google Login Started", description: `Logging into ${acc.email} via browser` });
    } catch (err: any) {
      setLoggingInGmailIds((prev) => { const n = new Set(prev); n.delete(acc.id); return n; });
      toast({ title: "Error", description: err.message || "Failed to start login", variant: "destructive" });
    }
  }

  async function createGmailWebAccount() {
    if (creatingGmail) return;
    setCreatingGmail(true);
    try {
      const res = await fetch("/api/private/gmail/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        setCreatingGmail(false);
        toast({ title: "Creation Failed", description: "Could not start Gmail creation", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setGmailCreateJobs((prev) => ({
        ...prev,
        [data.batchId]: {
          createId: data.createId,
          batchId: data.batchId,
          status: "running",
          logs: [],
        },
      }));
      toast({ title: "Gmail Creation Started", description: "Automating Google signup..." });
    } catch (err: any) {
      setCreatingGmail(false);
      toast({ title: "Error", description: err.message || "Failed to start creation", variant: "destructive" });
    }
  }

  function exportGmailCsv() {
    const rows = ["email,password", ...gmailAccounts.map((a) => `${a.email},${a.password}`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gmail_accounts.csv";
    a.click();
    URL.revokeObjectURL(url);
    sounds.navigate();
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
      id: "gmail" as TabType,
      label: "Gmail Accounts",
      count: gmailAccounts.length,
      sub: `${gmailAccounts.filter((a) => a.status === "active").length} active`,
      color: "#ef4444",
      glow: "rgba(239,68,68,0.18)",
      border: "rgba(239,68,68,0.25)",
      textColor: "text-red-400",
      icon: <Mail className="w-4 h-4" />,
      testId: "card-gmail-summary",
    },
    {
      id: "replit" as TabType,
      label: "Replit Accounts",
      count: replitAccounts.length,
      sub: `${replitAccounts.filter((a) => a.status === "created").length} ready`,
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
    <div className="space-y-5">
      {/* ── HEADER BANNER ── */}
      <div className="relative rounded-xl overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.95) 0%, rgba(10,10,20,0.98) 100%)", border: "1px solid rgba(0,255,65,0.12)", boxShadow: "0 0 40px rgba(0,255,65,0.04) inset" }}>
        {/* scan-line overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,65,0.015) 3px, rgba(0,255,65,0.015) 4px)" }} />
        {/* left glow */}
        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: "linear-gradient(180deg, #00ff41 0%, #00bfff 50%, #ec4899 100%)" }} />
        <div className="pl-6 pr-5 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,255,65,0.06)", border: "1px solid rgba(0,255,65,0.2)", boxShadow: "0 0 20px rgba(0,255,65,0.15)" }}>
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: "0 0 6px #00ff41" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black font-mono tracking-tight" style={{ background: "linear-gradient(90deg, #00ff41 0%, #00bfff 60%, #ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }} data-testid="text-page-title">
                  PRIVATE ACCOUNT
                </h1>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border" style={{ color: "#00ff41", borderColor: "rgba(0,255,65,0.3)", background: "rgba(0,255,65,0.06)" }}>SUPERADMIN</span>
              </div>
              <p className="text-[10px] font-mono mt-0.5" style={{ color: "rgba(0,255,65,0.45)" }}>&#9632; secure account stock management system &#9632; {outlookAccounts.length + gmailAccounts.length + replitAccounts.length + lovableAccounts.length} total assets</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs border gap-1.5"
            style={{ color: "rgba(0,255,65,0.7)", borderColor: "rgba(0,255,65,0.15)", background: "rgba(0,255,65,0.04)" }}
            onClick={() => { fetchOutlook(); fetchZenrows(); fetchGmail(); fetchReplit(); sounds.navigate(); }}
            data-testid="button-refresh-private"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-5 gap-3">
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
                {s.count.toString().padStart(3, "0")}
              </p>
            </div>
          </div>
        ))}
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

      {/* ── TAB BAR ── */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.05)" }}>
        {statCards.map((s) => (
          <button
            key={s.id}
            onClick={() => { setTab(s.id); sounds.hover(); }}
            data-testid={`tab-${s.id}`}
            className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] font-medium transition-all duration-200 flex-1 justify-center"
            style={{
              background: tab === s.id ? s.glow : "transparent",
              color: tab === s.id ? s.color : "rgba(255,255,255,0.3)",
              border: tab === s.id ? `1px solid ${s.border}` : "1px solid transparent",
              boxShadow: tab === s.id ? `0 0 12px ${s.glow}` : "none",
            }}
          >
            <span style={{ color: tab === s.id ? s.color : "rgba(255,255,255,0.3)" }}>{s.icon}</span>
            {s.label}
            {tab === s.id && <span className="w-1.5 h-1.5 rounded-full animate-pulse ml-0.5" style={{ background: s.color, boxShadow: `0 0 4px ${s.color}` }} />}
          </button>
        ))}
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

      {tab === "gmail" && (
        <Card className="border-emerald-500/10 bg-black/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono text-emerald-50 flex items-center gap-2">
                <Mail className="w-4 h-4 text-red-400" />
                Gmail Accounts
                <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/15 text-emerald-400/60 ml-2">{gmailAccounts.length} total</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                {gmailAccounts.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 font-mono text-xs"
                    onClick={exportGmailCsv}
                    data-testid="button-export-gmail-csv"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" />
                    Export CSV
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 font-mono text-xs"
                  onClick={createGmailWebAccount}
                  disabled={creatingGmail}
                  data-testid="button-create-gmail"
                >
                  {creatingGmail ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                  {creatingGmail ? "Creating..." : "Create Gmail"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 font-mono text-xs"
                  onClick={() => { setAddGmailOpen(!addGmailOpen); sounds.navigate(); }}
                  data-testid="button-add-gmail"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Add Manual
                </Button>
              </div>
            </div>
          </CardHeader>

          {addGmailOpen && (
            <div className="mx-6 mb-4 p-4 rounded-lg border border-red-500/10" style={{ background: "rgba(234,67,53,0.02)" }}>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-3">Add Gmail Account</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Input
                  placeholder="email@gmail.com"
                  value={newGmailEmail}
                  onChange={(e) => setNewGmailEmail(e.target.value)}
                  className="h-8 text-xs bg-black/30 border-red-500/10 text-emerald-50 font-mono"
                  data-testid="input-gmail-email"
                />
                <Input
                  placeholder="Password"
                  value={newGmailPassword}
                  onChange={(e) => setNewGmailPassword(e.target.value)}
                  className="h-8 text-xs bg-black/30 border-red-500/10 text-emerald-50 font-mono"
                  data-testid="input-gmail-password"
                />
              </div>
              <Button size="sm" className="bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 font-mono text-xs" onClick={addGmailAccount} disabled={saving} data-testid="button-save-gmail">
                {saving ? "Saving..." : "Save Account"}
              </Button>
            </div>
          )}

          <CardContent className="pt-0">
            {gmailAccounts.length === 0 ? (
              <div className="text-center py-12">
                <Mail className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-sm text-zinc-500 font-mono">No Gmail accounts yet</p>
                <p className="text-xs text-zinc-600 font-mono mt-1">Add accounts manually using the button above</p>
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
                    {gmailAccounts.map((acc) => (
                      <TableRow key={acc.id} className="border-emerald-500/5 hover:bg-emerald-500/[0.02]" data-testid={`row-gmail-${acc.id}`}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-emerald-50" data-testid={`text-gmail-email-${acc.id}`}>{acc.email}</span>
                            <button onClick={() => copyToClipboard(acc.email, `ge-${acc.id}`)} className="text-zinc-600 hover:text-emerald-400 transition-colors" data-testid={`button-copy-gmail-email-${acc.id}`}>
                              {copied === `ge-${acc.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-zinc-400" data-testid={`text-gmail-password-${acc.id}`}>
                              {showPasswords[`gm-${acc.id}`] ? acc.password : "••••••••"}
                            </span>
                            <button onClick={() => togglePassword(`gm-${acc.id}`)} className="text-zinc-600 hover:text-red-400 transition-colors" data-testid={`button-toggle-gmail-password-${acc.id}`}>
                              {showPasswords[`gm-${acc.id}`] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                            <button onClick={() => copyToClipboard(acc.password, `gp-${acc.id}`)} className="text-zinc-600 hover:text-red-400 transition-colors" data-testid={`button-copy-gmail-password-${acc.id}`}>
                              {copied === `gp-${acc.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          {checkingGmailIds.has(acc.id) ? (
                            <Badge variant="outline" className="text-[9px] font-mono border-yellow-500/20 text-yellow-400" data-testid={`badge-gmail-status-${acc.id}`}>
                              <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin inline" />CHECKING
                            </Badge>
                          ) : acc.status === "verified" ? (
                            <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/25 text-emerald-400" data-testid={`badge-gmail-status-${acc.id}`}>
                              ✅ VERIFIED
                            </Badge>
                          ) : acc.status === "failed" ? (
                            <Badge variant="outline" className="text-[9px] font-mono border-red-500/25 text-red-400" data-testid={`badge-gmail-status-${acc.id}`}>
                              ❌ FAILED
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] font-mono border-zinc-500/20 text-zinc-400" data-testid={`badge-gmail-status-${acc.id}`}>
                              {acc.status.toUpperCase()}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[10px] text-zinc-600 font-mono">{formatDate(acc.createdAt)}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-emerald-400/50 hover:text-emerald-400 hover:bg-emerald-500/10 font-mono text-[10px]"
                              onClick={() => checkGmailLogin(acc)}
                              disabled={checkingGmailIds.has(acc.id) || loggingInGmailIds.has(acc.id)}
                              data-testid={`button-check-gmail-${acc.id}`}
                              title="IMAP credential check"
                            >
                              {checkingGmailIds.has(acc.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-blue-400/50 hover:text-blue-400 hover:bg-blue-500/10 font-mono text-[10px]"
                              onClick={() => loginGmailWeb(acc)}
                              disabled={loggingInGmailIds.has(acc.id) || checkingGmailIds.has(acc.id)}
                              data-testid={`button-login-gmail-${acc.id}`}
                              title="Google web login (Playwright)"
                            >
                              {loggingInGmailIds.has(acc.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10" onClick={() => deleteGmail(acc.id)} data-testid={`button-delete-gmail-${acc.id}`}>
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

            {Object.values(gmailCheckJobs).length > 0 && (
              <div className="mt-4 space-y-3">
                {Object.values(gmailCheckJobs).map((job) => {
                  const emailLines = job.logs.filter(l => l.startsWith("📧 FROM:"));
                  const otherLines = job.logs.filter(l => !l.startsWith("📧 FROM:"));
                  const parseEmail = (line: string) => {
                    const fromMatch = line.match(/FROM:(.+?)\|\|SUBJECT:(.+?)\|\|DATE:(.+)/);
                    if (!fromMatch) return null;
                    return { from: fromMatch[1].trim(), subject: fromMatch[2].trim(), date: fromMatch[3].trim() };
                  };
                  return (
                    <div key={job.batchId} className={`rounded-lg border p-3 ${job.status === "success" ? "border-emerald-500/20 bg-emerald-500/5" : job.status === "failed" ? "border-red-500/20 bg-red-500/5" : "border-yellow-500/15 bg-yellow-500/5"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {job.status === "running" && <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />}
                          {job.status === "success" && <Check className="w-3 h-3 text-emerald-400" />}
                          {job.status === "failed" && <X className="w-3 h-3 text-red-400" />}
                          <span className="text-[10px] font-mono text-zinc-300">{job.email}</span>
                          <Badge variant="outline" className={`text-[9px] font-mono ${job.status === "success" ? "border-emerald-500/20 text-emerald-400" : job.status === "failed" ? "border-red-500/20 text-red-400" : "border-yellow-500/20 text-yellow-400"}`}>
                            {job.status === "running" ? "CHECKING" : job.status.toUpperCase()}
                          </Badge>
                          {emailLines.length > 0 && (
                            <Badge variant="outline" className="text-[9px] font-mono border-blue-500/20 text-blue-400">
                              <Inbox className="w-2.5 h-2.5 mr-1" />{emailLines.length} email{emailLines.length !== 1 ? "s" : ""}
                            </Badge>
                          )}
                        </div>
                        <button onClick={() => setGmailCheckJobs((prev) => { const n = { ...prev }; delete n[job.batchId]; return n; })} className="text-zinc-600 hover:text-zinc-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="bg-black/40 rounded p-2 max-h-28 overflow-y-auto font-mono text-[10px] text-zinc-400 space-y-0.5 mb-2">
                        {otherLines.map((line, i) => (
                          <div key={i} className={
                            line.startsWith("✅") ? "text-emerald-400" :
                            line.startsWith("❌") ? "text-red-400" :
                            line.startsWith("⚠️") ? "text-yellow-400" :
                            line.startsWith("📬") || line.startsWith("📭") ? "text-blue-400" :
                            "text-zinc-400"
                          }>{line}</div>
                        ))}
                        {otherLines.length === 0 && job.logs.length === 0 && <div className="text-zinc-600">Waiting for logs...</div>}
                      </div>

                      {emailLines.length > 0 && (
                        <div className="space-y-1.5 max-h-64 overflow-y-auto">
                          <p className="text-[9px] font-mono text-blue-400/60 uppercase tracking-wider flex items-center gap-1 mb-1">
                            <Inbox className="w-3 h-3" /> Inbox — Real-time
                          </p>
                          {emailLines.map((line, i) => {
                            const parsed = parseEmail(line);
                            if (!parsed) return null;
                            return (
                              <div key={i} className="flex items-start gap-2 rounded-md border border-blue-500/10 bg-blue-500/5 px-2.5 py-2" data-testid={`email-card-${job.batchId}-${i}`}>
                                <div className="mt-0.5 shrink-0">
                                  <div className="w-5 h-5 rounded-full bg-blue-500/15 flex items-center justify-center">
                                    <Mail className="w-2.5 h-2.5 text-blue-400" />
                                  </div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] font-semibold text-zinc-200 truncate max-w-[200px]">{parsed.subject}</span>
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5">
                                    <span className="flex items-center gap-1 text-[9px] text-zinc-400 truncate max-w-[180px]">
                                      <User className="w-2.5 h-2.5 shrink-0 text-zinc-500" />{parsed.from}
                                    </span>
                                    <span className="flex items-center gap-1 text-[9px] text-zinc-500 shrink-0">
                                      <Calendar className="w-2.5 h-2.5" />{parsed.date}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {Object.values(gmailLoginJobs).length > 0 && (
              <div className="mt-4 space-y-3">
                {Object.values(gmailLoginJobs).map((job) => {
                  const borderClass =
                    job.status === "success" ? "border-emerald-500/20 bg-emerald-500/5" :
                    job.status === "2fa" ? "border-yellow-500/20 bg-yellow-500/5" :
                    job.status === "failed" ? "border-red-500/20 bg-red-500/5" :
                    "border-blue-500/15 bg-blue-500/5";
                  return (
                    <div key={job.batchId} className={`rounded-lg border p-3 ${borderClass}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {job.status === "running" && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
                          {job.status === "success" && <Check className="w-3 h-3 text-emerald-400" />}
                          {job.status === "2fa" && <Shield className="w-3 h-3 text-yellow-400" />}
                          {job.status === "failed" && <X className="w-3 h-3 text-red-400" />}
                          <Mail className="w-3 h-3 text-blue-400/60" />
                          <span className="text-[10px] font-mono text-zinc-300">{job.email}</span>
                          <Badge variant="outline" className={`text-[9px] font-mono ${
                            job.status === "success" ? "border-emerald-500/20 text-emerald-400" :
                            job.status === "2fa" ? "border-yellow-500/20 text-yellow-400" :
                            job.status === "failed" ? "border-red-500/20 text-red-400" :
                            "border-blue-500/20 text-blue-400"
                          }`}>
                            {job.status === "running" ? "LOGGING IN" : job.status === "2fa" ? "2FA REQUIRED" : job.status.toUpperCase()}
                          </Badge>
                          {job.cookieCount != null && job.cookieCount > 0 && (
                            <Badge variant="outline" className="text-[9px] font-mono border-emerald-500/20 text-emerald-400">
                              {job.cookieCount} cookies
                            </Badge>
                          )}
                        </div>
                        <button onClick={() => setGmailLoginJobs((prev) => { const n = { ...prev }; delete n[job.batchId]; return n; })} className="text-zinc-600 hover:text-zinc-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      {job.error && job.status !== "running" && (
                        <p className="text-[9px] font-mono text-yellow-400/80 mb-2 px-1">{job.error}</p>
                      )}
                      <div className="bg-black/40 rounded p-2 max-h-40 overflow-y-auto font-mono text-[10px] text-zinc-400 space-y-0.5">
                        {job.logs.map((line, i) => (
                          <div key={i} className={
                            line.startsWith("✅") ? "text-emerald-400" :
                            line.startsWith("❌") ? "text-red-400" :
                            line.startsWith("⚠️") ? "text-yellow-400" :
                            line.startsWith("Opening") || line.startsWith("Launching") || line.startsWith("Page loaded") || line.startsWith("After") || line.startsWith("Final") ? "text-blue-400/70" :
                            "text-zinc-400"
                          }>{line}</div>
                        ))}
                        {job.logs.length === 0 && <div className="text-zinc-600">Waiting for logs...</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {Object.values(gmailCreateJobs).length > 0 && (
              <div className="mt-4 space-y-3">
                {Object.values(gmailCreateJobs).map((job) => {
                  const borderClass =
                    job.status === "success" ? "border-emerald-500/20 bg-emerald-500/5" :
                    job.status === "failed" ? "border-red-500/20 bg-red-500/5" :
                    "border-purple-500/15 bg-purple-500/5";
                  return (
                    <div key={job.batchId} className={`rounded-lg border p-3 ${borderClass}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {job.status === "running" && <Loader2 className="w-3 h-3 text-purple-400 animate-spin" />}
                          {job.status === "success" && <Check className="w-3 h-3 text-emerald-400" />}
                          {job.status === "failed" && <X className="w-3 h-3 text-red-400" />}
                          <Plus className="w-3 h-3 text-purple-400/60" />
                          <span className="text-[10px] font-mono text-zinc-300">
                            {job.status === "success" && job.email ? job.email : "Gmail Auto-Create"}
                          </span>
                          <Badge variant="outline" className={`text-[9px] font-mono ${
                            job.status === "success" ? "border-emerald-500/20 text-emerald-400" :
                            job.status === "failed" ? "border-red-500/20 text-red-400" :
                            "border-purple-500/20 text-purple-400"
                          }`}>
                            {job.status === "running" ? "CREATING" : job.status.toUpperCase()}
                          </Badge>
                        </div>
                        <button onClick={() => setGmailCreateJobs((prev) => { const n = { ...prev }; delete n[job.batchId]; return n; })} className="text-zinc-600 hover:text-zinc-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      {job.error && job.status !== "running" && (
                        <p className="text-[9px] font-mono text-red-400/80 mb-2 px-1">{job.error}</p>
                      )}
                      {job.status === "success" && job.email && (
                        <div className="flex items-center gap-2 mb-2 px-1 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/15">
                          <Mail className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span className="text-[10px] font-mono text-emerald-300 font-semibold">{job.email}</span>
                        </div>
                      )}
                      <div className="bg-black/40 rounded p-2 max-h-40 overflow-y-auto font-mono text-[10px] text-zinc-400 space-y-0.5">
                        {job.logs.map((line, i) => (
                          <div key={i} className={
                            line.startsWith("✅") ? "text-emerald-400" :
                            line.startsWith("❌") ? "text-red-400" :
                            line.startsWith("⚠️") ? "text-yellow-400" :
                            line.startsWith("📱") ? "text-blue-400" :
                            line.startsWith("Creating") || line.startsWith("Launching") || line.startsWith("Opening") || line.startsWith("Final") ? "text-purple-400/70" :
                            "text-zinc-400"
                          }>{line}</div>
                        ))}
                        {job.logs.length === 0 && <div className="text-zinc-600">Waiting for logs...</div>}
                      </div>
                    </div>
                  );
                })}
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

      {tab === "replit" && (
        <Card className="border-violet-500/10 bg-black/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-mono text-emerald-50 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-violet-400" />
                Replit Accounts
                <Badge variant="outline" className="text-[9px] font-mono border-violet-500/15 text-violet-400/60 ml-2">{replitAccounts.length} total</Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-500 hover:text-zinc-300" onClick={fetchReplit} data-testid="button-refresh-replit">
                <RefreshCw className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {replitAccounts.length === 0 ? (
              <div className="text-center py-12">
                <Code2 className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-sm text-zinc-500 font-mono">No Replit accounts yet</p>
                <p className="text-xs text-zinc-600 font-mono mt-1">Create accounts in the Replit Create module</p>
              </div>
            ) : (
              <div className="rounded-lg border border-violet-500/8 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-violet-500/8 hover:bg-transparent">
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Username</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Email</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Password</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Via Outlook</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8">Created</TableHead>
                      <TableHead className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider h-8 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {replitAccounts.map((acct) => (
                      <TableRow key={acct.id} className="border-violet-500/5 hover:bg-violet-500/[0.02]" data-testid={`row-replit-private-${acct.id}`}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <Code2 className="w-3 h-3 text-violet-400/50 flex-shrink-0" />
                            <span className="text-xs font-mono text-violet-300 font-bold">@{acct.username}</span>
                          </div>
                          <Badge variant="outline" className={`text-[9px] font-mono mt-1 ${acct.status === "created" ? "border-emerald-500/20 text-emerald-400" : "border-red-500/20 text-red-400"}`}>
                            {acct.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono text-zinc-300 truncate max-w-[150px]" data-testid={`text-replit-email-${acct.id}`}>{acct.email}</span>
                            <button onClick={() => copyToClipboard(acct.email, `re-${acct.id}`)} className="text-zinc-600 hover:text-violet-400 transition-colors flex-shrink-0" data-testid={`button-copy-replit-email-${acct.id}`}>
                              {copied === `re-${acct.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono text-zinc-400" data-testid={`text-replit-pw-${acct.id}`}>
                              {replitShowPasswords[acct.id] ? acct.password : acct.password.substring(0, 4) + "••••••••"}
                            </span>
                            <button onClick={() => setReplitShowPasswords((p) => ({ ...p, [acct.id]: !p[acct.id] }))} className="text-zinc-600 hover:text-violet-400 transition-colors" data-testid={`button-toggle-replit-pw-${acct.id}`}>
                              {replitShowPasswords[acct.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                            <button onClick={() => copyToClipboard(acct.password, `rp-${acct.id}`)} className="text-zinc-600 hover:text-violet-400 transition-colors" data-testid={`button-copy-replit-pw-${acct.id}`}>
                              {copied === `rp-${acct.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[120px] block">{acct.outlookEmail || "—"}</span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[10px] text-zinc-600 font-mono">{formatDate(acct.createdAt)}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-zinc-500 hover:text-violet-400 hover:bg-violet-500/10"
                              onClick={() => copyToClipboard(`Username: ${acct.username}\nEmail: ${acct.email}\nPassword: ${acct.password}`, `rall-${acct.id}`)}
                              title="Copy all credentials"
                              data-testid={`button-copy-replit-all-${acct.id}`}
                            >
                              {copied === `rall-${acct.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10"
                              onClick={async () => {
                                try {
                                  await fetch(`/api/replit-accounts/${acct.id}`, { method: "DELETE", credentials: "include" });
                                  fetchReplit();
                                  toast({ title: "Deleted", description: "Replit account removed" });
                                } catch {}
                              }}
                              data-testid={`button-delete-replit-${acct.id}`}
                            >
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

      {tab === "lovable" && (
        <Card className="border-pink-500/10 bg-black/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-mono text-zinc-300 flex items-center gap-2">
              <Mail className="w-4 h-4 text-pink-400" />
              Lovable Accounts
              <Badge variant="outline" className="text-[9px] font-mono border-pink-500/15 text-pink-400/60 ml-2">{lovableAccounts.length} total</Badge>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-zinc-500 hover:text-zinc-300 ml-auto" onClick={fetchLovable} data-testid="button-refresh-lovable">
                <RefreshCw className="w-3 h-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {lovableAccounts.length === 0 ? (
              <div className="text-center py-12">
                <Mail className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-600 text-sm font-mono">No Lovable accounts yet</p>
                <p className="text-zinc-700 text-xs font-mono mt-1">Use the Create Server module to create accounts</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-pink-500/10">
                      <TableHead className="text-[10px] font-mono text-zinc-500 uppercase">Email</TableHead>
                      <TableHead className="text-[10px] font-mono text-zinc-500 uppercase">Password</TableHead>
                      <TableHead className="text-[10px] font-mono text-zinc-500 uppercase">Outlook Source</TableHead>
                      <TableHead className="text-[10px] font-mono text-zinc-500 uppercase">Status</TableHead>
                      <TableHead className="text-[10px] font-mono text-zinc-500 uppercase">Created</TableHead>
                      <TableHead className="text-right text-[10px] font-mono text-zinc-500 uppercase">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lovableAccounts.map((acct) => (
                      <TableRow key={acct.id} className="border-pink-500/5 hover:bg-pink-500/[0.02]" data-testid={`row-lovable-${acct.id}`}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2">
                            <Mail className="w-3 h-3 text-pink-400/50 flex-shrink-0" />
                            <span className="text-xs font-mono text-zinc-200">{acct.email}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-zinc-600 hover:text-pink-400"
                              onClick={() => copyToClipboard(acct.email, `lem-${acct.id}`)}
                              data-testid={`button-copy-lovable-email-${acct.id}`}
                            >
                              {copied === `lem-${acct.id}` ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-mono text-zinc-400" data-testid={`text-lovable-pw-${acct.id}`}>
                              {lovableShowPasswords[acct.id] ? (acct.password || "—") : "••••••••"}
                            </span>
                            <button
                              onClick={() => setLovableShowPasswords((p) => ({ ...p, [acct.id]: !p[acct.id] }))}
                              className="text-zinc-600 hover:text-pink-400 transition-colors"
                              data-testid={`button-toggle-lovable-pw-${acct.id}`}
                            >
                              {lovableShowPasswords[acct.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                            {acct.password && (
                              <button
                                onClick={() => copyToClipboard(acct.password!, `lpw-${acct.id}`)}
                                className="text-zinc-600 hover:text-pink-400 transition-colors"
                                data-testid={`button-copy-lovable-pw-${acct.id}`}
                              >
                                {copied === `lpw-${acct.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[140px] block">{acct.outlookEmail || "—"}</span>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-mono ${acct.status === "created" ? "border-emerald-500/30 text-emerald-400" : "border-zinc-700 text-zinc-500"}`}
                          >
                            {acct.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <span className="text-[10px] text-zinc-600 font-mono">{new Date(acct.createdAt).toLocaleDateString()}</span>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-zinc-500 hover:text-pink-400 hover:bg-pink-500/10"
                              onClick={() => copyToClipboard(`${acct.email}\n${acct.password || ""}`, `lall-${acct.id}`)}
                              title="Copy email + password"
                              data-testid={`button-copy-lovable-all-${acct.id}`}
                            >
                              {copied === `lall-${acct.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-red-400/50 hover:text-red-400 hover:bg-red-500/10"
                              onClick={async () => {
                                try {
                                  await fetch(`/api/lovable-accounts/${acct.id}`, { method: "DELETE", credentials: "include" });
                                  fetchLovable();
                                  toast({ title: "Deleted", description: "Lovable account removed" });
                                } catch {}
                              }}
                              data-testid={`button-delete-lovable-${acct.id}`}
                            >
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
    </div>
  );
}

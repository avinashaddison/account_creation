import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus, Copy, Trash2, Mail, Inbox, RefreshCw,
  CheckCircle2, Clock, Search, Eye, Users, Zap,
  AtSign, Shield, AlertTriangle, FileText, Server, X,
} from "lucide-react";
import { handleUnauthorized } from "@/lib/auth";
import { subscribe } from "@/lib/ws";
import { sounds } from "@/lib/sounds";

/* ─── Color tokens ──────────────────────────────────────────── */
const G = "#00ff41";
const R = "#ff1a1a";
const GA = (a: number) => `rgba(0,255,65,${a})`;
const RA = (a: number) => `rgba(255,26,26,${a})`;
const PA = (a: number) => `rgba(168,85,247,${a})`;
const EA = (a: number) => `rgba(16,185,129,${a})`; // emerald for smtp.dev
const E = "#10b981";
const BG0 = "#07050a";
const BG1 = "#080510";
const BG2 = "#0a0614";

/* ─── Types ─────────────────────────────────────────────────── */
type TempEmailItem = {
  id: string; address: string; label: string | null;
  createdAt: string; source: "temp";
};
type AccountEmailItem = {
  id: string; address: string; firstName: string;
  lastName: string; status: string; createdAt: string; source: "account";
};
type SmtpDevItem = {
  id: string; address: string; username: string;
  domainId: string; domainName: string; password?: string;
  createdAt: string; source: "smtpdev";
};
type EmailItem = TempEmailItem | AccountEmailItem | SmtpDevItem;
type InboxMessage = { id: string; from: string; subject: string; text: string; createdAt: string; };
type TabType = "all" | "temp" | "account" | "smtpdev";

type SmtpDevDomain = { id: string; name: string; isActive: boolean; };

/* ─── Helpers ───────────────────────────────────────────────── */
function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/* ─── Sub-components ────────────────────────────────────────── */
function Blink({ color = G }: { color?: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setInterval(() => setOn(v => !v), 600); return () => clearInterval(t); }, []);
  return <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: color, opacity: on ? 1 : 0, boxShadow: `0 0 6px ${color}`, transition: "opacity 0.1s", verticalAlign: "middle" }} />;
}

function ScanBar() {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${GA(0.4)},transparent)`, animation: "scanbeam 5s linear infinite", pointerEvents: "none", zIndex: 10 }} />
  );
}

function Toast({ toast }: { toast: { msg: string; kind: "ok" | "err" } | null }) {
  if (!toast) return null;
  return (
    <div style={{
      position: "fixed", top: 16, right: 16, zIndex: 9999,
      padding: "10px 18px", borderRadius: 6, fontSize: 11, fontFamily: "monospace", fontWeight: 700,
      background: toast.kind === "ok" ? "#040d06" : "#0d0404",
      border: `1px solid ${toast.kind === "ok" ? GA(0.5) : RA(0.5)}`,
      color: toast.kind === "ok" ? G : R,
      boxShadow: `0 4px 24px ${toast.kind === "ok" ? GA(0.3) : RA(0.3)}`,
      animation: "fadeIn 0.2s ease",
    }}>
      {toast.kind === "ok" ? "✓" : "✗"} {toast.msg}
    </div>
  );
}

function OtpChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(code); setCopied(true); sounds.click(); setTimeout(() => setCopied(false), 1800); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 10px", borderRadius: 4, cursor: "pointer",
        fontFamily: "monospace", fontWeight: 800, fontSize: 11, letterSpacing: "0.12em",
        background: GA(0.12), border: `1px solid ${GA(0.5)}`,
        color: G, textShadow: `0 0 8px ${GA(0.8)}`,
        boxShadow: `0 0 14px ${GA(0.2)}`,
      }}>
      <Shield style={{ width: 11, height: 11 }} />
      {copied ? "COPIED!" : `OTP: ${code}`}
    </button>
  );
}

function extractOtp(text: string): string | null {
  const patterns = [
    /(?:verification|confirm(?:ation)?|code|otp|pin|passcode)[^\d]{0,30}(\d{4,8})/i,
    /(?:your|the)\s+(?:code|pin|otp)[^\d]{0,20}(\d{4,8})/i,
    /\b(\d{6})\b/, /\b(\d{8})\b/, /\b(\d{4})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

/* ─── Create smtp.dev account modal ────────────────────────── */
function CreateSmtpDevModal({
  domains,
  onClose,
  onCreate,
}: {
  domains: SmtpDevDomain[];
  onClose: () => void;
  onCreate: (address: string) => Promise<void>;
}) {
  const [selectedDomain, setSelectedDomain] = useState(domains[0]?.name ?? "");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const fullAddress = username.trim() && selectedDomain ? `${username.trim().toLowerCase()}@${selectedDomain}` : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullAddress) { setErr("Fill in username and select a domain"); return; }
    setSubmitting(true); setErr("");
    try {
      await onCreate(fullAddress);
      onClose();
    } catch (ex: any) {
      setErr(ex.message || "Failed to create account");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(7,5,10,0.85)", backdropFilter: "blur(4px)",
    }} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} style={{
        background: "#0d0b18", border: `1px solid ${EA(0.3)}`, borderRadius: 10,
        padding: "28px 32px", width: 360, display: "flex", flexDirection: "column", gap: 16,
        boxShadow: `0 0 40px ${EA(0.1)}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: E, letterSpacing: "0.15em", fontFamily: "monospace" }}>
              CREATE smtp.dev ACCOUNT
            </div>
            <div style={{ fontSize: 9, color: EA(0.4), letterSpacing: "0.1em", fontFamily: "monospace", marginTop: 2 }}>
              New inbox on your smtp.dev domain
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: EA(0.4), padding: 4 }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {domains.length === 0 && (
          <div style={{ fontSize: 10, color: RA(0.7), fontFamily: "monospace", padding: "8px 10px", background: RA(0.06), borderRadius: 5, border: `1px solid ${RA(0.2)}` }}>
            No domains found — check your smtp.dev dashboard at smtp.dev
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 9, color: EA(0.5), letterSpacing: "0.12em", fontFamily: "monospace" }}>EMAIL ADDRESS</label>
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value.replace(/[@\s]/g, ""))}
              placeholder="username" data-testid="input-smtpdev-username"
              style={{
                flex: 1, background: EA(0.06), border: `1px solid ${EA(0.2)}`,
                borderRadius: "5px 0 0 5px", padding: "7px 10px",
                color: "rgba(255,255,255,0.85)", fontSize: 11, fontFamily: "monospace", outline: "none",
              }}
            />
            <span style={{
              background: EA(0.04), borderTop: `1px solid ${EA(0.2)}`, borderBottom: `1px solid ${EA(0.2)}`,
              padding: "7px 6px", color: EA(0.5), fontSize: 10, fontFamily: "monospace",
            }}>@</span>
            {domains.length === 1 ? (
              <div style={{
                background: EA(0.04), border: `1px solid ${EA(0.2)}`, borderLeft: "none",
                borderRadius: "0 5px 5px 0", padding: "7px 10px",
                color: EA(0.7), fontSize: 10, fontFamily: "monospace", whiteSpace: "nowrap",
              }}>
                {domains[0].name}
              </div>
            ) : (
              <select value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)}
                data-testid="select-smtpdev-domain"
                style={{
                  background: EA(0.06), border: `1px solid ${EA(0.2)}`, borderLeft: "none",
                  borderRadius: "0 5px 5px 0", padding: "7px 8px",
                  color: "rgba(255,255,255,0.85)", fontSize: 10, fontFamily: "monospace", outline: "none",
                }}>
                {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            )}
          </div>
          {fullAddress && (
            <div style={{ fontSize: 9, color: EA(0.5), fontFamily: "monospace", letterSpacing: "0.06em" }}>
              → {fullAddress}
            </div>
          )}
        </div>

        {err && <div style={{ fontSize: 10, color: R, fontFamily: "monospace" }}>{err}</div>}

        <button type="submit" disabled={submitting || !fullAddress} data-testid="button-create-smtpdev-account"
          style={{
            padding: "9px 0", borderRadius: 6, border: `1px solid ${EA(0.5)}`,
            background: submitting ? EA(0.08) : EA(0.15),
            color: E, fontSize: 11, fontFamily: "monospace", fontWeight: 800, letterSpacing: "0.12em",
            cursor: submitting ? "wait" : "pointer", opacity: !fullAddress ? 0.5 : 1,
          }}>
          {submitting ? "CREATING..." : "CREATE ACCOUNT"}
        </button>
      </form>
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────── */
export default function EmailWorkspace() {
  const [tempEmails, setTempEmails] = useState<TempEmailItem[]>([]);
  const [accountEmails, setAccountEmails] = useState<AccountEmailItem[]>([]);
  const [smtpDevAccounts, setSmtpDevAccounts] = useState<SmtpDevItem[]>([]);
  const [smtpDevDomains, setSmtpDevDomains] = useState<SmtpDevDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [sdLoading, setSdLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }

  const fetchSmtpDevDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/smtpdev/domains", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setSmtpDevDomains(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);

  const fetchSmtpDevAccounts = useCallback(async () => {
    setSdLoading(true);
    try {
      const res = await fetch("/api/smtpdev/accounts", { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (res.ok) {
        const data = await res.json();
        const raw: any[] = Array.isArray(data) ? data : [];
        const items: SmtpDevItem[] = raw
          .filter(a => !a.isDeleted)
          .map((a: any) => {
            const addr: string = a.address ?? "";
            const parts = addr.split("@");
            return {
              id: String(a.id ?? ""),
              address: addr,
              username: parts[0] ?? addr,
              domainId: "",
              domainName: parts[1] ?? "",
              createdAt: a.createdAt ?? new Date().toISOString(),
              source: "smtpdev" as const,
            };
          });
        setSmtpDevAccounts(items);
      }
    } catch {} finally {
      setSdLoading(false);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tempRes, accRes] = await Promise.all([
        fetch("/api/temp-emails", { credentials: "include" }),
        fetch("/api/emails", { credentials: "include" }),
      ]);
      if (tempRes.status === 401 || accRes.status === 401) { handleUnauthorized(); return; }
      const tempData = await tempRes.json();
      const accData = await accRes.json();
      setTempEmails(tempData.map((e: any) => ({ ...e, source: "temp" as const })));
      setAccountEmails(accData.map((e: any) => ({
        id: e.id, address: e.email,
        firstName: e.firstName, lastName: e.lastName,
        status: e.status, createdAt: e.createdAt, source: "account" as const,
      })));
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchSmtpDevAccounts();
    fetchSmtpDevDomains();
    const unsub = subscribe((msg: any) => {
      if (msg.type === "account_update") {
        setAccountEmails(prev => {
          const idx = prev.findIndex(e => e.id === msg.account.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], status: msg.account.status };
            return updated;
          }
          return prev;
        });
      }
    });
    return () => { unsub(); if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchAll, fetchSmtpDevAccounts, fetchSmtpDevDomains]);

  const allEmails: EmailItem[] = (() => {
    let items: EmailItem[] = [];
    if (activeTab === "all") items = [...tempEmails, ...accountEmails, ...smtpDevAccounts];
    else if (activeTab === "temp") items = [...tempEmails];
    else if (activeTab === "account") items = [...accountEmails];
    else if (activeTab === "smtpdev") items = [...smtpDevAccounts];
    if (!searchTerm) return items;
    return items.filter(e => e.address.toLowerCase().includes(searchTerm.toLowerCase()));
  })();

  async function generateNewMail() {
    setGenerating(true); sounds.generate();
    try {
      const res = await fetch("/api/temp-emails", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), credentials: "include",
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      const newEmail = await res.json();
      const item: TempEmailItem = { ...newEmail, source: "temp" };
      setTempEmails(prev => [item, ...prev]);
      setSelectedEmail(item);
      fetchInbox(item);
      sounds.success();
      showToast(`Generated: ${newEmail.address}`, "ok");
    } catch (e: any) {
      sounds.error(); showToast(e.message, "err");
    } finally { setGenerating(false); }
  }

  async function deleteEmail(id: string) {
    setDeletingId(id); sounds.click();
    try {
      const res = await fetch(`/api/temp-emails/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        setTempEmails(prev => prev.filter(e => e.id !== id));
        if (selectedEmail?.id === id) { setSelectedEmail(null); setInbox([]); if (pollRef.current) clearInterval(pollRef.current); }
        showToast("Mailbox deleted", "ok");
      }
    } catch {} finally { setDeletingId(null); }
  }

  async function deleteSmtpDevAccount(id: string) {
    setDeletingId(id); sounds.click();
    try {
      const res = await fetch(`/api/smtpdev/accounts/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        setSmtpDevAccounts(prev => prev.filter(e => e.id !== id));
        if (selectedEmail?.id === id) { setSelectedEmail(null); setInbox([]); if (pollRef.current) clearInterval(pollRef.current); }
        showToast("Account deleted", "ok");
      } else {
        const e = await res.json().catch(() => ({ error: "Failed" }));
        showToast(e.error || "Delete failed", "err");
      }
    } catch (ex: any) {
      showToast(ex.message, "err");
    } finally { setDeletingId(null); }
  }

  async function createSmtpDevAccount(address: string) {
    const res = await fetch("/api/smtpdev/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      credentials: "include",
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: "Failed" }));
      throw new Error(e.error || "Failed to create account");
    }
    const a = await res.json();
    const parts = (a.address ?? address).split("@");
    const item: SmtpDevItem = {
      id: a.id,
      address: a.address ?? address,
      username: parts[0] ?? address,
      domainId: "",
      domainName: parts[1] ?? "",
      password: a.password,
      createdAt: a.createdAt ?? new Date().toISOString(),
      source: "smtpdev",
    };
    setSmtpDevAccounts(prev => [item, ...prev]);
    setSelectedEmail(item);
    fetchInbox(item);
    sounds.success();
    showToast(`Created: ${item.address}`, "ok");
  }

  async function fetchInbox(email: EmailItem) {
    setSelectedEmail(email); setInboxLoading(true); setInbox([]); setExpandedMsg(null);
    if (pollRef.current) clearInterval(pollRef.current);

    let inboxUrl: string;
    if (email.source === "temp") inboxUrl = `/api/temp-emails/${email.id}/inbox`;
    else if (email.source === "smtpdev") inboxUrl = `/api/smtpdev/accounts/${email.id}/inbox`;
    else inboxUrl = `/api/emails/${email.id}/inbox`;

    try {
      const res = await fetch(inboxUrl, { credentials: "include" });
      if (res.status === 401) { handleUnauthorized(); return; }
      setInbox(await res.json());
    } catch { setInbox([]); } finally { setInboxLoading(false); }

    pollRef.current = setInterval(async () => {
      setScanning(true); setScanCount(n => n + 1);
      try {
        const res = await fetch(inboxUrl, { credentials: "include" });
        if (res.ok) {
          const messages = await res.json();
          setInbox(prev => {
            if (messages.length > prev.length) { sounds.notification(); showToast(`+${messages.length - prev.length} new message(s)`, "ok"); }
            return messages;
          });
        }
      } catch {} finally { setTimeout(() => setScanning(false), 800); }
    }, 5000);
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text); setCopiedId(id); sounds.click();
    showToast("Copied to clipboard", "ok");
    setTimeout(() => setCopiedId(null), 2000);
  }

  const tabs: { key: TabType; label: string; count: number; color: string }[] = [
    { key: "all",      label: "All",       count: tempEmails.length + accountEmails.length + smtpDevAccounts.length, color: G },
    { key: "temp",     label: "Generated", count: tempEmails.length, color: "#a855f7" },
    { key: "account",  label: "Accounts",  count: accountEmails.length, color: G },
    { key: "smtpdev",  label: "smtp.dev",  count: smtpDevAccounts.length, color: E },
  ];

  const selIsTmp = selectedEmail?.source === "temp";
  const selIsSd  = selectedEmail?.source === "smtpdev";

  /* ── Render ── */
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: BG0, fontFamily: "'Courier New', Courier, monospace", overflow: "hidden", position: "relative" }}>
      <Toast toast={toast} />
      {showCreateModal && (
        <CreateSmtpDevModal
          domains={smtpDevDomains}
          onClose={() => setShowCreateModal(false)}
          onCreate={createSmtpDevAccount}
        />
      )}

      {/* ══ TOP BAR ═════════════════════════════════════════════ */}
      <div style={{ flexShrink: 0, background: BG1, borderBottom: `1px solid ${GA(0.14)}`, position: "relative", overflow: "hidden" }}>
        <ScanBar />
        <div style={{ display: "flex", alignItems: "center", padding: "0 20px", height: 52, gap: 0 }}>

          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 20 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: PA(0.12), border: `1px solid ${PA(0.35)}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AtSign style={{ width: 14, height: 14, color: "#a855f7", filter: "drop-shadow(0 0 5px #a855f7)" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: G, letterSpacing: "0.2em", textShadow: `0 0 10px ${GA(0.6)}` }}>MAIL_INTERCEPT</div>
              <div style={{ fontSize: 8, color: GA(0.35), letterSpacing: "0.15em" }}>EMAIL WORKSPACE v2.1</div>
            </div>
          </div>

          <div style={{ width: 1, height: 30, background: GA(0.12), marginRight: 20 }} />

          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <Blink color={scanning ? "#ffaa00" : G} />
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: GA(0.7), letterSpacing: "0.05em" }}>
                {tempEmails.length + accountEmails.length + smtpDevAccounts.length} MAILBOXES ACTIVE
                {smtpDevAccounts.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 9, color: EA(0.7), border: `1px solid ${EA(0.3)}`, borderRadius: 4, padding: "1px 5px" }}>
                    {smtpDevAccounts.length} smtp.dev
                  </span>
                )}
              </div>
              <div style={{ fontSize: 8, color: GA(0.3), letterSpacing: "0.12em" }}>
                {scanning ? `SCANNING · POLL #${scanCount}` : selectedEmail ? `MONITORING: ${selectedEmail.address}` : "SELECT MAILBOX TO MONITOR"}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button onClick={() => { fetchAll(); fetchSmtpDevAccounts(); }} data-testid="button-refresh-workspace"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 5, background: GA(0.06), border: `1px solid ${GA(0.18)}`, color: GA(0.6), fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer", letterSpacing: "0.12em" }}>
              <RefreshCw style={{ width: 10, height: 10, animation: loading ? "spin 1s linear infinite" : "none" }} /> REFRESH
            </button>

            {activeTab === "smtpdev" ? (
              <button onClick={() => { sounds.click(); setShowCreateModal(true); }} data-testid="button-create-smtpdev"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 5, background: EA(0.15), border: `1px solid ${EA(0.45)}`, color: E, fontSize: 10, fontFamily: "monospace", fontWeight: 800, cursor: "pointer", letterSpacing: "0.12em", textShadow: `0 0 8px ${EA(0.7)}`, boxShadow: `0 0 14px ${EA(0.12)}` }}>
                <Plus style={{ width: 12, height: 12 }} />
                CREATE INBOX
              </button>
            ) : (
              <button onClick={generateNewMail} disabled={generating} data-testid="button-generate-email"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 5, background: GA(0.15), border: `1px solid ${GA(0.45)}`, color: G, fontSize: 10, fontFamily: "monospace", fontWeight: 800, cursor: generating ? "wait" : "pointer", letterSpacing: "0.12em", textShadow: `0 0 8px ${GA(0.7)}`, boxShadow: `0 0 14px ${GA(0.12)}`, opacity: generating ? 0.7 : 1 }}>
                {generating
                  ? <RefreshCw style={{ width: 12, height: 12, animation: "spin 0.8s linear infinite" }} />
                  : <Zap style={{ width: 12, height: 12 }} />}
                {generating ? "GENERATING..." : "GENERATE NEW MAIL"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ══ BODY ════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ─ LEFT: Mailbox list ────────────────────────────────── */}
        <div style={{ width: 300, flexShrink: 0, background: BG1, borderRight: `1px solid ${GA(0.1)}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* List header */}
          <div style={{ flexShrink: 0, padding: "10px 14px 0", borderBottom: `1px solid ${GA(0.08)}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.25em", color: GA(0.35) }}>// MAILBOXES</span>
              <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: GA(0.4), background: GA(0.08), padding: "1px 7px", borderRadius: 10, border: `1px solid ${GA(0.15)}` }}>
                {tempEmails.length + accountEmails.length + smtpDevAccounts.length}
              </span>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
              {tabs.map(tab => (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} data-testid={`tab-${tab.key}`}
                  style={{
                    flex: 1, padding: "5px 2px", borderRadius: 4, border: "none", cursor: "pointer", fontFamily: "monospace", fontSize: 8, fontWeight: 700, letterSpacing: "0.05em",
                    background: activeTab === tab.key ? (tab.key === "smtpdev" ? EA(0.12) : GA(0.12)) : "transparent",
                    color: activeTab === tab.key ? tab.color : GA(0.35),
                    borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : "2px solid transparent",
                    transition: "all 0.12s",
                  }}>
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>

            {/* Search */}
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 10, height: 10, color: GA(0.3) }} />
              <input
                type="text"
                placeholder="Search emails..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                data-testid="input-search-emails"
                style={{
                  width: "100%", boxSizing: "border-box", height: 28, paddingLeft: 26, paddingRight: 10,
                  fontFamily: "monospace", fontSize: 9, background: GA(0.05), border: `1px solid ${GA(0.12)}`,
                  borderRadius: 5, color: GA(0.8), outline: "none", letterSpacing: "0.05em",
                }}
              />
            </div>
          </div>

          {/* smtp.dev banner when on that tab */}
          {activeTab === "smtpdev" && (
            <div style={{ flexShrink: 0, padding: "8px 14px", background: EA(0.04), borderBottom: `1px solid ${EA(0.12)}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Server style={{ width: 11, height: 11, color: E, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 9, color: E, fontWeight: 700, letterSpacing: "0.08em" }}>smtp.dev INBOXES</div>
                <div style={{ fontSize: 8, color: EA(0.45), letterSpacing: "0.05em" }}>
                  {sdLoading ? "Loading..." : `${smtpDevAccounts.length} account(s) · ${smtpDevDomains.length} domain(s)`}
                </div>
              </div>
            </div>
          )}

          {/* Email list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {(loading || (activeTab === "smtpdev" && sdLoading)) ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8 }}>
                <RefreshCw style={{ width: 18, height: 18, color: GA(0.25), animation: "spin 1.5s linear infinite" }} />
                <span style={{ fontSize: 9, color: GA(0.2), letterSpacing: "0.15em" }}>LOADING...</span>
              </div>
            ) : allEmails.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", gap: 10 }}>
                {activeTab === "smtpdev"
                  ? <Server style={{ width: 28, height: 28, color: EA(0.2) }} />
                  : <Mail style={{ width: 28, height: 28, color: GA(0.12) }} />}
                <span style={{ fontSize: 9, color: GA(0.2), letterSpacing: "0.12em" }}>
                  {activeTab === "smtpdev" ? "NO smtp.dev ACCOUNTS" : "NO MAILBOXES YET"}
                </span>
                {activeTab === "smtpdev" && (
                  <span style={{ fontSize: 8, color: EA(0.2), letterSpacing: "0.08em", textAlign: "center", padding: "0 16px" }}>
                    Click CREATE INBOX to add one
                  </span>
                )}
              </div>
            ) : (
              allEmails.map(em => {
                const isAcc = em.source === "account";
                const isSd  = em.source === "smtpdev";
                const accEm = isAcc ? (em as AccountEmailItem) : null;
                const isSel = selectedEmail?.id === em.id && selectedEmail?.source === em.source;

                const accentColor = isSd ? E : isAcc ? G : "#a855f7";
                const accentAlpha = isSd ? EA : isAcc ? GA : PA;
                const tagLabel = isSd ? "SMTP" : isAcc ? (accEm?.status?.toUpperCase() || "VERIFIED") : "TEMP";

                return (
                  <div key={`${em.source}-${em.id}`} onClick={() => fetchInbox(em)} data-testid={`email-item-${em.source}-${em.id}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                      background: isSel ? (isSd ? EA(0.08) : GA(0.08)) : "transparent",
                      borderLeft: isSel ? `2px solid ${accentColor}` : "2px solid transparent",
                      borderBottom: `1px solid ${GA(0.06)}`,
                      cursor: "pointer", transition: "all 0.1s",
                    }}>

                    {/* Icon */}
                    <div style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      background: accentAlpha(0.1),
                      border: `1px solid ${accentAlpha(0.25)}`,
                    }}>
                      {isSd
                        ? <Server style={{ width: 13, height: 13, color: E }} />
                        : isAcc
                          ? <Users style={{ width: 13, height: 13, color: G }} />
                          : <Mail style={{ width: 13, height: 13, color: "#a855f7" }} />}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 10, fontFamily: "monospace", color: isSel ? accentColor : "rgba(255,255,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                          {em.address}
                        </span>
                        <span style={{
                          fontSize: 7, fontFamily: "monospace", fontWeight: 800, padding: "1px 5px", borderRadius: 3,
                          background: accentAlpha(0.12),
                          border: `1px solid ${accentAlpha(0.3)}`,
                          color: accentColor,
                          letterSpacing: "0.08em", flexShrink: 0,
                        }}>
                          {tagLabel}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Clock style={{ width: 8, height: 8, color: GA(0.25) }} />
                        <span style={{ fontSize: 8, color: GA(0.3), letterSpacing: "0.05em" }}>
                          {isAcc && accEm ? `${accEm.firstName} ${accEm.lastName}` : timeAgo(em.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); copyText(em.address, `${em.source}-${em.id}`); }}
                        data-testid={`button-copy-${em.source}-${em.id}`}
                        style={{ width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: GA(0.06), border: `1px solid ${GA(0.12)}`, cursor: "pointer" }}>
                        {copiedId === `${em.source}-${em.id}`
                          ? <CheckCircle2 style={{ width: 10, height: 10, color: G }} />
                          : <Copy style={{ width: 10, height: 10, color: GA(0.45) }} />}
                      </button>
                      {(em.source === "temp" || em.source === "smtpdev") && (
                        <button onClick={e => { e.stopPropagation(); isSd ? deleteSmtpDevAccount(em.id) : deleteEmail(em.id); }} disabled={deletingId === em.id}
                          data-testid={`button-delete-${em.id}`}
                          style={{ width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: RA(0.06), border: `1px solid ${RA(0.15)}`, cursor: "pointer" }}>
                          {deletingId === em.id
                            ? <RefreshCw style={{ width: 10, height: 10, color: RA(0.5), animation: "spin 1s linear infinite" }} />
                            : <Trash2 style={{ width: 10, height: 10, color: RA(0.5) }} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ─ RIGHT: Inbox panel ────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Inbox header */}
          <div style={{ flexShrink: 0, height: 48, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${GA(0.1)}`, background: BG2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <Inbox style={{ width: 13, height: 13, color: selIsSd ? EA(0.6) : GA(0.45), flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontFamily: "monospace", color: selectedEmail ? (selIsSd ? EA(0.9) : GA(0.8)) : GA(0.25), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.03em" }}>
                {selectedEmail ? selectedEmail.address : "SELECT A MAILBOX"}
              </span>
              {selectedEmail && (
                <button onClick={() => copyText(selectedEmail.address, "hdr-" + selectedEmail.id)}
                  data-testid="button-copy-selected"
                  style={{ width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: GA(0.06), border: `1px solid ${GA(0.12)}`, cursor: "pointer", flexShrink: 0 }}>
                  {copiedId === "hdr-" + selectedEmail.id
                    ? <CheckCircle2 style={{ width: 10, height: 10, color: G }} />
                    : <Copy style={{ width: 10, height: 10, color: GA(0.4) }} />}
                </button>
              )}
            </div>

            {selectedEmail && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {scanning && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Blink color="#ffaa00" />
                    <span style={{ fontSize: 8, color: "#ffaa00", letterSpacing: "0.12em" }}>SCANNING...</span>
                  </div>
                )}
                <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, padding: "2px 10px", borderRadius: 10,
                  background: selIsSd ? EA(0.1) : GA(0.1),
                  border: `1px solid ${selIsSd ? EA(0.25) : GA(0.25)}`,
                  color: selIsSd ? E : GA(0.8), letterSpacing: "0.08em" }}>
                  {inbox.length} MSG{inbox.length !== 1 ? "S" : ""}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: selIsSd ? E : G, boxShadow: `0 0 6px ${selIsSd ? E : G}`, animation: "pulse 2s ease-in-out infinite" }} />
                  <span style={{ fontSize: 8, color: GA(0.35), letterSpacing: "0.1em" }}>LIVE SCAN EVERY 5S</span>
                </div>
              </div>
            )}
          </div>

          {/* Inbox meta strip */}
          {selectedEmail && (
            <div style={{ flexShrink: 0, padding: "6px 20px", borderBottom: `1px solid ${GA(0.07)}`, background: "#060110", display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{
                fontSize: 7, fontFamily: "monospace", fontWeight: 800, padding: "2px 7px", borderRadius: 3, letterSpacing: "0.1em",
                background: selIsSd ? EA(0.12) : selIsTmp ? PA(0.15) : GA(0.1),
                border: `1px solid ${selIsSd ? EA(0.3) : selIsTmp ? PA(0.3) : GA(0.25)}`,
                color: selIsSd ? E : selIsTmp ? "#a855f7" : G,
              }}>
                {selIsSd ? "smtp.dev" : selIsTmp ? "TEMP" : "ACCOUNT"}
              </span>
              {selIsSd && selectedEmail.source === "smtpdev" && (
                <span style={{ fontSize: 9, color: EA(0.45), letterSpacing: "0.05em" }}>
                  {(selectedEmail as SmtpDevItem).username}@{(selectedEmail as SmtpDevItem).domainName}
                </span>
              )}
              {!selIsSd && !selIsTmp && selectedEmail.source === "account" && (
                <span style={{ fontSize: 9, color: GA(0.4), letterSpacing: "0.05em" }}>
                  {(selectedEmail as AccountEmailItem).firstName} {(selectedEmail as AccountEmailItem).lastName}
                </span>
              )}
              <span style={{ fontSize: 8, color: GA(0.2) }}>{new Date(selectedEmail.createdAt).toLocaleString()}</span>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {!selectedEmail ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 16 }}>
                <div style={{ width: 64, height: 64, borderRadius: 14, background: GA(0.04), border: `1px solid ${GA(0.1)}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Inbox style={{ width: 28, height: 28, color: GA(0.18) }} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: GA(0.2), letterSpacing: "0.2em", marginBottom: 6 }}>NO MAILBOX SELECTED</div>
                  <div style={{ fontSize: 9, color: GA(0.12), letterSpacing: "0.08em" }}>Select a mailbox from the left panel</div>
                </div>
              </div>
            ) : inboxLoading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50%", gap: 10 }}>
                <RefreshCw style={{ width: 22, height: 22, color: selIsSd ? EA(0.4) : GA(0.3), animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: 9, color: GA(0.25), letterSpacing: "0.15em" }}>LOADING INBOX...</span>
              </div>
            ) : inbox.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50%", gap: 12 }}>
                <Mail style={{ width: 26, height: 26, color: selIsSd ? EA(0.15) : GA(0.1) }} />
                <span style={{ fontSize: 9, color: GA(0.2), letterSpacing: "0.12em" }}>INBOX EMPTY</span>
                <span style={{ fontSize: 8, color: GA(0.12), letterSpacing: "0.08em" }}>Polling every 5 seconds...</span>
              </div>
            ) : (
              <div style={{ padding: "10px 0" }}>
                {inbox.map(msg => {
                  const otp = extractOtp(msg.text ?? "");
                  const isExp = expandedMsg === msg.id;
                  return (
                    <div key={msg.id} data-testid={`msg-${msg.id}`}
                      onClick={() => { setExpandedMsg(isExp ? null : msg.id); sounds.click(); }}
                      style={{
                        margin: "0 16px 8px", padding: "12px 14px", borderRadius: 7, cursor: "pointer",
                        background: isExp ? (selIsSd ? EA(0.07) : GA(0.07)) : GA(0.03),
                        border: `1px solid ${isExp ? (selIsSd ? EA(0.25) : GA(0.25)) : GA(0.08)}`,
                        transition: "all 0.15s",
                      }}>

                      {/* Message header */}
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: isExp ? 10 : 0 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: selIsSd ? E : G, letterSpacing: "0.03em" }}>
                              {msg.subject}
                            </span>
                            {otp && <OtpChip code={otp} />}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 9, color: GA(0.45), fontFamily: "monospace" }}>
                              FROM: <span style={{ color: GA(0.7) }}>{msg.from}</span>
                            </span>
                            <span style={{ fontSize: 8, color: GA(0.25), fontFamily: "monospace" }}>
                              {new Date(msg.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <button onClick={e => { e.stopPropagation(); copyText(msg.text ?? "", `msg-${msg.id}`); }}
                            data-testid={`button-copy-msg-${msg.id}`}
                            style={{ width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: GA(0.06), border: `1px solid ${GA(0.15)}`, cursor: "pointer" }}>
                            {copiedId === `msg-${msg.id}`
                              ? <CheckCircle2 style={{ width: 10, height: 10, color: G }} />
                              : <Copy style={{ width: 10, height: 10, color: GA(0.4) }} />}
                          </button>
                          <div style={{ display: "flex", alignItems: "center" }}>
                            <Eye style={{ width: 10, height: 10, color: isExp ? (selIsSd ? E : G) : GA(0.25) }} />
                          </div>
                        </div>
                      </div>

                      {/* Expanded body */}
                      {isExp && (
                        <div style={{
                          marginTop: 4, padding: "10px 12px", borderRadius: 5, background: GA(0.03),
                          border: `1px solid ${GA(0.08)}`, maxHeight: 280, overflowY: "auto",
                        }}>
                          <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 10, color: GA(0.65), whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                            {msg.text || "(empty)"}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

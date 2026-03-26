import { useState, useEffect, useRef, useCallback } from "react";
import {
  Copy, RefreshCw, Zap, Square, Inbox, Trash2, Send,
  AlertTriangle, Mail, ChevronDown, AtSign, Archive,
  Clock, Shield, User, FileText, Terminal, CheckCircle,
  XCircle, Info, Eye, EyeOff,
} from "lucide-react";
import { sounds } from "@/lib/sounds";

/* ─── Color tokens ─────────────────────────────────────────── */
const G = "#00ff41";
const R = "#ff1a1a";
const GA = (a: number) => `rgba(0,255,65,${a})`;
const RA = (a: number) => `rgba(255,26,26,${a})`;
const BG0 = "#07050a";
const BG1 = "#080510";
const BG2 = "#0a0614";

/* ─── Types ─────────────────────────────────────────────────── */
interface OEmail {
  uid: number; folder: string; folderDisplay: string;
  from: string; fromEmail: string; subject: string;
  date: string; snippet: string; body: string;
  otp: string | null; isNew: boolean; id: string;
}
interface FolderInfo { imap: string; display: string; count: number; }
interface LogEntry { time: string; msg: string; level: "info" | "warn" | "error" | "ok"; }
interface Payload {
  messages: OEmail[]; folders: FolderInfo[];
  newCount: number; email: string | null;
  status: string; error: string | null;
  lastPollAt: string | null; startedAt: string | null;
  logs?: LogEntry[];
}
interface Account { id: string; email: string; status: string; }

/* ─── Helpers ───────────────────────────────────────────────── */
function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtLogTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] || "").join("").toUpperCase().substring(0, 2) || "?";
}
function folderIcon(display: string) {
  const d = display.toLowerCase();
  if (d === "inbox") return Inbox;
  if (d === "junk" || d === "spam") return AlertTriangle;
  if (d === "sent") return Send;
  if (d === "trash" || d === "deleted") return Trash2;
  if (d === "archive") return Archive;
  if (d === "drafts") return FileText;
  return Mail;
}

/* ─── Sub-components ────────────────────────────────────────── */
function Blink({ color = G }: { color?: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setInterval(() => setOn(v => !v), 600); return () => clearInterval(t); }, []);
  return <span style={{ color, opacity: on ? 1 : 0, transition: "opacity 0.08s", display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, verticalAlign: "middle" }} />;
}

function ScanBar() {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${GA(0.35)},transparent)`, animation: "scanbeam 5s linear infinite", pointerEvents: "none", zIndex: 10 }} />
  );
}

function OtpChip({ code, large }: { code: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); sounds.click(); setTimeout(() => setCopied(false), 1800); };
  return (
    <button onClick={copy} data-testid={`otp-copy-${code}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: large ? 8 : 4,
        padding: large ? "6px 14px" : "2px 8px",
        borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontWeight: 800,
        fontSize: large ? 13 : 10, letterSpacing: large ? "0.15em" : "0.08em",
        background: GA(0.12), border: `1px solid ${GA(0.5)}`,
        color: G, textShadow: `0 0 8px ${GA(0.8)}`,
        boxShadow: `0 0 12px ${GA(0.2)}`,
        transition: "all 0.15s",
      }}>
      <Shield style={{ width: large ? 14 : 10, height: large ? 14 : 10 }} />
      {copied ? "COPIED" : (large ? `OTP: ${code}` : code)}
    </button>
  );
}

/* ─── Live Log Panel ────────────────────────────────────────── */
function LiveLogPanel({ logs }: { logs: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const levelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "ok": return G;
      case "warn": return "#ffaa00";
      case "error": return R;
      default: return "rgba(0,255,65,0.5)";
    }
  };

  const LevelIcon = ({ level }: { level: LogEntry["level"] }) => {
    const sz = { width: 9, height: 9, flexShrink: 0 as const };
    switch (level) {
      case "ok": return <CheckCircle style={{ ...sz, color: G }} />;
      case "warn": return <AlertTriangle style={{ ...sz, color: "#ffaa00" }} />;
      case "error": return <XCircle style={{ ...sz, color: R }} />;
      default: return <Info style={{ ...sz, color: GA(0.4) }} />;
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", fontFamily: "monospace" }}>
      {logs.length === 0 && (
        <div style={{ padding: "12px 14px", fontSize: 9, color: GA(0.25), letterSpacing: "0.1em" }}>
          Waiting for connection logs...
        </div>
      )}
      {logs.map((log, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "flex-start", gap: 7,
          padding: "3px 14px",
          borderBottom: `1px solid ${GA(0.04)}`,
          background: log.level === "error" ? RA(0.03) : log.level === "warn" ? "rgba(255,170,0,0.02)" : "transparent",
        }}>
          <span style={{ fontSize: 8, color: GA(0.25), flexShrink: 0, marginTop: 1, letterSpacing: "0.02em" }}>
            {fmtLogTime(log.time)}
          </span>
          <LevelIcon level={log.level} />
          <span style={{ fontSize: 9, color: levelColor(log.level), flex: 1, lineHeight: 1.5, wordBreak: "break-all" }}>
            {log.msg}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────── */
export default function OutlookWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [folder, setFolder] = useState("ALL");
  const [activating, setActivating] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAccPicker, setShowAccPicker] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [showLogs, setShowLogs] = useState(true);
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  function showToast(msg: string, kind: "ok" | "err" = "ok") {
    setToast({ msg, kind }); setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowAccPicker(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/outlook-workspace/messages");
      if (!r.ok) return;
      const d: Payload = await r.json();
      setData(d);
      setScanCount(n => n + 1);
      if (d.logs && d.logs.length > 0) {
        setAllLogs(prev => {
          const existingTimes = new Set(prev.map(l => l.time + l.msg));
          const newEntries = d.logs!.filter(l => !existingTimes.has(l.time + l.msg));
          return [...prev, ...newEntries].slice(-200);
        });
      }
      if (d.newCount > 0) { sounds.notification(); showToast(`+${d.newCount} new message${d.newCount > 1 ? "s" : ""}`, "ok"); }
    } catch {}
  }, []);

  useEffect(() => {
    fetchData();
    fetch("/api/outlook-workspace/accounts").then(r => r.json()).then(setAccounts).catch(() => {});
    const t = setInterval(fetchData, 4000);
    return () => clearInterval(t);
  }, [fetchData]);

  async function activate(id?: string) {
    setActivating(true); setShowAccPicker(false); sounds.generate();
    setAllLogs([]);
    try {
      const r = await fetch(id ? `/api/outlook-workspace/activate/${id}` : "/api/outlook-workspace/activate", { method: "POST" });
      const d = await r.json();
      if (!r.ok) { showToast(d.error || "Failed", "err"); sounds.error(); }
      else { showToast(`Connected: ${d.email}`, "ok"); sounds.success(); setSelectedId(null); setFolder("ALL"); await fetchData(); }
    } finally { setActivating(false); }
  }

  async function stopSession() {
    await fetch("/api/outlook-workspace/stop", { method: "POST" });
    setData(null); setSelectedId(null); setAllLogs([]); showToast("Session terminated", "ok"); sounds.toggle();
  }

  function copyEmail() {
    if (!data?.email) return;
    navigator.clipboard.writeText(data.email);
    showToast("Email copied", "ok"); sounds.click();
  }

  const isActive = !!data?.email;
  const statusOk = data?.status === "active";
  const statusErr = data?.status === "error";
  const statusConn = data?.status === "connecting";

  const filtered = (data?.messages || []).filter(m =>
    folder === "ALL" || m.folder === folder || m.folderDisplay === folder
  );
  const selected = filtered.find(m => m.id === selectedId) || null;

  const allFolders: FolderInfo[] = [
    { imap: "ALL", display: "All Mail", count: data?.messages?.length || 0 },
    ...(data?.folders || []),
  ];

  const logPanelWidth = showLogs ? 280 : 0;

  /* ── Layout ── */
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: BG0, fontFamily: "'Courier New', Courier, monospace", overflow: "hidden", position: "relative" }}>

      {/* Toast */}
      {toast && (
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
      )}

      {/* ══ TOP STATUS BAR ══════════════════════════════════════ */}
      <div style={{ flexShrink: 0, background: BG1, borderBottom: `1px solid ${GA(0.14)}`, position: "relative", overflow: "hidden" }}>
        <ScanBar />
        <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 20px", height: 52 }}>

          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 20 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: GA(0.1), border: `1px solid ${GA(0.3)}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AtSign style={{ width: 14, height: 14, color: G, filter: `drop-shadow(0 0 5px ${G})` }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: G, letterSpacing: "0.2em", textShadow: `0 0 10px ${GA(0.6)}` }}>MAIL_INTERCEPT</div>
              <div style={{ fontSize: 8, color: GA(0.35), letterSpacing: "0.15em" }}>OUTLOOK WORKSPACE v3.0</div>
            </div>
          </div>

          <div style={{ width: 1, height: 30, background: GA(0.12), marginRight: 20 }} />

          {/* Active session info */}
          {isActive ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              <Blink color={statusErr ? R : statusConn ? "#ffaa00" : G} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: statusErr ? R : G, textShadow: `0 0 8px ${statusErr ? RA(0.5) : GA(0.5)}`, letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {data?.email}
                </div>
                <div style={{ fontSize: 8, color: GA(0.35), letterSpacing: "0.12em" }}>
                  {statusConn
                    ? "LAUNCHING BROWSER — LOGGING IN..."
                    : statusErr
                    ? `ERR: ${(data?.error || "").substring(0, 50)}`
                    : `ACTIVE · SCAN #${scanCount} · ${data?.messages?.length || 0} MSGS`}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <Blink color="#444" />
              <span style={{ fontSize: 10, color: GA(0.3), letterSpacing: "0.15em" }}>NO ACTIVE SESSION — CLICK GENERATE TO START</span>
            </div>
          )}

          {/* Right actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {data?.lastPollAt && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: GA(0.3), letterSpacing: "0.1em" }}>
                <RefreshCw style={{ width: 9, height: 9, animation: "spin 3s linear infinite" }} />
                {timeAgo(data.lastPollAt)}
              </div>
            )}

            {/* Log toggle */}
            {isActive && (
              <button onClick={() => setShowLogs(v => !v)} data-testid="button-toggle-logs"
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 5, background: showLogs ? GA(0.12) : GA(0.04), border: `1px solid ${showLogs ? GA(0.35) : GA(0.12)}`, color: showLogs ? G : GA(0.45), fontSize: 9, fontFamily: "monospace", fontWeight: 700, cursor: "pointer", letterSpacing: "0.1em" }}>
                <Terminal style={{ width: 10, height: 10 }} /> LOGS
              </button>
            )}

            {isActive && (
              <button onClick={copyEmail} data-testid="button-copy-email"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 5, background: GA(0.06), border: `1px solid ${GA(0.2)}`, color: GA(0.7), fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer", letterSpacing: "0.1em" }}>
                <Copy style={{ width: 11, height: 11 }} /> COPY
              </button>
            )}

            {/* Account picker */}
            <div style={{ position: "relative" }} ref={pickerRef}>
              <button onClick={() => setShowAccPicker(v => !v)} data-testid="button-open-picker"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 5, background: GA(0.06), border: `1px solid ${GA(0.2)}`, color: GA(0.7), fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer", letterSpacing: "0.1em" }}>
                <User style={{ width: 11, height: 11 }} /> SELECT <ChevronDown style={{ width: 9, height: 9 }} />
              </button>
              {showAccPicker && (
                <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", width: 300, borderRadius: 8, background: "#060210", border: `1px solid ${GA(0.2)}`, boxShadow: `0 16px 48px rgba(0,0,0,0.9)`, zIndex: 100, overflow: "hidden" }}>
                  <div style={{ padding: "8px 12px", fontSize: 9, fontWeight: 700, letterSpacing: "0.2em", color: GA(0.4), borderBottom: `1px solid ${GA(0.1)}` }}>
                    SELECT ACCOUNT ({accounts.length})
                  </div>
                  <div style={{ maxHeight: 220, overflowY: "auto" }}>
                    {accounts.length === 0 && <div style={{ padding: "12px 16px", fontSize: 10, color: GA(0.3) }}>No accounts in database</div>}
                    {accounts.map(a => (
                      <button key={a.id} onClick={() => activate(a.id)} data-testid={`acc-${a.id}`}
                        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: "transparent", border: "none", borderBottom: `1px solid ${GA(0.06)}`, cursor: "pointer", textAlign: "left" }}>
                        <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{a.email}</span>
                        <span style={{ fontSize: 8, fontFamily: "monospace", fontWeight: 700, color: a.status === "active" ? G : R, flexShrink: 0, marginLeft: 8 }}>{a.status.toUpperCase()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button onClick={() => activate()} disabled={activating} data-testid="button-generate-outlook"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 5, background: GA(0.15), border: `1px solid ${GA(0.45)}`, color: G, fontSize: 10, fontFamily: "monospace", fontWeight: 800, cursor: activating ? "wait" : "pointer", letterSpacing: "0.12em", textShadow: `0 0 8px ${GA(0.7)}`, boxShadow: `0 0 14px ${GA(0.12)}`, opacity: activating ? 0.6 : 1 }}>
              <Zap style={{ width: 12, height: 12 }} />
              {activating ? "CONNECTING..." : "GENERATE OUTLOOK"}
            </button>

            {isActive && (
              <button onClick={stopSession} data-testid="button-stop"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 5, background: RA(0.1), border: `1px solid ${RA(0.35)}`, color: R, fontSize: 10, fontFamily: "monospace", fontWeight: 700, cursor: "pointer", letterSpacing: "0.1em" }}>
                <Square style={{ width: 10, height: 10 }} /> STOP
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ══ BODY ════════════════════════════════════════════════ */}
      {!isActive ? (
        /* ── Empty / idle state ── */
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", inset: -24, borderRadius: "50%", background: GA(0.04), filter: "blur(24px)" }} />
            <div style={{ width: 80, height: 80, borderRadius: 16, background: GA(0.06), border: `1px solid ${GA(0.15)}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <Mail style={{ width: 32, height: 32, color: GA(0.3) }} />
            </div>
          </div>

          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: G, letterSpacing: "0.25em", textShadow: `0 0 12px ${GA(0.5)}`, marginBottom: 8 }}>MAIL INTERCEPT OFFLINE</div>
            <div style={{ fontSize: 10, color: GA(0.35), letterSpacing: "0.1em" }}>Generate a session to start scanning Outlook emails in real-time</div>
          </div>

          <button onClick={() => activate()} disabled={activating} data-testid="button-generate-main"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 28px", borderRadius: 8, background: GA(0.12), border: `1px solid ${GA(0.4)}`, color: G, fontSize: 12, fontFamily: "monospace", fontWeight: 800, cursor: activating ? "wait" : "pointer", letterSpacing: "0.15em", textShadow: `0 0 10px ${GA(0.7)}`, boxShadow: `0 0 24px ${GA(0.1)}` }}>
            <Zap style={{ width: 16, height: 16 }} />
            {activating ? "CONNECTING..." : "GENERATE OUTLOOK"}
          </button>

          <div style={{ display: "flex", gap: 24 }}>
            {[
              { icon: Shield, label: "OTP EXTRACTION", sub: "Auto-detect verification codes" },
              { icon: RefreshCw, label: "LIVE SCANNING", sub: "All folders every 30 seconds" },
              { icon: Clock, label: "FULL HISTORY", sub: "Inbox, Junk, Spam, Sent" },
              { icon: Terminal, label: "REAL-TIME LOGS", sub: "Live connection progress" },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} style={{ textAlign: "center", padding: "12px 16px", borderRadius: 8, background: GA(0.03), border: `1px solid ${GA(0.08)}`, minWidth: 130 }}>
                <Icon style={{ width: 18, height: 18, color: GA(0.4), margin: "0 auto 6px" }} />
                <div style={{ fontSize: 9, fontWeight: 800, color: GA(0.5), letterSpacing: "0.15em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 8, color: GA(0.25) }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Four-panel email client ── */
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* ─ LEFT: Folder sidebar ──────────────────────────── */}
          <div style={{ width: 160, flexShrink: 0, background: BG1, borderRight: `1px solid ${GA(0.1)}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "10px 12px 6px", fontSize: 8, fontWeight: 800, letterSpacing: "0.25em", color: GA(0.35) }}>// FOLDERS</div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {allFolders.map(f => {
                const sel = folder === f.imap || (folder === "ALL" && f.imap === "ALL");
                const Icon = folderIcon(f.display);
                return (
                  <button key={f.imap} onClick={() => { setFolder(f.imap); setSelectedId(null); sounds.navigate(); }}
                    data-testid={`folder-btn-${f.imap}`}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: sel ? GA(0.1) : "transparent", border: "none", borderLeft: sel ? `2px solid ${G}` : "2px solid transparent", cursor: "pointer", textAlign: "left", transition: "all 0.12s" }}>
                    <Icon style={{ width: 13, height: 13, color: sel ? G : GA(0.35), flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 10, fontFamily: "monospace", color: sel ? G : "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.display}</span>
                    {f.count > 0 && <span style={{ fontSize: 9, fontFamily: "monospace", color: sel ? GA(0.8) : GA(0.35), flexShrink: 0 }}>{f.count}</span>}
                  </button>
                );
              })}
            </div>

            {/* Status footer */}
            <div style={{ padding: "8px 12px", borderTop: `1px solid ${GA(0.08)}`, fontSize: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, color: GA(0.3), marginBottom: 3 }}>
                <RefreshCw style={{ width: 8, height: 8, animation: statusOk ? "spin 3s linear infinite" : "none" }} />
                {statusErr ? <span style={{ color: R }}>ERR</span> : statusConn ? <span style={{ color: "#ffaa00" }}>LAUNCHING...</span> : "LIVE"}
              </div>
              {statusConn && <div style={{ color: "#ffaa00", fontSize: 7, marginTop: 1 }}>~60s first scan</div>}
              {data?.lastPollAt && <div style={{ color: GA(0.25) }}>SCANNED {timeAgo(data.lastPollAt)} AGO</div>}
              {statusErr && <div style={{ color: R, marginTop: 2, wordBreak: "break-all" }}>{(data?.error || "").substring(0, 50)}</div>}
            </div>
          </div>

          {/* ─ CENTER: Email list ─────────────────────────────── */}
          <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: `1px solid ${GA(0.1)}`, overflow: "hidden" }}>
            <div style={{ padding: "0 14px", height: 38, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${GA(0.1)}`, background: BG2, flexShrink: 0 }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.2em", color: GA(0.45) }}>
                MESSAGES ({filtered.length})
              </span>
              <RefreshCw style={{ width: 10, height: 10, color: GA(0.3), animation: "spin 4s linear infinite" }} />
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Mail style={{ width: 24, height: 24, color: GA(0.15) }} />
                  <span style={{ fontSize: 9, color: GA(0.25), letterSpacing: "0.15em" }}>
                    {statusConn ? "BROWSER LOADING..." : "NO MESSAGES"}
                  </span>
                  {statusConn && (
                    <span style={{ fontSize: 8, color: GA(0.18), letterSpacing: "0.08em", textAlign: "center", maxWidth: 180, lineHeight: 1.5 }}>
                      Check the log panel for progress
                    </span>
                  )}
                </div>
              ) : (
                filtered.map(msg => {
                  const isSel = selectedId === msg.id;
                  return (
                    <button key={msg.id} onClick={() => { setSelectedId(msg.id); sounds.click(); }}
                      data-testid={`email-row-${msg.id}`}
                      style={{ width: "100%", display: "flex", flexDirection: "column", padding: "10px 14px", background: isSel ? GA(0.1) : msg.isNew ? GA(0.04) : "transparent", border: "none", borderBottom: `1px solid ${GA(0.07)}`, borderLeft: isSel ? `2px solid ${G}` : msg.isNew ? `2px solid ${GA(0.35)}` : "2px solid transparent", cursor: "pointer", textAlign: "left", transition: "all 0.12s", flexShrink: 0 }}>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                          {msg.isNew && (
                            <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: G, boxShadow: `0 0 6px ${G}` }} />
                          )}
                          <span style={{ fontSize: 11, fontWeight: msg.isNew ? 800 : 600, color: isSel ? G : "rgba(255,255,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                            {msg.from}
                          </span>
                        </div>
                        <span style={{ fontSize: 9, color: GA(0.35), flexShrink: 0, marginLeft: 6 }}>{timeAgo(msg.date)}</span>
                      </div>

                      <div style={{ fontSize: 10, color: isSel ? GA(0.9) : "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 5, letterSpacing: "0.01em" }}>
                        {msg.subject}
                      </div>

                      {msg.otp ? (
                        <OtpChip code={msg.otp} />
                      ) : (
                        <div style={{ fontSize: 9, color: GA(0.25), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {msg.snippet.substring(0, 55)}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ─ RIGHT: Email preview ───────────────────────────── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            {!selected ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <Mail style={{ width: 36, height: 36, color: GA(0.12) }} />
                <span style={{ fontSize: 10, color: GA(0.2), letterSpacing: "0.2em" }}>SELECT A MESSAGE TO READ</span>
              </div>
            ) : (
              <>
                {/* Preview header */}
                <div style={{ flexShrink: 0, padding: "16px 24px", borderBottom: `1px solid ${GA(0.12)}`, background: BG2 }}>
                  {/* OTP banner */}
                  {selected.otp && (
                    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 18px", borderRadius: 8, marginBottom: 14, background: GA(0.07), border: `1px solid ${GA(0.35)}`, boxShadow: `0 0 20px ${GA(0.08)}` }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: GA(0.15), border: `1px solid ${GA(0.4)}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Shield style={{ width: 18, height: 18, color: G, filter: `drop-shadow(0 0 6px ${G})` }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.25em", color: GA(0.5), marginBottom: 4 }}>VERIFICATION CODE DETECTED</div>
                        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: "0.3em", color: G, textShadow: `0 0 24px ${GA(0.9)}, 0 0 48px ${GA(0.4)}`, fontFamily: "monospace" }}>
                          {selected.otp}
                        </div>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(selected.otp!); showToast("OTP copied!", "ok"); sounds.click(); }}
                        data-testid="button-copy-otp"
                        style={{ padding: "8px 16px", borderRadius: 6, background: GA(0.18), border: `1px solid ${GA(0.5)}`, color: G, fontSize: 11, fontFamily: "monospace", fontWeight: 800, cursor: "pointer", letterSpacing: "0.1em", textShadow: `0 0 8px ${GA(0.6)}` }}>
                        COPY OTP
                      </button>
                    </div>
                  )}

                  <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.9)", marginBottom: 12, lineHeight: 1.3 }}>{selected.subject}</div>

                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "4px 12px", alignItems: "center" }}>
                    {[
                      ["FROM", `${selected.from}${selected.fromEmail && selected.fromEmail !== selected.from ? ` <${selected.fromEmail}>` : ""}`],
                      ["TO", data?.email || ""],
                      ["DATE", fmtTime(selected.date)],
                      ["FOLDER", selected.folderDisplay],
                    ].map(([k, v]) => (
                      <>
                        <span key={k + "k"} style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.2em", color: GA(0.35) }}>{k}</span>
                        <span key={k + "v"} style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                      </>
                    ))}
                  </div>
                </div>

                {/* Email body */}
                <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                  <pre style={{ margin: 0, fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap", lineHeight: 1.7, wordBreak: "break-word" }}>
                    {selected.body || "(empty body)"}
                  </pre>
                </div>
              </>
            )}
          </div>

          {/* ─ RIGHTMOST: Live Log Panel ──────────────────────── */}
          {showLogs && (
            <div style={{ width: 280, flexShrink: 0, background: "#060110", borderLeft: `1px solid ${GA(0.12)}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Log panel header */}
              <div style={{ flexShrink: 0, height: 38, padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${GA(0.1)}`, background: BG2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Terminal style={{ width: 10, height: 10, color: GA(0.5) }} />
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.2em", color: GA(0.45) }}>CONNECTION LOGS</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {statusConn && <Blink color="#ffaa00" />}
                  {statusOk && <Blink color={G} />}
                  <button onClick={() => setAllLogs([])}
                    style={{ fontSize: 8, color: GA(0.25), background: "transparent", border: "none", cursor: "pointer", letterSpacing: "0.1em", fontFamily: "monospace" }}>
                    CLR
                  </button>
                </div>
              </div>

              {/* Logs */}
              <LiveLogPanel logs={allLogs} />

              {/* Footer */}
              <div style={{ flexShrink: 0, padding: "6px 14px", borderTop: `1px solid ${GA(0.08)}`, fontSize: 8, color: GA(0.2), letterSpacing: "0.1em" }}>
                {allLogs.length} ENTRIES · AUTO-SCROLL
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes scanbeam { 0%{top:0%} 100%{top:100%} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:${GA(0.2)}; border-radius:2px; }
        ::-webkit-scrollbar-thumb:hover { background:${GA(0.35)}; }
      `}</style>
    </div>
  );
}

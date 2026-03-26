import { useState, useEffect, useRef, useCallback } from "react";
import { Copy, RefreshCw, Zap, StopCircle, Inbox, Trash2, Send, AlertTriangle, Mail, ChevronRight } from "lucide-react";
import { sounds } from "@/lib/sounds";

const GREEN = "#00ff41";
const RED = "#ff1a1a";
const GA = (a: number) => `rgba(0,255,65,${a})`;
const RA = (a: number) => `rgba(255,26,26,${a})`;
const BG = "#07050a";
const PANEL = "#090610";
const BORDER = GA(0.12);

interface OutlookEmail {
  uid: number;
  folder: string;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  otp: string | null;
  isNew: boolean;
  id: string;
}

interface FolderCount {
  name: string;
  displayName: string;
  count: number;
}

interface MessagesResponse {
  messages: OutlookEmail[];
  folderCounts: FolderCount[];
  newCount: number;
  email: string | null;
  status: string;
  error: string | null;
  lastPollAt: string | null;
  startedAt: string | null;
}

interface OutlookAccount {
  id: string;
  email: string;
  status: string;
}

function ScanLine() {
  return (
    <div className="absolute left-0 right-0 h-[1px] pointer-events-none"
      style={{ background: `linear-gradient(90deg, transparent, ${GA(0.3)}, transparent)`, animation: "scanbeam 4s linear infinite", zIndex: 1 }} />
  );
}

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: GREEN }} />}
      <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: active ? GREEN : "#333", boxShadow: active ? `0 0 6px ${GREEN}` : "none" }} />
    </span>
  );
}

function OtpBadge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCopied(true); sounds.click(); setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <button onClick={copy} data-testid={`otp-badge-${code}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono font-bold text-xs transition-all"
      style={{ background: GA(0.15), border: `1px solid ${GA(0.5)}`, color: GREEN, textShadow: `0 0 8px ${GREEN}`, boxShadow: `0 0 12px ${GA(0.2)}` }}>
      {copied ? "COPIED!" : `OTP: ${code}`}
    </button>
  );
}

function FolderIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n.includes("junk") || n.includes("spam")) return <AlertTriangle className="w-3.5 h-3.5 shrink-0" />;
  if (n.includes("sent")) return <Send className="w-3.5 h-3.5 shrink-0" />;
  if (n.includes("trash") || n.includes("deleted")) return <Trash2 className="w-3.5 h-3.5 shrink-0" />;
  return <Inbox className="w-3.5 h-3.5 shrink-0" />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function formatBody(body: string): string {
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

function highlightOtp(text: string, otp: string | null): string {
  if (!otp) return text;
  return text.replace(new RegExp(`\\b${otp}\\b`, "g"), `【${otp}】`);
}

export default function OutlookWorkspace() {
  const [data, setData] = useState<MessagesResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string>("ALL");
  const [activating, setActivating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [accounts, setAccounts] = useState<OutlookAccount[]>([]);
  const [showAccounts, setShowAccounts] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [scanTick, setScanTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevEmailCountRef = useRef<number>(0);
  const isActiveRef = useRef(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/outlook-workspace/messages");
      if (!res.ok) return;
      const d: MessagesResponse = await res.json();
      setData(d);
      isActiveRef.current = !!d.email;

      if (d.newCount > 0) {
        sounds.notification();
        showToast(`+${d.newCount} new message${d.newCount > 1 ? "s" : ""} received`);
      }

      setScanTick(t => t + 1);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  useEffect(() => {
    fetch("/api/outlook-workspace/accounts")
      .then(r => r.json())
      .then(setAccounts)
      .catch(() => {});
  }, []);

  const activate = async (id?: string) => {
    setActivating(true);
    sounds.generate();
    try {
      const url = id ? `/api/outlook-workspace/activate/${id}` : "/api/outlook-workspace/activate";
      const res = await fetch(url, { method: "POST" });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || "Activation failed"); sounds.error(); return; }
      showToast(`Connected: ${d.email}`);
      sounds.success();
      setShowAccounts(false);
      setSelectedId(null);
      setActiveFolder("ALL");
      await fetchMessages();
    } finally {
      setActivating(false);
    }
  };

  const stop = async () => {
    setStopping(true);
    sounds.toggle();
    try {
      await fetch("/api/outlook-workspace/stop", { method: "POST" });
      setData(null);
      setSelectedId(null);
      showToast("Session terminated");
    } finally {
      setStopping(false);
    }
  };

  const copyEmail = () => {
    if (!data?.email) return;
    navigator.clipboard.writeText(data.email);
    showToast("Email copied to clipboard");
    sounds.click();
  };

  const filteredMessages = (data?.messages || []).filter(m =>
    activeFolder === "ALL" || m.folder === activeFolder ||
    (activeFolder === "Junk Email" && (m.folder === "Junk" || m.folder === "Spam"))
  );

  const selected = filteredMessages.find(m => m.id === selectedId) || null;

  const isActive = !!data?.email;
  const isConnecting = data?.status === "connecting";
  const hasError = data?.status === "error";

  const allFolders = [
    { name: "ALL", displayName: "All Mail", count: data?.messages?.length || 0 },
    ...(data?.folderCounts || []),
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: BG, fontFamily: "monospace" }}>
      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded text-xs font-mono animate-in fade-in"
          style={{ background: "#0a1a0a", border: `1px solid ${GA(0.5)}`, color: GREEN, boxShadow: `0 0 20px ${GA(0.3)}` }}>
          {toastMsg}
        </div>
      )}

      {/* ── HEADER ── */}
      <div className="relative shrink-0 px-5 py-3 flex items-center gap-3 flex-wrap"
        style={{ background: "#060310", borderBottom: `1px solid ${GA(0.15)}`, boxShadow: `0 2px 20px ${GA(0.04)}` }}>
        <ScanLine />
        {/* Title */}
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4" style={{ color: GREEN, filter: `drop-shadow(0 0 6px ${GREEN})` }} />
          <span className="text-xs font-mono font-bold tracking-[0.2em] uppercase"
            style={{ color: GREEN, textShadow: `0 0 12px ${GA(0.6)}` }}>
            MAIL_INTERCEPT
          </span>
          <span className="text-[9px] font-mono opacity-40" style={{ color: GREEN }}>v2.0</span>
        </div>

        <div className="w-px h-4 opacity-30" style={{ background: GREEN }} />

        {/* Active email */}
        {isActive ? (
          <div className="flex items-center gap-2">
            <PulseDot active={!isConnecting && !hasError} />
            <span className="text-xs font-mono font-bold" style={{ color: GREEN, textShadow: `0 0 8px ${GA(0.5)}` }}>
              {data?.email}
            </span>
            {isConnecting && <span className="text-[9px] font-mono opacity-50" style={{ color: GREEN }}>CONNECTING...</span>}
            {hasError && <span className="text-[9px] font-mono" style={{ color: RED }}>ERROR</span>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <PulseDot active={false} />
            <span className="text-[10px] font-mono opacity-40" style={{ color: GREEN }}>NO ACTIVE SESSION</span>
          </div>
        )}

        <div className="flex-1" />

        {/* Scan indicator */}
        {isActive && (
          <div className="flex items-center gap-1.5 text-[9px] font-mono" style={{ color: GA(0.5) }}>
            <RefreshCw className="w-2.5 h-2.5 animate-spin" style={{ animationDuration: "3s" }} />
            SCAN #{scanTick}
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {isActive && (
            <button onClick={copyEmail} data-testid="button-copy-email"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono font-bold transition-all"
              style={{ background: GA(0.08), border: `1px solid ${GA(0.25)}`, color: GA(0.8) }}>
              <Copy className="w-3 h-3" /> COPY
            </button>
          )}

          <div className="relative">
            <button onClick={() => { setShowAccounts(v => !v); sounds.hover(); }}
              data-testid="button-show-accounts"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono font-bold transition-all"
              style={{ background: GA(0.12), border: `1px solid ${GA(0.35)}`, color: GREEN, textShadow: `0 0 8px ${GA(0.5)}` }}>
              <ChevronRight className="w-3 h-3" /> SELECT
            </button>

            {showAccounts && (
              <div className="absolute right-0 top-full mt-1 w-72 rounded z-50 overflow-hidden"
                style={{ background: "#06020e", border: `1px solid ${GA(0.25)}`, boxShadow: `0 8px 32px rgba(0,0,0,0.8)` }}>
                <div className="px-3 py-2 text-[9px] font-mono font-bold tracking-[0.2em]" style={{ color: GA(0.5), borderBottom: `1px solid ${GA(0.1)}` }}>
                  SELECT ACCOUNT
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {accounts.length === 0 && (
                    <div className="px-3 py-3 text-[10px] font-mono opacity-40" style={{ color: GREEN }}>No accounts in database</div>
                  )}
                  {accounts.map(a => (
                    <button key={a.id} onClick={() => activate(a.id)} data-testid={`account-item-${a.id}`}
                      className="w-full text-left px-3 py-2 text-[10px] font-mono transition-all flex items-center justify-between"
                      style={{ color: a.status === "active" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)", borderBottom: `1px solid ${GA(0.05)}` }}>
                      <span className="truncate">{a.email}</span>
                      <span className="shrink-0 ml-2 text-[9px]" style={{ color: a.status === "active" ? GREEN : RED }}>{a.status.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => activate()} disabled={activating} data-testid="button-generate-outlook"
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-[10px] font-mono font-bold transition-all disabled:opacity-50"
            style={{ background: GA(0.18), border: `1px solid ${GA(0.5)}`, color: GREEN, textShadow: `0 0 10px ${GA(0.7)}`, boxShadow: `0 0 16px ${GA(0.15)}` }}>
            <Zap className="w-3 h-3" />
            {activating ? "CONNECTING..." : "GENERATE OUTLOOK"}
          </button>

          {isActive && (
            <button onClick={stop} disabled={stopping} data-testid="button-stop-session"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono font-bold transition-all disabled:opacity-50"
              style={{ background: RA(0.12), border: `1px solid ${RA(0.35)}`, color: RED }}>
              <StopCircle className="w-3 h-3" />
              {stopping ? "STOP..." : "STOP"}
            </button>
          )}
        </div>
      </div>

      {/* ── MAIN BODY ── */}
      {!isActive ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="relative">
            <div className="absolute inset-0 blur-2xl opacity-20" style={{ background: GREEN }} />
            <Mail className="w-16 h-16 relative" style={{ color: GA(0.25) }} />
          </div>
          <div className="text-center space-y-2">
            <p className="text-xs font-mono font-bold tracking-[0.3em] uppercase" style={{ color: GA(0.5) }}>
              MAIL INTERCEPT OFFLINE
            </p>
            <p className="text-[10px] font-mono" style={{ color: GA(0.25) }}>
              Click GENERATE OUTLOOK to activate a session
            </p>
          </div>
          <button onClick={() => activate()} disabled={activating} data-testid="button-generate-outlook-empty"
            className="flex items-center gap-2 px-6 py-2.5 rounded text-xs font-mono font-bold transition-all disabled:opacity-50"
            style={{ background: GA(0.15), border: `1px solid ${GA(0.4)}`, color: GREEN, textShadow: `0 0 10px ${GA(0.6)}`, boxShadow: `0 0 24px ${GA(0.12)}` }}>
            <Zap className="w-4 h-4" />
            {activating ? "CONNECTING..." : "GENERATE OUTLOOK"}
          </button>

          {data?.error && (
            <div className="px-4 py-2 rounded text-[10px] font-mono max-w-md text-center"
              style={{ background: RA(0.08), border: `1px solid ${RA(0.25)}`, color: RED }}>
              ERROR: {data.error}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">

          {/* ── LEFT: FOLDERS ── */}
          <div className="w-44 shrink-0 flex flex-col overflow-hidden"
            style={{ background: "#060210", borderRight: `1px solid ${GA(0.1)}` }}>
            <div className="px-3 pt-3 pb-2">
              <span className="text-[9px] font-mono font-bold tracking-[0.25em] uppercase" style={{ color: GA(0.4) }}>
                // FOLDERS
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {allFolders.map(f => {
                const isSelected = activeFolder === f.name;
                return (
                  <button key={f.name} onClick={() => { setActiveFolder(f.name); setSelectedId(null); sounds.navigate(); }}
                    data-testid={`folder-${f.name}`}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left transition-all"
                    style={{
                      background: isSelected ? GA(0.1) : "transparent",
                      borderLeft: isSelected ? `2px solid ${GREEN}` : "2px solid transparent",
                      color: isSelected ? GREEN : "rgba(255,255,255,0.45)",
                    }}>
                    <FolderIcon name={f.displayName} />
                    <span className="flex-1 text-[10px] font-mono truncate">{f.displayName}</span>
                    {f.count > 0 && (
                      <span className="text-[9px] font-mono tabular-nums shrink-0"
                        style={{ color: isSelected ? GREEN : GA(0.4) }}>
                        {f.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Status info */}
            <div className="px-3 py-3 space-y-1" style={{ borderTop: `1px solid ${GA(0.08)}` }}>
              {data?.lastPollAt && (
                <div className="text-[8px] font-mono" style={{ color: GA(0.3) }}>
                  LAST SCAN: {timeAgo(data.lastPollAt)}
                </div>
              )}
              {data?.error && (
                <div className="text-[8px] font-mono" style={{ color: RED }}>
                  ERR: {data.error.substring(0, 30)}...
                </div>
              )}
            </div>
          </div>

          {/* ── CENTER: EMAIL LIST ── */}
          <div className="w-72 shrink-0 flex flex-col overflow-hidden"
            style={{ borderRight: `1px solid ${GA(0.1)}` }}>
            {/* List header */}
            <div className="px-3 py-2 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${GA(0.1)}`, background: "#060210" }}>
              <span className="text-[9px] font-mono font-bold tracking-[0.2em] uppercase" style={{ color: GA(0.5) }}>
                MESSAGES ({filteredMessages.length})
              </span>
              <RefreshCw className="w-2.5 h-2.5 animate-spin" style={{ color: GA(0.3), animationDuration: "3s" }} />
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2">
                  <span className="text-[9px] font-mono" style={{ color: GA(0.25) }}>NO MESSAGES</span>
                  <span className="text-[8px] font-mono" style={{ color: GA(0.15) }}>Scanning...</span>
                </div>
              ) : (
                filteredMessages.map(msg => {
                  const isSelected = selectedId === msg.id;
                  return (
                    <button key={msg.id} onClick={() => { setSelectedId(msg.id); sounds.click(); }}
                      data-testid={`email-item-${msg.id}`}
                      className="w-full text-left px-3 py-2.5 transition-all"
                      style={{
                        background: isSelected ? GA(0.1) : msg.isNew ? GA(0.04) : "transparent",
                        borderBottom: `1px solid ${GA(0.07)}`,
                        borderLeft: isSelected ? `2px solid ${GREEN}` : msg.isNew ? `2px solid ${GA(0.4)}` : "2px solid transparent",
                      }}>
                      {/* New badge */}
                      {msg.isNew && (
                        <span className="inline-block text-[7px] font-mono font-bold px-1 mb-1 rounded-sm"
                          style={{ background: GA(0.2), color: GREEN, border: `1px solid ${GA(0.4)}` }}>
                          NEW
                        </span>
                      )}
                      {/* From */}
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-[10px] font-mono font-bold truncate"
                          style={{ color: isSelected ? GREEN : msg.isNew ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.6)" }}>
                          {msg.from}
                        </span>
                        <span className="text-[8px] font-mono shrink-0" style={{ color: GA(0.35) }}>
                          {timeAgo(msg.date)}
                        </span>
                      </div>
                      {/* Subject */}
                      <div className="text-[9px] font-mono truncate mb-1"
                        style={{ color: isSelected ? GA(0.9) : "rgba(255,255,255,0.45)" }}>
                        {msg.subject}
                      </div>
                      {/* OTP + snippet */}
                      {msg.otp ? (
                        <OtpBadge code={msg.otp} />
                      ) : (
                        <div className="text-[8px] font-mono truncate" style={{ color: GA(0.25) }}>
                          {msg.snippet.substring(0, 60)}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ── RIGHT: EMAIL PREVIEW ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selected ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Mail className="w-10 h-10" style={{ color: GA(0.15) }} />
                <p className="text-[9px] font-mono tracking-[0.2em] uppercase" style={{ color: GA(0.25) }}>
                  SELECT A MESSAGE
                </p>
              </div>
            ) : (
              <>
                {/* Email header */}
                <div className="shrink-0 px-5 py-4 space-y-2" style={{ borderBottom: `1px solid ${GA(0.12)}`, background: "#060210" }}>
                  {/* OTP highlight */}
                  {selected.otp && (
                    <div className="flex items-center gap-3 px-4 py-2.5 rounded mb-3"
                      style={{ background: GA(0.1), border: `1px solid ${GA(0.4)}`, boxShadow: `0 0 20px ${GA(0.1)}` }}>
                      <Zap className="w-4 h-4 shrink-0" style={{ color: GREEN, filter: `drop-shadow(0 0 4px ${GREEN})` }} />
                      <div className="flex-1">
                        <div className="text-[8px] font-mono uppercase tracking-widest mb-1" style={{ color: GA(0.5) }}>VERIFICATION CODE DETECTED</div>
                        <div className="text-2xl font-mono font-bold tracking-[0.3em]"
                          style={{ color: GREEN, textShadow: `0 0 20px ${GA(0.8)}, 0 0 40px ${GA(0.4)}` }}>
                          {selected.otp}
                        </div>
                      </div>
                      <button onClick={() => { navigator.clipboard.writeText(selected.otp!); showToast("OTP copied!"); sounds.click(); }}
                        data-testid="button-copy-otp"
                        className="px-3 py-1.5 rounded text-[10px] font-mono font-bold transition-all"
                        style={{ background: GA(0.2), border: `1px solid ${GA(0.5)}`, color: GREEN }}>
                        COPY
                      </button>
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono font-bold mb-2" style={{ color: "rgba(255,255,255,0.9)" }}>
                        {selected.subject}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-mono uppercase tracking-widest w-12 shrink-0" style={{ color: GA(0.35) }}>FROM</span>
                          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.65)" }}>
                            {selected.from} {selected.fromEmail && selected.fromEmail !== selected.from && <span style={{ color: GA(0.4) }}>&lt;{selected.fromEmail}&gt;</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-mono uppercase tracking-widest w-12 shrink-0" style={{ color: GA(0.35) }}>TO</span>
                          <span className="text-[10px] font-mono" style={{ color: GREEN }}>{data?.email}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-mono uppercase tracking-widest w-12 shrink-0" style={{ color: GA(0.35) }}>DATE</span>
                          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>
                            {new Date(selected.date).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-mono uppercase tracking-widest w-12 shrink-0" style={{ color: GA(0.35) }}>FOLDER</span>
                          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>{selected.folder}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Email body */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed"
                    style={{ color: "rgba(255,255,255,0.65)", fontFamily: "monospace" }}>
                    {selected.body ? formatBody(highlightOtp(selected.body, selected.otp)) : "(empty body)"}
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

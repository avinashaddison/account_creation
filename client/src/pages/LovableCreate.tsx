import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { Heart, Play, Hash, Layers, ChevronRight, Radio, AtSign, Zap, Tag, Link2, Square } from "lucide-react";

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
const L = "#f59e0b";
const LA = (a: number) => `rgba(245,158,11,${a})`;

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━") || text.startsWith("---") || text.startsWith("─")) return { color: PA(0.25), prefix: "" };
  if (text.startsWith("🚀") || text.startsWith("🏁")) return { color: P, prefix: ">" };
  if (text.includes("✅") || text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("verified") || text.toLowerCase().includes("created") || text.toLowerCase().includes("complete"))
    return { color: "#4ade80", prefix: "+" };
  if (text.includes("❌") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("error"))
    return { color: "#f87171", prefix: "!" };
  if (text.includes("⚠️") || text.toLowerCase().includes("warn"))
    return { color: "#fbbf24", prefix: "~" };
  if (text.includes("⏳") || text.toLowerCase().includes("pending") || text.toLowerCase().includes("polling") || text.toLowerCase().includes("mail.gw"))
    return { color: "rgba(167,139,250,0.85)", prefix: "·" };
  if (text.toLowerCase().includes("magic") || text.toLowerCase().includes("link") || text.toLowerCase().includes("verification") || text.toLowerCase().includes("confirm"))
    return { color: PA(0.85), prefix: "›" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser"))
    return { color: PA(0.6), prefix: ">" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox") || text.toLowerCase().includes("temp"))
    return { color: "rgba(147,197,253,0.75)", prefix: "·" };
  if (text.toLowerCase().includes("checkout") || text.toLowerCase().includes("stripe") || text.toLowerCase().includes("billing") || text.toLowerCase().includes("coupon"))
    return { color: LA(0.8), prefix: "$" };
  return { color: PA(0.4), prefix: "·" };
}

export default function LovableCreate() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<"create" | "links">("create");

  // ── CREATE mode state ──
  const [count, setCount] = useState(1);
  const [referralUrl, setReferralUrl] = useState("");

  // ── BULK LINKS mode state ──
  const [linksCoupon, setLinksCoupon] = useState("");
  const [linksCount, setLinksCount] = useState(4);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // ── Shared ──
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [tick, setTick] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeBatchId = useRef<string | null>(null);

  const { data: lovableAccounts = [] } = useQuery<LovableAccount[]>({
    queryKey: ["/api/lovable-accounts"],
    refetchInterval: running ? 4000 : false,
  });

  const createdCount = lovableAccounts.filter((a) => a.status === "created").length;
  const pendingCount = lovableAccounts.filter((a) => a.status === "pending_verification").length;

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => { const t = setInterval(() => setTick((p) => !p), 600); return () => clearInterval(t); }, []);

  function nowTime() {
    return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function addLog(text: string) {
    setLogs((prev) => [...prev, { text, ts: Date.now(), time: nowTime() }]);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2500);
  }

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let dead = false;

    function connect() {
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
            } else if (data.type === "lovable_create_result") {
              // Use server-authoritative index so dropped messages don't de-sync counter
              if (data.index) setCompletedCount(data.index);
              if (data.total) setTotalCount(data.total);
              if (data.success) {
                sounds.success();
                toast({ title: "✅ Account Created", description: data.email });
              } else if (data.pending) {
                toast({ title: "⏳ Pending Verification", description: data.email });
              } else {
                sounds.error();
                toast({ title: "❌ Creation Failed", description: data.error || "Unknown error", variant: "destructive" });
              }
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!dead) {
          // Auto-reconnect after 2s
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      dead = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  const handleStop = async () => {
    const batchId = activeBatchId.current;
    if (!batchId) return;
    try {
      await apiRequest("POST", `/api/cancel-batch/${batchId}`, {});
      addLog(`🛑 Stop signal sent — waiting for current account to finish...`);
    } catch (err: any) {
      toast({ title: "Stop failed", description: err.message, variant: "destructive" });
    }
  };

  const handleCreate = async () => {
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);
    setTotalCount(count);
    try {
      const res = await apiRequest("POST", "/api/lovable-create/bulk", { count, referralUrl: referralUrl || undefined });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start");
      activeBatchId.current = data.batchId;
      setTotalCount(data.count);
      addLog(`🚀 Starting ${data.count} Lovable account${data.count > 1 ? "s" : ""} via mail.gw [${data.batchId}]`);
    } catch (err: any) {
      sounds.error();
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRunning(false);
    }
  };

  const handleBulkLinks = async () => {
    if (!linksCoupon.trim()) {
      toast({ title: "Missing coupon", description: "Enter a coupon code", variant: "destructive" });
      return;
    }
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);
    setTotalCount(linksCount);
    try {
      const res = await apiRequest("POST", "/api/lovable-bulk-checkout-links", {
        coupon: linksCoupon.trim(),
        count: linksCount,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start");
      activeBatchId.current = data.batchId;
      addLog(`🔗 Bulk checkout link job started [${data.batchId}]`);
      addLog(`🎟️ Coupon: ${linksCoupon.trim()} · Count: ${linksCount}`);
    } catch (err: any) {
      sounds.error();
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRunning(false);
    }
  };

  const maxCount = 1000;
  const pct = maxCount > 1 ? ((count - 1) / (maxCount - 1)) * 100 : 0;
  const accentColor = mode === "links" ? L : P;
  const accentAlpha = mode === "links" ? LA : PA;

  return (
    <div className="space-y-6 animate-float-up">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Heart className="w-5 h-5" style={{ color: P, filter: `drop-shadow(0 0 8px ${PA(0.5)})` }} />
            <h1 className="text-lg font-mono font-bold tracking-tight" style={{ color: P, textShadow: `0 0 24px ${PA(0.4)}` }}>
              lovable<span style={{ color: P }}>{tick ? "_" : "\u00a0"}</span>create
            </h1>
          </div>
          <p className="text-[11px] font-mono mt-0.5 pl-8" style={{ color: PA(0.28) }}>
            automate Lovable.dev account creation &amp; checkout via stored credentials
          </p>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] font-mono">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.18)" }}>
            <Heart className="w-3 h-3" style={{ color: "rgba(74,222,128,0.7)" }} />
            <span style={{ color: "#4ade80", textShadow: "0 0 8px rgba(74,222,128,0.5)" }}>{createdCount}</span>
            <span style={{ color: "rgba(74,222,128,0.35)" }}>avail</span>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.18)" }}>
              <span style={{ color: "rgba(167,139,250,0.9)" }}>{pendingCount}</span>
              <span style={{ color: "rgba(167,139,250,0.35)" }}>pending</span>
            </div>
          )}
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2 flex-wrap">
        {([
          { id: "create" as const, label: "Create Account", icon: Play },
          { id: "links" as const, label: "Bulk Links", icon: Link2 },
        ] as const).map(({ id, label, icon: Icon }) => {
          const isActive = mode === id;
          const color = id === "links" ? L : P;
          const alpha = id === "links" ? LA : PA;
          return (
            <button
              key={id}
              onClick={() => { sounds.keypress(); setMode(id); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-mono uppercase tracking-widest font-bold transition-all duration-200"
              style={{
                background: isActive ? alpha(0.14) : "rgba(0,0,0,0.35)",
                border: `1px solid ${isActive ? alpha(0.45) : "rgba(255,255,255,0.06)"}`,
                color: isActive ? color : "rgba(255,255,255,0.22)",
                boxShadow: isActive ? `0 0 18px ${alpha(0.08)}` : "none",
              }}
              data-testid={`button-mode-${id}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Config panel */}
        <div
          className="rounded-xl p-5 space-y-5 relative overflow-hidden"
          style={{
            background: "rgba(0,0,0,0.55)",
            border: `1px solid ${accentAlpha(0.14)}`,
            boxShadow: `0 0 40px ${accentAlpha(0.04)} inset`,
          }}
        >
          {/* scanline overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${accentAlpha(0.012)} 2px, ${accentAlpha(0.012)} 4px)`, borderRadius: "inherit" }} />

          {/* section label */}
          <div className="flex items-center gap-2">
            <ChevronRight className="w-3.5 h-3.5" style={{ color: accentColor }} />
            <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: accentAlpha(0.5) }}>
              {mode === "links" ? "Bulk Links Configuration" : "Configuration"}
            </span>
            <div className="flex-1 h-px" style={{ background: accentAlpha(0.1) }} />
          </div>

          {/* ══ CREATE MODE ══ */}
          {mode === "create" && (
            <>
              {/* mail.gw info badge */}
              <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)" }}>
                <AtSign className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "rgba(167,139,250,0.6)" }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono" style={{ color: "rgba(167,139,250,0.55)" }}>email provider</p>
                  <p className="text-[11px] font-mono font-semibold" style={{ color: "rgba(167,139,250,0.85)" }}>mail.gw API — auto-generated per account</p>
                </div>
                <Zap className="w-3 h-3 flex-shrink-0" style={{ color: "rgba(167,139,250,0.4)" }} />
              </div>

              {/* Referral URL (optional) */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: PA(0.4) }}>
                  <Link2 className="w-3 h-3" />
                  Referral URL <span style={{ color: PA(0.25) }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={referralUrl}
                  onChange={(e) => setReferralUrl(e.target.value)}
                  placeholder="https://lovable.dev/signup?referral_code=..."
                  className="w-full text-[11px] font-mono rounded-lg px-3 py-2 outline-none transition-all"
                  style={{
                    background: PA(0.04),
                    border: `1px solid ${referralUrl ? PA(0.35) : PA(0.12)}`,
                    color: referralUrl ? P : PA(0.4),
                    boxShadow: referralUrl ? `0 0 8px ${PA(0.08)}` : "none",
                  }}
                  data-testid="input-referral-url"
                />
                {referralUrl && (
                  <p className="text-[9px] font-mono mt-1" style={{ color: PA(0.3) }}>
                    referral active — new accounts get 10 free credits
                  </p>
                )}
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
                      style={{ background: `linear-gradient(to right, ${PA(0.65)} ${pct}%, rgba(255,255,255,0.07) ${pct}%)`, accentColor: P }}
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
                {count > 1 && (
                  <p className="text-[10px] font-mono mt-2 flex items-center gap-1.5" style={{ color: PA(0.32) }}>
                    <Layers className="w-3 h-3" />
                    bulk mode — {count} accounts, each gets a unique mail.gw address
                  </p>
                )}
              </div>

              {/* Create / STOP buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={running}
                  className="relative flex-1 flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200 overflow-hidden"
                  style={{
                    background: running ? PA(0.04) : `linear-gradient(135deg, ${PA(0.25)}, ${PA(0.1)})`,
                    border: `1px solid ${running ? PA(0.08) : PA(0.5)}`,
                    color: running ? PA(0.25) : P,
                    textShadow: running ? "none" : `0 0 14px ${P}`,
                    boxShadow: running ? "none" : `0 0 25px ${PA(0.1)}, inset 0 1px 0 ${PA(0.12)}`,
                    cursor: running ? "not-allowed" : "pointer",
                  }}
                  data-testid="button-create-lovable"
                >
                  {!running && <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${PA(0.025)} 2px, ${PA(0.025)} 4px)` }} />}
                  <Play className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
                  <span className="relative z-10">
                    {running
                      ? totalCount > 1 ? `creating ${completedCount}/${totalCount}...` : "creating account..."
                      : count > 1 ? `bulk_create ${count} accounts` : "create_lovable_account"}
                  </span>
                </button>
                {running && (
                  <button
                    onClick={handleStop}
                    className="flex items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200"
                    style={{
                      background: "rgba(239,68,68,0.12)",
                      border: "1px solid rgba(239,68,68,0.45)",
                      color: "#f87171",
                      textShadow: "0 0 10px rgba(239,68,68,0.6)",
                    }}
                    data-testid="button-stop-lovable"
                  >
                    <Square className="w-3.5 h-3.5" />
                    STOP
                  </button>
                )}
              </div>

              {/* Progress bar */}
              {running && totalCount > 1 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: PA(0.38) }}>
                    <span>progress</span>
                    <span style={{ color: P, textShadow: `0 0 8px ${PA(0.5)}` }}>{completedCount}/{totalCount}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(completedCount / totalCount) * 100}%`, background: `linear-gradient(90deg, ${P}, rgba(244,114,182,0.7))`, boxShadow: `0 0 10px ${PA(0.7)}` }} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══ BULK LINKS MODE ══ */}
          {mode === "links" && (
            <>
              {/* Coupon Code */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: LA(0.5) }}>
                  <Tag className="w-2.5 h-2.5 inline mr-1" />Coupon Code
                </label>
                <input
                  value={linksCoupon}
                  onChange={(e) => { sounds.keypress(); setLinksCoupon(e.target.value); }}
                  placeholder="Enter coupon code..."
                  className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none"
                  style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${linksCoupon ? LA(0.45) : LA(0.15)}`, color: LA(0.9) }}
                  data-testid="input-links-coupon"
                />
              </div>

              {/* Number of Links */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: LA(0.5) }}>
                  <Layers className="w-2.5 h-2.5 inline mr-1" />Number of Links
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => { sounds.keypress(); setLinksCount(n); }}
                      className="flex-1 rounded-lg py-2 text-xs font-mono font-bold transition-all"
                      style={{
                        background: linksCount === n ? LA(0.15) : "rgba(0,0,0,0.4)",
                        border: `1px solid ${linksCount === n ? LA(0.55) : LA(0.1)}`,
                        color: linksCount === n ? L : LA(0.35),
                      }}
                      data-testid={`button-links-count-${n}`}
                    >{n}</button>
                  ))}
                </div>
              </div>

              {/* Info box */}
              <div className="rounded-lg p-3 space-y-1" style={{ background: LA(0.04), border: `1px solid ${LA(0.12)}` }}>
                <p className="text-[9px] font-mono" style={{ color: LA(0.45) }}>
                  Picks {linksCount} "Account Created" account(s) → logs into Lovable → opens billing page → clicks $25 Upgrade → captures Stripe checkout URL with coupon
                </p>
                <p className="text-[9px] font-mono" style={{ color: LA(0.3) }}>
                  Requires accounts with status: <span style={{ color: "#22c55e" }}>Account Created</span> + stored password
                </p>
              </div>

              {/* Generate button */}
              <button
                onClick={handleBulkLinks}
                disabled={running || !linksCoupon.trim()}
                className="relative w-full flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200"
                style={{
                  background: running || !linksCoupon.trim() ? LA(0.03) : `linear-gradient(135deg, ${LA(0.18)}, ${LA(0.07)})`,
                  border: `1px solid ${running || !linksCoupon.trim() ? LA(0.08) : LA(0.55)}`,
                  color: running || !linksCoupon.trim() ? LA(0.2) : L,
                  textShadow: running || !linksCoupon.trim() ? "none" : `0 0 14px ${L}`,
                  boxShadow: running || !linksCoupon.trim() ? "none" : `0 0 25px ${LA(0.08)}`,
                  cursor: running || !linksCoupon.trim() ? "not-allowed" : "pointer",
                }}
                data-testid="button-generate-links"
              >
                <Link2 className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
                <span className="relative z-10">
                  {running ? `generating ${linksCount} link(s)...` : "generate_checkout_links"}
                </span>
              </button>
            </>
          )}
        </div>

        {/* Terminal panel */}
        <div className="min-w-0">
          <div
            className="rounded-xl overflow-hidden flex flex-col"
            style={{ background: "rgba(0,0,0,0.75)", border: `1px solid ${accentAlpha(0.12)}`, boxShadow: `0 0 40px ${accentAlpha(0.03)}` }}
          >
            {/* Terminal title bar */}
            <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ background: accentAlpha(0.03), borderBottom: `1px solid ${accentAlpha(0.08)}` }}>
              <div className="flex items-center gap-2.5">
                <Radio className="w-3 h-3" style={{ color: running ? accentColor : accentAlpha(0.28), filter: running ? `drop-shadow(0 0 5px ${accentColor})` : "none" }} />
                <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: accentAlpha(0.45) }}>live_output</span>
                {running && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accentColor, boxShadow: `0 0 6px ${accentColor}` }} />
                    <span className="text-[9px] font-mono font-bold" style={{ color: accentAlpha(0.65) }}>RUNNING</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,59,48,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,149,0,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: accentAlpha(0.55) }} />
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
                    <p className="text-[11px] font-mono" style={{ color: accentAlpha(0.22) }}>{">"}_</p>
                    <p className="text-[10px] font-mono" style={{ color: accentAlpha(0.16) }}>waiting for output...</p>
                  </div>
                </div>
              ) : (
                logs.map((line, i) => {
                  // Special rendering for checkout URLs
                  if (line.text.startsWith("CHECKOUT_URL|")) {
                    const parts = line.text.split("|");
                    const email = parts[1] || "";
                    const url = parts.slice(2).join("|");
                    const isCopied = copiedUrl === url;
                    return (
                      <div key={i} className="flex flex-col gap-1 my-2 rounded-lg p-2.5" style={{ background: LA(0.06), border: `1px solid ${LA(0.25)}` }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono" style={{ color: LA(0.7) }}>🔗 {email}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono font-bold transition-all"
                              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.4)", color: "rgba(147,197,253,0.9)" }}
                              data-testid={`link-open-url-${i}`}
                            >
                              open link
                            </a>
                            <button
                              onClick={() => {
                                const blob = new Blob([`${email}\n${url}`], { type: "text/plain" });
                                const a = document.createElement("a");
                                a.href = URL.createObjectURL(blob);
                                a.download = `checkout_${email.split("@")[0]}.txt`;
                                a.click();
                                URL.revokeObjectURL(a.href);
                              }}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono font-bold transition-all"
                              style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", color: "rgba(134,239,172,0.85)" }}
                              data-testid={`button-download-url-${i}`}
                            >
                              download
                            </button>
                            <button
                              onClick={() => copyToClipboard(url)}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-mono font-bold transition-all"
                              style={{ background: isCopied ? LA(0.25) : LA(0.1), border: `1px solid ${LA(0.4)}`, color: isCopied ? L : LA(0.7) }}
                              data-testid={`button-copy-url-${i}`}
                            >
                              {isCopied ? "✓ copied!" : "copy link"}
                            </button>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono break-all" style={{ color: LA(0.5) }}>{url.substring(0, 80)}...</span>
                      </div>
                    );
                  }

                  const { color, prefix } = getLogStyle(line.text);
                  const isSeparator = line.text.startsWith("━━━") || line.text.startsWith("---") || line.text.startsWith("─");
                  return (
                    <div key={i} className={`flex items-start gap-2 min-w-0 ${isSeparator ? "mt-2 mb-1 opacity-30" : "py-px"}`}>
                      <span className="text-[9px] flex-shrink-0 mt-0.5 tabular-nums" style={{ color: accentAlpha(0.22) }}>{line.time}</span>
                      <span className="text-[10px] flex-shrink-0 mt-0.5 w-3 text-center font-bold" style={{ color }}>{prefix}</span>
                      <span className="text-[11px] leading-relaxed break-words min-w-0 overflow-hidden" style={{ color, textShadow: color === accentColor ? `0 0 8px ${accentAlpha(0.4)}` : "none" }}>
                        {line.text}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Terminal footer */}
            <div className="px-4 py-2 flex items-center gap-2" style={{ background: accentAlpha(0.02), borderTop: `1px solid ${accentAlpha(0.07)}` }}>
              <span className="text-[9px] font-mono" style={{ color: accentAlpha(0.25) }}>addison@panel:~$</span>
              <span className="text-[9px] font-mono" style={{ color: accentAlpha(0.4) }}>
                {running ? (mode === "links" ? "generating checkout links..." : "executing lovable_create...") : "ready"}
              </span>
              <span
                className="w-1.5 h-3 ml-px"
                style={{ background: tick && !running ? accentColor : "transparent", boxShadow: tick && !running ? `0 0 6px ${accentColor}` : "none" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

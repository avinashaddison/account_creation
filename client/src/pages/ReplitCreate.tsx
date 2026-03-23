import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { Code2, Play, Mail, Key, Hash, Layers, ChevronRight, Cpu, Radio, Tag, ExternalLink, CreditCard, ShoppingCart, User, Link2, Save } from "lucide-react";

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

const G = "#00ff41";
const GA = (a: number) => `rgba(0,255,65,${a})`;
const B = "rgba(100,210,255,1)";
const BA = (a: number) => `rgba(100,210,255,${a})`;
const P = "rgba(190,120,255,1)";
const PA = (a: number) => `rgba(190,120,255,${a})`;

function getLogStyle(text: string): { color: string; prefix: string } {
  if (text.startsWith("━━━") || text.startsWith("---")) return { color: GA(0.25), prefix: "" };
  if (text.startsWith("🚀") || text.startsWith("🏁")) return { color: G, prefix: ">" };
  if (text.includes("✅") || text.toLowerCase().includes("success") || text.toLowerCase().includes("saved") || text.toLowerCase().includes("verified") || text.toLowerCase().includes("created") || text.toLowerCase().includes("complete"))
    return { color: G, prefix: "+" };
  if (text.includes("❌") || text.toLowerCase().includes("failed") || text.toLowerCase().includes("error"))
    return { color: "#ff4141", prefix: "!" };
  if (text.includes("⚠️") || text.toLowerCase().includes("warn"))
    return { color: "#ffaa00", prefix: "~" };
  if (text.toLowerCase().includes("navigat") || text.toLowerCase().includes("launch") || text.toLowerCase().includes("browser"))
    return { color: GA(0.7), prefix: ">" };
  if (text.toLowerCase().includes("username") || text.toLowerCase().includes("password") || text.toLowerCase().includes("generated"))
    return { color: GA(0.9), prefix: "»" };
  if (text.toLowerCase().includes("email") || text.toLowerCase().includes("inbox") || text.toLowerCase().includes("outlook") || text.toLowerCase().includes("owa"))
    return { color: "rgba(0,200,255,0.7)", prefix: "·" };
  if (text.toLowerCase().includes("captcha") || text.toLowerCase().includes("hcap") || text.toLowerCase().includes("token"))
    return { color: "rgba(255,200,50,0.8)", prefix: "~" };
  if (text.toLowerCase().includes("card") || text.toLowerCase().includes("stripe") || text.toLowerCase().includes("checkout") || text.toLowerCase().includes("otp"))
    return { color: BA(0.8), prefix: "$" };
  return { color: GA(0.45), prefix: "·" };
}

export default function ReplitCreate() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"create" | "checkout" | "onboarding">("create");

  // ── ONBOARDING mode state ──
  const [onbEmail, setOnbEmail] = useState("");
  const [onbPassword, setOnbPassword] = useState("");
  const [onbCoupon, setOnbCoupon] = useState("AGENT4BC4974559665");
  const [onbUsername, setOnbUsername] = useState("");
  const [onbFullname, setOnbFullname] = useState("");

  // ── CREATE mode state ──
  const [outlookEmail, setOutlookEmail] = useState("");
  const [outlookPassword, setOutlookPassword] = useState("");
  const [selectedOutlookId, setSelectedOutlookId] = useState("");
  const [count, setCount] = useState(1);
  const [couponCode, setCouponCode] = useState("");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  // ── CHECKOUT mode state ──
  const [selectedReplitId, setSelectedReplitId] = useState("");
  const [promoUrl, setPromoUrl] = useState("https://replit.com/stripe-checkout-by-price/core_1mo_20usd_monthly_feb_26?coupon=");
  const [checkoutCardId, setCheckoutCardId] = useState("");
  const [nopeKey, setNopeKey] = useState("");
  const [nopeKeyDirty, setNopeKeyDirty] = useState(false);
  const [nopeKeySaving, setNopeKeySaving] = useState(false);

  // ── Shared ──
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [tick, setTick] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeBatchId = useRef<string | null>(null);

  // ── Live screenshot viewer ──
  const [screenshot, setScreenshot] = useState<{ data: string | null; label: string; ts: number }>({ data: null, label: "", ts: 0 });
  useEffect(() => {
    if (!running) return;
    const poll = async () => {
      try {
        const res = await fetch("/api/screenshot/latest", { credentials: "include" });
        if (res.ok) { const d = await res.json(); setScreenshot(d); }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [running]);

  const { data: savedCards = [] } = useQuery<{ id: string; label: string; cardNumber: string; cardType: string }[]>({
    queryKey: ["/api/my-cards"],
  });
  const { data: outlookAccounts = [] } = useQuery<OutlookAccount[]>({
    queryKey: ["/api/private/outlook"],
  });
  const { data: replitAccounts = [] } = useQuery<ReplitAccount[]>({
    queryKey: ["/api/replit-accounts"],
    refetchInterval: running ? 4000 : false,
  });
  const { data: nopeKeyData } = useQuery<{ key: string }>({
    queryKey: ["/api/settings/nopecha-api-key"],
  });

  useEffect(() => {
    if (nopeKeyData?.key && !nopeKeyDirty) setNopeKey(nopeKeyData.key);
  }, [nopeKeyData]);

  const usedEmails = new Set(replitAccounts.map((a) => a.outlookEmail?.toLowerCase()).filter(Boolean));
  const availableOutlookAccounts = outlookAccounts.filter((a) => !usedEmails.has(a.email.toLowerCase()));

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  useEffect(() => { const t = setInterval(() => setTick((p) => !p), 600); return () => clearInterval(t); }, []);

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
            sounds.complete();
            qc.invalidateQueries({ queryKey: ["/api/replit-accounts"] });
            qc.invalidateQueries({ queryKey: ["/api/private/outlook"] });
          } else if (data.type === "replit_create_result") {
            if (data.success) {
              setCompletedCount((p) => p + 1);
              sounds.success();
              if (data.checkoutUrl) setCheckoutUrl(data.checkoutUrl);
              if (data.checkoutComplete) {
                toast({ title: "✅ Checkout Complete!", description: "Payment processed successfully" });
              } else if (data.username) {
                toast({ title: "✅ Account Created", description: `@${data.username}` });
              } else {
                toast({ title: "✅ Checkout Done", description: "Finished" });
              }
            } else {
              sounds.error();
              toast({ title: "❌ Failed", description: data.error || "Unknown error", variant: "destructive" });
            }
          }
        }
      } catch {}
    };

    return () => ws.close();
  }, []);

  const handleOutlookSelect = (id: string) => {
    sounds.click();
    setSelectedOutlookId(id);
    const acct = availableOutlookAccounts.find((a) => a.id === id);
    if (acct) { setOutlookEmail(acct.email); setOutlookPassword(acct.password); }
  };

  const handleCreate = async () => {
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);
    setCheckoutUrl(null);

    if (count > 1) {
      setTotalCount(count);
      try {
        const res = await apiRequest("POST", "/api/replit-create/bulk", { count, couponCode: couponCode.trim() || undefined, cardId: selectedCardId || undefined });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to start bulk");
        activeBatchId.current = data.batchId;
        setTotalCount(data.count);
        addLog(`🚀 Bulk job started — ${data.count} account(s) queued [${data.batchId}]`);
        if (couponCode.trim()) addLog(`🎟️ Coupon "${couponCode.trim()}" will be applied after each creation`);
      } catch (err: any) {
        sounds.error();
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setRunning(false);
      }
    } else {
      if (!outlookEmail || !outlookPassword) {
        sounds.error();
        toast({ title: "Missing fields", description: "Select or enter an Outlook account", variant: "destructive" });
        setRunning(false);
        return;
      }
      setTotalCount(1);
      try {
        const res = await apiRequest("POST", "/api/replit-create", { outlookEmail, outlookPassword, couponCode: couponCode.trim() || undefined, cardId: selectedCardId || undefined });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Failed to start");
        activeBatchId.current = data.batchId;
        addLog(`Job started: ${data.batchId}`);
        if (couponCode.trim()) addLog(`🎟️ Coupon "${couponCode.trim()}" will be applied after creation`);
      } catch (err: any) {
        sounds.error();
        toast({ title: "Error", description: err.message, variant: "destructive" });
        setRunning(false);
      }
    }
  };

  const handleCheckout = async () => {
    if (!selectedReplitId) {
      toast({ title: "Missing account", description: "Select a Replit account", variant: "destructive" });
      return;
    }
    if (!promoUrl.trim() || !promoUrl.includes("replit.com")) {
      toast({ title: "Invalid URL", description: "Paste the full Replit checkout URL", variant: "destructive" });
      return;
    }
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);
    setTotalCount(1);

    try {
      const res = await apiRequest("POST", "/api/replit-checkout", {
        replitAccountId: selectedReplitId,
        checkoutUrl: promoUrl.trim(),
        cardId: checkoutCardId || undefined,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start checkout");
      activeBatchId.current = data.batchId;
      addLog(`🎟️ Checkout job started [${data.batchId}]`);
    } catch (err: any) {
      sounds.error();
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRunning(false);
    }
  };

  const handleOnboarding = async () => {
    if (!onbEmail || !onbPassword) {
      toast({ title: "Missing fields", description: "Email and password are required", variant: "destructive" });
      return;
    }
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);
    setTotalCount(1);
    try {
      const res = await apiRequest("POST", "/api/replit-onboarding-checkout", {
        email: onbEmail.trim(),
        password: onbPassword,
        couponCode: onbCoupon.trim() || "AGENT4BC4974559665",
        username: onbUsername.trim() || undefined,
        fullname: onbFullname.trim() || undefined,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start");
      activeBatchId.current = data.batchId;
      addLog(`🚀 Onboarding job started [${data.batchId}]`);
      addLog(`🎟️ Coupon: ${onbCoupon.trim() || "AGENT4BC4974559665"}`);
    } catch (err: any) {
      sounds.error();
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRunning(false);
    }
  };

  const saveNopeKey = async () => {
    setNopeKeySaving(true);
    try {
      await apiRequest("PUT", "/api/admin/nopecha-api-key", { key: nopeKey.trim() });
      setNopeKeyDirty(false);
      qc.invalidateQueries({ queryKey: ["/api/settings/nopecha-api-key"] });
      toast({ title: "✅ NopeCHA key saved" });
    } catch (err: any) {
      toast({ title: "Error saving key", description: err.message, variant: "destructive" });
    } finally {
      setNopeKeySaving(false);
    }
  };

  const isBulk = count > 1;
  const canCreate = isBulk ? availableOutlookAccounts.length > 0 : (!!outlookEmail && !!outlookPassword);
  const maxCount = Math.min(1000, availableOutlookAccounts.length || 1);
  const pct = maxCount > 1 ? ((count - 1) / (maxCount - 1)) * 100 : 100;
  const selectedReplitAccount = replitAccounts.find((a) => a.id === selectedReplitId);

  // Extract coupon from promo URL for display
  let urlCoupon = "";
  try { urlCoupon = new URL(promoUrl).searchParams.get("coupon") || ""; } catch {}

  return (
    <div className="space-y-6 animate-float-up">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Code2 className="w-5 h-5" style={{ color: G, filter: `drop-shadow(0 0 8px ${G})` }} />
            <h1 className="text-lg font-mono font-bold tracking-tight" style={{ color: G, textShadow: `0 0 24px ${GA(0.55)}` }}>
              replit_create<span style={{ color: G }}>{tick ? "_" : "\u00a0"}</span>
            </h1>
          </div>
          <p className="text-[11px] font-mono mt-0.5 pl-8" style={{ color: GA(0.32) }}>
            automate account creation & checkout via stored credentials
          </p>
        </div>
        <div className="flex items-center gap-2.5 text-[10px] font-mono">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: GA(0.05), border: `1px solid ${GA(0.18)}` }}>
            <Cpu className="w-3 h-3" style={{ color: GA(0.55) }} />
            <span style={{ color: G, textShadow: `0 0 8px ${GA(0.5)}` }}>{availableOutlookAccounts.length}</span>
            <span style={{ color: GA(0.3) }}>avail</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ color: "rgba(255,255,255,0.3)" }}>{usedEmails.size}</span>
            <span style={{ color: "rgba(255,255,255,0.14)" }}>used</span>
          </div>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => { sounds.toggle(); setMode("create"); setLogs([]); setRunning(false); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-widest uppercase transition-all"
          style={{
            background: mode === "create" ? GA(0.12) : "rgba(0,0,0,0.3)",
            border: `1px solid ${mode === "create" ? GA(0.5) : GA(0.1)}`,
            color: mode === "create" ? G : GA(0.3),
            textShadow: mode === "create" ? `0 0 10px ${G}` : "none",
            boxShadow: mode === "create" ? `0 0 16px ${GA(0.08)}` : "none",
          }}
          data-testid="button-mode-create"
        >
          <Play className="w-3.5 h-3.5" />
          Create Account
        </button>
        <button
          onClick={() => { sounds.toggle(); setMode("checkout"); setLogs([]); setRunning(false); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-widest uppercase transition-all"
          style={{
            background: mode === "checkout" ? BA(0.1) : "rgba(0,0,0,0.3)",
            border: `1px solid ${mode === "checkout" ? BA(0.5) : BA(0.08)}`,
            color: mode === "checkout" ? B : BA(0.3),
            textShadow: mode === "checkout" ? `0 0 10px ${B}` : "none",
            boxShadow: mode === "checkout" ? `0 0 16px ${BA(0.06)}` : "none",
          }}
          data-testid="button-mode-checkout"
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          Checkout Existing
        </button>
        <button
          onClick={() => { sounds.toggle(); setMode("onboarding"); setLogs([]); setRunning(false); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-widest uppercase transition-all"
          style={{
            background: mode === "onboarding" ? PA(0.1) : "rgba(0,0,0,0.3)",
            border: `1px solid ${mode === "onboarding" ? PA(0.5) : PA(0.08)}`,
            color: mode === "onboarding" ? P : PA(0.3),
            textShadow: mode === "onboarding" ? `0 0 10px ${P}` : "none",
            boxShadow: mode === "onboarding" ? `0 0 16px ${PA(0.06)}` : "none",
          }}
          data-testid="button-mode-onboarding"
        >
          <User className="w-3.5 h-3.5" />
          Onboarding + Core
        </button>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Config Panel */}
        <div
          className="rounded-xl p-5 space-y-5 relative overflow-hidden"
          style={{
            background: "rgba(0,0,0,0.55)",
            border: `1px solid ${mode === "checkout" ? BA(0.2) : mode === "onboarding" ? PA(0.2) : GA(0.14)}`,
            boxShadow: `0 0 40px ${mode === "checkout" ? BA(0.03) : mode === "onboarding" ? PA(0.03) : GA(0.04)} inset`,
          }}
        >
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.012) 2px, rgba(0,255,65,0.012) 4px)", borderRadius: "inherit" }} />

          <div className="flex items-center gap-2">
            <ChevronRight className="w-3.5 h-3.5" style={{ color: mode === "checkout" ? B : mode === "onboarding" ? P : G }} />
            <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: mode === "checkout" ? BA(0.55) : mode === "onboarding" ? PA(0.55) : GA(0.55) }}>
              {mode === "checkout" ? "Checkout Configuration" : mode === "onboarding" ? "Onboarding + Core Configuration" : "Configuration"}
            </span>
            <div className="flex-1 h-px" style={{ background: mode === "checkout" ? BA(0.1) : mode === "onboarding" ? PA(0.1) : GA(0.1) }} />
          </div>

          {/* ══ CREATE MODE ══ */}
          {mode === "create" && (
            <>
              {/* Count slider */}
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest mb-2.5" style={{ color: GA(0.4) }}>
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
                      style={{ background: `linear-gradient(to right, ${GA(0.7)} ${pct}%, rgba(255,255,255,0.07) ${pct}%)`, accentColor: G }}
                      data-testid="input-count-slider"
                    />
                  </div>
                  <div className="w-11 h-8 rounded-lg flex items-center justify-center text-base font-mono font-bold flex-shrink-0" style={{ background: GA(0.08), border: `1px solid ${GA(0.35)}`, color: G, textShadow: `0 0 10px ${G}`, boxShadow: `0 0 12px ${GA(0.1)} inset` }}>
                    {count}
                  </div>
                </div>
                {isBulk && (
                  <p className="text-[10px] font-mono mt-2 flex items-center gap-1.5" style={{ color: GA(0.32) }}>
                    <Layers className="w-3 h-3" />
                    bulk mode — picks {count} random from {availableOutlookAccounts.length} pool
                  </p>
                )}
              </div>

              {!isBulk && (
                <>
                  {availableOutlookAccounts.length > 0 && (
                    <div>
                      <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: GA(0.4) }}>Stored Outlook Account</label>
                      <select value={selectedOutlookId} onChange={(e) => handleOutlookSelect(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${GA(0.18)}`, color: "rgba(255,255,255,0.75)" }} data-testid="select-outlook-account">
                        <option value="">— Select account —</option>
                        {availableOutlookAccounts.map((a) => (<option key={a.id} value={a.id}>{a.email}</option>))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: GA(0.4) }}>
                      <Mail className="w-2.5 h-2.5 inline mr-1" />Outlook Email
                    </label>
                    <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${GA(0.14)}` }}>
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: GA(0.38) }} />
                      <input type="email" value={outlookEmail} onChange={(e) => setOutlookEmail(e.target.value)} onKeyDown={() => sounds.keypress()} placeholder="yourname@outlook.com" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: "rgba(255,255,255,0.8)", caretColor: G }} data-testid="input-outlook-email" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: GA(0.4) }}>
                      <Key className="w-2.5 h-2.5 inline mr-1" />Outlook Password
                    </label>
                    <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${GA(0.14)}` }}>
                      <Key className="w-3.5 h-3.5 flex-shrink-0" style={{ color: GA(0.38) }} />
                      <input type="password" value={outlookPassword} onChange={(e) => setOutlookPassword(e.target.value)} onKeyDown={() => sounds.keypress()} placeholder="••••••••" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: "rgba(255,255,255,0.8)", caretColor: G }} data-testid="input-outlook-password" />
                    </div>
                  </div>
                </>
              )}

              {/* Coupon Code */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: GA(0.4) }}>
                  <Tag className="w-2.5 h-2.5 inline mr-1" />Coupon Code <span style={{ color: GA(0.22) }}>(optional)</span>
                </label>
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${couponCode.trim() ? GA(0.4) : GA(0.14)}` }}>
                  <Tag className="w-3.5 h-3.5 flex-shrink-0" style={{ color: couponCode.trim() ? G : GA(0.3) }} />
                  <input type="text" value={couponCode} onChange={(e) => { sounds.keypress(); setCouponCode(e.target.value.toUpperCase()); }} placeholder="PROMO2025 (leave blank to skip)" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: couponCode.trim() ? G : "rgba(255,255,255,0.5)", caretColor: G, letterSpacing: couponCode ? "0.12em" : undefined }} data-testid="input-coupon-code" />
                  {couponCode.trim() && (<span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: GA(0.1), border: `1px solid ${GA(0.28)}`, color: G }}>WILL APPLY</span>)}
                </div>
              </div>

              {/* Card */}
              {savedCards.length > 0 && (
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: BA(0.4) }}>
                    <CreditCard className="w-2.5 h-2.5 inline mr-1" />Payment Card <span style={{ color: BA(0.2) }}>(optional)</span>
                  </label>
                  <select value={selectedCardId} onChange={(e) => { sounds.keypress(); setSelectedCardId(e.target.value); }} className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${selectedCardId ? BA(0.4) : BA(0.14)}`, color: selectedCardId ? BA(0.9) : "rgba(255,255,255,0.35)" }} data-testid="select-checkout-card">
                    <option value="">— Skip auto checkout —</option>
                    {savedCards.map((c) => (<option key={c.id} value={c.id}>{c.label} (•••• {c.cardNumber.replace(/\D/g, "").slice(-4)})</option>))}
                  </select>
                </div>
              )}

              {/* Checkout URL result */}
              {checkoutUrl && (
                <div className="rounded-lg p-3 space-y-1.5" style={{ background: GA(0.04), border: `1px solid ${GA(0.25)}` }}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: G, boxShadow: `0 0 6px ${G}` }} />
                    <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: GA(0.55) }}>Checkout URL (coupon applied)</span>
                  </div>
                  <a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1.5" onClick={() => sounds.click()}>
                    <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: GA(0.45) }} />
                    <span className="text-[9px] font-mono break-all" style={{ color: G }}>{checkoutUrl.length > 120 ? checkoutUrl.substring(0, 120) + "..." : checkoutUrl}</span>
                  </a>
                  <button onClick={() => { navigator.clipboard.writeText(checkoutUrl); sounds.click(); toast({ title: "Copied!" }); }} className="text-[8px] font-mono px-2 py-0.5 rounded" style={{ background: GA(0.08), border: `1px solid ${GA(0.22)}`, color: GA(0.6) }} data-testid="button-copy-checkout-url">copy url</button>
                </div>
              )}

              {/* Create button */}
              <button
                onClick={handleCreate}
                disabled={running || !canCreate}
                className="relative w-full flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200 overflow-hidden"
                style={{
                  background: running || !canCreate ? GA(0.04) : `linear-gradient(135deg, ${GA(0.2)}, ${GA(0.08)})`,
                  border: `1px solid ${running || !canCreate ? GA(0.08) : GA(0.5)}`,
                  color: running || !canCreate ? GA(0.25) : G,
                  textShadow: running || !canCreate ? "none" : `0 0 14px ${G}`,
                  cursor: running || !canCreate ? "not-allowed" : "pointer",
                }}
                data-testid="button-create-replit"
              >
                {!(running || !canCreate) && (<div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.025) 2px, rgba(0,255,65,0.025) 4px)" }} />)}
                <Play className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
                <span className="relative z-10">
                  {running ? (totalCount > 1 ? `creating ${completedCount}/${totalCount}...` : "creating account...") : isBulk ? `bulk_create ${count} account${count > 1 ? "s" : ""}` : "create_replit_account"}
                </span>
              </button>

              {running && totalCount > 1 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-mono" style={{ color: GA(0.38) }}>
                    <span>progress</span>
                    <span style={{ color: G }}>{completedCount}/{totalCount}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${(completedCount / totalCount) * 100}%`, background: `linear-gradient(90deg, ${G}, rgba(0,200,50,0.7))`, boxShadow: `0 0 10px ${GA(0.7)}` }} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══ ONBOARDING MODE ══ */}
          {mode === "onboarding" && (
            <>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.5) }}>
                  <Mail className="w-2.5 h-2.5 inline mr-1" />Replit Email
                </label>
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${onbEmail ? PA(0.45) : PA(0.15)}` }}>
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: onbEmail ? P : PA(0.3) }} />
                  <input type="email" value={onbEmail} onChange={(e) => { sounds.keypress(); setOnbEmail(e.target.value); }} placeholder="you@outlook.com" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: onbEmail ? P : "rgba(255,255,255,0.5)", caretColor: P }} data-testid="input-onb-email" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.5) }}>
                  <Key className="w-2.5 h-2.5 inline mr-1" />Replit Password
                </label>
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${onbPassword ? PA(0.45) : PA(0.15)}` }}>
                  <Key className="w-3.5 h-3.5 flex-shrink-0" style={{ color: onbPassword ? P : PA(0.3) }} />
                  <input type="password" value={onbPassword} onChange={(e) => { sounds.keypress(); setOnbPassword(e.target.value); }} placeholder="••••••••" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: "rgba(255,255,255,0.8)", caretColor: P }} data-testid="input-onb-password" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.5) }}>
                  <Tag className="w-2.5 h-2.5 inline mr-1" />Promo Code
                </label>
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${onbCoupon.trim() ? PA(0.45) : PA(0.15)}` }}>
                  <Tag className="w-3.5 h-3.5 flex-shrink-0" style={{ color: onbCoupon.trim() ? P : PA(0.3) }} />
                  <input type="text" value={onbCoupon} onChange={(e) => { sounds.keypress(); setOnbCoupon(e.target.value.toUpperCase()); }} placeholder="AGENT4BC4974559665" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: onbCoupon.trim() ? P : "rgba(255,255,255,0.5)", caretColor: P, letterSpacing: "0.1em" }} data-testid="input-onb-coupon" />
                </div>
                <p className="text-[9px] font-mono mt-1" style={{ color: PA(0.3) }}>Applied on Stripe checkout — leave blank to use default</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.35) }}>
                    <User className="w-2.5 h-2.5 inline mr-1" />Username <span style={{ color: PA(0.2) }}>(opt)</span>
                  </label>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${onbUsername ? PA(0.35) : PA(0.1)}` }}>
                    <input type="text" value={onbUsername} onChange={(e) => { sounds.keypress(); setOnbUsername(e.target.value); }} placeholder="auto-generated" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: onbUsername ? P : "rgba(255,255,255,0.35)", caretColor: P }} data-testid="input-onb-username" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.35) }}>
                    Full Name <span style={{ color: PA(0.2) }}>(opt)</span>
                  </label>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${onbFullname ? PA(0.35) : PA(0.1)}` }}>
                    <input type="text" value={onbFullname} onChange={(e) => { sounds.keypress(); setOnbFullname(e.target.value); }} placeholder="Alex Taylor" className="bg-transparent flex-1 text-xs font-mono focus:outline-none" style={{ color: onbFullname ? P : "rgba(255,255,255,0.35)", caretColor: P }} data-testid="input-onb-fullname" />
                  </div>
                </div>
              </div>

              <div className="rounded-lg p-3 space-y-1" style={{ background: PA(0.04), border: `1px solid ${PA(0.15)}` }}>
                <p className="text-[9px] font-mono" style={{ color: PA(0.55) }}>Flow: Login → Onboarding (if needed) → Pricing → Continue with Core → Stripe → Apply promo</p>
              </div>

              <button
                onClick={handleOnboarding}
                disabled={running || !onbEmail || !onbPassword}
                className="relative w-full flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200 overflow-hidden"
                style={{
                  background: running || !onbEmail || !onbPassword ? PA(0.03) : `linear-gradient(135deg, ${PA(0.18)}, ${PA(0.07)})`,
                  border: `1px solid ${running || !onbEmail || !onbPassword ? PA(0.08) : PA(0.55)}`,
                  color: running || !onbEmail || !onbPassword ? PA(0.2) : P,
                  textShadow: running || !onbEmail || !onbPassword ? "none" : `0 0 14px ${P}`,
                  boxShadow: running || !onbEmail || !onbPassword ? "none" : `0 0 25px ${PA(0.08)}`,
                  cursor: running || !onbEmail || !onbPassword ? "not-allowed" : "pointer",
                }}
                data-testid="button-run-onboarding"
              >
                <User className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
                <span className="relative z-10">
                  {running ? "running onboarding..." : "run_onboarding_checkout"}
                </span>
              </button>
            </>
          )}

          {/* ══ CHECKOUT MODE ══ */}
          {mode === "checkout" && (
            <>
              {/* Replit Account Selector */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: BA(0.5) }}>
                  <User className="w-2.5 h-2.5 inline mr-1" />Replit Account
                </label>
                <select
                  value={selectedReplitId}
                  onChange={(e) => { sounds.keypress(); setSelectedReplitId(e.target.value); }}
                  className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none"
                  style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${selectedReplitId ? BA(0.45) : BA(0.15)}`, color: selectedReplitId ? BA(0.9) : "rgba(255,255,255,0.4)" }}
                  data-testid="select-replit-account"
                >
                  <option value="">— Select Replit account —</option>
                  {replitAccounts.filter((a) => a.status === "processing").map((a) => (
                    <option key={a.id} value={a.id}>@{a.username} ({a.email})</option>
                  ))}
                </select>
                {selectedReplitAccount && (
                  <p className="text-[9px] font-mono mt-1 flex gap-2" style={{ color: BA(0.4) }}>
                    <span>email: {selectedReplitAccount.email}</span>
                    <span style={{ color: BA(0.2) }}>|</span>
                    <span>status: {selectedReplitAccount.status}</span>
                  </p>
                )}
              </div>

              {/* Promotional Checkout URL */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: BA(0.5) }}>
                  <Link2 className="w-2.5 h-2.5 inline mr-1" />Promotional Checkout URL
                </label>
                <div className="space-y-1.5">
                  <div
                    className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
                    style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${promoUrl.includes("replit.com") ? BA(0.4) : BA(0.14)}` }}
                  >
                    <Link2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: promoUrl.includes("replit.com") ? B : BA(0.3) }} />
                    <textarea
                      value={promoUrl}
                      onChange={(e) => { sounds.keypress(); setPromoUrl(e.target.value); }}
                      rows={3}
                      placeholder="https://replit.com/stripe-checkout-by-price/core_1mo_20usd_monthly_feb_26?coupon=YOUR_CODE"
                      className="bg-transparent flex-1 text-[10px] font-mono focus:outline-none resize-none"
                      style={{ color: promoUrl.includes("replit.com") ? B : "rgba(255,255,255,0.5)", caretColor: B }}
                      data-testid="input-promo-url"
                    />
                  </div>
                  {urlCoupon && (
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3 h-3" style={{ color: BA(0.5) }} />
                      <span className="text-[9px] font-mono" style={{ color: BA(0.4) }}>Coupon detected:</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: BA(0.08), border: `1px solid ${BA(0.3)}`, color: B, letterSpacing: "0.1em" }}>{urlCoupon}</span>
                    </div>
                  )}
                  <p className="text-[9px] font-mono" style={{ color: BA(0.25) }}>
                    Paste the full URL — coupon in the URL is auto-applied by Stripe
                  </p>
                </div>
              </div>

              {/* Card Selector */}
              {savedCards.length > 0 && (
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: BA(0.5) }}>
                    <CreditCard className="w-2.5 h-2.5 inline mr-1" />Payment Card
                  </label>
                  <select
                    value={checkoutCardId}
                    onChange={(e) => { sounds.keypress(); setCheckoutCardId(e.target.value); }}
                    className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none"
                    style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${checkoutCardId ? BA(0.45) : BA(0.15)}`, color: checkoutCardId ? BA(0.9) : "rgba(255,255,255,0.4)" }}
                    data-testid="select-checkout-card-co"
                  >
                    <option value="">— No card (navigate only) —</option>
                    {savedCards.map((c) => (
                      <option key={c.id} value={c.id}>{c.label} (•••• {c.cardNumber.replace(/\D/g, "").slice(-4)})</option>
                    ))}
                  </select>
                  {checkoutCardId && (
                    <p className="text-[9px] font-mono mt-1" style={{ color: BA(0.3) }}>
                      Will fill card → solve hCaptcha → submit → handle 3DS OTP
                    </p>
                  )}
                </div>
              )}

              {/* NopeCHA Key */}
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: BA(0.5) }}>
                  <Key className="w-2.5 h-2.5 inline mr-1" />NopeCHA API Key
                  <span className="ml-1.5" style={{ color: BA(0.25) }}>(for hCaptcha solving)</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 flex-1" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${nopeKey.trim() ? BA(0.4) : BA(0.14)}` }}>
                    <Key className="w-3.5 h-3.5 flex-shrink-0" style={{ color: nopeKey.trim() ? B : BA(0.3) }} />
                    <input
                      type="text"
                      value={nopeKey}
                      onChange={(e) => { sounds.keypress(); setNopeKey(e.target.value); setNopeKeyDirty(true); }}
                      placeholder="nopecha_key_..."
                      className="bg-transparent flex-1 text-xs font-mono focus:outline-none"
                      style={{ color: nopeKey.trim() ? B : "rgba(255,255,255,0.5)", caretColor: B }}
                      data-testid="input-nopecha-key"
                    />
                  </div>
                  <button
                    onClick={saveNopeKey}
                    disabled={!nopeKey.trim() || nopeKeySaving}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-mono font-bold transition-all"
                    style={{
                      background: nopeKey.trim() && !nopeKeySaving ? BA(0.1) : "rgba(0,0,0,0.3)",
                      border: `1px solid ${nopeKey.trim() ? BA(0.4) : BA(0.1)}`,
                      color: nopeKey.trim() ? B : BA(0.2),
                      cursor: nopeKey.trim() && !nopeKeySaving ? "pointer" : "not-allowed",
                    }}
                    data-testid="button-save-nopecha"
                  >
                    <Save className="w-3 h-3" />
                    {nopeKeySaving ? "..." : "Save"}
                  </button>
                </div>
                {nopeKey.trim() && !nopeKeyDirty && (
                  <p className="text-[9px] font-mono mt-1 flex items-center gap-1" style={{ color: BA(0.3) }}>
                    <span className="w-1 h-1 rounded-full inline-block" style={{ background: B }} />
                    Key configured — will be used as primary hCaptcha solver
                  </p>
                )}
              </div>

              {/* Run Checkout Button */}
              <button
                onClick={handleCheckout}
                disabled={running || !selectedReplitId || !promoUrl.includes("replit.com")}
                className="relative w-full flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200 overflow-hidden"
                style={{
                  background: running || !selectedReplitId ? BA(0.03) : `linear-gradient(135deg, ${BA(0.15)}, ${BA(0.06)})`,
                  border: `1px solid ${running || !selectedReplitId ? BA(0.08) : BA(0.55)}`,
                  color: running || !selectedReplitId ? BA(0.2) : B,
                  textShadow: running || !selectedReplitId ? "none" : `0 0 14px ${B}`,
                  boxShadow: running || !selectedReplitId ? "none" : `0 0 25px ${BA(0.08)}`,
                  cursor: running || !selectedReplitId ? "not-allowed" : "pointer",
                }}
                data-testid="button-run-checkout"
              >
                <ShoppingCart className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
                <span className="relative z-10">
                  {running ? "running checkout..." : "run_checkout"}
                </span>
              </button>
            </>
          )}
        </div>

        {/* Terminal panel */}
        <div className="min-w-0">
          <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: "rgba(0,0,0,0.75)", border: `1px solid ${mode === "checkout" ? BA(0.1) : mode === "onboarding" ? PA(0.1) : GA(0.12)}` }}>
            <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ background: mode === "checkout" ? BA(0.03) : mode === "onboarding" ? PA(0.03) : GA(0.03), borderBottom: `1px solid ${mode === "checkout" ? BA(0.08) : mode === "onboarding" ? PA(0.08) : GA(0.08)}` }}>
              <div className="flex items-center gap-2.5">
                <Radio className="w-3 h-3" style={{ color: running ? (mode === "checkout" ? B : mode === "onboarding" ? P : G) : GA(0.28), filter: running ? `drop-shadow(0 0 5px ${mode === "checkout" ? B : mode === "onboarding" ? P : G})` : "none" }} />
                <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: mode === "checkout" ? BA(0.45) : mode === "onboarding" ? PA(0.45) : GA(0.45) }}>live_output</span>
                {running && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: mode === "checkout" ? B : mode === "onboarding" ? P : G, boxShadow: `0 0 6px ${mode === "checkout" ? B : mode === "onboarding" ? P : G}` }} />
                    <span className="text-[9px] font-mono font-bold" style={{ color: mode === "checkout" ? BA(0.65) : mode === "onboarding" ? PA(0.65) : GA(0.65) }}>RUNNING</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,59,48,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,149,0,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: mode === "checkout" ? BA(0.55) : GA(0.55) }} />
              </div>
            </div>

            <div className="overflow-y-auto overflow-x-hidden p-4 space-y-0.5 font-mono" style={{ height: "420px", wordBreak: "break-all", overflowWrap: "anywhere" }} data-testid="container-logs">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <div className="text-center space-y-1.5">
                    <p className="text-[11px] font-mono" style={{ color: GA(0.22) }}>{">"}_</p>
                    <p className="text-[10px] font-mono" style={{ color: GA(0.16) }}>waiting for output...</p>
                  </div>
                </div>
              ) : (
                logs.map((line, i) => {
                  const { color, prefix } = getLogStyle(line.text);
                  const isSeparator = line.text.startsWith("━━━") || line.text.startsWith("---");
                  return (
                    <div key={i} className={`flex items-start gap-2 min-w-0 ${isSeparator ? "mt-2 mb-1 opacity-30" : "py-px"}`}>
                      <span className="text-[9px] flex-shrink-0 mt-0.5 tabular-nums" style={{ color: GA(0.22) }}>{line.time}</span>
                      <span className="text-[10px] flex-shrink-0 mt-0.5 w-3 text-center font-bold" style={{ color }}>{prefix}</span>
                      <span className="text-[11px] leading-relaxed break-words min-w-0 overflow-hidden" style={{ color, textShadow: color === G ? `0 0 8px ${GA(0.4)}` : "none" }}>{line.text}</span>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="px-4 py-2 flex items-center gap-2" style={{ background: mode === "checkout" ? BA(0.02) : GA(0.02), borderTop: `1px solid ${mode === "checkout" ? BA(0.07) : GA(0.07)}` }}>
              <span className="text-[9px] font-mono" style={{ color: GA(0.25) }}>addison@panel:~$</span>
              <span className="text-[9px] font-mono" style={{ color: mode === "checkout" ? BA(0.4) : GA(0.4) }}>
                {running ? (mode === "checkout" ? "executing replit_checkout..." : "executing replit_create...") : "ready"}
              </span>
              <span className="w-1.5 h-3 ml-px" style={{ background: tick && !running ? (mode === "checkout" ? B : G) : "transparent", boxShadow: tick && !running ? `0 0 6px ${mode === "checkout" ? B : G}` : "none" }} />
            </div>
          </div>

          {/* ── Live browser screenshot viewer ── */}
          {(running || screenshot.data) && (
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BA(0.18)}`, background: "rgba(0,0,0,0.6)" }}>
              {/* Title bar */}
              <div className="flex items-center justify-between px-3 py-2" style={{ background: BA(0.06), borderBottom: `1px solid ${BA(0.1)}` }}>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: B, boxShadow: `0 0 6px ${BA(0.8)}` }} />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: BA(0.7) }}>LIVE BROWSER VIEW</span>
                </div>
                {screenshot.label && (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded" style={{ background: BA(0.1), color: BA(0.6) }}>{screenshot.label}</span>
                )}
              </div>
              {/* Screenshot */}
              <div className="relative" style={{ minHeight: "180px" }}>
                {screenshot.data ? (
                  <img src={screenshot.data} alt="Live browser" className="w-full block" style={{ imageRendering: "auto" }} />
                ) : (
                  <div className="flex items-center justify-center" style={{ height: "180px" }}>
                    <div className="text-center space-y-2">
                      <div className="w-6 h-6 rounded-full border-2 animate-spin mx-auto" style={{ borderColor: `${BA(0.3)} ${BA(0.3)} ${BA(0.3)} ${B}` }} />
                      <p className="text-[10px] font-mono" style={{ color: BA(0.35) }}>Waiting for browser to start...</p>
                    </div>
                  </div>
                )}
              </div>
              {screenshot.ts > 0 && (
                <div className="px-3 py-1.5" style={{ borderTop: `1px solid ${BA(0.07)}` }}>
                  <span className="text-[8px] font-mono" style={{ color: BA(0.25) }}>
                    Updated {new Date(screenshot.ts).toLocaleTimeString()} · refreshes every 2s
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

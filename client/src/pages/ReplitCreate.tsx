import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { Code2, Play, Mail, Key, Hash, Layers, ChevronRight, Cpu, Radio, Tag, ExternalLink, CreditCard, ShoppingCart, User, Link2, Save, Zap, ChevronDown, Trash2, FileSpreadsheet } from "lucide-react";

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
  couponExtracted: boolean;
  couponCode: string | null;
  warmedAt: string | null;
  createdAt: string;
};

type LogLine = { text: string; ts: number; time: string };

const G = "#00ff41";
const GA = (a: number) => `rgba(0,255,65,${a})`;
const B = "rgba(100,210,255,1)";
const BA = (a: number) => `rgba(100,210,255,${a})`;
const P = "rgba(190,120,255,1)";
const PA = (a: number) => `rgba(190,120,255,${a})`;
const L = "rgba(255,185,50,1)";
const LA = (a: number) => `rgba(255,185,50,${a})`;

const STATUSES: { value: string; label: string; color: string; bg: string; border: string }[] = [
  { value: "processing", label: "PROCESSING",        color: "#f97316", bg: "rgba(249,115,22,0.12)",  border: "rgba(249,115,22,0.4)" },
  { value: "working",    label: "WORKING",           color: "#22c55e", bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.4)" },
  { value: "sold_out",   label: "STOCK OUT",         color: "#ef4444", bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.4)" },
  { value: "completed",  label: "COMPLETED",         color: "#34d399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)" },
  { value: "warmed",     label: "WARMED",            color: "#c084fc", bg: "rgba(192,132,252,0.12)", border: "rgba(192,132,252,0.35)" },
  { value: "error",      label: "ERROR",             color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.35)" },
];
function statusMeta(s: string) {
  return STATUSES.find(x => x.value === s) ?? { value: s, label: s.toUpperCase(), color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.15)" };
}
// Solid fill color for spreadsheet-style status cell (no transparency)
function statusSolid(s: string): string {
  switch (s) {
    case "processing": return "rgb(249,115,22)";   // orange
    case "working":    return "rgb(34,197,94)";    // green
    case "sold_out":   return "rgb(220,38,38)";    // red
    case "completed":  return "rgb(13,148,136)";   // teal
    case "warmed":     return "rgb(124,58,237)";   // purple
    case "error":      return "rgb(139,0,0)";      // dark red
    default:           return "rgb(55,65,81)";     // gray
  }
}

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
  const [mode, setMode] = useState<"create" | "checkout" | "onboarding" | "links">("create");

  // ── BULK LINKS mode state ──
  const [linksCoupon, setLinksCoupon] = useState("AGENT4BC4974559665");
  const [linksCount, setLinksCount] = useState(4);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [linksSubMode, setLinksSubMode] = useState<"manual" | "auto">("auto");
  const [batchCount, setBatchCount] = useState(5);
  const [linksPerSource, setLinksPerSource] = useState(2);

  const [checkoutDelayMinutes, setCheckoutDelayMinutes] = useState(0);
  const [checkoutDelaySaving, setCheckoutDelaySaving] = useState(false);
  const { data: checkoutDelayData } = useQuery<{ minutes: number }>({ queryKey: ["/api/settings/replit-checkout-delay"] });
  useEffect(() => { if (checkoutDelayData?.minutes !== undefined) setCheckoutDelayMinutes(checkoutDelayData.minutes); }, [checkoutDelayData]);

  // ── ONBOARDING mode state ──
  const [onbEmail, setOnbEmail] = useState("");
  const [onbPassword, setOnbPassword] = useState("");
  const [onbCoupon, setOnbCoupon] = useState("AGENT4BC4974559665");
  const [onbUsername, setOnbUsername] = useState("");
  const [onbFullname, setOnbFullname] = useState("");
  const [onbCardId, setOnbCardId] = useState("");

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

  // ── Status changer ──
  const [statusPickerOpen, setStatusPickerOpen] = useState<string | null>(null); // accountId

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/replit-accounts/${id}/status`, { status }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/replit-accounts"] });
      setStatusPickerOpen(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Shared ──
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [tick, setTick] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeBatchId = useRef<string | null>(null);

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
        cardId: onbCardId || undefined,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start");
      activeBatchId.current = data.batchId;
      addLog(`🚀 Onboarding job started [${data.batchId}]`);
      addLog(`🎟️ Coupon: ${onbCoupon.trim() || "AGENT4BC4974559665"}`);
      if (onbCardId) addLog(`💳 Auto-checkout enabled — will fill card, solve hCaptcha, submit`);
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
      const res = await apiRequest("POST", "/api/replit-bulk-checkout-links", {
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

  const handleSaveCheckoutDelay = async () => {
    setCheckoutDelaySaving(true);
    try {
      await apiRequest("PUT", "/api/admin/replit-checkout-delay", { minutes: checkoutDelayMinutes });
      qc.invalidateQueries({ queryKey: ["/api/settings/replit-checkout-delay"] });
      toast({ title: "Saved", description: `Checkout spacing set to ${checkoutDelayMinutes} min` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCheckoutDelaySaving(false);
    }
  };

  const handleAutoCouponLinks = async () => {
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);
    setTotalCount(4);
    try {
      const res = await apiRequest("POST", "/api/replit-auto-coupon-links", {});
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start");
      activeBatchId.current = data.batchId;
      addLog(`🤖 Auto Coupon job started [${data.batchId}]`);
      if (data.sourceEmail) addLog(`👤 Using account: ${data.sourceEmail}`);
    } catch (err: any) {
      sounds.error();
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRunning(false);
    }
  };

  const handleBatchCouponLinks = async () => {
    sounds.start();
    setLogs([]);
    setRunning(true);
    setCompletedCount(0);
    setTotalCount(batchCount);
    try {
      const res = await apiRequest("POST", "/api/replit-batch-coupon-links", { count: batchCount, linksPerSource });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to start batch");
      activeBatchId.current = data.batchId;
      addLog(`🚀 Parallel batch started — ${data.count} job(s) running simultaneously [${data.batchId}]`);
    } catch (err: any) {
      sounds.error();
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setRunning(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
    });
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

  // Email → replit account lookup (for inline log status pills)
  const emailToAccount = new Map<string, ReplitAccount>(
    replitAccounts.map(a => [a.email.toLowerCase(), a])
  );
  // Quick regex to extract emails from a log line
  const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

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
        <button
          onClick={() => { sounds.toggle(); setMode("links"); setLogs([]); setRunning(false); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold tracking-widest uppercase transition-all"
          style={{
            background: mode === "links" ? LA(0.1) : "rgba(0,0,0,0.3)",
            border: `1px solid ${mode === "links" ? LA(0.5) : LA(0.08)}`,
            color: mode === "links" ? L : LA(0.3),
            textShadow: mode === "links" ? `0 0 10px ${L}` : "none",
            boxShadow: mode === "links" ? `0 0 16px ${LA(0.06)}` : "none",
          }}
          data-testid="button-mode-links"
        >
          <Link2 className="w-3.5 h-3.5" />
          Bulk Links
        </button>
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>

        {/* Config Panel */}
        <div
          className="rounded-xl p-5 space-y-5 relative overflow-hidden"
          style={{
            background: "rgba(0,0,0,0.55)",
            border: `1px solid ${mode === "checkout" ? BA(0.2) : mode === "onboarding" ? PA(0.2) : mode === "links" ? LA(0.2) : GA(0.14)}`,
            boxShadow: `0 0 40px ${mode === "checkout" ? BA(0.03) : mode === "onboarding" ? PA(0.03) : mode === "links" ? LA(0.03) : GA(0.04)} inset`,
          }}
        >
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.012) 2px, rgba(0,255,65,0.012) 4px)", borderRadius: "inherit" }} />

          <div className="flex items-center gap-2">
            <ChevronRight className="w-3.5 h-3.5" style={{ color: mode === "checkout" ? B : mode === "onboarding" ? P : mode === "links" ? L : G }} />
            <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: mode === "checkout" ? BA(0.55) : mode === "onboarding" ? PA(0.55) : mode === "links" ? LA(0.55) : GA(0.55) }}>
              {mode === "checkout" ? "Checkout Configuration" : mode === "onboarding" ? "Onboarding + Core Configuration" : mode === "links" ? "Bulk Links Configuration" : "Configuration"}
            </span>
            <div className="flex-1 h-px" style={{ background: mode === "checkout" ? BA(0.1) : mode === "onboarding" ? PA(0.1) : mode === "links" ? LA(0.1) : GA(0.1) }} />
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

              {/* Card Selector for auto-checkout */}
              {savedCards.length > 0 && (
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: PA(0.4) }}>
                    <CreditCard className="w-2.5 h-2.5 inline mr-1" />Payment Card <span style={{ color: PA(0.2) }}>(auto-checkout)</span>
                  </label>
                  <select
                    value={onbCardId}
                    onChange={(e) => { sounds.keypress(); setOnbCardId(e.target.value); }}
                    className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none"
                    style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${onbCardId ? PA(0.5) : PA(0.15)}`, color: onbCardId ? P : "rgba(255,255,255,0.4)" }}
                    data-testid="select-onb-card"
                  >
                    <option value="">— Skip (navigate to Stripe only) —</option>
                    {savedCards.map((c) => (
                      <option key={c.id} value={c.id}>{c.label} (•••• {c.cardNumber.replace(/\D/g, "").slice(-4)})</option>
                    ))}
                  </select>
                  {onbCardId && (
                    <p className="text-[9px] font-mono mt-1" style={{ color: PA(0.35) }}>
                      Will fill card → solve hCaptcha → click Subscribe → handle 3DS OTP
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-lg p-3 space-y-1" style={{ background: PA(0.04), border: `1px solid ${PA(0.15)}` }}>
                <p className="text-[9px] font-mono" style={{ color: PA(0.55) }}>
                  {onbCardId
                    ? "Flow: Login → Onboarding → Stripe (coupon) → Fill card → hCaptcha → Subscribe → 3DS OTP"
                    : "Flow: Login → Onboarding → Stripe (coupon applied) → stop"}
                </p>
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

          {/* ══ BULK LINKS MODE ══ */}
          {mode === "links" && (
            <>
              {/* Sub-mode toggle: Auto / Manual */}
              <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${LA(0.15)}` }}>
                {(["auto", "manual"] as const).map(sm => (
                  <button
                    key={sm}
                    onClick={() => { sounds.keypress(); setLinksSubMode(sm); }}
                    className="flex-1 py-2 text-[10px] font-mono uppercase tracking-widest font-bold transition-all"
                    style={{
                      background: linksSubMode === sm ? LA(0.15) : "transparent",
                      color: linksSubMode === sm ? L : LA(0.35),
                      borderRight: sm === "auto" ? `1px solid ${LA(0.15)}` : "none",
                    }}
                  >
                    {sm === "auto" ? "🤖 Auto Coupon" : "✍️ Manual"}
                  </button>
                ))}
              </div>

              {/* ── AUTO MODE ── */}
              {linksSubMode === "auto" && (() => {
                // Source candidates: sold_out first (have Core = valid coupon), then processing
                const nextSource =
                  replitAccounts.find(a => !a.couponExtracted && a.email && a.password && a.status === "sold_out") ||
                  replitAccounts.find(a => !a.couponExtracted && a.email && a.password && a.status === "processing");
                const exhausted = !nextSource;
                const usedCount = replitAccounts.filter(a => a.couponExtracted).length;
                const soldOutAvail = replitAccounts.filter(a => !a.couponExtracted && a.email && a.password && a.status === "sold_out").length;
                const processingAvail = replitAccounts.filter(a => !a.couponExtracted && a.email && a.password && a.status === "processing").length;
                const processingTargets = replitAccounts.filter(a => a.status === "processing").length;
                return (
                  <>
                    {/* Queue status */}
                    <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${LA(0.18)}` }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: LA(0.4) }}>Coupon Queue</span>
                        <span className="text-[9px] font-mono" style={{ color: LA(0.35) }}>{usedCount} used · {soldOutAvail + processingAvail} remaining</span>
                      </div>
                      {exhausted ? (
                        <p className="text-[10px] font-mono" style={{ color: "#ef4444" }}>⚠️ No sold_out or processing accounts available for coupon extraction</p>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-[9px] font-mono" style={{ color: LA(0.4) }}>Next source (auto-selected):</p>
                          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: LA(0.06), border: `1px solid ${LA(0.2)}` }}>
                            <User className="w-3 h-3 flex-shrink-0" style={{ color: LA(0.6) }} />
                            <div className="min-w-0">
                              <p className="text-[11px] font-mono font-bold truncate" style={{ color: L }}>@{nextSource!.username}</p>
                              <p className="text-[9px] font-mono truncate" style={{ color: LA(0.5) }}>{nextSource!.email}</p>
                            </div>
                            <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded" style={{
                              background: nextSource!.status === "sold_out" ? "rgba(239,68,68,0.1)" : "rgba(251,191,36,0.1)",
                              color: nextSource!.status === "sold_out" ? "#ef4444" : "#fbbf24",
                              border: `1px solid ${nextSource!.status === "sold_out" ? "rgba(239,68,68,0.3)" : "rgba(251,191,36,0.3)"}`,
                            }}>
                              {nextSource!.status}
                            </span>
                          </div>
                          <div className="flex gap-3 text-[9px] font-mono pt-0.5" style={{ color: LA(0.35) }}>
                            <span><span style={{ color: "#ef4444" }}>{soldOutAvail}</span> sold_out sources</span>
                            <span><span style={{ color: "#fbbf24" }}>{processingAvail}</span> processing sources</span>
                            <span><span style={{ color: "rgba(34,197,94,0.8)" }}>{processingTargets}</span> processing targets</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Already extracted coupons */}
                    {usedCount > 0 && (
                      <div className="rounded-lg p-3 space-y-1.5" style={{ background: LA(0.03), border: `1px solid ${LA(0.1)}` }}>
                        <p className="text-[9px] font-mono uppercase tracking-widest" style={{ color: LA(0.35) }}>Extracted coupons ({usedCount})</p>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {replitAccounts.filter(a => a.couponExtracted).map(a => (
                            <div key={a.id} className="flex items-center gap-2 text-[9px] font-mono" style={{ color: LA(0.4) }}>
                              <span className="truncate" style={{ maxWidth: 120 }}>{a.email.split("@")[0]}</span>
                              <span style={{ color: LA(0.2) }}>→</span>
                              <span className="font-bold" style={{ color: LA(0.7) }}>{a.couponCode || "?"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg p-3 space-y-1" style={{ background: LA(0.03), border: `1px solid ${LA(0.1)}` }}>
                      <p className="text-[9px] font-mono leading-relaxed" style={{ color: LA(0.4) }}>
                        Picks next sold_out or processing account → extracts coupon → generates up to 3 checkout links → marks source as used (never re-logs into extracted accounts)
                      </p>
                    </div>

                    {/* Single smart run button */}
                    <button
                      onClick={handleAutoCouponLinks}
                      disabled={running || exhausted}
                      className="relative w-full flex items-center justify-center gap-2 rounded-lg py-3 text-xs font-mono font-bold tracking-widest uppercase transition-all duration-200"
                      style={{
                        background: running ? LA(0.07) : exhausted ? LA(0.03) : `linear-gradient(135deg, ${LA(0.22)}, ${LA(0.08)})`,
                        border: `1px solid ${running ? LA(0.3) : exhausted ? LA(0.08) : LA(0.7)}`,
                        color: running ? L : exhausted ? LA(0.2) : L,
                        textShadow: running || exhausted ? "none" : `0 0 14px ${L}`,
                        boxShadow: running || exhausted ? "none" : `0 0 25px ${LA(0.12)}`,
                        cursor: running || exhausted ? "not-allowed" : "pointer",
                      }}
                      data-testid="button-auto-coupon-links"
                    >
                      <Hash className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
                      <span className="relative z-10">
                        {running
                          ? "extracting coupon & generating links..."
                          : exhausted
                            ? "no_sources_remaining"
                            : `run_auto_coupon · ${nextSource!.status} → up to 3 links`}
                      </span>
                    </button>
                  </>
                );
              })()}

              {/* ── MANUAL MODE ── */}
              {linksSubMode === "manual" && (
                <>
                  <div>
                    <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: LA(0.5) }}>
                      <Tag className="w-2.5 h-2.5 inline mr-1" />Coupon Code
                    </label>
                    <input
                      value={linksCoupon}
                      onChange={(e) => { sounds.keypress(); setLinksCoupon(e.target.value); }}
                      placeholder="AGENT4BC4974559665"
                      className="w-full rounded-lg px-3 py-2.5 text-xs font-mono focus:outline-none"
                      style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${linksCoupon ? LA(0.45) : LA(0.15)}`, color: LA(0.9) }}
                      data-testid="input-links-coupon"
                    />
                  </div>

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
                        >{n}</button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg p-3 space-y-1" style={{ background: LA(0.04), border: `1px solid ${LA(0.12)}` }}>
                    <p className="text-[9px] font-mono" style={{ color: LA(0.45) }}>
                      Picks {linksCount} Account Created account(s) → generates Stripe checkout URL with coupon
                    </p>
                    <p className="text-[9px] font-mono" style={{ color: LA(0.3) }}>
                      Account status: Account Created → <span style={{ color: "#f97316" }}>Working Now</span>
                    </p>
                  </div>

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
                    data-testid="button-run-links"
                  >
                    <Link2 className={`w-4 h-4 relative z-10 ${running ? "animate-pulse" : ""}`} />
                    <span className="relative z-10">
                      {running ? `generating ${linksCount} link(s)...` : `generate_checkout_links`}
                    </span>
                  </button>
                </>
              )}
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
          <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: "rgba(0,0,0,0.75)", border: `1px solid ${mode === "checkout" ? BA(0.1) : mode === "onboarding" ? PA(0.1) : mode === "links" ? LA(0.1) : GA(0.12)}` }}>
            <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0" style={{ background: mode === "checkout" ? BA(0.03) : mode === "onboarding" ? PA(0.03) : mode === "links" ? LA(0.03) : GA(0.03), borderBottom: `1px solid ${mode === "checkout" ? BA(0.08) : mode === "onboarding" ? PA(0.08) : mode === "links" ? LA(0.08) : GA(0.08)}` }}>
              <div className="flex items-center gap-2.5">
                <Radio className="w-3 h-3" style={{ color: running ? (mode === "checkout" ? B : mode === "onboarding" ? P : mode === "links" ? L : G) : GA(0.28), filter: running ? `drop-shadow(0 0 5px ${mode === "checkout" ? B : mode === "onboarding" ? P : mode === "links" ? L : G})` : "none" }} />
                <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: mode === "checkout" ? BA(0.45) : mode === "onboarding" ? PA(0.45) : mode === "links" ? LA(0.45) : GA(0.45) }}>live_output</span>
                {running && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: mode === "checkout" ? B : mode === "onboarding" ? P : mode === "links" ? L : G, boxShadow: `0 0 6px ${mode === "checkout" ? B : mode === "onboarding" ? P : mode === "links" ? L : G}` }} />
                    <span className="text-[9px] font-mono font-bold" style={{ color: mode === "checkout" ? BA(0.65) : mode === "onboarding" ? PA(0.65) : mode === "links" ? LA(0.65) : GA(0.65) }}>RUNNING</span>
                  </div>
                )}
              </div>
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,59,48,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,149,0,0.55)" }} />
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: mode === "checkout" ? BA(0.55) : mode === "links" ? LA(0.55) : GA(0.55) }} />
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

                  // Find any replit account email in this log line
                  const emailMatches = [...line.text.matchAll(new RegExp(EMAIL_RE.source, "g"))];
                  const matchedAccount = emailMatches.map(m => emailToAccount.get(m[0].toLowerCase())).find(Boolean);

                  return (
                    <div key={i} className={`flex items-start gap-2 min-w-0 ${isSeparator ? "mt-2 mb-1 opacity-30" : "py-px"}`}>
                      <span className="text-[9px] flex-shrink-0 mt-0.5 tabular-nums" style={{ color: GA(0.22) }}>{line.time}</span>
                      <span className="text-[10px] flex-shrink-0 mt-0.5 w-3 text-center font-bold" style={{ color }}>{prefix}</span>
                      <span className="text-[11px] leading-relaxed break-words min-w-0 overflow-hidden flex-1" style={{ color, textShadow: color === G ? `0 0 8px ${GA(0.4)}` : "none" }}>{line.text}</span>
                      {matchedAccount && (() => {
                        const sm = statusMeta(matchedAccount.status);
                        const isOpen = statusPickerOpen === matchedAccount.id;
                        return (
                          <div className="relative flex-shrink-0">
                            <button
                              onClick={() => setStatusPickerOpen(isOpen ? null : matchedAccount.id)}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold"
                              style={{ background: sm.bg, border: `1px solid ${sm.border}`, color: sm.color, cursor: "pointer" }}
                              data-testid={`button-log-status-${i}`}
                            >
                              {sm.label}
                              <ChevronDown className="w-2 h-2" />
                            </button>
                            {isOpen && (
                              <div className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden shadow-2xl" style={{ background: "#0d0d0d", border: "1px solid rgba(0,255,65,0.2)", minWidth: 110 }}>
                                {STATUSES.map(s => (
                                  <button
                                    key={s.value}
                                    onClick={() => statusMutation.mutate({ id: matchedAccount.id, status: s.value })}
                                    className="w-full text-left px-3 py-1.5 text-[9px] font-mono font-bold transition-all"
                                    style={{ color: s.color, background: matchedAccount.status === s.value ? s.bg : "transparent" }}
                                    data-testid={`button-set-status-${s.value}-${i}`}
                                  >
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            <div className="px-4 py-2 flex items-center gap-2" style={{ background: mode === "checkout" ? BA(0.02) : mode === "links" ? LA(0.02) : GA(0.02), borderTop: `1px solid ${mode === "checkout" ? BA(0.07) : mode === "links" ? LA(0.07) : GA(0.07)}` }}>
              <span className="text-[9px] font-mono" style={{ color: GA(0.25) }}>addison@panel:~$</span>
              <span className="text-[9px] font-mono" style={{ color: mode === "checkout" ? BA(0.4) : mode === "links" ? LA(0.4) : GA(0.4) }}>
                {running ? (mode === "checkout" ? "executing replit_checkout..." : mode === "links" ? "generating checkout links..." : "executing replit_create...") : "ready"}
              </span>
              <span className="w-1.5 h-3 ml-px" style={{ background: tick && !running ? (mode === "checkout" ? B : mode === "links" ? L : G) : "transparent", boxShadow: tick && !running ? `0 0 6px ${mode === "checkout" ? B : mode === "links" ? L : G}` : "none" }} />
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}

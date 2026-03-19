import { useState, useRef } from "react";
import { CreditCard, Copy, RefreshCw, Download, Zap, Check, Shield, Terminal, Activity, Wifi, WifiOff, Loader, AlertTriangle, ChevronRight, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MONTHS = ["Random", "01","02","03","04","05","06","07","08","09","10","11","12"];
const currentYear = new Date().getFullYear();
const YEARS = ["Random", ...Array.from({ length: 10 }, (_, i) => String(currentYear + i))];
const QUANTITIES = ["1","5","10","20","50","100","200","500","999"];

type CheckResult = {
  status: "live" | "dead" | "unknown" | "checking" | "idle";
  code?: number;
  message?: string;
  bank?: string;
  type?: string;
  category?: string;
  country?: string;
};

function detectNetwork(bin: string) {
  if (bin.startsWith("34") || bin.startsWith("37")) return { name: "AMEX",       color: "#60b4ff", bg: "#0f4c81" };
  if (bin.startsWith("4"))                           return { name: "VISA",       color: "#7c8fff", bg: "#1a237e" };
  if (bin.startsWith("51") || bin.startsWith("52") || bin.startsWith("53") || bin.startsWith("54") || bin.startsWith("55") || (parseInt(bin) >= 222100 && parseInt(bin) <= 272099))
                                                     return { name: "MC",         color: "#ff6b6b", bg: "#7b1113" };
  if (bin.startsWith("6011") || bin.startsWith("65"))return { name: "DISC",       color: "#ffb74d", bg: "#e65100" };
  return                                                    { name: "CARD",       color: "#a78bfa", bg: "#1b1b2f" };
}

function parseCard(pipe: string) {
  const [number = "", mm = "", yyyy = "", cvv = ""] = pipe.split("|");
  return { number, mm, yyyy, cvv };
}

function StatusBadge({ result }: { result: CheckResult }) {
  if (result.status === "idle") return null;
  if (result.status === "checking") return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)" }}>
      <Loader className="w-2.5 h-2.5 animate-spin" style={{ color: "#fbbf24" }} />
      <span className="text-[9px] font-mono" style={{ color: "#fbbf24" }}>CHECKING</span>
    </div>
  );
  if (result.status === "live") return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ background: "rgba(0,255,65,0.08)", border: "1px solid rgba(0,255,65,0.3)" }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#00ff41", boxShadow: "0 0 6px #00ff41" }} />
      <span className="text-[9px] font-mono font-bold" style={{ color: "#00ff41" }}>LIVE</span>
    </div>
  );
  if (result.status === "dead") return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)" }}>
      <X className="w-2.5 h-2.5" style={{ color: "#f87171" }} />
      <span className="text-[9px] font-mono font-bold" style={{ color: "#f87171" }}>DEAD</span>
    </div>
  );
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.2)" }}>
      <AlertTriangle className="w-2.5 h-2.5" style={{ color: "#94a3b8" }} />
      <span className="text-[9px] font-mono" style={{ color: "#94a3b8" }}>UNK</span>
    </div>
  );
}

type FormState = {
  bin: string; dateEnabled: boolean; expmon: string; expyear: string;
  cvvEnabled: boolean; cvv: string; quantity: string; liveCheck: boolean;
};

export default function CardGenerator() {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>({
    bin: "", dateEnabled: true, expmon: "Random", expyear: "Random",
    cvvEnabled: true, cvv: "", quantity: "10", liveCheck: false,
  });
  const [cards, setCards] = useState<string[]>([]);
  const [results, setResults] = useState<Record<number, CheckResult>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [bulkCheckIdx, setBulkCheckIdx] = useState<number | null>(null);
  const abortRef = useRef<boolean>(false);

  const network = detectNetwork(form.bin);
  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm(f => ({ ...f, [k]: v })); }

  async function generate() {
    if (!/^\d{6,8}$/.test(form.bin.trim())) { setError("BIN must be 6–8 digits"); return; }
    setError(""); setLoading(true); setCards([]); setResults({});
    try {
      const res = await fetch("/api/card-generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ bin: form.bin.trim(), quantity: parseInt(form.quantity) || 10, expmon: form.dateEnabled ? form.expmon : "random", expyear: form.dateEnabled ? form.expyear : "random", cvvEnabled: form.cvvEnabled, cvv: form.cvv || "" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Generation failed"); return; }
      const list: string[] = Array.isArray(data.cards) ? data.cards : [];
      setCards(list);
      if (form.liveCheck && list.length > 0) {
        setTimeout(() => checkAll(list), 200);
      }
    } catch (e: any) { setError(e.message || "Network error"); }
    finally { setLoading(false); }
  }

  async function checkSingle(idx: number, pipe: string) {
    setResults(r => ({ ...r, [idx]: { status: "checking" } }));
    try {
      const res = await fetch("/api/card-check", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ card: pipe }),
      });
      const data = await res.json();
      const isLive = data.code === 1 || data.status === "Live" || data.status === "live";
      const isDead = data.code === 0 || data.status === "Dead" || data.status === "dead" || data.status === "Declined";
      setResults(r => ({
        ...r,
        [idx]: {
          status: isLive ? "live" : isDead ? "dead" : "unknown",
          code: data.code,
          message: data.message,
          bank: data.card?.bank,
          type: data.card?.type,
          category: data.card?.category,
          country: data.card?.country?.name,
        }
      }));
    } catch {
      setResults(r => ({ ...r, [idx]: { status: "unknown", message: "Network error" } }));
    }
  }

  async function checkAll(cardList?: string[]) {
    const list = cardList ?? cards;
    if (list.length === 0) return;
    abortRef.current = false;
    setChecking(true);
    setCheckProgress(0);
    setResults({});
    for (let i = 0; i < list.length; i++) {
      if (abortRef.current) break;
      setBulkCheckIdx(i);
      await checkSingle(i, list[i]);
      setCheckProgress(Math.round(((i + 1) / list.length) * 100));
      await new Promise(r => setTimeout(r, 400));
    }
    setBulkCheckIdx(null);
    setChecking(false);
    setCheckProgress(0);
  }

  function stopCheck() { abortRef.current = true; }

  function copyAll() { navigator.clipboard.writeText(cards.join("\n")); toast({ title: `${cards.length} cards copied` }); }
  function copyLive() {
    const live = cards.filter((_, i) => results[i]?.status === "live");
    if (!live.length) { toast({ title: "No live cards yet" }); return; }
    navigator.clipboard.writeText(live.join("\n"));
    toast({ title: `${live.length} live cards copied` });
  }
  function exportCSV() {
    const rows = ["Number,Month,Year,CVV,Status,Bank,Message", ...cards.map((c, i) => {
      const r = results[i];
      return `${c.replace(/\|/g, ",")},${r?.status ?? ""},${r?.bank ?? ""},${r?.message ?? ""}`;
    })].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" })); a.download = `cards_${form.bin}.csv`; a.click();
  }

  const liveCount = Object.values(results).filter(r => r.status === "live").length;
  const deadCount = Object.values(results).filter(r => r.status === "dead").length;
  const unkCount = Object.values(results).filter(r => r.status === "unknown").length;
  const checkedCount = liveCount + deadCount + unkCount;

  const inputStyle: React.CSSProperties = { background: "rgba(0,255,65,0.03)", border: "1px solid rgba(0,255,65,0.12)", color: "rgba(255,255,255,0.75)", caretColor: "#00ff41", outline: "none" };
  const labelCls = "block text-[8.5px] font-mono uppercase tracking-[0.2em] mb-1.5";

  function Toggle({ enabled, onToggle, label, accent = "#00ff41" }: { enabled: boolean; onToggle: () => void; label: string; accent?: string }) {
    return (
      <button onClick={onToggle} className="flex items-center gap-2.5 group">
        <div className="relative w-8 h-4 rounded-full transition-all duration-200 shrink-0" style={{ background: enabled ? `${accent}22` : "rgba(255,255,255,0.05)", border: `1px solid ${enabled ? accent + "50" : "rgba(255,255,255,0.08)"}` }}>
          <div className="absolute top-0.5 transition-all duration-200 w-3 h-3 rounded-full" style={{ left: enabled ? "calc(100% - 14px)" : "2px", background: enabled ? accent : "rgba(255,255,255,0.2)", boxShadow: enabled ? `0 0 8px ${accent}` : "none" }} />
        </div>
        <span className="text-[10px] font-mono font-bold tracking-widest" style={{ color: enabled ? accent : "rgba(255,255,255,0.2)" }}>{label}</span>
      </button>
    );
  }

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Terminal header */}
      <div className="rounded-xl px-5 py-3 flex items-center justify-between" style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,20,0,0.6))", border: "1px solid rgba(0,255,65,0.15)", boxShadow: "0 0 40px rgba(0,255,65,0.04)" }}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl blur-lg" style={{ background: "rgba(0,255,65,0.15)" }} />
            <div className="relative w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(0,255,65,0.15), rgba(0,0,0,0.5))", border: "1px solid rgba(0,255,65,0.3)" }}>
              <CreditCard className="w-4 h-4" style={{ color: "#00ff41", filter: "drop-shadow(0 0 4px #00ff41)" }} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-mono font-bold tracking-tight" style={{ color: "#00ff41", textShadow: "0 0 15px rgba(0,255,65,0.4)" }}>
                card_generator<span className="animate-pulse" style={{ color: "#00ff41" }}>_</span>
              </h1>
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(0,255,65,0.08)", border: "1px solid rgba(0,255,65,0.2)", color: "rgba(0,255,65,0.6)" }}>
                TEST ONLY
              </span>
            </div>
            <p className="text-[9px] font-mono mt-0.5" style={{ color: "rgba(255,255,255,0.2)" }}>
              <span style={{ color: "rgba(0,255,65,0.4)" }}>{'>'}</span> Luhn-valid generator + live checker · {cards.length > 0 ? `${cards.length} generated` : "ready"}
            </p>
          </div>
        </div>

        {cards.length > 0 && (
          <div className="flex items-center gap-2">
            {/* Stats */}
            {checkedCount > 0 && (
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg mr-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#00ff41", boxShadow: "0 0 5px #00ff41" }} />
                  <span className="text-[10px] font-mono font-bold" style={{ color: "#00ff41" }}>{liveCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <span className="text-[10px] font-mono text-red-400">{deadCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  <span className="text-[10px] font-mono text-zinc-500">{unkCount}</span>
                </div>
              </div>
            )}
            {liveCount > 0 && (
              <button onClick={copyLive} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono transition-all hover:opacity-80" style={{ background: "rgba(0,255,65,0.1)", border: "1px solid rgba(0,255,65,0.3)", color: "#00ff41" }}>
                <Wifi className="w-3 h-3" /> LIVE ({liveCount})
              </button>
            )}
            <button onClick={copyAll} data-testid="btn-copy-all" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono transition-all hover:opacity-80" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Copy className="w-3 h-3" /> ALL
            </button>
            <button onClick={exportCSV} data-testid="btn-export" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono transition-all hover:opacity-80" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Download className="w-3 h-3" /> CSV
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr" }}>
        {/* Config panel */}
        <div className="rounded-xl p-4 space-y-4 h-fit sticky top-4" style={{ background: "linear-gradient(180deg, rgba(0,20,0,0.6) 0%, rgba(0,0,0,0.5) 100%)", border: "1px solid rgba(0,255,65,0.10)", boxShadow: "0 0 30px rgba(0,255,65,0.03)" }}>

          {/* BIN */}
          <div>
            <label className={labelCls} style={{ color: "rgba(0,255,65,0.4)" }}>
              <ChevronRight className="w-2.5 h-2.5 inline mr-0.5" />BIN Number
            </label>
            <div className="relative">
              <input
                type="text" value={form.bin}
                onChange={e => { set("bin", e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
                placeholder="e.g. 453590"
                maxLength={8}
                data-testid="input-bin"
                className="w-full px-3 py-2.5 rounded-lg text-[12px] font-mono pr-16"
                style={{ ...inputStyle, borderColor: error ? "rgba(248,113,113,0.5)" : form.bin.length >= 6 ? `${network.color}40` : "rgba(0,255,65,0.12)", boxShadow: form.bin.length >= 6 ? `0 0 0 1px ${network.color}15, inset 0 0 20px ${network.color}04` : "none" }}
              />
              {form.bin.length >= 6 && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold tracking-wider" style={{ background: `${network.bg}cc`, border: `1px solid ${network.color}40`, color: network.color }}>
                  {network.name}
                </div>
              )}
            </div>
            {error && <p className="text-red-400/80 text-[9px] font-mono mt-1">{error}</p>}
          </div>

          {/* EXPIRY */}
          <div className="space-y-2.5">
            <Toggle enabled={form.dateEnabled} onToggle={() => set("dateEnabled", !form.dateEnabled)} label="EXPIRY DATE" />
            {form.dateEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls} style={{ color: "rgba(255,255,255,0.15)" }}>Month</label>
                  <select value={form.expmon} onChange={e => set("expmon", e.target.value)} data-testid="select-expmon"
                    className="w-full px-2.5 py-2 rounded-lg text-[11px] font-mono outline-none cursor-pointer appearance-none"
                    style={inputStyle}>
                    {MONTHS.map(m => <option key={m} style={{ background: "#0a0a0a" }}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} style={{ color: "rgba(255,255,255,0.15)" }}>Year</label>
                  <select value={form.expyear} onChange={e => set("expyear", e.target.value)} data-testid="select-expyear"
                    className="w-full px-2.5 py-2 rounded-lg text-[11px] font-mono outline-none cursor-pointer appearance-none"
                    style={inputStyle}>
                    {YEARS.map(y => <option key={y} style={{ background: "#0a0a0a" }}>{y}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* CVV */}
          <div className="space-y-2.5">
            <Toggle enabled={form.cvvEnabled} onToggle={() => set("cvvEnabled", !form.cvvEnabled)} label="CVV" />
            {form.cvvEnabled && (
              <input type="text" value={form.cvv} onChange={e => set("cvv", e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="blank = random" data-testid="input-cvv"
                className="w-full px-3 py-2 rounded-lg text-[11px] font-mono"
                style={inputStyle} />
            )}
          </div>

          {/* Live Check toggle */}
          <div className="py-2 px-3 rounded-lg" style={{ background: "rgba(0,255,65,0.03)", border: "1px solid rgba(0,255,65,0.08)" }}>
            <Toggle enabled={form.liveCheck} onToggle={() => set("liveCheck", !form.liveCheck)} label="AUTO LIVE CHECK" accent="#00ff41" />
            {form.liveCheck && (
              <p className="text-[8.5px] font-mono mt-2" style={{ color: "rgba(0,255,65,0.3)" }}>
                ⚡ Checks via chkr.cc after generation
              </p>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className={labelCls} style={{ color: "rgba(0,255,65,0.4)" }}>
              <ChevronRight className="w-2.5 h-2.5 inline mr-0.5" />Quantity
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUANTITIES.map(q => (
                <button key={q} onClick={() => set("quantity", q)} data-testid={`btn-qty-${q}`}
                  className="px-2 py-1 rounded text-[10px] font-mono font-medium transition-all"
                  style={form.quantity === q
                    ? { background: "rgba(0,255,65,0.12)", border: "1px solid rgba(0,255,65,0.4)", color: "#00ff41", boxShadow: "0 0 8px rgba(0,255,65,0.15)" }
                    : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.25)" }}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Generate */}
          <button onClick={generate} disabled={loading} data-testid="btn-generate"
            className="w-full py-2.5 rounded-xl font-mono text-[12px] font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 active:scale-[0.98]"
            style={{ background: loading ? "rgba(0,255,65,0.05)" : "linear-gradient(135deg, rgba(0,255,65,0.18), rgba(0,200,50,0.08))", border: "1px solid rgba(0,255,65,0.35)", color: "#00ff41", boxShadow: loading ? "none" : "0 0 25px rgba(0,255,65,0.1), inset 0 1px 0 rgba(0,255,65,0.1)", textShadow: "0 0 10px rgba(0,255,65,0.5)" }}>
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {loading ? "GENERATING..." : "GENERATE"}
          </button>

          {/* Manual check all */}
          {cards.length > 0 && !checking && (
            <button onClick={() => checkAll()} data-testid="btn-check-all"
              className="w-full py-2 rounded-xl font-mono text-[11px] font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{ background: "rgba(0,255,65,0.04)", border: "1px solid rgba(0,255,65,0.15)", color: "rgba(0,255,65,0.5)" }}>
              <Shield className="w-3.5 h-3.5" />
              CHECK ALL ({cards.length})
            </button>
          )}
          {checking && (
            <button onClick={stopCheck}
              className="w-full py-2 rounded-xl font-mono text-[11px] font-bold flex items-center justify-center gap-2 transition-all"
              style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}>
              <X className="w-3.5 h-3.5" /> STOP
            </button>
          )}
        </div>

        {/* Output panel */}
        <div className="min-w-0 space-y-3">
          {/* Check progress */}
          {checking && (
            <div className="rounded-xl px-4 py-3" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,255,65,0.15)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-3 h-3 animate-pulse" style={{ color: "#00ff41" }} />
                  <span className="text-[10px] font-mono" style={{ color: "rgba(0,255,65,0.7)" }}>
                    CHECKING {bulkCheckIdx !== null ? bulkCheckIdx + 1 : "?"}/{cards.length}
                  </span>
                </div>
                <span className="text-[10px] font-mono tabular-nums" style={{ color: "rgba(0,255,65,0.5)" }}>{checkProgress}%</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${checkProgress}%`, background: "linear-gradient(90deg, #00ff41, #00cc33)", boxShadow: "0 0 8px rgba(0,255,65,0.5)" }} />
              </div>
              <div className="flex gap-4 mt-2">
                <span className="text-[8.5px] font-mono" style={{ color: "#00ff41" }}>✓ {liveCount} live</span>
                <span className="text-[8.5px] font-mono text-red-400">✗ {deadCount} dead</span>
                <span className="text-[8.5px] font-mono text-zinc-600">? {unkCount} unknown</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 rounded-xl" style={{ border: "1px dashed rgba(0,255,65,0.08)", background: "rgba(0,0,0,0.3)" }}>
              <Terminal className="w-6 h-6 animate-pulse" style={{ color: "rgba(0,255,65,0.2)" }} />
              <p className="text-[10px] font-mono" style={{ color: "rgba(0,255,65,0.2)" }}>
                {'>'} generating {form.quantity} cards<span className="animate-pulse">_</span>
              </p>
            </div>
          ) : cards.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 rounded-xl" style={{ border: "1px dashed rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
              <CreditCard className="w-8 h-8" style={{ color: "rgba(255,255,255,0.05)" }} />
              <p className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.1)" }}>{'>'} enter BIN and generate_</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,255,65,0.08)" }}>
              {/* Table header */}
              <div className="grid px-4 py-2.5 text-[8px] font-mono uppercase tracking-[0.15em]" style={{ gridTemplateColumns: "28px 20px 1fr 100px 60px 80px 80px", borderBottom: "1px solid rgba(0,255,65,0.06)", background: "rgba(0,255,65,0.02)", color: "rgba(0,255,65,0.25)" }}>
                <span>#</span>
                <span></span>
                <span>Card Number</span>
                <span>Expiry / CVV</span>
                <span>Status</span>
                <span>Bank</span>
                <span className="text-right">Action</span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: "520px" }}>
                {cards.map((pipe, i) => {
                  const { number, mm, yyyy, cvv } = parseCard(pipe);
                  const res = results[i] ?? { status: "idle" as const };
                  const isLive = res.status === "live";
                  const isDead = res.status === "dead";
                  return (
                    <div
                      key={i}
                      className="grid items-center px-4 py-2 transition-all group"
                      data-testid={`card-row-${i}`}
                      style={{
                        gridTemplateColumns: "28px 20px 1fr 100px 60px 80px 80px",
                        borderBottom: "1px solid rgba(255,255,255,0.02)",
                        background: isLive ? "rgba(0,255,65,0.03)" : isDead ? "rgba(248,113,113,0.02)" : bulkCheckIdx === i ? "rgba(251,191,36,0.03)" : "transparent",
                      }}
                    >
                      <span className="text-[9px] font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.12)" }}>{i + 1}</span>
                      <div className="w-1 h-4 rounded-full shrink-0" style={{ background: network.color, opacity: 0.6, boxShadow: `0 0 4px ${network.color}60` }} />
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="text-[11px] font-mono tabular-nums truncate cursor-pointer"
                          style={{ color: isLive ? "#00ff41" : isDead ? "rgba(248,113,113,0.6)" : "rgba(255,255,255,0.55)" }}
                          onClick={() => { navigator.clipboard.writeText(pipe); toast({ title: "Copied!" }); }}
                        >
                          {number}
                        </span>
                        <button
                          onClick={() => { navigator.clipboard.writeText(pipe); toast({ title: "Copied!" }); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          data-testid={`copy-card-${i}`}
                        >
                          <Copy className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                        </button>
                      </div>
                      <span className="text-[10px] font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.25)" }}>
                        {mm}/{yyyy}{cvv ? ` · ${cvv}` : ""}
                      </span>
                      <div>
                        <StatusBadge result={res} />
                      </div>
                      <div className="min-w-0">
                        {res.bank && (
                          <p className="text-[8.5px] font-mono truncate" style={{ color: "rgba(255,255,255,0.2)" }} title={res.bank}>
                            {res.bank}
                          </p>
                        )}
                        {res.message && !res.bank && (
                          <p className="text-[8.5px] font-mono truncate" style={{ color: "rgba(255,255,255,0.15)" }}>{res.message}</p>
                        )}
                      </div>
                      <div className="flex justify-end">
                        {res.status === "idle" || res.status === "unknown" || res.status === "dead" ? (
                          <button
                            onClick={() => checkSingle(i, pipe)}
                            disabled={checking}
                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded text-[8.5px] font-mono transition-all disabled:cursor-not-allowed"
                            style={{ background: "rgba(0,255,65,0.06)", border: "1px solid rgba(0,255,65,0.15)", color: "rgba(0,255,65,0.5)" }}
                            data-testid={`btn-check-${i}`}
                          >
                            <Shield className="w-2 h-2" /> CHK
                          </button>
                        ) : res.status === "live" ? (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                            <Wifi className="w-3 h-3" style={{ color: "#00ff41" }} />
                          </div>
                        ) : res.status === "checking" ? (
                          <Loader className="w-3 h-3 animate-spin" style={{ color: "rgba(251,191,36,0.5)" }} />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Footer */}
              <div className="px-4 py-2 flex items-center justify-between" style={{ borderTop: "1px solid rgba(0,255,65,0.06)", background: "rgba(0,0,0,0.3)" }}>
                <span className="text-[8.5px] font-mono" style={{ color: "rgba(0,255,65,0.2)" }}>
                  {cards.length} cards · {network.name} · BIN {form.bin}
                </span>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: network.color, boxShadow: `0 0 4px ${network.color}` }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

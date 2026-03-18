import { useState, useCallback } from "react";
import { CreditCard, Copy, RefreshCw, Download, Zap, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MONTHS = ["Random", "01","02","03","04","05","06","07","08","09","10","11","12"];
const currentYear = new Date().getFullYear();
const YEARS = ["Random", ...Array.from({ length: 10 }, (_, i) => String(currentYear + i))];
const QUANTITIES = ["1","5","10","20","50","100","200","500","999"];

function detectNetwork(bin: string): { name: string; color1: string; color2: string; accent: string } {
  if (bin.startsWith("34") || bin.startsWith("37")) return { name: "AMEX",       color1: "#0f4c81", color2: "#1a6bb5", accent: "#60b4ff" };
  if (bin.startsWith("4"))                           return { name: "VISA",       color1: "#1a237e", color2: "#283593", accent: "#7c8fff" };
  if (bin.startsWith("51") || bin.startsWith("52") || bin.startsWith("53") || bin.startsWith("54") || bin.startsWith("55") || (parseInt(bin) >= 222100 && parseInt(bin) <= 272099))
                                                     return { name: "MASTERCARD", color1: "#7b1113", color2: "#b71c1c", accent: "#ff6b6b" };
  if (bin.startsWith("6011") || bin.startsWith("65"))return { name: "DISCOVER",  color1: "#e65100", color2: "#bf360c", accent: "#ffb74d" };
  return                                                    { name: "CARD",       color1: "#1b1b2f", color2: "#2a2a4a", accent: "#a78bfa" };
}

function formatCardNumber(n: string): string {
  if (n.length === 15) return `${n.slice(0,4)} ${n.slice(4,10)} ${n.slice(10)}`;
  return n.replace(/(.{4})/g, "$1 ").trim();
}

function parseCard(pipe: string) {
  const [number = "", mm = "", yyyy = "", cvv = ""] = pipe.split("|");
  return { number, mm, yyyy, cvv };
}

function CreditCardVisual({ pipe, index, network }: { pipe: string; index: number; network: ReturnType<typeof detectNetwork> }) {
  const { toast } = useToast();
  const { number, mm, yyyy, cvv } = parseCard(pipe);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  function copy(value: string, field: string) {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    toast({ title: "Copied", description: value });
    setTimeout(() => setCopiedField(null), 1500);
  }

  const CopyBtn = ({ value, field }: { value: string; field: string }) => (
    <button
      onClick={e => { e.stopPropagation(); copy(value, field); }}
      className="opacity-0 group-hover:opacity-100 transition-all ml-1.5"
      data-testid={`copy-${field}-${index}`}
    >
      {copiedField === field
        ? <Check className="w-2.5 h-2.5 text-emerald-400" />
        : <Copy className="w-2.5 h-2.5 text-white/40 hover:text-white/80" />}
    </button>
  );

  return (
    <div
      className="group relative rounded-2xl overflow-hidden cursor-pointer select-none shrink-0"
      style={{ width: 300, height: 180, background: `linear-gradient(135deg, ${network.color1}, ${network.color2})` }}
      onClick={() => copy(pipe, `card-${index}`)}
      data-testid={`card-visual-${index}`}
    >
      {/* Holographic shimmer overlay */}
      <div className="absolute inset-0 opacity-20" style={{
        background: "linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.15) 50%, transparent 70%)",
        backgroundSize: "200% 200%",
      }} />
      {/* Grid pattern */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0px, transparent 1px, transparent 20px), repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0px, transparent 1px, transparent 20px)",
      }} />
      {/* Glow circle top-right */}
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-20" style={{ background: `radial-gradient(circle, ${network.accent}, transparent)` }} />

      {/* Card content */}
      <div className="relative h-full flex flex-col justify-between p-5">
        {/* Top row: number badge + network */}
        <div className="flex items-start justify-between">
          <span className="text-[10px] font-mono text-white/40 tabular-nums">#{index + 1}</span>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}>
            <CreditCard className="w-2.5 h-2.5" style={{ color: network.accent }} />
            <span className="text-[9px] font-mono font-bold tracking-widest" style={{ color: network.accent }}>{network.name}</span>
          </div>
        </div>

        {/* Card number */}
        <div className="group/num flex items-center gap-1">
          <span className="text-[15px] font-mono font-bold text-white tracking-widest drop-shadow-lg" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
            {formatCardNumber(number)}
          </span>
          <CopyBtn value={number} field={`num-${index}`} />
        </div>

        {/* Bottom row */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[8px] font-mono text-white/30 uppercase tracking-widest mb-0.5">Expires</p>
            <div className="group/exp flex items-center gap-1">
              <p className="text-[13px] font-mono text-white/90 font-semibold">{mm}/{yyyy}</p>
              <CopyBtn value={`${mm}/${yyyy}`} field={`exp-${index}`} />
            </div>
          </div>
          {cvv && (
            <div className="text-right">
              <p className="text-[8px] font-mono text-white/30 uppercase tracking-widest mb-0.5">CVV</p>
              <div className="group/cvv flex items-center gap-1">
                <p className="text-[13px] font-mono text-white/90 font-semibold">{cvv}</p>
                <CopyBtn value={cvv} field={`cvv-${index}`} />
              </div>
            </div>
          )}
          {/* Copy hint */}
          <div className="absolute bottom-3 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-[8px] font-mono text-white/30">click to copy</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactRow({ pipe, index, network }: { pipe: string; index: number; network: ReturnType<typeof detectNetwork> }) {
  const { toast } = useToast();
  const { number, mm, yyyy, cvv } = parseCard(pipe);

  function copy() {
    navigator.clipboard.writeText(pipe);
    toast({ title: "Copied", description: pipe });
  }

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg group cursor-pointer transition-all hover:scale-[1.005]"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}
      onClick={copy}
      data-testid={`card-row-${index}`}
    >
      <span className="text-[9px] font-mono text-white/15 w-5 shrink-0 tabular-nums">{index + 1}</span>
      <div className="w-1.5 h-4 rounded-full shrink-0" style={{ background: network.accent, boxShadow: `0 0 6px ${network.accent}60` }} />
      <span className="text-[11px] font-mono flex-1 tabular-nums" style={{ color: network.accent }}>{number}</span>
      <span className="text-[10px] font-mono text-white/35">{mm}/{yyyy}</span>
      {cvv && <span className="text-[10px] font-mono text-white/25">{cvv}</span>}
      <Copy className="w-3 h-3 text-white/15 group-hover:text-white/50 shrink-0 transition-colors" />
    </div>
  );
}

type FormState = { bin: string; dateEnabled: boolean; expmon: string; expyear: string; cvvEnabled: boolean; cvv: string; quantity: string };

export default function CardGenerator() {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>({ bin: "", dateEnabled: true, expmon: "Random", expyear: "Random", cvvEnabled: true, cvv: "", quantity: "10" });
  const [cards, setCards] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  const network = detectNetwork(form.bin);
  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm(f => ({ ...f, [k]: v })); }

  async function generate() {
    if (!/^\d{6,8}$/.test(form.bin.trim())) { setError("BIN must be 6–8 digits"); return; }
    setError(""); setLoading(true); setCards([]);
    try {
      const res = await fetch("/api/card-generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ bin: form.bin.trim(), quantity: parseInt(form.quantity) || 10, expmon: form.dateEnabled ? form.expmon : "random", expyear: form.dateEnabled ? form.expyear : "random", cvvEnabled: form.cvvEnabled, cvv: form.cvv || "" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Generation failed"); return; }
      const list: string[] = Array.isArray(data.cards) ? data.cards : [];
      setCards(list);
      if (list.length > 6) setViewMode("list"); else setViewMode("card");
    } catch (e: any) { setError(e.message || "Network error"); }
    finally { setLoading(false); }
  }

  function copyAll() { navigator.clipboard.writeText(cards.join("\n")); toast({ title: `${cards.length} cards copied` }); }
  function exportCSV() {
    const rows = ["Number,Month,Year,CVV", ...cards.map(c => c.replace(/\|/g, ","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" })); a.download = `cards_${form.bin}.csv`; a.click();
  }

  const inputCls = "w-full px-3.5 py-2.5 rounded-xl text-[12px] font-mono outline-none transition-all focus:ring-1";
  const inputStyle = { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", caretColor: "#fbbf24" };
  const inputFocus = { "--tw-ring-color": "#fbbf2440" } as React.CSSProperties;
  const labelCls = "block text-[9px] font-mono text-white/25 uppercase tracking-[0.15em] mb-1.5";
  const selCls = "w-full px-3.5 py-2.5 rounded-xl text-[12px] font-mono outline-none cursor-pointer appearance-none";

  function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label: string }) {
    return (
      <button onClick={onToggle} className="flex items-center gap-2.5 group">
        <div className="relative w-9 h-5 rounded-full transition-all duration-200 shrink-0" style={{ background: enabled ? "rgba(251,191,36,0.3)" : "rgba(255,255,255,0.06)", border: enabled ? "1px solid rgba(251,191,36,0.5)" : "1px solid rgba(255,255,255,0.1)" }}>
          <div className="absolute top-0.5 transition-all duration-200 w-4 h-4 rounded-full shadow-lg" style={{ left: enabled ? "calc(100% - 18px)" : "2px", background: enabled ? "#fbbf24" : "rgba(255,255,255,0.2)", boxShadow: enabled ? "0 0 8px rgba(251,191,36,0.6)" : "none" }} />
        </div>
        <span className="text-[11px] font-mono font-semibold tracking-wider transition-colors" style={{ color: enabled ? "#fbbf24" : "rgba(255,255,255,0.2)" }}>{label}</span>
      </button>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(245,158,11,0.1))", border: "1px solid rgba(251,191,36,0.3)", boxShadow: "0 0 20px rgba(251,191,36,0.15)" }}>
            <CreditCard className="w-4.5 h-4.5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-white font-mono font-bold text-xl tracking-tight flex items-center gap-2.5">
              Card_Generator
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full font-mono tracking-widest" style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>TEST ONLY</span>
            </h1>
            <p className="text-white/20 mt-0.5 text-[11px] font-mono">Luhn-valid test cards · {cards.length > 0 ? `${cards.length} generated` : "Enter BIN to start"}</p>
          </div>
        </div>
        {cards.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => setViewMode(viewMode === "card" ? "list" : "card")} className="px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              {viewMode === "card" ? "List View" : "Card View"}
            </button>
            <button onClick={copyAll} data-testid="btn-copy-all" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all hover:opacity-80" style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
              <Copy className="w-3 h-3" /> Copy All
            </button>
            <button onClick={exportCSV} data-testid="btn-export" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono transition-all hover:opacity-80" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}>
              <Download className="w-3 h-3" /> CSV
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5" style={{ gridTemplateColumns: "320px 1fr" }}>
        {/* Config panel */}
        <div className="rounded-2xl p-5 space-y-5 h-fit sticky top-4" style={{ background: "linear-gradient(180deg, rgba(251,191,36,0.04) 0%, rgba(0,0,0,0.3) 100%)", border: "1px solid rgba(251,191,36,0.12)", boxShadow: "0 0 40px rgba(251,191,36,0.04)" }}>

          {/* BIN + Network badge */}
          <div>
            <label className={labelCls}>BIN Number</label>
            <div className="relative">
              <input
                type="text" value={form.bin}
                onChange={e => { set("bin", e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
                placeholder="e.g. 453590"
                maxLength={8}
                data-testid="input-bin"
                className={`${inputCls} pr-20`}
                style={{ ...inputStyle, borderColor: error ? "rgba(248,113,113,0.5)" : form.bin.length >= 6 ? `${network.accent}40` : "rgba(255,255,255,0.08)", boxShadow: form.bin.length >= 6 ? `0 0 0 1px ${network.accent}20, inset 0 0 20px ${network.accent}06` : "none" }}
              />
              {form.bin.length >= 6 && (
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md text-[9px] font-mono font-bold tracking-wider" style={{ background: `${network.color1}cc`, border: `1px solid ${network.accent}40`, color: network.accent }}>
                  {network.name}
                </div>
              )}
            </div>
            {error && <p className="text-red-400/80 text-[10px] font-mono mt-1.5">{error}</p>}
          </div>

          {/* DATE toggle */}
          <div className="space-y-3">
            <Toggle enabled={form.dateEnabled} onToggle={() => set("dateEnabled", !form.dateEnabled)} label="EXPIRY DATE" />
            {form.dateEnabled && (
              <div className="grid grid-cols-2 gap-2 pl-1">
                <div>
                  <label className={labelCls}>Month</label>
                  <select value={form.expmon} onChange={e => set("expmon", e.target.value)} className={selCls} style={{ ...inputStyle }} data-testid="select-expmon">
                    {MONTHS.map(m => <option key={m} style={{ background: "#111" }}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Year</label>
                  <select value={form.expyear} onChange={e => set("expyear", e.target.value)} className={selCls} style={{ ...inputStyle }} data-testid="select-expyear">
                    {YEARS.map(y => <option key={y} style={{ background: "#111" }}>{y}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* CVV toggle */}
          <div className="space-y-3">
            <Toggle enabled={form.cvvEnabled} onToggle={() => set("cvvEnabled", !form.cvvEnabled)} label="CVV" />
            {form.cvvEnabled && (
              <div className="pl-1">
                <input type="text" value={form.cvv} onChange={e => set("cvv", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Leave blank to randomize" data-testid="input-cvv" className={inputCls} style={inputStyle} />
              </div>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className={labelCls}>Quantity</label>
            <div className="flex flex-wrap gap-1.5">
              {QUANTITIES.map(q => (
                <button key={q} onClick={() => set("quantity", q)} data-testid={`btn-qty-${q}`}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all"
                  style={form.quantity === q
                    ? { background: "rgba(251,191,36,0.2)", border: "1px solid rgba(251,191,36,0.5)", color: "#fbbf24", boxShadow: "0 0 10px rgba(251,191,36,0.2)" }
                    : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button onClick={generate} disabled={loading} data-testid="btn-generate"
            className="w-full py-3 rounded-xl font-mono text-[13px] font-bold flex items-center justify-center gap-2.5 transition-all disabled:opacity-50 active:scale-[0.98]"
            style={{ background: loading ? "rgba(251,191,36,0.1)" : "linear-gradient(135deg, rgba(251,191,36,0.35), rgba(245,158,11,0.2))", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", boxShadow: loading ? "none" : "0 0 30px rgba(251,191,36,0.15), inset 0 1px 0 rgba(255,255,255,0.1)" }}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? "GENERATING..." : "GENERATE"}
          </button>
        </div>

        {/* Output panel */}
        <div className="min-w-0">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 rounded-2xl" style={{ border: "1px dashed rgba(251,191,36,0.1)" }}>
              <RefreshCw className="w-6 h-6 text-amber-400/30 animate-spin" />
              <p className="text-[11px] font-mono text-white/15">Generating {form.quantity} cards...</p>
            </div>
          ) : cards.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 rounded-2xl" style={{ border: "1px dashed rgba(255,255,255,0.05)" }}>
              <CreditCard className="w-8 h-8 text-white/8" />
              <p className="text-[11px] font-mono text-white/12">Enter a BIN and click Generate</p>
            </div>
          ) : viewMode === "card" ? (
            <div className="flex flex-wrap gap-4" data-testid="container-cards">
              {cards.map((c, i) => <CreditCardVisual key={i} pipe={c} index={i} network={network} />)}
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(251,191,36,0.03)" }}>
                <span className="text-[10px] font-mono text-amber-400/40 uppercase tracking-wider">{cards.length} cards · {network.name}</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: network.accent, boxShadow: `0 0 6px ${network.accent}` }} />
                </div>
              </div>
              <div className="p-3 space-y-1 h-[500px] overflow-y-auto overflow-x-hidden" style={{ wordBreak: "break-all" }} data-testid="container-cards-list">
                {cards.map((c, i) => <CompactRow key={i} pipe={c} index={i} network={network} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

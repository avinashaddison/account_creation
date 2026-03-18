import { useState } from "react";
import { CreditCard, Copy, RefreshCw, Download, Zap, ToggleLeft, ToggleRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MONTHS = ["Random", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const currentYear = new Date().getFullYear();
const YEARS = ["Random", ...Array.from({ length: 10 }, (_, i) => String(currentYear + i))];
const QUANTITIES = ["1", "5", "10", "20", "50", "100", "200", "500", "999"];

type FormState = {
  bin: string;
  format: string;
  dateEnabled: boolean;
  expmon: string;
  expyear: string;
  cvvEnabled: boolean;
  cvv: string;
  quantity: string;
};

export default function CardGenerator() {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>({
    bin: "",
    format: "PIPE",
    dateEnabled: true,
    expmon: "Random",
    expyear: "Random",
    cvvEnabled: true,
    cvv: "",
    quantity: "10",
  });
  const [cards, setCards] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function generate() {
    if (!/^\d{6,8}$/.test(form.bin.trim())) {
      setError("BIN must be 6–8 digits (e.g. 453590)");
      return;
    }
    setError("");
    setLoading(true);
    setCards([]);
    try {
      const res = await fetch("/api/card-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          bin: form.bin.trim(),
          quantity: parseInt(form.quantity) || 10,
          expmon: form.dateEnabled ? form.expmon : undefined,
          expyear: form.dateEnabled ? form.expyear : undefined,
          cvv: form.cvvEnabled && form.cvv ? form.cvv : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed");
        return;
      }
      const list: string[] = Array.isArray(data.cards) ? data.cards : Array.isArray(data) ? data : [];
      setCards(list);
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    navigator.clipboard.writeText(cards.join("\n"));
    toast({ title: "Copied", description: `${cards.length} cards copied to clipboard` });
  }

  function copyCard(c: string) {
    navigator.clipboard.writeText(c);
    toast({ title: "Copied", description: c });
  }

  function reset() {
    setCards([]);
    setError("");
    setForm({ bin: "", format: "PIPE", dateEnabled: true, expmon: "Random", expyear: "Random", cvvEnabled: true, cvv: "", quantity: "10" });
  }

  function exportCSV() {
    const rows = ["Number,Expiry Month,Expiry Year,CVV",
      ...cards.map(c => {
        const parts = c.split("|");
        return parts.join(",");
      })
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = `cards_${form.bin}.csv`;
    a.click();
  }

  const sel = "w-full px-3 py-2 rounded-lg text-[12px] font-mono text-white/70 outline-none appearance-none cursor-pointer";
  const selStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(251,191,36,0.15)", color: "rgba(255,255,255,0.7)" };
  const labelCls = "text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1 block";

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)" }}>
          <CreditCard className="w-4 h-4 text-amber-400" />
        </div>
        <div>
          <h1 className="text-white font-mono font-bold text-lg tracking-tight flex items-center gap-2">
            Card_Generator
            <span className="text-[10px] font-normal px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>TEST ONLY</span>
          </h1>
          <p className="text-amber-400/30 mt-0.5 text-[11px] font-mono">Generate test card numbers · Powered by namso-gen</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Config panel */}
        <div className="min-w-0 rounded-xl p-5 space-y-4" style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.18)" }}>

          {/* BIN */}
          <div>
            <label className={labelCls}>BIN</label>
            <input
              type="text"
              value={form.bin}
              onChange={e => set("bin", e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="e.g. 453590"
              maxLength={8}
              data-testid="input-bin"
              className="w-full px-3 py-2 rounded-lg text-[12px] font-mono text-white/80 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${error && !form.bin ? "#f87171" : "rgba(251,191,36,0.2)"}`, caretColor: "#fbbf24" }}
            />
            {error && !form.bin && <p className="text-red-400 text-[10px] font-mono mt-1">{error}</p>}
          </div>

          {/* Format */}
          <div>
            <label className={labelCls}>Format</label>
            <select value={form.format} onChange={e => set("format", e.target.value)} className={sel} style={selStyle} data-testid="select-format">
              <option>PIPE</option>
            </select>
          </div>

          {/* DATE toggle */}
          <div className="space-y-2">
            <button
              onClick={() => set("dateEnabled", !form.dateEnabled)}
              data-testid="toggle-date"
              className="flex items-center gap-2 text-[11px] font-mono font-medium transition-colors"
              style={{ color: form.dateEnabled ? "#fbbf24" : "rgba(255,255,255,0.25)" }}
            >
              {form.dateEnabled
                ? <ToggleRight className="w-5 h-5" style={{ color: "#fbbf24" }} />
                : <ToggleLeft className="w-5 h-5" style={{ color: "rgba(255,255,255,0.2)" }} />}
              DATE
            </button>
            {form.dateEnabled && (
              <div className="grid grid-cols-2 gap-2 pl-7">
                <div>
                  <label className={labelCls}>Expiration Month</label>
                  <select value={form.expmon} onChange={e => set("expmon", e.target.value)} className={sel} style={selStyle} data-testid="select-expmon">
                    {MONTHS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Expiration Year</label>
                  <select value={form.expyear} onChange={e => set("expyear", e.target.value)} className={sel} style={selStyle} data-testid="select-expyear">
                    {YEARS.map(y => <option key={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* CVV toggle */}
          <div className="space-y-2">
            <button
              onClick={() => set("cvvEnabled", !form.cvvEnabled)}
              data-testid="toggle-cvv"
              className="flex items-center gap-2 text-[11px] font-mono font-medium transition-colors"
              style={{ color: form.cvvEnabled ? "#fbbf24" : "rgba(255,255,255,0.25)" }}
            >
              {form.cvvEnabled
                ? <ToggleRight className="w-5 h-5" style={{ color: "#fbbf24" }} />
                : <ToggleLeft className="w-5 h-5" style={{ color: "rgba(255,255,255,0.2)" }} />}
              CVV
            </button>
            {form.cvvEnabled && (
              <div className="pl-7">
                <input
                  type="text"
                  value={form.cvv}
                  onChange={e => set("cvv", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="Leave blank to randomize"
                  data-testid="input-cvv"
                  className="w-full px-3 py-2 rounded-lg text-[12px] font-mono text-white/70 outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(251,191,36,0.15)", caretColor: "#fbbf24" }}
                />
              </div>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className={labelCls}>Quantity</label>
            <select value={form.quantity} onChange={e => set("quantity", e.target.value)} className={sel} style={selStyle} data-testid="select-quantity">
              {QUANTITIES.map(q => <option key={q}>{q}</option>)}
            </select>
          </div>

          {/* Error */}
          {error && form.bin && <p className="text-red-400 text-[10px] font-mono">{error}</p>}

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={loading}
            data-testid="btn-generate"
            className="w-full py-2.5 rounded-lg font-mono text-[12px] font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.3), rgba(245,158,11,0.18))", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24" }}
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {loading ? "GENERATING..." : "GENERATE"}
          </button>
        </div>

        {/* Output panel */}
        <div className="min-w-0 sticky top-4">
          <div className="rounded-xl overflow-hidden flex flex-col min-w-0" style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(251,191,36,0.12)" }}>
            {/* Output header */}
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(251,191,36,0.08)", background: "rgba(251,191,36,0.04)" }}>
              <span className="text-[10px] font-mono text-amber-400/50 uppercase tracking-wider">
                {cards.length > 0 ? `${cards.length} cards` : "Output"}
              </span>
              {cards.length > 0 && (
                <div className="flex gap-1.5">
                  <button onClick={copyAll} data-testid="btn-copy-all" className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors hover:text-amber-400" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.15)", color: "rgba(251,191,36,0.6)" }}>
                    <Copy className="w-2.5 h-2.5" /> Copy
                  </button>
                  <button onClick={exportCSV} data-testid="btn-export" className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors hover:text-amber-400" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.15)", color: "rgba(251,191,36,0.6)" }}>
                    <Download className="w-2.5 h-2.5" /> CSV
                  </button>
                  <button onClick={reset} data-testid="btn-reset" className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors hover:text-amber-400" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.15)", color: "rgba(251,191,36,0.6)" }}>
                    Reset
                  </button>
                </div>
              )}
            </div>

            {/* Output body */}
            <div
              className="h-[420px] overflow-y-auto overflow-x-hidden p-3 space-y-1"
              style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
              data-testid="container-cards"
            >
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 text-amber-400/40 animate-spin" />
                  <p className="text-[10px] font-mono text-white/20">fetching from namso-gen...</p>
                </div>
              ) : cards.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <CreditCard className="w-6 h-6 text-white/10" />
                  <p className="text-[10px] font-mono text-white/15">enter a BIN and click Generate</p>
                </div>
              ) : (
                cards.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded group cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => copyCard(c)}
                    data-testid={`card-row-${i}`}
                  >
                    <span className="text-[9px] font-mono text-white/15 w-5 shrink-0 tabular-nums">{i + 1}</span>
                    <span className="text-[11px] font-mono text-amber-300/80 flex-1 tabular-nums select-all">{c}</span>
                    <Copy className="w-3 h-3 text-white/15 group-hover:text-amber-400/60 shrink-0 transition-colors" />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

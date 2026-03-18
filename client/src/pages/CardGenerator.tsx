import { useState } from "react";
import { CreditCard, Copy, RefreshCw, Download, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Network = "Visa" | "Mastercard" | "Amex" | "Discover" | "Random";

const BINS: Record<string, string[]> = {
  Visa:       ["4111111111111111", "4242424242424242", "4000056655665556"],
  Mastercard: ["5555555555554444", "5105105105105100", "2221000000000009"],
  Amex:       ["378282246310005",  "371449635398431",  "340000000000009"],
  Discover:   ["6011111111111117", "6011000990139424", "6500000000000002"],
};

const NETWORK_COLORS: Record<string, string> = {
  Visa:       "#1a1f71",
  Mastercard: "#eb001b",
  Amex:       "#2e77bc",
  Discover:   "#f76f20",
  Random:     "#6366f1",
};

function luhn(num: string): string {
  const digits = num.split("").map(Number);
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  const check = (10 - (sum % 10)) % 10;
  return num + check;
}

function generateCard(network: Network, bin: string): { number: string; expiry: string; cvv: string; network: string } {
  const nets: Network[] = ["Visa", "Mastercard", "Amex", "Discover"];
  const resolved: Network = network === "Random" ? nets[Math.floor(Math.random() * nets.length)] : network;

  let base = bin.replace(/\D/g, "");
  if (!base) {
    const pool = BINS[resolved];
    base = pool[Math.floor(Math.random() * pool.length)].slice(0, 6);
  }

  const isAmex = resolved === "Amex";
  const targetLen = isAmex ? 14 : 15; // leave 1 for luhn check
  while (base.length < targetLen) base += Math.floor(Math.random() * 10);
  const number = luhn(base);

  const now = new Date();
  const expMonth = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const expYear = String(now.getFullYear() + 1 + Math.floor(Math.random() * 4)).slice(-2);
  const cvv = isAmex
    ? String(Math.floor(1000 + Math.random() * 9000))
    : String(Math.floor(100 + Math.random() * 900));

  return { number, expiry: `${expMonth}/${expYear}`, cvv, network: resolved };
}

function formatNumber(n: string) {
  if (n.length === 15) return `${n.slice(0,4)} ${n.slice(4,10)} ${n.slice(10)}`;
  return n.replace(/(.{4})/g, "$1 ").trim();
}

type Card = { number: string; expiry: string; cvv: string; network: string };

export default function CardGenerator() {
  const { toast } = useToast();
  const [network, setNetwork] = useState<Network>("Visa");
  const [bin, setBin] = useState("");
  const [count, setCount] = useState(5);
  const [cards, setCards] = useState<Card[]>([]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  function generate() {
    const generated: Card[] = [];
    for (let i = 0; i < count; i++) generated.push(generateCard(network, bin));
    setCards(generated);
    setRevealed(new Set());
  }

  function copyCard(c: Card) {
    const text = `${c.number}|${c.expiry}|${c.cvv}|${c.network}`;
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: text });
  }

  function copyAll() {
    const text = cards.map(c => `${c.number}|${c.expiry}|${c.cvv}|${c.network}`).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "All cards copied", description: `${cards.length} cards copied to clipboard` });
  }

  function exportCSV() {
    const rows = ["Number,Expiry,CVV,Network", ...cards.map(c => `${c.number},${c.expiry},${c.cvv},${c.network}`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = "cards.csv";
    a.click();
  }

  function toggleReveal(i: number) {
    setRevealed(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const networks: Network[] = ["Visa", "Mastercard", "Amex", "Discover", "Random"];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)" }}>
          <CreditCard className="w-4 h-4 text-amber-400" />
        </div>
        <div>
          <h1 className="text-white font-mono font-bold text-lg tracking-tight flex items-center gap-2">
            Card_Generator
            <span className="text-[10px] font-normal px-1.5 py-0.5 rounded font-mono" style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>TEST ONLY</span>
          </h1>
          <p className="text-amber-400/30 mt-0.5 text-[11px] font-mono pl-0">Generate test card numbers using Luhn algorithm</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Config */}
        <div className="min-w-0 rounded-xl p-5 space-y-4" style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.15)" }}>
          <span className="text-[11px] font-mono text-amber-400/60 uppercase tracking-wider">Configuration</span>

          <div>
            <label className="block text-[10px] font-mono text-white/40 mb-2 uppercase tracking-wider">Network</label>
            <div className="flex flex-wrap gap-1.5">
              {networks.map(n => (
                <button
                  key={n}
                  onClick={() => setNetwork(n)}
                  data-testid={`btn-network-${n.toLowerCase()}`}
                  className="px-3 py-1 rounded-lg text-[11px] font-mono font-medium transition-all"
                  style={network === n ? {
                    background: `${NETWORK_COLORS[n]}22`,
                    border: `1px solid ${NETWORK_COLORS[n]}55`,
                    color: NETWORK_COLORS[n] === "#eb001b" ? "#f87171" : NETWORK_COLORS[n] === "#1a1f71" ? "#93c5fd" : "#fbbf24",
                  } : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.35)" }}
                >{n}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-white/40 mb-1.5 uppercase tracking-wider">BIN Prefix (optional)</label>
            <input
              type="text"
              value={bin}
              onChange={e => setBin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="e.g. 411111"
              maxLength={8}
              data-testid="input-bin"
              className="w-full px-3 py-2 rounded-lg text-[12px] font-mono text-white/80 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(251,191,36,0.15)", caretColor: "#fbbf24" }}
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono text-white/40 mb-1.5 uppercase tracking-wider">Count — {count}</label>
            <input
              type="range" min={1} max={50} value={count}
              onChange={e => setCount(parseInt(e.target.value))}
              data-testid="input-count"
              className="w-full h-1.5 rounded-full cursor-pointer accent-amber-400"
            />
          </div>

          <button
            onClick={generate}
            data-testid="btn-generate"
            className="w-full py-2.5 rounded-lg font-mono text-[12px] font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.25), rgba(245,158,11,0.15))", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}
          >
            <Zap className="w-3.5 h-3.5" />
            GENERATE {count} CARD{count > 1 ? "S" : ""}
          </button>
        </div>

        {/* Output */}
        <div className="min-w-0 sticky top-4">
          <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(251,191,36,0.12)" }}>
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(251,191,36,0.08)", background: "rgba(251,191,36,0.04)" }}>
              <span className="text-[10px] font-mono text-amber-400/50 uppercase tracking-wider">
                {cards.length > 0 ? `${cards.length} cards generated` : "Output"}
              </span>
              {cards.length > 0 && (
                <div className="flex gap-2">
                  <button onClick={copyAll} data-testid="btn-copy-all" className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-amber-400/60 hover:text-amber-400 transition-colors" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.12)" }}>
                    <Copy className="w-2.5 h-2.5" /> Copy All
                  </button>
                  <button onClick={exportCSV} data-testid="btn-export-csv" className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-amber-400/60 hover:text-amber-400 transition-colors" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.12)" }}>
                    <Download className="w-2.5 h-2.5" /> CSV
                  </button>
                  <button onClick={generate} data-testid="btn-regenerate" className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-amber-400/60 hover:text-amber-400 transition-colors" style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.12)" }}>
                    <RefreshCw className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="h-96 overflow-y-auto overflow-x-hidden p-3 space-y-1.5" data-testid="container-cards">
              {cards.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2">
                  <CreditCard className="w-6 h-6 text-white/10" />
                  <p className="text-[10px] font-mono text-white/15">configure and generate cards...</p>
                </div>
              ) : (
                cards.map((c, i) => {
                  const show = revealed.has(i);
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg group" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <span className="text-[9px] font-mono text-white/20 w-5 shrink-0 tabular-nums">{i + 1}</span>
                      <span className="text-[10px] font-mono text-amber-300/80 flex-1 tabular-nums" data-testid={`card-number-${i}`}>
                        {show ? formatNumber(c.number) : formatNumber(c.number).replace(/\d(?=.{4})/g, "•")}
                      </span>
                      <span className="text-[9px] font-mono text-white/30 shrink-0">{c.expiry}</span>
                      <span className="text-[9px] font-mono text-white/30 shrink-0">{show ? c.cvv : "•••"}</span>
                      <span className="text-[8px] font-mono text-white/20 shrink-0 w-14 text-right">{c.network}</span>
                      <button onClick={() => toggleReveal(i)} data-testid={`btn-reveal-${i}`} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-mono text-white/30 hover:text-white/60 px-1">
                        {show ? "hide" : "show"}
                      </button>
                      <button onClick={() => copyCard(c)} data-testid={`btn-copy-${i}`} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Copy className="w-3 h-3 text-white/30 hover:text-amber-400 transition-colors" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

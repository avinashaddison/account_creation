import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { CreditCard, Plus, Trash2, Eye, EyeOff, Copy, Check, Shield, Zap, Activity, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SavedCard } from "@shared/schema";

function detectCardType(n: string): string {
  const num = n.replace(/\s/g, "");
  if (/^4/.test(num)) return "visa";
  if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^6/.test(num)) return "discover";
  return "visa";
}

const CARD_COLORS: Record<string, { bg: string; accent: string; glow: string; label: string }> = {
  visa:       { bg: "linear-gradient(135deg,#1a237e,#283593)", accent: "#90caf9", glow: "rgba(144,202,249,0.3)", label: "VISA" },
  mastercard: { bg: "linear-gradient(135deg,#b71c1c,#880e4f)", accent: "#f48fb1", glow: "rgba(244,143,177,0.3)", label: "MASTERCARD" },
  amex:       { bg: "linear-gradient(135deg,#006064,#00796b)", accent: "#80cbc4", glow: "rgba(128,203,196,0.3)", label: "AMEX" },
  discover:   { bg: "linear-gradient(135deg,#e65100,#bf360c)", accent: "#ffcc80", glow: "rgba(255,204,128,0.3)", label: "DISCOVER" },
};

function maskNumber(n: string) {
  const clean = n.replace(/\s/g, "");
  return `•••• •••• •••• ${clean.slice(-4)}`;
}

function CreditCardDisplay({ card, onDelete }: { card: SavedCard; onDelete: () => void }) {
  const [showFull, setShowFull] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const style = CARD_COLORS[card.cardType] || CARD_COLORS.visa;

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    sounds.hover();
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ boxShadow: `0 8px 40px ${style.glow}, 0 2px 12px rgba(0,0,0,0.5)` }}>
      {/* Card face */}
      <div className="relative p-5" style={{ background: style.bg, minHeight: 170 }}>
        {/* Scanlines */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.025) 3px,rgba(255,255,255,0.025) 4px)" }} />
        {/* Glow circles */}
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none" style={{ background: style.accent, filter: "blur(50px)", opacity: 0.15 }} />
        <div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full pointer-events-none" style={{ background: style.accent, filter: "blur(40px)", opacity: 0.1 }} />

        <div className="relative flex flex-col gap-4">
          {/* Top row */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest mb-0.5" style={{ color: `${style.accent}99` }}>
                {style.label}
              </p>
              <p className="text-xs font-mono font-semibold" style={{ color: style.accent }}>
                {card.label}
              </p>
            </div>
            <div className="w-10 h-7 rounded-md" style={{ background: "rgba(255,255,255,0.15)", border: `1px solid ${style.accent}30` }}>
              <div className="w-full h-full rounded-md" style={{ background: "linear-gradient(135deg,rgba(255,215,0,0.6),rgba(255,165,0,0.4))" }} />
            </div>
          </div>

          {/* Card number */}
          <div className="flex items-center gap-2">
            <p className="text-base font-mono tracking-widest font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>
              {showFull ? card.cardNumber.replace(/(.{4})/g, "$1 ").trim() : maskNumber(card.cardNumber)}
            </p>
            <button onClick={() => { setShowFull(!showFull); sounds.hover(); }} className="opacity-50 hover:opacity-100 transition-opacity">
              {showFull ? <EyeOff className="w-3.5 h-3.5 text-white" /> : <Eye className="w-3.5 h-3.5 text-white" />}
            </button>
            <button onClick={() => copy(card.cardNumber, "num")} className="opacity-50 hover:opacity-100 transition-opacity" data-testid={`copy-card-number-${card.id}`}>
              {copied === "num" ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-white" />}
            </button>
          </div>

          {/* Bottom row */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[8px] font-mono uppercase tracking-widest mb-0.5" style={{ color: `${style.accent}80` }}>Card Holder</p>
              <p className="text-[11px] font-mono font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.85)" }}>{card.cardholderName}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] font-mono uppercase tracking-widest mb-0.5" style={{ color: `${style.accent}80` }}>Expires</p>
              <p className="text-[11px] font-mono font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>{card.expiryMonth}/{card.expiryYear.slice(-2)}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] font-mono uppercase tracking-widest mb-0.5" style={{ color: `${style.accent}80` }}>CVV</p>
              <p className="text-[11px] font-mono font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>{showCvv ? card.cvv : "•••"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions strip */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "rgba(0,0,0,0.7)", borderTop: `1px solid ${style.accent}20` }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setShowCvv(!showCvv); sounds.hover(); }}
            className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: style.accent }}
            data-testid={`toggle-cvv-${card.id}`}
          >
            {showCvv ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} CVV
          </button>
          <button
            onClick={() => copy(`${card.cardNumber}|${card.expiryMonth}|${card.expiryYear}|${card.cvv}`, "all")}
            className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: style.accent }}
            data-testid={`copy-all-${card.id}`}
          >
            {copied === "all" ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            Copy All
          </button>
        </div>
        <button
          onClick={() => { sounds.error(); onDelete(); }}
          className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-red-400/50 hover:text-red-400 transition-colors"
          data-testid={`delete-card-${card.id}`}
        >
          <Trash2 className="w-3 h-3" /> Delete
        </button>
      </div>
    </div>
  );
}

function AddCardForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    label: "", cardholderName: "", cardNumber: "", expiryMonth: "", expiryYear: "", cvv: "", notes: "",
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form & { cardType: string }) =>
      apiRequest("POST", "/api/my-cards", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-cards"] });
      sounds.navigate();
      toast({ title: "Card saved", description: "Your card has been added." });
      onClose();
    },
    onError: () => {
      sounds.error();
      toast({ title: "Error", description: "Failed to save card.", variant: "destructive" });
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({ ...form, cardType: detectCardType(form.cardNumber) });
  }

  function formatCardNumber(val: string) {
    return val.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  }

  const preview = CARD_COLORS[detectCardType(form.cardNumber)] || CARD_COLORS.visa;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4" style={{ color: preview.accent }} />
          <span className="font-mono text-sm font-semibold text-white">Add New Card</span>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 font-mono text-xs">✕ Cancel</button>
      </div>
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">Card Number *</Label>
            <Input
              className="font-mono bg-black/40 border-zinc-800 text-white tracking-widest"
              placeholder="0000 0000 0000 0000"
              value={form.cardNumber}
              onChange={e => setForm(f => ({ ...f, cardNumber: formatCardNumber(e.target.value) }))}
              data-testid="input-card-number"
              required
            />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">Cardholder Name *</Label>
            <Input
              className="font-mono bg-black/40 border-zinc-800 text-white uppercase"
              placeholder="JOHN DOE"
              value={form.cardholderName}
              onChange={e => setForm(f => ({ ...f, cardholderName: e.target.value.toUpperCase() }))}
              data-testid="input-cardholder-name"
              required
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">Expiry Month *</Label>
            <Input
              className="font-mono bg-black/40 border-zinc-800 text-white"
              placeholder="MM"
              maxLength={2}
              value={form.expiryMonth}
              onChange={e => setForm(f => ({ ...f, expiryMonth: e.target.value.replace(/\D/g, "") }))}
              data-testid="input-expiry-month"
              required
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">Expiry Year *</Label>
            <Input
              className="font-mono bg-black/40 border-zinc-800 text-white"
              placeholder="YYYY"
              maxLength={4}
              value={form.expiryYear}
              onChange={e => setForm(f => ({ ...f, expiryYear: e.target.value.replace(/\D/g, "") }))}
              data-testid="input-expiry-year"
              required
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">CVV *</Label>
            <Input
              className="font-mono bg-black/40 border-zinc-800 text-white"
              placeholder="•••"
              maxLength={4}
              value={form.cvv}
              onChange={e => setForm(f => ({ ...f, cvv: e.target.value.replace(/\D/g, "") }))}
              data-testid="input-cvv"
              required
            />
          </div>
          <div>
            <Label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">Label</Label>
            <Input
              className="font-mono bg-black/40 border-zinc-800 text-white"
              placeholder="My Visa Card"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              data-testid="input-card-label"
            />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">Notes</Label>
            <Input
              className="font-mono bg-black/40 border-zinc-800 text-white"
              placeholder="Optional notes..."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              data-testid="input-card-notes"
            />
          </div>
        </div>
        <Button
          type="submit"
          disabled={mutation.isPending}
          className="w-full font-mono text-xs uppercase tracking-widest"
          style={{ background: preview.bg, border: `1px solid ${preview.accent}40`, color: preview.accent }}
          data-testid="button-save-card"
        >
          {mutation.isPending ? "Saving..." : "Save Card"}
        </Button>
      </form>
    </div>
  );
}

export default function MyCards() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);

  const { data: cards = [], isLoading } = useQuery<SavedCard[]>({
    queryKey: ["/api/my-cards"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/my-cards/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-cards"] });
      toast({ title: "Card removed" });
    },
  });

  const activeCards = cards.filter(c => c.isActive);
  const typeCount = Object.fromEntries(
    ["visa", "mastercard", "amex", "discover"].map(t => [t, cards.filter(c => c.cardType === t).length])
  );

  return (
    <div className="space-y-5 animate-float-up">

      {/* ── HEADER ── */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg,rgba(0,0,0,0.97),rgba(5,5,14,0.99))", border: "1px solid rgba(59,130,246,0.18)", boxShadow: "0 4px 32px rgba(0,0,0,0.6)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(59,130,246,0.01) 2px,rgba(59,130,246,0.01) 3px)" }} />
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg,transparent,rgba(59,130,246,0.4),rgba(167,139,250,0.3),transparent)" }} />
        <div className="relative px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.25)", boxShadow: "0 0 24px rgba(59,130,246,0.15)" }}>
                <CreditCard className="w-6 h-6 text-blue-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" style={{ boxShadow: "0 0 8px #60a5fa" }} />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-0.5">
                <h1 className="text-lg font-black font-mono tracking-tight" data-testid="text-my-cards-title"
                  style={{ background: "linear-gradient(90deg,#60a5fa 0%,#a78bfa 60%,#ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  MY_CARDS
                </h1>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border" style={{ color: "#60a5fa", borderColor: "rgba(96,165,250,0.25)", background: "rgba(96,165,250,0.06)" }}>
                  CHECKOUT
                </span>
              </div>
              <p className="text-[10px] font-mono" style={{ color: "rgba(96,165,250,0.4)" }}>
                &#9632; saved payment cards for ticket automation checkout
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right">
              <span className="text-[9px] font-mono text-zinc-500">TOTAL</span>
              <span className="text-[9px] font-mono font-bold text-blue-400">{cards.length}</span>
              <span className="text-[9px] font-mono text-zinc-500">ACTIVE</span>
              <span className="text-[9px] font-mono font-bold text-emerald-400">{activeCards.length}</span>
            </div>
            <Button
              onClick={() => { setShowAdd(v => !v); sounds.hover(); }}
              className="font-mono text-xs gap-2"
              style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa" }}
              data-testid="button-add-card"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Card
            </Button>
          </div>
        </div>
      </div>

      {/* ── STAT PILLS ── */}
      <div className="flex gap-2 flex-wrap">
        {(["visa","mastercard","amex","discover"] as const).map(t => {
          const s = CARD_COLORS[t];
          return (
            <div key={t} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.accent, boxShadow: `0 0 6px ${s.glow}` }} />
              <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: s.accent }}>{s.label}</span>
              <span className="text-[9px] font-mono font-bold text-zinc-300">{typeCount[t] || 0}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg ml-auto" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <Shield className="w-3 h-3 text-zinc-500" />
          <span className="text-[9px] font-mono text-zinc-500">Stored locally</span>
        </div>
      </div>

      {/* ── ADD CARD FORM ── */}
      {showAdd && <AddCardForm onClose={() => setShowAdd(false)} />}

      {/* ── CARDS GRID ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Activity className="w-5 h-5 text-blue-400/40 animate-spin" />
        </div>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}>
            <CreditCard className="w-8 h-8 text-blue-400/30" />
          </div>
          <div className="text-center">
            <p className="font-mono text-sm text-zinc-400">No cards saved yet</p>
            <p className="font-mono text-[10px] text-zinc-600 mt-1">Add a card to use with ticket automation checkout</p>
          </div>
          <Button onClick={() => { setShowAdd(true); sounds.hover(); }} className="font-mono text-xs gap-2"
            style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)", color: "#60a5fa" }}
            data-testid="button-add-card-empty">
            <Plus className="w-3.5 h-3.5" /> Add First Card
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {cards.map(card => (
            <CreditCardDisplay
              key={card.id}
              card={card}
              onDelete={() => deleteMutation.mutate(card.id)}
            />
          ))}
        </div>
      )}

    </div>
  );
}

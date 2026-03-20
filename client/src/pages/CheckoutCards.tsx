import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { CreditCard, Plus, Trash2, Eye, EyeOff, Copy, Check, Mail, Key, Shield } from "lucide-react";
import type { SavedCard } from "@shared/schema";

const G = "#00ff41";
const GA = (a: number) => `rgba(0,255,65,${a})`;

function detectCardType(n: string): string {
  const num = n.replace(/\D/g, "");
  if (/^4/.test(num)) return "visa";
  if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^6/.test(num)) return "discover";
  return "visa";
}

function formatCardNumber(val: string) {
  return val.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}

const CARD_STYLES: Record<string, { bg: string; accent: string; label: string }> = {
  visa:       { bg: "linear-gradient(135deg,#1a237e,#283593)", accent: "#90caf9", label: "VISA" },
  mastercard: { bg: "linear-gradient(135deg,#b71c1c,#880e4f)", accent: "#f48fb1", label: "MC" },
  amex:       { bg: "linear-gradient(135deg,#006064,#00796b)", accent: "#80cbc4", label: "AMEX" },
  discover:   { bg: "linear-gradient(135deg,#e65100,#bf360c)", accent: "#ffcc80", label: "DISC" },
};

function CardPreview({ card, onDelete }: { card: SavedCard; onDelete: () => void }) {
  const [showFull, setShowFull] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const s = CARD_STYLES[card.cardType] || CARD_STYLES.visa;

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    sounds.hover();
    setTimeout(() => setCopied(null), 1500);
  }

  const masked = `•••• •••• •••• ${card.cardNumber.replace(/\D/g, "").slice(-4)}`;

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 4px 24px rgba(0,0,0,0.35)" }}>
      {/* Card face */}
      <div className="relative p-4" style={{ background: s.bg, minHeight: 140 }}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest opacity-60 text-white">{card.label}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-white" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}>{s.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <p className="font-mono text-sm tracking-widest text-white flex-1">
            {showFull ? card.cardNumber.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim() : masked}
          </p>
          <button onClick={() => { setShowFull(!showFull); sounds.toggle(); }} className="opacity-50 hover:opacity-100">
            {showFull ? <EyeOff className="w-3 h-3 text-white" /> : <Eye className="w-3 h-3 text-white" />}
          </button>
          <button onClick={() => copy(card.cardNumber.replace(/\D/g, ""), "num")} className="opacity-50 hover:opacity-100">
            {copied === "num" ? <Check className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3 text-white" />}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[8px] opacity-50 text-white uppercase tracking-widest">Cardholder</p>
            <p className="text-[11px] font-mono text-white">{card.cardholderName}</p>
          </div>
          <div className="text-right">
            <p className="text-[8px] opacity-50 text-white uppercase tracking-widest">Expires</p>
            <p className="text-[11px] font-mono text-white">{card.expiryMonth}/{card.expiryYear}</p>
          </div>
          <div className="text-right">
            <p className="text-[8px] opacity-50 text-white uppercase tracking-widest">CVV</p>
            <div className="flex items-center gap-1">
              <p className="text-[11px] font-mono text-white">{showCvv ? card.cvv : "•••"}</p>
              <button onClick={() => { setShowCvv(!showCvv); sounds.toggle(); }} className="opacity-50 hover:opacity-100">
                {showCvv ? <EyeOff className="w-2.5 h-2.5 text-white" /> : <Eye className="w-2.5 h-2.5 text-white" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* OTP email strip */}
      <div className="px-4 py-2.5 space-y-1" style={{ background: "rgba(0,0,0,0.55)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-1.5">
          <Mail className="w-3 h-3" style={{ color: card.otpEmail ? G : "rgba(255,255,255,0.2)" }} />
          <span className="text-[9px] font-mono" style={{ color: card.otpEmail ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)" }}>
            {card.otpEmail || "No OTP email set"}
          </span>
          {card.otpEmail && (
            <span className="ml-auto text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: GA(0.1), border: `1px solid ${GA(0.25)}`, color: G }}>
              OTP READY
            </span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3 h-3" style={{ color: "rgba(255,255,255,0.18)" }} />
            <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>
              {card.otpEmailPassword ? "App password set ✓" : "No app password"}
            </span>
          </div>
          <button
            onClick={() => { sounds.click(); onDelete(); }}
            className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded transition-all"
            style={{ color: "rgba(255,69,58,0.7)", border: "1px solid rgba(255,69,58,0.2)", background: "rgba(255,69,58,0.05)" }}
            data-testid={`button-delete-card-${card.id}`}
          >
            <Trash2 className="w-2.5 h-2.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AddCardForm({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    label: "", cardholderName: "", cardNumber: "", expiryMonth: "", expiryYear: "",
    cvv: "", otpEmail: "", otpEmailPassword: "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const cardType = detectCardType(form.cardNumber);
      const res = await apiRequest("POST", "/api/my-cards", {
        label: form.label || undefined,
        cardholderName: form.cardholderName,
        cardNumber: form.cardNumber.replace(/\s/g, ""),
        expiryMonth: form.expiryMonth,
        expiryYear: form.expiryYear,
        cvv: form.cvv,
        cardType,
        otpEmail: form.otpEmail || null,
        otpEmailPassword: form.otpEmailPassword || null,
      });
      return res.json();
    },
    onSuccess: () => {
      sounds.success();
      queryClient.invalidateQueries({ queryKey: ["/api/my-cards"] });
      toast({ title: "Card saved!" });
      onClose();
    },
    onError: (e: any) => {
      sounds.error();
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  function set(k: string, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  const field = (label: string, key: string, type = "text", placeholder = "", icon?: any) => (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: GA(0.4) }}>
        {icon && <span className="inline-block w-3 h-3 mr-1 align-middle">{icon}</span>}
        {label}
      </label>
      <input
        type={type}
        value={(form as any)[key]}
        onChange={(e) => { sounds.keypress(); set(key, key === "cardNumber" ? formatCardNumber(e.target.value) : e.target.value); }}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-xs font-mono focus:outline-none"
        style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${GA(0.14)}`, color: "rgba(255,255,255,0.85)", caretColor: G }}
      />
    </div>
  );

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: "rgba(0,0,0,0.6)", border: `1px solid ${GA(0.2)}` }}>
      <div className="flex items-center gap-2 mb-2">
        <Plus className="w-4 h-4" style={{ color: G }} />
        <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: G }}>Add New Card</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {field("Card Label (optional)", "label", "text", "e.g. HDFC Debit")}
        {field("Cardholder Name", "cardholderName", "text", "As on card")}
      </div>

      {field("Card Number", "cardNumber", "text", "1234 5678 9012 3456")}

      <div className="grid grid-cols-3 gap-3">
        {field("Expiry Month", "expiryMonth", "text", "MM")}
        {field("Expiry Year", "expiryYear", "text", "YY")}
        {field("CVV", "cvv", "password", "•••")}
      </div>

      <div className="pt-2 border-t" style={{ borderColor: GA(0.1) }}>
        <div className="flex items-center gap-2 mb-3">
          <Mail className="w-3 h-3" style={{ color: "rgba(0,191,255,0.7)" }} />
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "rgba(0,191,255,0.5)" }}>OTP Email (for 3D Secure)</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("Bank OTP Email", "otpEmail", "email", "yourbank@gmail.com")}
          {field("App Password", "otpEmailPassword", "password", "Google app password")}
        </div>
        <p className="text-[9px] font-mono mt-2" style={{ color: "rgba(255,255,255,0.2)" }}>
          Used to auto-fetch OTP from your bank email for 3DS verification. Use a Gmail App Password.
        </p>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.cardholderName || !form.cardNumber || !form.expiryMonth || !form.expiryYear || !form.cvv}
          className="flex-1 py-2.5 rounded-lg text-xs font-mono font-bold uppercase tracking-widest transition-all"
          style={{
            background: GA(0.12),
            border: `1px solid ${GA(0.4)}`,
            color: G,
            textShadow: `0 0 10px ${G}`,
            cursor: mutation.isPending ? "not-allowed" : "pointer",
          }}
          data-testid="button-save-card"
        >
          {mutation.isPending ? "Saving..." : "Save Card"}
        </button>
        <button
          onClick={() => { sounds.click(); onClose(); }}
          className="px-4 py-2.5 rounded-lg text-xs font-mono"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function CheckoutCards() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);

  const { data: cards = [], isLoading } = useQuery<SavedCard[]>({
    queryKey: ["/api/my-cards"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/my-cards/${id}`);
    },
    onSuccess: () => {
      sounds.click();
      queryClient.invalidateQueries({ queryKey: ["/api/my-cards"] });
      toast({ title: "Card deleted" });
    },
  });

  return (
    <div className="space-y-5 animate-float-up">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <CreditCard className="w-5 h-5" style={{ color: "#64d2ff", filter: "drop-shadow(0 0 8px #64d2ff55)" }} />
            <h1 className="text-lg font-mono font-bold tracking-tight" style={{ color: "#64d2ff" }}>
              checkout_cards
            </h1>
          </div>
          <p className="text-[11px] font-mono mt-0.5 pl-8" style={{ color: "rgba(100,210,255,0.32)" }}>
            saved payment cards for automated Stripe checkout
          </p>
        </div>
        <button
          onClick={() => { sounds.click(); setShowAdd(!showAdd); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-mono font-bold uppercase tracking-widest transition-all"
          style={{
            background: showAdd ? "rgba(100,210,255,0.1)" : "rgba(255,255,255,0.04)",
            border: showAdd ? "1px solid rgba(100,210,255,0.4)" : "1px solid rgba(255,255,255,0.1)",
            color: showAdd ? "#64d2ff" : "rgba(255,255,255,0.5)",
          }}
          data-testid="button-add-card"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Card
        </button>
      </div>

      {/* Add card form */}
      {showAdd && <AddCardForm onClose={() => setShowAdd(false)} />}

      {/* Card grid */}
      {isLoading ? (
        <div className="text-center py-16 font-mono text-[11px]" style={{ color: GA(0.3) }}>Loading...</div>
      ) : cards.length === 0 && !showAdd ? (
        <div
          className="rounded-xl p-10 text-center"
          style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>No cards saved yet</p>
          <p className="text-[10px] font-mono mt-1" style={{ color: "rgba(255,255,255,0.13)" }}>
            Add a card above — it will be used for Replit Stripe checkout
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <CardPreview
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

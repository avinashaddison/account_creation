import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings as SettingsIcon, Eye, EyeOff, Save, Loader2, CheckCircle2, AlertTriangle, Key, Globe, Shield, DollarSign, Cpu, Mail, CreditCard, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import { handleUnauthorized } from "@/lib/auth";

type ApiKeyField = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  getEndpoint: string;
  putEndpoint: string;
  fieldName: string;
  placeholder: string;
  borderColor: string;
  iconColor: string;
  balanceEndpoint?: string;
  balanceLabel?: string;
};

const apiKeyFields: ApiKeyField[] = [
  {
    id: "zenrows-proxy",
    label: "Addison Browser Engine",
    description: "WebSocket URL for anti-bot browser engine (wss://...)",
    icon: <Cpu className="w-4 h-4" />,
    getEndpoint: "/api/settings/zenrows-proxy",
    putEndpoint: "/api/admin/zenrows-proxy",
    fieldName: "url",
    placeholder: "wss://browser.example.com?apikey=...",
    borderColor: "rgba(0,255,65,0.15)",
    iconColor: "text-emerald-400",
  },
  {
    id: "residential-proxy",
    label: "Residential Proxy",
    description: "Residential proxy for IP rotation (user:pass@host:port)",
    icon: <Globe className="w-4 h-4" />,
    getEndpoint: "/api/settings/residential-proxy",
    putEndpoint: "/api/admin/residential-proxy",
    fieldName: "url",
    placeholder: "user:pass@proxy.example.com:5000",
    borderColor: "rgba(0,255,65,0.1)",
    iconColor: "text-emerald-400/70",
  },
  {
    id: "zenrows",
    label: "Addison Proxy API Key",
    description: "REST API key for premium proxy requests (anti-bot scraping)",
    icon: <Key className="w-4 h-4" />,
    getEndpoint: "/api/settings/zenrows-api-key",
    putEndpoint: "/api/admin/zenrows-api-key",
    fieldName: "key",
    placeholder: "Enter API key...",
    borderColor: "rgba(0,255,65,0.08)",
    iconColor: "text-emerald-400/50",
  },
  {
    id: "capsolver",
    label: "CapSolver API Key",
    description: "CAPTCHA solving service for reCAPTCHA v2/v3 Enterprise",
    icon: <Shield className="w-4 h-4" />,
    getEndpoint: "/api/settings/capsolver-api-key",
    putEndpoint: "/api/admin/capsolver-api-key",
    fieldName: "key",
    placeholder: "Enter CapSolver API key...",
    borderColor: "rgba(255,176,0,0.15)",
    iconColor: "text-amber-400",
    balanceEndpoint: "/api/capsolver/balance",
    balanceLabel: "Balance",
  },
  {
    id: "nopecha",
    label: "NopeCHA API Key",
    description: "Primary hCaptcha solver for Stripe 3DS — nopecha.com ($1 per 90,000 solves, confirmed hCaptcha support)",
    icon: <Shield className="w-4 h-4" />,
    getEndpoint: "/api/settings/nopecha-api-key",
    putEndpoint: "/api/admin/nopecha-api-key",
    fieldName: "key",
    placeholder: "Enter NopeCHA API key...",
    borderColor: "rgba(234,179,8,0.22)",
    iconColor: "text-yellow-400",
  },
  {
    id: "anticaptcha",
    label: "Anti-Captcha API Key",
    description: "Fallback hCaptcha solver (anti-captcha.com — used if NopeCHA is not configured or fails)",
    icon: <Shield className="w-4 h-4" />,
    getEndpoint: "/api/settings/anticaptcha-api-key",
    putEndpoint: "/api/admin/anticaptcha-api-key",
    fieldName: "key",
    placeholder: "Enter anti-captcha.com API key...",
    borderColor: "rgba(168,85,247,0.18)",
    iconColor: "text-purple-400",
  },
  {
    id: "twocaptcha",
    label: "2captcha API Key",
    description: "Fallback CAPTCHA solver (used if NopeCHA and anti-captcha.com are not configured or fail)",
    icon: <Shield className="w-4 h-4" />,
    getEndpoint: "/api/settings/twocaptcha-api-key",
    putEndpoint: "/api/admin/twocaptcha-api-key",
    fieldName: "key",
    placeholder: "Enter 2captcha API key...",
    borderColor: "rgba(99,102,241,0.15)",
    iconColor: "text-indigo-400",
  },
  {
    id: "fivesim",
    label: "5sim API Key",
    description: "Primary SMS provider for Ticketmaster phone verification — 5sim.net (cheaper than SMSPool, falls back to SMSPool if not configured)",
    icon: <Smartphone className="w-4 h-4" />,
    getEndpoint: "/api/settings/fivesim-api-key",
    putEndpoint: "/api/admin/fivesim-api-key",
    fieldName: "key",
    placeholder: "Enter 5sim.net API key...",
    borderColor: "rgba(52,211,153,0.22)",
    iconColor: "text-emerald-400",
    balanceEndpoint: "/api/fivesim/balance",
    balanceLabel: "Balance",
  },
  {
    id: "account-price",
    label: "Account Price",
    description: "Cost per account creation charged to admin wallets",
    icon: <DollarSign className="w-4 h-4" />,
    getEndpoint: "/api/settings/account-price",
    putEndpoint: "/api/admin/account-price",
    fieldName: "price",
    placeholder: "0.24",
    borderColor: "rgba(0,255,65,0.15)",
    iconColor: "text-emerald-400",
  },
  {
    id: "gmail-email",
    label: "Gmail Address (LA28 Email)",
    description: "Your Gmail account for receiving LA28 verification codes (user@gmail.com) — enables Gmail IMAP mode",
    icon: <Mail className="w-4 h-4" />,
    getEndpoint: "/api/settings/gmail-email",
    putEndpoint: "/api/admin/gmail-email",
    fieldName: "email",
    placeholder: "youraddress@gmail.com",
    borderColor: "rgba(66,133,244,0.25)",
    iconColor: "text-blue-400",
  },
  {
    id: "gmail-app-password",
    label: "Gmail App Password",
    description: "16-char App Password from Google Account → Security → 2-Step Verification → App Passwords",
    icon: <Key className="w-4 h-4" />,
    getEndpoint: "/api/settings/gmail-app-password",
    putEndpoint: "/api/admin/gmail-app-password",
    fieldName: "password",
    placeholder: "xxxx xxxx xxxx xxxx",
    borderColor: "rgba(66,133,244,0.15)",
    iconColor: "text-blue-400/70",
  },
  {
    id: "card-otp-gmail",
    label: "Card OTP Gmail",
    description: "Gmail address that receives 3DS OTP / bank verification emails for card payments",
    icon: <CreditCard className="w-4 h-4" />,
    getEndpoint: "/api/settings/card-otp-gmail",
    putEndpoint: "/api/admin/card-otp-gmail",
    fieldName: "email",
    placeholder: "yourbank_otp@gmail.com",
    borderColor: "rgba(100,210,255,0.25)",
    iconColor: "text-sky-400",
  },
  {
    id: "card-otp-gmail-password",
    label: "Card OTP Gmail App Password",
    description: "16-char Google App Password for the Card OTP Gmail — used to read 3DS OTP emails via IMAP",
    icon: <Key className="w-4 h-4" />,
    getEndpoint: "/api/settings/card-otp-gmail-password",
    putEndpoint: "/api/admin/card-otp-gmail-password",
    fieldName: "password",
    placeholder: "xxxx xxxx xxxx xxxx",
    borderColor: "rgba(100,210,255,0.15)",
    iconColor: "text-sky-400/70",
  },
];

function ApiKeyCard({ field }: { field: ApiKeyField }) {
  const [value, setValue] = useState("");
  const [originalValue, setOriginalValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetch(field.getEndpoint, { credentials: "include" })
      .then((r) => {
        if (r.status === 401) { handleUnauthorized(); return {}; }
        return r.json();
      })
      .then((data) => {
        const raw = data[field.fieldName];
        const val = raw !== undefined && raw !== null ? String(raw) : "";
        setValue(val);
        setOriginalValue(val);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    if (field.balanceEndpoint) {
      fetch(field.balanceEndpoint, { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          if (data.balance !== undefined) {
            setBalance(`$${Number(data.balance).toFixed(2)}`);
          }
        })
        .catch(() => {});
    }
  }, []);

  async function handleSave() {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    setSaving(true);
    sounds.click();
    try {
      const body: Record<string, string> = {};
      body[field.fieldName] = trimmed;
      const res = await fetch(field.putEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (res.ok) {
        sounds.success();
        setOriginalValue(trimmed);
        toast({ title: "Saved", description: `${field.label} updated successfully.` });
      } else {
        sounds.error();
        toast({ title: "Error", description: data.error || "Failed to save", variant: "destructive" });
      }
    } catch {
      sounds.error();
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const strValue = String(value || "");
  const hasChanged = strValue.trim() !== originalValue;
  const isSecret = field.id !== "account-price";
  const maskedValue = strValue ? strValue.slice(0, 6) + "•".repeat(Math.max(0, strValue.length - 10)) + strValue.slice(-4) : "";

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${field.borderColor}`, background: 'rgba(19,26,38,0.9)' }} data-testid={`card-setting-${field.id}`}>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${field.iconColor}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {field.icon}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white font-mono tracking-tight">{field.label}</h3>
              <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{field.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {balance && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-sm" style={{ background: 'rgba(0,255,65,0.05)', border: '1px solid rgba(0,255,65,0.15)' }}>
                <span className="text-[9px] text-emerald-400 font-mono">{balance}</span>
              </div>
            )}
            {!loading && originalValue && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-sm" style={{ background: 'rgba(0,255,65,0.05)', border: '1px solid rgba(0,255,65,0.1)' }}>
                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                <span className="text-[9px] text-emerald-400 font-mono">CONFIGURED</span>
              </div>
            )}
            {!loading && !originalValue && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-sm" style={{ background: 'rgba(255,51,102,0.05)', border: '1px solid rgba(255,51,102,0.15)' }}>
                <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                <span className="text-[9px] text-amber-400 font-mono">NOT SET</span>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400/40" />
            <span className="text-[10px] text-emerald-400/30 font-mono">Loading...</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={isSecret && !visible ? "password" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={field.placeholder}
                className="h-9 text-[12px] bg-black/20 border-emerald-500/15 text-emerald-50 font-mono rounded-lg pr-10 focus:border-emerald-500/30 placeholder:text-zinc-500"
                data-testid={`input-${field.id}`}
              />
              {isSecret && (
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  data-testid={`toggle-visibility-${field.id}`}
                >
                  {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanged || !strValue.trim()}
              className={`h-9 px-3 font-mono text-[11px] rounded-lg transition-all duration-200 ${
                hasChanged && strValue.trim()
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25"
                  : "bg-zinc-800/30 text-zinc-600 border border-zinc-700/20"
              }`}
              data-testid={`button-save-${field.id}`}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <div className="space-y-6 animate-float-up">
      <div>
        <div className="flex items-center gap-2.5">
          <Key className="w-5 h-5 text-emerald-400/50" />
          <h1 className="text-xl font-bold tracking-tight text-white font-mono" data-testid="text-settings-title">
            API<span className="text-emerald-400">_</span>Settings
          </h1>
        </div>
        <p className="text-emerald-400/30 mt-1 text-[11px] font-mono pl-7.5">Configure external service API keys and pricing</p>
      </div>

      <div className="grid gap-4">
        {apiKeyFields.map((field) => (
          <ApiKeyCard key={field.id} field={field} />
        ))}
      </div>

      <div className="rounded-lg px-4 py-3" style={{ background: 'rgba(0,255,65,0.02)', border: '1px solid rgba(0,255,65,0.06)' }}>
        <p className="text-[10px] text-emerald-400/25 font-mono leading-relaxed">
          <span className="text-emerald-400/40">[INFO]</span> API keys are stored encrypted in the database and take effect immediately.
          Changes to Addison Proxy and CapSolver keys will clear cached values on the server.
        </p>
      </div>
    </div>
  );
}

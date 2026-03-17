import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings as SettingsIcon, Eye, EyeOff, Save, Loader2, CheckCircle2, AlertTriangle, Key, Globe, Shield, DollarSign, Cpu } from "lucide-react";
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
    id: "zenrows",
    label: "Addison Proxy API Key",
    description: "Premium proxy for bypassing Akamai bot protection on tickets.la28.org",
    icon: <Globe className="w-4 h-4" />,
    getEndpoint: "/api/settings/zenrows-api-key",
    putEndpoint: "/api/admin/zenrows-api-key",
    fieldName: "key",
    placeholder: "Enter proxy API key...",
    borderColor: "rgba(0,255,65,0.15)",
    iconColor: "text-emerald-400",
  },
  {
    id: "zenrows-proxy",
    label: "Addison Proxy Browser URL",
    description: "WebSocket URL for Addison Proxy browser (wss://...)",
    icon: <Cpu className="w-4 h-4" />,
    getEndpoint: "/api/settings/zenrows-proxy",
    putEndpoint: "/api/admin/zenrows-proxy",
    fieldName: "url",
    placeholder: "wss://proxy.addison.internal?apikey=...",
    borderColor: "rgba(0,255,65,0.1)",
    iconColor: "text-emerald-400/70",
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

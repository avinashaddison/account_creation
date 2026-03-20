import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users, Wallet, Server, Pencil, Check, X, TrendingUp, ChevronRight, Terminal, Settings, Shield, Ticket, Search, Bell, Bookmark, SlidersHorizontal, Zap, Activity, Radio, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sounds } from "@/lib/sounds";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string; panelName?: string };
  onLogout: () => void;
  onPanelNameChange?: (name: string) => void;
};

const TM_SUBNAV = [
  { href: "/admin/tm-event-scanner", label: "Event Scanner", icon: Search },
  { href: "/admin/tm-live-alerts", label: "Live Alerts", icon: Bell },
  { href: "/admin/tm-tracked-events", label: "Tracked Events", icon: Bookmark },
  { href: "/admin/tm-settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/my-cards", label: "My Cards", icon: CreditCard },
];

const TAG_STYLES: Record<string, { bg: string; text: string; dot: string; glow: string }> = {
  SYS: { bg: "rgba(255,255,255,0.06)", text: "rgba(255,255,255,0.4)", dot: "#e2e8f0", glow: "rgba(255,255,255,0.15)" },
  OPS: { bg: "rgba(167,139,250,0.14)", text: "rgba(167,139,250,0.8)", dot: "#a78bfa", glow: "rgba(167,139,250,0.25)" },
  DB:  { bg: "rgba(251,191,36,0.12)", text: "rgba(251,191,36,0.75)", dot: "#fbbf24", glow: "rgba(251,191,36,0.25)" },
  NET: { bg: "rgba(56,189,248,0.12)", text: "rgba(56,189,248,0.75)", dot: "#38bdf8", glow: "rgba(56,189,248,0.25)" },
  FIN: { bg: "rgba(52,211,153,0.12)", text: "rgba(52,211,153,0.75)", dot: "#34d399", glow: "rgba(52,211,153,0.25)" },
  PVT: { bg: "rgba(248,113,113,0.12)", text: "rgba(248,113,113,0.75)", dot: "#f87171", glow: "rgba(248,113,113,0.25)" },
  ADM: { bg: "rgba(251,146,60,0.12)", text: "rgba(251,146,60,0.75)", dot: "#fb923c", glow: "rgba(251,146,60,0.25)" },
  CFG: { bg: "rgba(148,163,184,0.12)", text: "rgba(148,163,184,0.75)", dot: "#94a3b8", glow: "rgba(148,163,184,0.25)" },
  TKT: { bg: "rgba(0,255,65,0.10)", text: "rgba(0,255,65,0.7)", dot: "#00ff41", glow: "rgba(0,255,65,0.3)" },
  CRD: { bg: "rgba(96,165,250,0.12)", text: "rgba(96,165,250,0.75)", dot: "#60a5fa", glow: "rgba(96,165,250,0.25)" },
};

function TagBadge({ tag }: { tag: string }) {
  const s = TAG_STYLES[tag] || TAG_STYLES.SYS;
  return (
    <span
      className="text-[8px] font-mono tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.dot}22` }}
    >
      <span
        className="w-1 h-1 rounded-full inline-block"
        style={{ background: s.dot, boxShadow: `0 0 5px ${s.dot}, 0 0 10px ${s.glow}` }}
      />
      {tag}
    </span>
  );
}

function SectionDivider({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-3 pb-1.5">
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <span className="text-[7.5px] font-mono uppercase tracking-[0.25em]" style={{ color }}>
        {label}
      </span>
      <div className="h-px flex-1" style={{ background: `linear-gradient(270deg, ${color}, transparent)` }} />
    </div>
  );
}

function NavItem({ item, location }: { item: { href: string; label: string; icon: any; tag: string }; location: string }) {
  const isActive = location === item.href || (item.href === "/admin/create-server" && (
    location === "/admin/la28-create" || location === "/admin/tm-create" ||
    location === "/admin/uefa-create" || location === "/admin/brunomars-create" ||
    location === "/admin/outlook-login" || location === "/admin/outlook-create" ||
    location === "/admin/zenrows-register" || location === "/admin/replit-create" ||
    location === "/admin/lovable-create" || location === "/admin/card-generator"
  ));
  const tag = TAG_STYLES[item.tag] || TAG_STYLES.SYS;

  return (
    <Link href={item.href}>
      <div
        onClick={() => sounds.navigate()}
        onMouseEnter={() => sounds.hover()}
        className="group/item relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-200"
        style={isActive ? {
          background: `linear-gradient(135deg, ${tag.dot}14 0%, ${tag.dot}06 100%)`,
          border: `1px solid ${tag.dot}30`,
          boxShadow: `inset 0 0 24px ${tag.dot}08, 0 2px 12px ${tag.dot}10`,
        } : {
          border: "1px solid transparent",
          background: "transparent",
        }}
        data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
      >
        {isActive && (
          <>
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
              style={{ height: "55%", background: `linear-gradient(180deg, ${tag.dot}, ${tag.dot}80)`, boxShadow: `0 0 10px ${tag.dot}, 0 0 20px ${tag.glow}` }}
            />
            <div className="absolute inset-0 rounded-lg opacity-30" style={{ background: `radial-gradient(ellipse at left center, ${tag.dot}20, transparent 70%)` }} />
          </>
        )}

        <div
          className="relative shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center transition-all duration-200"
          style={isActive
            ? { background: `linear-gradient(135deg, ${tag.dot}20, ${tag.dot}08)`, border: `1px solid ${tag.dot}40`, boxShadow: `0 0 12px ${tag.glow}` }
            : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }
          }
        >
          <item.icon
            className="w-[12px] h-[12px] shrink-0 transition-all duration-200"
            style={{ color: isActive ? tag.dot : "rgba(255,255,255,0.6)" }}
          />
        </div>

        <span
          className="flex-1 font-mono text-[11.5px] font-medium transition-colors duration-200"
          style={{ color: isActive ? "#ffffff" : "rgba(255,255,255,0.88)" }}
        >
          {item.label}
        </span>
        <TagBadge tag={item.tag} />
      </div>
    </Link>
  );
}

export default function Layout({ children, user, onLogout, onPanelNameChange }: LayoutProps) {
  const [location] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.panelName || "Addison Panel");
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState(new Date());
  const isTmRoute = location.startsWith("/admin/tm-") || location === "/admin/my-cards";
  const [tmExpanded, setTmExpanded] = useState(() => location.startsWith("/admin/tm-") || location === "/admin/my-cards");
  const [uptime, setUptime] = useState(0);
  const startTime = useRef(Date.now());

  const panelName = user.panelName || "Addison Panel";

  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date());
      setUptime(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  async function savePanelName() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/auth/panel-name", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelName: editName.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        onPanelNameChange?.(data.panelName);
        setIsEditing(false);
      }
    } catch {} finally {
      setSaving(false);
    }
  }

  const nav = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard, tag: "SYS" },
    { href: "/admin/create-server", label: "Create Account", icon: Server, tag: "OPS" },
    { href: "/admin/accounts", label: "Account Stock", icon: Archive, tag: "DB" },
    { href: "/admin/email-workspace", label: "Email Workspace", icon: Mail, tag: "NET" },
    { href: "/admin/billing", label: "Billing", icon: Receipt, tag: "FIN" },
    { href: "/admin/wallet", label: "Wallet", icon: Wallet, tag: "FIN" },
    ...(user.role === "superadmin" ? [
      { href: "/admin/private-account", label: "Private Account", icon: Shield, tag: "PVT" },
      { href: "/admin/earnings", label: "Earnings", icon: TrendingUp, tag: "ADM" },
      { href: "/admin/manage-admins", label: "Manage Admins", icon: Users, tag: "ADM" },
      { href: "/admin/settings", label: "API Settings", icon: Settings, tag: "CFG" },
    ] : []),
  ];

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };

  return (
    <div className="min-h-screen flex" style={{ background: '#080808' }}>
      <aside
        className="w-[262px] flex flex-col shrink-0 h-screen sticky top-0 overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #0c100c 0%, #080c08 60%, #060906 100%)',
          borderRight: '1px solid rgba(0,255,65,0.10)',
          boxShadow: '6px 0 40px rgba(0,0,0,0.6), inset -1px 0 0 rgba(0,255,65,0.04)',
        }}
        data-testid="sidebar"
      >
        {/* Top edge highlight */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(0,255,65,0.4), transparent)" }} />

        {/* Ambient glow top-left */}
        <div className="absolute top-0 left-0 w-40 h-40 pointer-events-none" style={{ background: "radial-gradient(ellipse at top left, rgba(0,255,65,0.06), transparent 70%)" }} />

        {/* Header */}
        <div className="px-4 pt-5 pb-3">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm bg-black/40 border-emerald-500/20 text-emerald-50 font-mono rounded-lg"
                onKeyDown={(e) => { if (e.key === "Enter") savePanelName(); if (e.key === "Escape") { setIsEditing(false); setEditName(panelName); } }}
                data-testid="input-panel-name"
              />
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10" onClick={savePanelName} disabled={saving} data-testid="button-save-panel-name">
                  <Check className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-zinc-500 hover:text-zinc-300 hover:bg-white/5" onClick={() => { setIsEditing(false); setEditName(panelName); }}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="group flex items-center gap-3">
              {/* Logo mark */}
              <div className="relative shrink-0">
                <div className="absolute inset-[-4px] rounded-2xl animate-glow" style={{ background: "radial-gradient(ellipse, rgba(0,255,65,0.18), transparent 70%)" }} />
                <div
                  className="relative w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(0,255,65,0.18) 0%, rgba(0,255,65,0.06) 100%)',
                    border: '1px solid rgba(0,255,65,0.30)',
                    boxShadow: '0 0 20px rgba(0,255,65,0.12), inset 0 1px 0 rgba(0,255,65,0.15), inset 0 0 12px rgba(0,255,65,0.04)'
                  }}
                >
                  <Terminal className="w-5 h-5 text-emerald-400" style={{ filter: "drop-shadow(0 0 6px rgba(0,255,65,0.6))" }} />
                </div>
                {/* Corner brackets */}
                <div className="absolute -top-1 -left-1 w-2 h-2 border-t border-l border-emerald-400/40" />
                <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b border-r border-emerald-400/40" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2
                    className="text-[13.5px] font-bold text-white tracking-tight truncate font-mono"
                    style={{ textShadow: "0 0 20px rgba(0,255,65,0.2)" }}
                    data-testid="text-brand"
                  >
                    {panelName}
                  </h2>
                  <button
                    onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-emerald-500/10 transition-all shrink-0"
                    data-testid="button-edit-panel-name"
                  >
                    <Pencil className="w-2.5 h-2.5 text-emerald-500/50" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Zap className="w-2.5 h-2.5" style={{ color: "rgba(0,255,65,0.45)", filter: "drop-shadow(0 0 3px rgba(0,255,65,0.4))" }} />
                  <p className="text-[8.5px] font-mono tracking-[0.15em] uppercase" style={{ color: "rgba(0,255,65,0.35)" }}>Command Center</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Status panel */}
        <div className="mx-3 mb-1">
          <div
            className="px-3 py-2 rounded-lg"
            style={{
              background: "linear-gradient(135deg, rgba(0,255,65,0.04), rgba(0,0,0,0.3))",
              border: "1px solid rgba(0,255,65,0.08)",
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="relative flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px rgba(0,255,65,0.8)" }} />
                  <div className="absolute w-3 h-3 rounded-full border border-emerald-400/30 animate-ping" style={{ animationDuration: "2s" }} />
                </div>
                <span className="text-[9px] font-mono uppercase tracking-[0.2em]" style={{ color: "rgba(0,255,65,0.7)" }}>Online</span>
              </div>
              <span className="text-[9px] font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.25)" }}>
                {time.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Activity className="w-2.5 h-2.5" style={{ color: "rgba(0,255,65,0.3)" }} />
                <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>UP {formatUptime(uptime)}</span>
              </div>
              <div className="flex items-center gap-0.5">
                {[1,2,3,4].map(i => (
                  <div key={i} className="w-0.5 rounded-full" style={{ height: `${4 + i * 2}px`, background: i <= 3 ? "rgba(0,255,65,0.5)" : "rgba(255,255,255,0.08)" }} />
                ))}
                <Radio className="w-2.5 h-2.5 ml-1" style={{ color: "rgba(0,255,65,0.35)" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto pb-2 space-y-0.5">
          <SectionDivider label="Core" color="rgba(0,255,65,0.2)" />
          <NavItem item={nav[0]} location={location} />

          {/* Ticket Master */}
          <SectionDivider label="Ticket Master" color="rgba(0,255,65,0.15)" />
          <div>
            <div
              onClick={() => { setTmExpanded((v) => !v); sounds.navigate(); }}
              onMouseEnter={() => sounds.hover()}
              className="relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-200"
              style={isTmRoute ? {
                background: "linear-gradient(135deg, rgba(0,255,65,0.14) 0%, rgba(0,255,65,0.05) 100%)",
                border: "1px solid rgba(0,255,65,0.28)",
                boxShadow: "inset 0 0 24px rgba(0,255,65,0.06), 0 2px 12px rgba(0,255,65,0.08)",
              } : { border: "1px solid transparent" }}
              data-testid="nav-ticket-master"
            >
              {isTmRoute && (
                <>
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full" style={{ height: "55%", background: "linear-gradient(180deg, #00ff41, #00ff4180)", boxShadow: "0 0 10px #00ff41, 0 0 20px rgba(0,255,65,0.3)" }} />
                  <div className="absolute inset-0 rounded-lg opacity-30" style={{ background: "radial-gradient(ellipse at left center, rgba(0,255,65,0.2), transparent 70%)" }} />
                </>
              )}
              <div
                className="shrink-0 w-[26px] h-[26px] rounded-lg flex items-center justify-center"
                style={isTmRoute
                  ? { background: "rgba(0,255,65,0.18)", border: "1px solid rgba(0,255,65,0.35)", boxShadow: "0 0 10px rgba(0,255,65,0.2)" }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }
                }
              >
                <Ticket className="w-[12px] h-[12px]" style={{ color: isTmRoute ? "#00ff41" : "rgba(255,255,255,0.6)" }} />
              </div>
              <span className="flex-1 font-mono text-[11.5px] font-medium" style={{ color: isTmRoute ? "#ffffff" : "rgba(255,255,255,0.88)" }}>Ticket Master</span>
              <TagBadge tag="TKT" />
              <ChevronRight className="w-3 h-3 transition-transform duration-250 ml-0.5" style={{ transform: tmExpanded ? "rotate(90deg)" : "rotate(0deg)", color: tmExpanded ? "rgba(0,255,65,0.5)" : "rgba(255,255,255,0.45)" }} />
            </div>

            {tmExpanded && (
              <div className="ml-4 mt-1 pl-3 space-y-0.5" style={{ borderLeft: "1px solid rgba(0,255,65,0.10)" }}>
                {TM_SUBNAV.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        onClick={() => sounds.navigate()}
                        onMouseEnter={() => sounds.hover()}
                        className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all duration-150"
                        style={isActive
                          ? { background: "rgba(0,255,65,0.07)", border: "1px solid rgba(0,255,65,0.14)", color: "#86efac" }
                          : { border: "1px solid transparent", color: "rgba(255,255,255,0.85)" }
                        }
                        data-testid={`nav-tm-${item.label.toLowerCase().replace(/ /g, "-")}`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3 rounded-r-full" style={{ background: "#00ff41", boxShadow: "0 0 6px rgba(0,255,65,0.6)" }} />
                        )}
                        <item.icon className="w-[11px] h-[11px] shrink-0" style={{ color: isActive ? "#4ade80" : "rgba(255,255,255,0.55)" }} />
                        <span className="font-mono">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <SectionDivider label="Operations" color="rgba(167,139,250,0.2)" />
          <NavItem item={nav[1]} location={location} />

          <SectionDivider label="Data" color="rgba(251,191,36,0.18)" />
          {nav.slice(2, 6).map((item) => <NavItem key={item.href} item={item} location={location} />)}

          {user.role === "superadmin" && (
            <>
              <SectionDivider label="Admin" color="rgba(248,113,113,0.2)" />
              {nav.slice(6).map((item) => <NavItem key={item.href} item={item} location={location} />)}
            </>
          )}
        </nav>

        {/* Bottom glow */}
        <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.8), transparent)" }} />

        {/* User card */}
        <div className="relative mx-3 mb-3 mt-1">
          <div
            className="p-3 rounded-xl"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.4) 100%)",
              border: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "0 -8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="relative shrink-0">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(0,255,65,0.12), rgba(0,255,65,0.04))",
                    border: "1px solid rgba(0,255,65,0.18)",
                    boxShadow: "0 0 14px rgba(0,255,65,0.08)",
                  }}
                >
                  <User className="w-4 h-4" style={{ color: "rgba(0,255,65,0.6)" }} />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border border-black" style={{ boxShadow: "0 0 6px rgba(0,255,65,0.8)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10.5px] font-mono truncate" style={{ color: "rgba(255,255,255,0.65)" }} data-testid="text-user-email">
                  {user.email}
                </p>
                <p className="text-[8.5px] font-mono capitalize mt-0.5" style={{ color: "rgba(0,255,65,0.45)" }} data-testid="text-user-role">
                  ◆ {user.role}
                </p>
              </div>
            </div>

            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10.5px] font-mono transition-all duration-150 group/logout"
              style={{ border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.25)", background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                e.currentTarget.style.borderColor = "rgba(239,68,68,0.2)";
                e.currentTarget.style.color = "rgba(248,113,113,0.9)";
                e.currentTarget.style.boxShadow = "0 0 12px rgba(239,68,68,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                e.currentTarget.style.color = "rgba(255,255,255,0.25)";
                e.currentTarget.style.boxShadow = "none";
              }}
              onClick={() => { sounds.logout(); onLogout(); }}
              data-testid="button-logout"
            >
              <LogOut className="w-3 h-3" />
              Disconnect
            </button>
          </div>
        </div>

        {/* Bottom edge line */}
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(0,255,65,0.15), transparent)" }} />
      </aside>

      <main className="flex-1 overflow-auto cyber-grid scan-line crt-overlay animate-flicker" style={{ background: 'linear-gradient(135deg, #080808 0%, #0b0e0b 50%, #080808 100%)' }}>
        <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

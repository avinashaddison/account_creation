import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import {
  LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users,
  Wallet, Server, Pencil, Check, X, TrendingUp, ChevronRight,
  Terminal, Settings, Shield, Ticket, Search, Bell, Bookmark,
  SlidersHorizontal, Zap, CreditCard, ShoppingCart, Activity,
  ChevronDown, Circle, Database, Globe, Lock, Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sounds } from "@/lib/sounds";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string; panelName?: string };
  onLogout: () => void;
  onPanelNameChange?: (name: string) => void;
};

const R = "#ff2020";
const RA = (a: number) => `rgba(255,32,32,${a})`;
const G = "#00ff41";
const GA = (a: number) => `rgba(0,255,65,${a})`;

const TM_SUBNAV = [
  { href: "/admin/tm-event-scanner", label: "Event Scanner", icon: Search },
  { href: "/admin/tm-live-alerts", label: "Live Alerts", icon: Bell },
  { href: "/admin/tm-tracked-events", label: "Tracked Events", icon: Bookmark },
  { href: "/admin/tm-settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/my-cards", label: "My Cards", icon: CreditCard },
];

const TAG_META: Record<string, { label: string; color: string; bg: string }> = {
  SYS: { label: "SYS", color: "#ff2020", bg: "rgba(255,32,32,0.12)" },
  OPS: { label: "OPS", color: "#ff6b20", bg: "rgba(255,107,32,0.12)" },
  DB:  { label: "DB",  color: "#ff2020", bg: "rgba(255,32,32,0.10)" },
  NET: { label: "NET", color: "#20aaff", bg: "rgba(32,170,255,0.10)" },
  FIN: { label: "FIN", color: "#ffcc20", bg: "rgba(255,204,32,0.10)" },
  PVT: { label: "PVT", color: "#ff2020", bg: "rgba(255,32,32,0.14)" },
  ADM: { label: "ADM", color: "#cc0000", bg: "rgba(200,0,0,0.10)" },
  CFG: { label: "CFG", color: "#aeaeb2", bg: "rgba(174,174,178,0.10)" },
  TKT: { label: "TKT", color: "#ff2020", bg: "rgba(255,32,32,0.10)" },
  CRD: { label: "CRD", color: "#ff2020", bg: "rgba(255,32,32,0.10)" },
};

function TagBadge({ tag }: { tag: string }) {
  const m = TAG_META[tag] || TAG_META.SYS;
  return (
    <span
      className="text-[8px] font-mono tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"
      style={{ background: m.bg, color: m.color, border: `1px solid ${m.color}28` }}
    >
      <span className="w-1 h-1 rounded-full inline-block" style={{ background: m.color, boxShadow: `0 0 4px ${m.color}` }} />
      {m.label}
    </span>
  );
}

function SectionDivider({ label, icon: Icon }: { label: string; icon?: any }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-4 pb-1.5">
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, transparent, ${RA(0.25)})` }} />
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="w-2 h-2" style={{ color: RA(0.50) }} />}
        <span className="text-[8px] uppercase tracking-[0.25em] font-mono font-bold" style={{ color: RA(0.50) }}>
          {label}
        </span>
      </div>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />
    </div>
  );
}

function NavItem({ item, location }: { item: { href: string; label: string; icon: any; tag: string }; location: string }) {
  const isActive = location === item.href || (item.href === "/admin/create-server" && (
    location === "/admin/la28-create" || location === "/admin/tm-create" ||
    location === "/admin/uefa-create" || location === "/admin/brunomars-create" ||
    location === "/admin/outlook-login" || location === "/admin/outlook-create" ||
    location === "/admin/zenrows-register" || location === "/admin/replit-create" ||
    location === "/admin/lovable-create" || location === "/admin/v0-create" ||
    location === "/admin/card-generator"
  ));

  return (
    <Link href={item.href}>
      <div
        onClick={() => sounds.navigate()}
        onMouseEnter={() => sounds.hover()}
        className="group/item relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-150"
        style={isActive ? {
          background: `linear-gradient(135deg, ${RA(0.20)} 0%, ${RA(0.06)} 100%)`,
          border: `1px solid ${RA(0.40)}`,
          boxShadow: `0 0 20px ${RA(0.12)}, inset 0 1px 0 ${RA(0.12)}`,
        } : {
          border: "1px solid transparent",
          background: "transparent",
        }}
        data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
      >
        {isActive && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
            style={{ height: "60%", background: R, boxShadow: `0 0 8px ${R}, 0 0 16px ${RA(0.5)}` }}
          />
        )}
        {/* Hover scanline */}
        <div
          className="absolute inset-0 rounded-lg opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 pointer-events-none"
          style={{ background: `linear-gradient(135deg, ${RA(0.07)} 0%, transparent 60%)` }}
        />

        <div
          className="relative shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150"
          style={isActive
            ? { background: RA(0.20), border: `1px solid ${RA(0.45)}`, boxShadow: `0 0 12px ${RA(0.20)}` }
            : { background: RA(0.04), border: `1px solid ${RA(0.10)}` }
          }
        >
          <item.icon
            className="w-[13px] h-[13px] shrink-0 transition-all duration-150"
            style={{ color: isActive ? R : RA(0.45), filter: isActive ? `drop-shadow(0 0 4px ${R})` : "none" }}
          />
        </div>

        <span
          className="flex-1 text-[11.5px] font-mono tracking-tight transition-colors duration-150"
          style={{ color: isActive ? "#ffffff" : "rgba(255,255,255,0.55)" }}
        >
          {item.label}
        </span>
        <TagBadge tag={item.tag} />
      </div>
    </Link>
  );
}

function GlitchText({ text }: { text: string }) {
  const [glitching, setGlitching] = useState(false);
  useEffect(() => {
    const scheduleGlitch = () => {
      const delay = 4000 + Math.random() * 8000;
      setTimeout(() => {
        setGlitching(true);
        setTimeout(() => { setGlitching(false); scheduleGlitch(); }, 300);
      }, delay);
    };
    scheduleGlitch();
  }, []);
  return (
    <span
      className="relative inline-block"
      style={{
        color: "#ffffff",
        textShadow: glitching ? `2px 0 ${R}, -2px 0 rgba(0,255,65,0.8)` : `0 0 12px ${RA(0.35)}`,
        transition: "text-shadow 0.05s",
        transform: glitching ? "translateX(1px)" : "none",
      }}
    >
      {text}
    </span>
  );
}

function SignalBars({ active = 3 }: { active?: number }) {
  return (
    <div className="flex items-end gap-[2px]">
      {[3, 5, 7, 9].map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm transition-all duration-500"
          style={{
            height: `${h}px`,
            background: i < active ? R : RA(0.12),
            boxShadow: i < active ? `0 0 4px ${R}` : "none",
          }}
        />
      ))}
    </div>
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
  const [signalStrength, setSignalStrength] = useState(3);
  const startTime = useRef(Date.now());
  const scanRef = useRef<HTMLDivElement>(null);

  const panelName = user.panelName || "Addison Panel";

  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date());
      setUptime(Math.floor((Date.now() - startTime.current) / 1000));
      setSignalStrength(Math.random() > 0.1 ? 3 + (Math.random() > 0.5 ? 1 : 0) : 2);
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
    { href: "/admin/checkout-cards", label: "Checkout Cards", icon: ShoppingCart, tag: "CRD" },
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
    <div className="min-h-screen flex" style={{ background: "linear-gradient(135deg, #050508 0%, #0a0205 50%, #050508 100%)" }}>
      <aside
        className="w-[240px] flex flex-col shrink-0 h-screen sticky top-0 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #090108 0%, #060105 60%, #080108 100%)",
          borderRight: `1px solid ${RA(0.20)}`,
        }}
        data-testid="sidebar"
      >
        {/* Animated scan line */}
        <div
          className="absolute left-0 right-0 h-[1px] pointer-events-none z-10"
          style={{
            background: `linear-gradient(90deg, transparent, ${RA(0.30)}, transparent)`,
            animation: "scanline 6s linear infinite",
          }}
        />

        {/* Top glow */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${R}, transparent)`, boxShadow: `0 0 8px ${R}` }} />

        {/* Ambient blobs */}
        <div className="absolute top-0 left-0 w-48 h-48 pointer-events-none" style={{ background: `radial-gradient(ellipse at top left, ${RA(0.10)}, transparent 65%)` }} />
        <div className="absolute bottom-20 right-0 w-32 h-32 pointer-events-none" style={{ background: `radial-gradient(ellipse at bottom right, ${RA(0.06)}, transparent 65%)` }} />

        {/* Circuit line decoration */}
        <div className="absolute top-0 bottom-0 right-6 w-px pointer-events-none" style={{ background: `linear-gradient(180deg, ${RA(0.06)}, ${RA(0.02)}, ${RA(0.06)})` }} />

        {/* Header */}
        <div className="px-4 pt-5 pb-3 relative">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm font-mono bg-black/50 border-red-900/50 text-red-100 rounded-lg"
                onKeyDown={(e) => { if (e.key === "Enter") savePanelName(); if (e.key === "Escape") { setIsEditing(false); setEditName(panelName); } }}
                data-testid="input-panel-name"
              />
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2" style={{ color: R }} onClick={savePanelName} disabled={saving} data-testid="button-save-panel-name">
                  <Check className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-white/40" onClick={() => { setIsEditing(false); setEditName(panelName); }}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="group flex items-center gap-3">
              {/* Logo mark */}
              <div
                className="relative shrink-0 w-10 h-10 flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${RA(0.28)} 0%, ${RA(0.10)} 100%)`,
                  border: `1px solid ${RA(0.45)}`,
                  boxShadow: `0 0 20px ${RA(0.25)}, inset 0 1px 0 ${RA(0.20)}`,
                  clipPath: "polygon(15% 0%, 85% 0%, 100% 15%, 100% 85%, 85% 100%, 15% 100%, 0% 85%, 0% 15%)",
                }}
              >
                <Terminal className="w-[17px] h-[17px]" style={{ color: R, filter: `drop-shadow(0 0 8px ${R})` }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[13px] font-mono font-bold tracking-tight truncate" data-testid="text-brand">
                    <GlitchText text={panelName} />
                  </h2>
                  <button
                    onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all shrink-0"
                    style={{ color: RA(0.35) }}
                    data-testid="button-edit-panel-name"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-[8px] uppercase tracking-[0.25em] font-mono" style={{ color: RA(0.45) }}>Command Center</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Status strip */}
        <div className="mx-3 mb-2">
          <div
            className="px-3 py-2 rounded-lg"
            style={{
              background: "rgba(0,0,0,0.50)",
              border: `1px solid ${RA(0.20)}`,
              boxShadow: `inset 0 1px 0 ${RA(0.08)}`,
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <div className="relative flex items-center justify-center w-2 h-2">
                  <div className="absolute w-2 h-2 rounded-full animate-ping" style={{ background: R, opacity: 0.4 }} />
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: R, boxShadow: `0 0 6px ${R}` }} />
                </div>
                <span className="text-[9px] font-mono font-bold tracking-widest uppercase" style={{ color: R, textShadow: `0 0 8px ${R}` }}>ONLINE</span>
              </div>
              <span className="text-[9px] tabular-nums font-mono font-bold" style={{ color: "rgba(255,255,255,0.45)" }}>
                {time.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-mono" style={{ color: RA(0.35) }}>
                UP {formatUptime(uptime)}
              </span>
              <SignalBars active={signalStrength} />
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto pb-2 space-y-0.5 mt-0.5 scrollbar-none">
          <SectionDivider label="Core" icon={Circle} />
          <NavItem item={nav[0]} location={location} />

          {/* Ticket Master */}
          <SectionDivider label="Ticket Master" icon={Ticket} />
          <div>
            <div
              onClick={() => { setTmExpanded((v) => !v); sounds.navigate(); }}
              onMouseEnter={() => sounds.hover()}
              className="relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-150"
              style={isTmRoute ? {
                background: `linear-gradient(135deg, ${RA(0.20)} 0%, ${RA(0.06)} 100%)`,
                border: `1px solid ${RA(0.40)}`,
                boxShadow: `0 0 20px ${RA(0.12)}, inset 0 1px 0 ${RA(0.12)}`,
              } : { border: "1px solid transparent" }}
              data-testid="nav-ticket-master"
            >
              {isTmRoute && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full" style={{ height: "60%", background: R, boxShadow: `0 0 8px ${R}` }} />
              )}
              <div
                className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
                style={isTmRoute
                  ? { background: RA(0.20), border: `1px solid ${RA(0.45)}`, boxShadow: `0 0 12px ${RA(0.20)}` }
                  : { background: RA(0.04), border: `1px solid ${RA(0.10)}` }
                }
              >
                <Ticket className="w-[13px] h-[13px]" style={{ color: isTmRoute ? R : RA(0.45), filter: isTmRoute ? `drop-shadow(0 0 4px ${R})` : "none" }} />
              </div>
              <span className="flex-1 text-[11.5px] font-mono tracking-tight" style={{ color: isTmRoute ? "#ffffff" : "rgba(255,255,255,0.55)" }}>Ticket Master</span>
              <TagBadge tag="TKT" />
              <ChevronDown
                className="w-3 h-3 ml-0.5 transition-transform duration-200"
                style={{ transform: tmExpanded ? "rotate(0deg)" : "rotate(-90deg)", color: RA(0.35) }}
              />
            </div>

            {tmExpanded && (
              <div className="ml-4 mt-1 pl-3 space-y-0.5" style={{ borderLeft: `1px solid ${RA(0.20)}` }}>
                {TM_SUBNAV.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        onClick={() => sounds.navigate()}
                        onMouseEnter={() => sounds.hover()}
                        className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-mono cursor-pointer transition-all duration-100"
                        style={isActive
                          ? { background: RA(0.14), border: `1px solid ${RA(0.30)}`, color: R }
                          : { border: "1px solid transparent", color: "rgba(255,255,255,0.45)" }
                        }
                        data-testid={`nav-tm-${item.label.toLowerCase().replace(/ /g, "-")}`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3 rounded-r-full" style={{ background: R, boxShadow: `0 0 6px ${R}` }} />
                        )}
                        <item.icon className="w-[11px] h-[11px] shrink-0" style={{ color: isActive ? R : RA(0.40) }} />
                        <span>{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <SectionDivider label="Operations" icon={Zap} />
          <NavItem item={nav[1]} location={location} />

          <SectionDivider label="Data" icon={Database} />
          {nav.slice(2, 7).map((item) => <NavItem key={item.href} item={item} location={location} />)}

          {user.role === "superadmin" && (
            <>
              <SectionDivider label="Admin" icon={Lock} />
              {nav.slice(7).map((item) => <NavItem key={item.href} item={item} location={location} />)}
            </>
          )}
        </nav>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-28 pointer-events-none" style={{ background: "linear-gradient(0deg, rgba(6,1,5,1) 0%, transparent 100%)" }} />

        {/* User card */}
        <div className="relative mx-3 mb-3 mt-1">
          <div
            className="p-3 rounded-lg"
            style={{
              background: "rgba(0,0,0,0.60)",
              border: `1px solid ${RA(0.22)}`,
              boxShadow: `0 0 20px ${RA(0.08)}, inset 0 1px 0 ${RA(0.10)}`,
            }}
          >
            {/* Top border accent */}
            <div className="absolute top-0 left-6 right-6 h-px" style={{ background: `linear-gradient(90deg, transparent, ${RA(0.45)}, transparent)` }} />

            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="relative shrink-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${RA(0.22)}, ${RA(0.08)})`,
                    border: `1px solid ${RA(0.38)}`,
                    boxShadow: `0 0 14px ${RA(0.18)}`,
                  }}
                >
                  <User className="w-[15px] h-[15px]" style={{ color: R, filter: `drop-shadow(0 0 4px ${R})` }} />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full" style={{ background: R, border: "1.5px solid #060105", boxShadow: `0 0 6px ${R}` }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono truncate" style={{ color: "rgba(255,255,255,0.80)" }} data-testid="text-user-email">
                  {user.email}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="text-[7.5px] capitalize font-mono font-bold tracking-widest uppercase px-1.5 py-0.5 rounded"
                    style={{ background: RA(0.14), color: R, border: `1px solid ${RA(0.30)}` }}
                    data-testid="text-user-role"
                  >
                    {user.role}
                  </span>
                </div>
              </div>
            </div>

            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-mono font-bold tracking-wider uppercase transition-all duration-150"
              style={{ border: `1px solid ${RA(0.18)}`, color: RA(0.40), background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = RA(0.14);
                e.currentTarget.style.borderColor = RA(0.45);
                e.currentTarget.style.color = R;
                e.currentTarget.style.boxShadow = `0 0 12px ${RA(0.15)}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = RA(0.18);
                e.currentTarget.style.color = RA(0.40);
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto" style={{ background: "transparent" }}>
        <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
      </main>

      <style>{`
        @keyframes scanline {
          0% { top: 0%; opacity: 0; }
          5% { opacity: 1; }
          95% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}

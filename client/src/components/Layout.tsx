import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import {
  LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users,
  Wallet, Server, Pencil, Check, X, TrendingUp, Terminal,
  Settings, Shield, Ticket, Search, Bell, Bookmark,
  SlidersHorizontal, CreditCard, ShoppingCart, ChevronDown, MailOpen,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { sounds } from "@/lib/sounds";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string; panelName?: string };
  onLogout: () => void;
  onPanelNameChange?: (name: string) => void;
};

const RED = "#ff1a1a";
const RED2 = "#ff4444";
const RA = (a: number) => `rgba(255,26,26,${a})`;
const GREEN = "#00ff41";

const TM_SUBNAV = [
  { href: "/admin/tm-event-scanner", label: "Event Scanner", icon: Search },
  { href: "/admin/tm-live-alerts", label: "Live Alerts", icon: Bell },
  { href: "/admin/tm-tracked-events", label: "Tracked Events", icon: Bookmark },
  { href: "/admin/tm-settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/my-cards", label: "My Cards", icon: CreditCard },
];

const TAG_META: Record<string, { label: string; color: string; glow: string }> = {
  SYS: { label: "SYS", color: "#ff1a1a", glow: "rgba(255,26,26,0.5)" },
  OPS: { label: "OPS", color: "#ff6600", glow: "rgba(255,102,0,0.5)" },
  DB:  { label: "DB",  color: "#ff1a1a", glow: "rgba(255,26,26,0.5)" },
  NET: { label: "NET", color: "#00aaff", glow: "rgba(0,170,255,0.5)" },
  FIN: { label: "FIN", color: "#ffcc00", glow: "rgba(255,204,0,0.5)" },
  PVT: { label: "PVT", color: "#ff1a1a", glow: "rgba(255,26,26,0.6)" },
  ADM: { label: "ADM", color: "#ff4444", glow: "rgba(255,68,68,0.5)" },
  CFG: { label: "CFG", color: "#aaaaaa", glow: "rgba(170,170,170,0.3)" },
  TKT: { label: "TKT", color: "#ff1a1a", glow: "rgba(255,26,26,0.5)" },
  CRD: { label: "CRD", color: "#ff1a1a", glow: "rgba(255,26,26,0.5)" },
};

function Tag({ tag }: { tag: string }) {
  const m = TAG_META[tag] || TAG_META.SYS;
  return (
    <span
      className="text-[9px] font-mono font-bold tracking-widest px-1.5 py-0.5 rounded-sm shrink-0"
      style={{
        color: m.color,
        background: `${m.color}14`,
        border: `1px solid ${m.color}55`,
        textShadow: `0 0 6px ${m.glow}`,
        boxShadow: `0 0 8px ${m.color}20, inset 0 0 6px ${m.color}08`,
      }}
    >
      {m.label}
    </span>
  );
}

function GlitchText({ text }: { text: string }) {
  const [frame, setFrame] = useState(0);
  const [glitching, setGlitching] = useState(false);
  const chars = "!@#$%^&*<>[]{}|/\\";

  useEffect(() => {
    let glitchTimeout: ReturnType<typeof setTimeout>;
    let frameInterval: ReturnType<typeof setInterval>;
    const schedule = () => {
      glitchTimeout = setTimeout(() => {
        setGlitching(true);
        let f = 0;
        frameInterval = setInterval(() => {
          setFrame(f++);
          if (f > 6) {
            clearInterval(frameInterval);
            setGlitching(false);
            schedule();
          }
        }, 60);
      }, 3000 + Math.random() * 7000);
    };
    schedule();
    return () => { clearTimeout(glitchTimeout); clearInterval(frameInterval); };
  }, []);

  const display = glitching && frame % 2 === 0
    ? text.split("").map((c, i) => (i + frame) % 3 === 0 ? chars[Math.floor(Math.random() * chars.length)] : c).join("")
    : text;

  return (
    <span
      style={{
        textShadow: glitching ? `2px 0 ${RED}, -2px 0 ${GREEN}, 0 0 20px ${RA(0.6)}` : `0 0 14px ${RA(0.45)}`,
        color: "#ffffff",
        transform: glitching ? `translateX(${(frame % 2) * 2 - 1}px)` : "none",
        display: "inline-block",
        transition: "text-shadow 0.05s",
      }}
    >
      {display}
    </span>
  );
}

function BlinkCursor() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOn(v => !v), 600);
    return () => clearInterval(t);
  }, []);
  return (
    <span style={{ color: RED, textShadow: `0 0 8px ${RED}`, opacity: on ? 1 : 0, transition: "opacity 0.1s" }}>█</span>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-5 pb-2">
      <span className="text-[9px] font-mono font-bold tracking-[0.3em] uppercase" style={{ color: RA(0.45), textShadow: `0 0 8px ${RA(0.3)}` }}>
        //
      </span>
      <span className="text-[9px] font-mono font-bold tracking-[0.25em] uppercase" style={{ color: RA(0.50), textShadow: `0 0 6px ${RA(0.25)}` }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${RA(0.25)}, transparent)` }} />
    </div>
  );
}

function NavItem({ item, location }: { item: { href: string; label: string; icon: any; tag: string }; location: string }) {
  const isActive = location === item.href || (item.href === "/admin/create-server" && ([
    "/admin/la28-create", "/admin/tm-create", "/admin/uefa-create",
    "/admin/brunomars-create", "/admin/outlook-login", "/admin/outlook-create",
    "/admin/zenrows-register", "/admin/replit-create", "/admin/lovable-create",
    "/admin/v0-create", "/admin/card-generator"
  ].includes(location)));

  return (
    <Link href={item.href}>
      <div
        onClick={() => sounds.navigate()}
        onMouseEnter={() => sounds.hover()}
        className="group/item relative flex items-center gap-3 mx-3 px-3 py-[9px] cursor-pointer transition-all duration-150 rounded"
        style={isActive ? {
          background: `linear-gradient(90deg, ${RA(0.15)}, ${RA(0.04)})`,
          border: `1px solid ${RA(0.35)}`,
          boxShadow: `0 0 20px ${RA(0.10)}, inset 0 0 20px ${RA(0.04)}`,
        } : {
          border: "1px solid transparent",
        }}
        data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
      >
        {/* Active bar */}
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-sm"
            style={{ height: "65%", background: RED, boxShadow: `0 0 10px ${RED}, 0 0 20px ${RA(0.5)}` }} />
        )}

        {/* Icon box */}
        <div
          className="shrink-0 w-8 h-8 rounded flex items-center justify-center transition-all duration-150"
          style={isActive ? {
            background: RA(0.18),
            border: `1px solid ${RA(0.40)}`,
            boxShadow: `0 0 12px ${RA(0.20)}`,
          } : {
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <item.icon
            className="w-[14px] h-[14px] shrink-0 transition-all duration-150"
            style={{
              color: isActive ? RED : "rgba(255,255,255,0.35)",
              filter: isActive ? `drop-shadow(0 0 5px ${RED})` : "none",
            }}
          />
        </div>

        {/* Label */}
        <span
          className="flex-1 text-[12.5px] font-mono transition-colors duration-150"
          style={{
            color: isActive ? "#ffffff" : "rgba(255,255,255,0.50)",
            textShadow: isActive ? `0 0 12px ${RA(0.3)}` : "none",
            letterSpacing: "0.01em",
          }}
        >
          {item.label}
        </span>
        <Tag tag={item.tag} />

        {/* Hover overlay */}
        {!isActive && (
          <div className="absolute inset-0 rounded opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 pointer-events-none"
            style={{ background: `linear-gradient(90deg, ${RA(0.06)}, transparent)` }} />
        )}
      </div>
    </Link>
  );
}

function DataReadout({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[8px] font-mono uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.20)" }}>{label}</span>
      <span className="text-[11px] font-mono font-bold tabular-nums"
        style={{ color: accent ? RED : "rgba(255,255,255,0.65)", textShadow: accent ? `0 0 8px ${RA(0.5)}` : "none" }}>
        {value}
      </span>
    </div>
  );
}

const FULLSCREEN_ROUTES = ["/admin/outlook-workspace", "/admin/email-workspace"];

export default function Layout({ children, user, onLogout, onPanelNameChange }: LayoutProps) {
  const [location] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.panelName || "Addison Panel");
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState(new Date());
  const [uptime, setUptime] = useState(0);
  const isTmRoute = location.startsWith("/admin/tm-") || location === "/admin/my-cards";
  const [tmExpanded, setTmExpanded] = useState(() => location.startsWith("/admin/tm-") || location === "/admin/my-cards");
  const startTime = useRef(Date.now());
  const [ping, setPing] = useState(12);

  const panelName = user.panelName || "Addison Panel";

  useEffect(() => {
    const t = setInterval(() => {
      setTime(new Date());
      setUptime(Math.floor((Date.now() - startTime.current) / 1000));
      setPing(Math.floor(8 + Math.random() * 18));
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

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };

  const nav = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard, tag: "SYS" },
    { href: "/admin/create-server", label: "Create Account", icon: Server, tag: "OPS" },
    { href: "/admin/accounts", label: "Account Stock", icon: Archive, tag: "DB" },
    { href: "/admin/email-workspace", label: "Email Workspace", icon: Mail, tag: "NET" },
    { href: "/admin/outlook-workspace", label: "Outlook Workspace", icon: MailOpen, tag: "NET" },
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

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "#07050a" }}>
      {/* ── SIDEBAR ── */}
      <aside
        className="w-[285px] flex flex-col shrink-0 h-screen sticky top-0 overflow-hidden"
        style={{
          background: "linear-gradient(170deg, #0d0509 0%, #080410 50%, #0a0308 100%)",
          borderRight: `1px solid ${RA(0.18)}`,
        }}
        data-testid="sidebar"
      >
        {/* Scanline sweep */}
        <div className="absolute inset-0 pointer-events-none z-0" style={{ animation: "scanlines 0.12s steps(1) infinite", backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.03) 1px, transparent 1px, transparent 2px)", backgroundSize: "100% 2px" }} />

        {/* Moving scan beam */}
        <div className="absolute left-0 right-0 h-[2px] pointer-events-none z-10"
          style={{ background: `linear-gradient(90deg, transparent, ${RA(0.25)}, transparent)`, animation: "scanbeam 7s linear infinite" }} />

        {/* Top neon line */}
        <div className="absolute top-0 left-0 right-0 h-[1px]"
          style={{ background: `linear-gradient(90deg, transparent, ${RED}, transparent)`, boxShadow: `0 0 10px ${RED}, 0 0 20px ${RA(0.3)}` }} />

        {/* Ambient glow */}
        <div className="absolute top-0 left-0 w-full h-60 pointer-events-none"
          style={{ background: `radial-gradient(ellipse 100% 50% at 50% -5%, ${RA(0.10)}, transparent)` }} />

        {/* Vertical circuit lines */}
        <div className="absolute top-0 bottom-0 right-8 w-px pointer-events-none"
          style={{ background: `linear-gradient(180deg, ${RA(0.08)}, transparent 30%, transparent 70%, ${RA(0.04)})` }} />
        <div className="absolute top-0 bottom-0 left-[18px] w-px pointer-events-none"
          style={{ background: `linear-gradient(180deg, transparent, ${RA(0.05)} 40%, transparent)` }} />

        {/* ── HEADER ── */}
        <div className="relative z-10 px-5 pt-6 pb-4">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-9 text-sm font-mono bg-black/60 border-red-900/40 text-red-100"
                onKeyDown={(e) => { if (e.key === "Enter") savePanelName(); if (e.key === "Escape") { setIsEditing(false); setEditName(panelName); } }}
                data-testid="input-panel-name"
              />
              <div className="flex gap-1.5">
                <button onClick={savePanelName} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all"
                  style={{ background: RA(0.15), color: RED, border: `1px solid ${RA(0.35)}`, textShadow: `0 0 6px ${RA(0.5)}` }}
                  data-testid="button-save-panel-name">
                  <Check className="w-3 h-3" /> SAVE
                </button>
                <button onClick={() => { setIsEditing(false); setEditName(panelName); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.40)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <X className="w-3 h-3" /> ESC
                </button>
              </div>
            </div>
          ) : (
            <div className="group flex items-center gap-3.5">
              {/* Hexagonal logo */}
              <div className="relative shrink-0 w-11 h-11 flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${RA(0.25)}, ${RA(0.08)})`,
                  border: `1px solid ${RA(0.45)}`,
                  boxShadow: `0 0 20px ${RA(0.25)}, 0 0 40px ${RA(0.10)}, inset 0 1px 0 ${RA(0.20)}`,
                  clipPath: "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)",
                }}>
                <Terminal className="w-[18px] h-[18px]" style={{ color: RED, filter: `drop-shadow(0 0 6px ${RED})` }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-mono font-bold tracking-tight truncate" data-testid="text-brand">
                    <GlitchText text={panelName} />
                  </h2>
                  <button onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded transition-all"
                    style={{ color: RA(0.35) }} data-testid="button-edit-panel-name">
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] font-mono tracking-[0.25em] uppercase" style={{ color: RA(0.40) }}>
                    CMD <BlinkCursor />
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── STATUS READOUT ── */}
        <div className="relative z-10 mx-4 mb-2">
          <div className="px-3.5 py-3 rounded"
            style={{
              background: "rgba(0,0,0,0.55)",
              border: `1px solid ${RA(0.20)}`,
              boxShadow: `0 0 20px ${RA(0.06)}, inset 0 1px 0 ${RA(0.08)}`,
            }}>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="absolute w-2.5 h-2.5 rounded-full animate-ping" style={{ background: RED, opacity: 0.35 }} />
                  <div className="w-2 h-2 rounded-full" style={{ background: RED, boxShadow: `0 0 8px ${RED}` }} />
                </div>
                <span className="text-[10px] font-mono font-bold tracking-widest uppercase" style={{ color: RED, textShadow: `0 0 8px ${RA(0.7)}` }}>
                  ◈ ONLINE
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.60)" }}>
                {time.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <DataReadout label="UPTIME" value={fmt(uptime)} />
              <DataReadout label="PING" value={`${ping}ms`} accent />
              <DataReadout label="STATUS" value="SECURE" />
            </div>
          </div>
        </div>

        {/* Separator */}
        <div className="relative z-10 mx-4 mb-1">
          <div className="h-px" style={{ background: `linear-gradient(90deg, transparent, ${RA(0.20)}, transparent)` }} />
        </div>

        {/* ── NAV ── */}
        <nav className="relative z-10 flex-1 overflow-y-auto pb-3 scrollbar-none">
          <SectionHeader label="Core" />
          <NavItem item={nav[0]} location={location} />

          <SectionHeader label="Ticket Master" />
          <div>
            <div
              onClick={() => { setTmExpanded(v => !v); sounds.navigate(); }}
              onMouseEnter={() => sounds.hover()}
              className="group relative flex items-center gap-3 mx-3 px-3 py-[9px] cursor-pointer transition-all duration-150 rounded"
              style={isTmRoute ? {
                background: `linear-gradient(90deg, ${RA(0.15)}, ${RA(0.04)})`,
                border: `1px solid ${RA(0.35)}`,
                boxShadow: `0 0 20px ${RA(0.10)}, inset 0 0 20px ${RA(0.04)}`,
              } : { border: "1px solid transparent" }}
              data-testid="nav-ticket-master"
            >
              {isTmRoute && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-sm"
                  style={{ height: "65%", background: RED, boxShadow: `0 0 10px ${RED}` }} />
              )}
              <div className="shrink-0 w-8 h-8 rounded flex items-center justify-center"
                style={isTmRoute
                  ? { background: RA(0.18), border: `1px solid ${RA(0.40)}`, boxShadow: `0 0 12px ${RA(0.20)}` }
                  : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }
                }>
                <Ticket className="w-[14px] h-[14px]"
                  style={{ color: isTmRoute ? RED : "rgba(255,255,255,0.35)", filter: isTmRoute ? `drop-shadow(0 0 5px ${RED})` : "none" }} />
              </div>
              <span className="flex-1 text-[12.5px] font-mono"
                style={{ color: isTmRoute ? "#ffffff" : "rgba(255,255,255,0.50)", textShadow: isTmRoute ? `0 0 12px ${RA(0.3)}` : "none" }}>
                Ticket Master
              </span>
              <Tag tag="TKT" />
              <ChevronDown className="w-3.5 h-3.5 ml-1 transition-transform duration-200 shrink-0"
                style={{ transform: tmExpanded ? "rotate(0deg)" : "rotate(-90deg)", color: "rgba(255,255,255,0.20)" }} />
              {!isTmRoute && (
                <div className="absolute inset-0 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: `linear-gradient(90deg, ${RA(0.06)}, transparent)` }} />
              )}
            </div>

            {tmExpanded && (
              <div className="ml-7 mt-1 pl-3 space-y-0.5" style={{ borderLeft: `1px solid ${RA(0.15)}` }}>
                {TM_SUBNAV.map((sub) => {
                  const on = location === sub.href;
                  return (
                    <Link key={sub.href} href={sub.href}>
                      <div onClick={() => sounds.navigate()} onMouseEnter={() => sounds.hover()}
                        className="relative flex items-center gap-2.5 px-3 py-2 rounded cursor-pointer transition-all duration-100"
                        style={on
                          ? { background: RA(0.12), color: RED, border: `1px solid ${RA(0.25)}`, textShadow: `0 0 8px ${RA(0.5)}` }
                          : { border: "1px solid transparent", color: "rgba(255,255,255,0.40)" }
                        }
                        data-testid={`nav-tm-${sub.label.toLowerCase().replace(/ /g, "-")}`}>
                        <sub.icon className="w-[11px] h-[11px] shrink-0" style={{ color: on ? RED : "rgba(255,255,255,0.30)" }} />
                        <span className="text-[11.5px] font-mono">{sub.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <SectionHeader label="Operations" />
          <NavItem item={nav[1]} location={location} />

          <SectionHeader label="Data" />
          {nav.slice(2, 7).map(item => <NavItem key={item.href} item={item} location={location} />)}

          {user.role === "superadmin" && (
            <>
              <SectionHeader label="Admin" />
              {nav.slice(7).map(item => <NavItem key={item.href} item={item} location={location} />)}
            </>
          )}
        </nav>

        {/* ── USER CARD ── */}
        <div className="relative z-10">
          <div className="h-px mx-4" style={{ background: `linear-gradient(90deg, transparent, ${RA(0.20)}, transparent)` }} />
          <div className="p-4">
            <div className="mb-3 px-3 py-2.5 rounded"
              style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${RA(0.15)}` }}>
              <div className="flex items-center gap-3">
                <div className="relative shrink-0 w-9 h-9 rounded flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${RA(0.20)}, ${RA(0.07)})`, border: `1px solid ${RA(0.35)}`, boxShadow: `0 0 14px ${RA(0.18)}` }}>
                  <User className="w-[15px] h-[15px]" style={{ color: RED, filter: `drop-shadow(0 0 4px ${RED})` }} />
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                    style={{ background: RED, border: "2px solid #0a0308", boxShadow: `0 0 6px ${RED}` }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-mono truncate" style={{ color: "rgba(255,255,255,0.75)" }} data-testid="text-user-email">
                    {user.email}
                  </p>
                  <span className="text-[8px] font-mono font-bold tracking-[0.25em] uppercase px-1.5 py-0.5 rounded-sm mt-0.5 inline-block"
                    style={{ background: RA(0.12), color: RED, border: `1px solid ${RA(0.28)}`, textShadow: `0 0 6px ${RA(0.5)}` }}
                    data-testid="text-user-role">
                    ◈ {user.role}
                  </span>
                </div>
              </div>
            </div>

            <button
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded text-[11px] font-mono font-bold tracking-widest uppercase transition-all duration-150"
              style={{ border: `1px solid ${RA(0.18)}`, color: RA(0.45), background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = RA(0.12);
                e.currentTarget.style.borderColor = RA(0.45);
                e.currentTarget.style.color = RED;
                e.currentTarget.style.boxShadow = `0 0 20px ${RA(0.18)}`;
                e.currentTarget.style.textShadow = `0 0 8px ${RA(0.6)}`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = RA(0.18);
                e.currentTarget.style.color = RA(0.45);
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.textShadow = "none";
              }}
              onClick={() => { sounds.logout(); onLogout(); }}
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5" />
              [ DISCONNECT ]
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      {FULLSCREEN_ROUTES.some(r => location.startsWith(r)) ? (
        <main className="flex-1 overflow-hidden flex flex-col" style={{ background: "#07050a", height: "100vh" }}>
          {children}
        </main>
      ) : (
        <main className="flex-1 overflow-auto" style={{ background: "#07050a" }}>
          <div className="p-7 max-w-[1400px] mx-auto">{children}</div>
        </main>
      )}

      <style>{`
        @keyframes scanbeam {
          0%   { top: -2px; opacity: 0; }
          5%   { opacity: 1; }
          95%  { opacity: 0.6; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes scanlines {
          0%   { background-position: 0 0; }
          100% { background-position: 0 4px; }
        }
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}

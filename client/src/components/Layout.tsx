import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users, Wallet, Server, Pencil, Check, X, TrendingUp, ChevronRight, Terminal, Settings, Shield, Ticket, Search, Bell, Bookmark, SlidersHorizontal, Zap, Activity, Radio, CreditCard, ShoppingCart } from "lucide-react";
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
const RD = "#cc0000";

const TM_SUBNAV = [
  { href: "/admin/tm-event-scanner", label: "Event Scanner", icon: Search },
  { href: "/admin/tm-live-alerts", label: "Live Alerts", icon: Bell },
  { href: "/admin/tm-tracked-events", label: "Tracked Events", icon: Bookmark },
  { href: "/admin/tm-settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/my-cards", label: "My Cards", icon: CreditCard },
];

const TAG_STYLES: Record<string, { bg: string; text: string; dot: string; glow: string }> = {
  SYS: { bg: RA(0.10), text: RA(0.75), dot: R, glow: RA(0.25) },
  OPS: { bg: RA(0.12), text: RA(0.85), dot: R, glow: RA(0.30) },
  DB:  { bg: RA(0.10), text: RA(0.75), dot: RD, glow: RA(0.25) },
  NET: { bg: RA(0.10), text: RA(0.75), dot: R, glow: RA(0.25) },
  FIN: { bg: RA(0.10), text: RA(0.75), dot: R, glow: RA(0.25) },
  PVT: { bg: RA(0.14), text: RA(0.90), dot: R, glow: RA(0.35) },
  ADM: { bg: RA(0.10), text: RA(0.75), dot: RD, glow: RA(0.25) },
  CFG: { bg: "rgba(174,174,178,0.10)", text: "rgba(174,174,178,0.75)", dot: "#aeaeb2", glow: "rgba(174,174,178,0.2)" },
  TKT: { bg: RA(0.10), text: RA(0.75), dot: R, glow: RA(0.25) },
  CRD: { bg: RA(0.10), text: RA(0.75), dot: R, glow: RA(0.25) },
};

function TagBadge({ tag }: { tag: string }) {
  const s = TAG_STYLES[tag] || TAG_STYLES.SYS;
  return (
    <span
      className="text-[8px] font-mono tracking-wider px-1.5 py-0.5 rounded-md flex items-center gap-1 shrink-0"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.dot}30` }}
    >
      <span className="w-1 h-1 rounded-full inline-block" style={{ background: s.dot }} />
      {tag}
    </span>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-3.5 pb-1">
      <div className="h-px flex-1" style={{ background: RA(0.18) }} />
      <span className="text-[9px] uppercase tracking-[0.22em] font-mono font-bold" style={{ color: RA(0.45) }}>
        {label}
      </span>
      <div className="h-px flex-1" style={{ background: RA(0.18) }} />
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
        className="group/item relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-xl cursor-pointer transition-all duration-200"
        style={isActive ? {
          background: `linear-gradient(135deg, ${RA(0.18)} 0%, ${RA(0.07)} 100%)`,
          border: `1px solid ${RA(0.35)}`,
          boxShadow: `0 2px 14px ${RA(0.15)}, inset 0 1px 0 ${RA(0.15)}`,
        } : {
          border: "1px solid transparent",
          background: "transparent",
        }}
        data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
      >
        {isActive && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
            style={{ height: "55%", background: R, boxShadow: `0 0 10px ${R}, 0 0 20px ${RA(0.4)}` }}
          />
        )}

        <div
          className="relative shrink-0 w-[28px] h-[28px] rounded-lg flex items-center justify-center transition-all duration-200"
          style={isActive
            ? { background: RA(0.18), border: `1px solid ${RA(0.40)}` }
            : { background: RA(0.05), border: `1px solid ${RA(0.12)}` }
          }
        >
          <item.icon
            className="w-[13px] h-[13px] shrink-0"
            style={{ color: isActive ? R : RA(0.50) }}
          />
        </div>

        <span
          className="flex-1 text-[12px] font-mono tracking-tight transition-colors duration-200"
          style={{ color: isActive ? "#ffffff" : RA(0.70) }}
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
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #050508 0%, #0a0205 50%, #050508 100%)' }}>
      <aside
        className="w-[256px] flex flex-col shrink-0 h-screen sticky top-0 overflow-hidden"
        style={{ background: "linear-gradient(180deg, #0a0205 0%, #080108 100%)", borderRight: `1px solid ${RA(0.18)}` }}
        data-testid="sidebar"
      >
        {/* Red top glow line */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${R}, transparent)` }} />

        {/* Ambient red blob */}
        <div className="absolute top-0 left-0 w-52 h-52 pointer-events-none" style={{ background: `radial-gradient(ellipse at top left, ${RA(0.08)}, transparent 65%)` }} />
        <div className="absolute bottom-0 right-0 w-40 h-40 pointer-events-none" style={{ background: `radial-gradient(ellipse at bottom right, ${RA(0.05)}, transparent 65%)` }} />

        {/* Header */}
        <div className="px-4 pt-5 pb-3 relative">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm font-mono bg-black/50 border-red-900/50 text-red-100 rounded-xl"
                onKeyDown={(e) => { if (e.key === "Enter") savePanelName(); if (e.key === "Escape") { setIsEditing(false); setEditName(panelName); } }}
                data-testid="input-panel-name"
              />
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 hover:bg-red-500/10" style={{ color: R }} onClick={savePanelName} disabled={saving} data-testid="button-save-panel-name">
                  <Check className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-white/40 hover:text-white/70 hover:bg-white/5" onClick={() => { setIsEditing(false); setEditName(panelName); }}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="group flex items-center gap-3">
              {/* Logo */}
              <div
                className="relative shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${RA(0.25)} 0%, ${RA(0.10)} 100%)`,
                  border: `1px solid ${RA(0.40)}`,
                  boxShadow: `0 4px 16px ${RA(0.20)}, inset 0 1px 0 ${RA(0.20)}`,
                }}
              >
                <Terminal className="w-[18px] h-[18px]" style={{ color: R, filter: `drop-shadow(0 0 6px ${R})` }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2
                    className="text-[13px] font-mono font-bold tracking-tight truncate"
                    style={{ color: "#ffffff", textShadow: `0 0 12px ${RA(0.4)}` }}
                    data-testid="text-brand"
                  >
                    {panelName}
                  </h2>
                  <button
                    onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md transition-all shrink-0"
                    style={{ color: RA(0.40) }}
                    data-testid="button-edit-panel-name"
                  >
                    <Pencil className="w-2.5 h-2.5" />
                  </button>
                </div>
                <p className="text-[9px] uppercase tracking-[0.22em] mt-0.5 font-mono" style={{ color: RA(0.45) }}>Command Center</p>
              </div>
            </div>
          )}
        </div>

        {/* Status strip */}
        <div className="mx-3 mb-1">
          <div
            className="px-3 py-2 rounded-xl"
            style={{
              background: RA(0.05),
              border: `1px solid ${RA(0.18)}`,
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: R }} />
                  <div className="absolute inset-0 w-1.5 h-1.5 rounded-full animate-ping" style={{ background: R, opacity: 0.6 }} />
                </div>
                <span className="text-[9px] font-mono font-bold tracking-widest uppercase" style={{ color: R, textShadow: `0 0 8px ${R}` }}>Online</span>
              </div>
              <span className="text-[9px] tabular-nums font-mono" style={{ color: RA(0.50) }}>
                {time.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-mono" style={{ color: RA(0.40) }}>UP {formatUptime(uptime)}</span>
              <div className="flex items-center gap-0.5">
                {[1,2,3,4].map(i => (
                  <div key={i} className="w-0.5 rounded-full" style={{ height: `${4 + i * 2}px`, background: i <= 3 ? RA(0.65) : RA(0.12) }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto pb-2 space-y-0.5 mt-1">
          <SectionDivider label="Core" />
          <NavItem item={nav[0]} location={location} />

          {/* Ticket Master expandable */}
          <SectionDivider label="Ticket Master" />
          <div>
            <div
              onClick={() => { setTmExpanded((v) => !v); sounds.navigate(); }}
              onMouseEnter={() => sounds.hover()}
              className="relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-xl cursor-pointer transition-all duration-200"
              style={isTmRoute ? {
                background: `linear-gradient(135deg, ${RA(0.18)} 0%, ${RA(0.07)} 100%)`,
                border: `1px solid ${RA(0.35)}`,
                boxShadow: `0 2px 14px ${RA(0.15)}, inset 0 1px 0 ${RA(0.15)}`,
              } : { border: "1px solid transparent" }}
              data-testid="nav-ticket-master"
            >
              {isTmRoute && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full" style={{ height: "55%", background: R, boxShadow: `0 0 10px ${R}` }} />
              )}
              <div
                className="shrink-0 w-[28px] h-[28px] rounded-lg flex items-center justify-center transition-all duration-200"
                style={isTmRoute
                  ? { background: RA(0.18), border: `1px solid ${RA(0.40)}` }
                  : { background: RA(0.05), border: `1px solid ${RA(0.12)}` }
                }
              >
                <Ticket className="w-[13px] h-[13px]" style={{ color: isTmRoute ? R : RA(0.50) }} />
              </div>
              <span className="flex-1 text-[12px] font-mono tracking-tight" style={{ color: isTmRoute ? "#ffffff" : RA(0.70) }}>Ticket Master</span>
              <TagBadge tag="TKT" />
              <ChevronRight className="w-3 h-3 transition-transform duration-200 ml-0.5" style={{ transform: tmExpanded ? "rotate(90deg)" : "rotate(0deg)", color: RA(0.35) }} />
            </div>

            {tmExpanded && (
              <div className="ml-4 mt-1 pl-3 space-y-0.5" style={{ borderLeft: `1px solid ${RA(0.18)}` }}>
                {TM_SUBNAV.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        onClick={() => sounds.navigate()}
                        onMouseEnter={() => sounds.hover()}
                        className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-mono cursor-pointer transition-all duration-150"
                        style={isActive
                          ? { background: RA(0.12), border: `1px solid ${RA(0.28)}`, color: R }
                          : { border: "1px solid transparent", color: RA(0.60) }
                        }
                        data-testid={`nav-tm-${item.label.toLowerCase().replace(/ /g, "-")}`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3 rounded-r-full" style={{ background: R }} />
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

          <SectionDivider label="Operations" />
          <NavItem item={nav[1]} location={location} />

          <SectionDivider label="Data" />
          {nav.slice(2, 6).map((item) => <NavItem key={item.href} item={item} location={location} />)}

          {user.role === "superadmin" && (
            <>
              <SectionDivider label="Admin" />
              {nav.slice(6).map((item) => <NavItem key={item.href} item={item} location={location} />)}
            </>
          )}
        </nav>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none" style={{ background: "linear-gradient(0deg, rgba(5,1,5,0.95), transparent)" }} />

        {/* User card */}
        <div className="relative mx-3 mb-3 mt-1">
          <div
            className="p-3 rounded-2xl"
            style={{
              background: RA(0.06),
              border: `1px solid ${RA(0.20)}`,
              boxShadow: `0 2px 16px ${RA(0.10)}, inset 0 1px 0 ${RA(0.10)}`,
            }}
          >
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="relative shrink-0">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${RA(0.20)}, ${RA(0.08)})`,
                    border: `1px solid ${RA(0.35)}`,
                  }}
                >
                  <User className="w-4 h-4" style={{ color: R }} />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-black" style={{ background: R }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10.5px] font-mono truncate" style={{ color: "rgba(255,255,255,0.80)" }} data-testid="text-user-email">
                  {user.email}
                </p>
                <p className="text-[8.5px] capitalize mt-0.5 font-mono font-bold tracking-widest uppercase" style={{ color: RA(0.65) }} data-testid="text-user-role">
                  {user.role}
                </p>
              </div>
            </div>

            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-[10.5px] font-mono transition-all duration-150"
              style={{ border: `1px solid ${RA(0.15)}`, color: RA(0.45), background: "transparent" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = RA(0.12);
                e.currentTarget.style.borderColor = RA(0.40);
                e.currentTarget.style.color = R;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = RA(0.15);
                e.currentTarget.style.color = RA(0.45);
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

      <main className="flex-1 overflow-auto cyber-grid" style={{ background: 'transparent' }}>
        <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

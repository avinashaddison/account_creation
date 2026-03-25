import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import {
  LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users,
  Wallet, Server, Pencil, Check, X, TrendingUp, ChevronRight,
  Terminal, Settings, Shield, Ticket, Search, Bell, Bookmark,
  SlidersHorizontal, Zap, CreditCard, ShoppingCart,
  ChevronDown, Database, Lock, Circle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { sounds } from "@/lib/sounds";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string; panelName?: string };
  onLogout: () => void;
  onPanelNameChange?: (name: string) => void;
};

const R = "#ef4444";
const RA = (a: number) => `rgba(239,68,68,${a})`;

const TM_SUBNAV = [
  { href: "/admin/tm-event-scanner", label: "Event Scanner", icon: Search },
  { href: "/admin/tm-live-alerts", label: "Live Alerts", icon: Bell },
  { href: "/admin/tm-tracked-events", label: "Tracked Events", icon: Bookmark },
  { href: "/admin/tm-settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/admin/my-cards", label: "My Cards", icon: CreditCard },
];

const TAG_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  SYS: { label: "SYS", color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.20)" },
  OPS: { label: "OPS", color: "#f97316", bg: "rgba(249,115,22,0.08)", border: "rgba(249,115,22,0.20)" },
  DB:  { label: "DB",  color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.18)" },
  NET: { label: "NET", color: "#38bdf8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.20)" },
  FIN: { label: "FIN", color: "#facc15", bg: "rgba(250,204,21,0.08)", border: "rgba(250,204,21,0.20)" },
  PVT: { label: "PVT", color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.25)" },
  ADM: { label: "ADM", color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.18)" },
  CFG: { label: "CFG", color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.18)" },
  TKT: { label: "TKT", color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.18)" },
  CRD: { label: "CRD", color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.18)" },
};

function TagBadge({ tag }: { tag: string }) {
  const m = TAG_META[tag] || TAG_META.SYS;
  return (
    <span
      className="text-[9px] font-mono tracking-wide px-1.5 py-0.5 rounded shrink-0"
      style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}
    >
      {m.label}
    </span>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-5 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.25)" }}>
        {label}
      </span>
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
        className="group/item relative flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150"
        style={isActive ? {
          background: "rgba(239,68,68,0.10)",
          border: "1px solid rgba(239,68,68,0.18)",
        } : {
          border: "1px solid transparent",
        }}
        data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
      >
        {isActive && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
            style={{ height: "55%", background: R }}
          />
        )}

        <div
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
          style={isActive
            ? { background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.25)" }
            : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }
          }
        >
          <item.icon
            className="w-[14px] h-[14px] shrink-0 transition-colors duration-150"
            style={{ color: isActive ? R : "rgba(255,255,255,0.45)" }}
          />
        </div>

        <span
          className="flex-1 text-[13px] font-medium transition-colors duration-150"
          style={{ color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.60)" }}
        >
          {item.label}
        </span>
        <TagBadge tag={item.tag} />

        {/* Hover state */}
        {!isActive && (
          <div className="absolute inset-0 rounded-lg opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 pointer-events-none"
            style={{ background: "rgba(255,255,255,0.03)" }} />
        )}
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
    <div className="min-h-screen flex" style={{ background: "#0c0a0a" }}>
      <aside
        className="w-[280px] flex flex-col shrink-0 h-screen sticky top-0 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #110d0d 0%, #0e0b0b 100%)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
        data-testid="sidebar"
      >
        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[1px]" style={{ background: `linear-gradient(90deg, transparent 10%, ${RA(0.6)} 50%, transparent 90%)` }} />

        {/* Subtle top glow */}
        <div className="absolute top-0 left-0 right-0 h-48 pointer-events-none" style={{ background: `radial-gradient(ellipse 80% 60% at 50% -10%, ${RA(0.06)}, transparent)` }} />

        {/* Header */}
        <div className="px-5 pt-6 pb-4 relative">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-9 text-sm bg-white/5 border-white/10 text-white rounded-lg"
                onKeyDown={(e) => { if (e.key === "Enter") savePanelName(); if (e.key === "Escape") { setIsEditing(false); setEditName(panelName); } }}
                data-testid="input-panel-name"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={savePanelName}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{ background: RA(0.15), color: R, border: `1px solid ${RA(0.25)}` }}
                  data-testid="button-save-panel-name"
                >
                  <Check className="w-3 h-3" /> Save
                </button>
                <button
                  onClick={() => { setIsEditing(false); setEditName(panelName); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.50)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group flex items-center gap-3.5">
              {/* Logo */}
              <div
                className="relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${RA(0.20)} 0%, ${RA(0.08)} 100%)`,
                  border: `1px solid ${RA(0.25)}`,
                  boxShadow: `0 0 0 3px ${RA(0.06)}`,
                }}
              >
                <Terminal className="w-5 h-5" style={{ color: R }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2
                    className="text-[15px] font-semibold tracking-tight truncate text-white"
                    data-testid="text-brand"
                  >
                    {panelName}
                  </h2>
                  <button
                    onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md transition-all"
                    style={{ color: "rgba(255,255,255,0.30)" }}
                    data-testid="button-edit-panel-name"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: "rgba(255,255,255,0.30)" }}>Command Center</p>
              </div>
            </div>
          )}
        </div>

        {/* Status strip */}
        <div className="mx-4 mb-2">
          <div
            className="px-3.5 py-2.5 rounded-xl flex items-center justify-between"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-center gap-2">
              <div className="relative flex items-center justify-center">
                <div className="absolute w-2.5 h-2.5 rounded-full animate-ping" style={{ background: R, opacity: 0.3 }} />
                <div className="w-2 h-2 rounded-full" style={{ background: R }} />
              </div>
              <div>
                <p className="text-[11px] font-semibold" style={{ color: R }}>Online</p>
                <p className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>up {formatUptime(uptime)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-mono font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
                {time.toLocaleTimeString("en-US", { hour12: false })}
              </p>
              <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.20)" }}>local time</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 mb-1 h-px" style={{ background: "rgba(255,255,255,0.05)" }} />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto pb-4 scrollbar-none">
          <SectionLabel label="Core" />
          <NavItem item={nav[0]} location={location} />

          {/* Ticket Master */}
          <SectionLabel label="Ticket Master" />
          <div>
            <div
              onClick={() => { setTmExpanded((v) => !v); sounds.navigate(); }}
              onMouseEnter={() => sounds.hover()}
              className="group relative flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150"
              style={isTmRoute ? {
                background: "rgba(239,68,68,0.10)",
                border: "1px solid rgba(239,68,68,0.18)",
              } : {
                border: "1px solid transparent",
              }}
              data-testid="nav-ticket-master"
            >
              {isTmRoute && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full" style={{ height: "55%", background: R }} />
              )}
              <div
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                style={isTmRoute
                  ? { background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.25)" }
                  : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }
                }
              >
                <Ticket className="w-[14px] h-[14px]" style={{ color: isTmRoute ? R : "rgba(255,255,255,0.45)" }} />
              </div>
              <span className="flex-1 text-[13px] font-medium" style={{ color: isTmRoute ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.60)" }}>
                Ticket Master
              </span>
              <TagBadge tag="TKT" />
              <ChevronDown
                className="w-3.5 h-3.5 ml-1 transition-transform duration-200"
                style={{ transform: tmExpanded ? "rotate(0deg)" : "rotate(-90deg)", color: "rgba(255,255,255,0.25)" }}
              />
              {!isTmRoute && (
                <div className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none"
                  style={{ background: "rgba(255,255,255,0.03)" }} />
              )}
            </div>

            {tmExpanded && (
              <div className="ml-6 mt-1 pl-3 space-y-0.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
                {TM_SUBNAV.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        onClick={() => sounds.navigate()}
                        onMouseEnter={() => sounds.hover()}
                        className="relative flex items-center gap-2.5 px-3 py-2 rounded-md text-[12.5px] font-medium cursor-pointer transition-all duration-100"
                        style={isActive
                          ? { background: "rgba(239,68,68,0.08)", color: R, border: "1px solid rgba(239,68,68,0.15)" }
                          : { border: "1px solid transparent", color: "rgba(255,255,255,0.45)" }
                        }
                        data-testid={`nav-tm-${item.label.toLowerCase().replace(/ /g, "-")}`}
                      >
                        <item.icon className="w-[12px] h-[12px] shrink-0" style={{ color: isActive ? R : "rgba(255,255,255,0.35)" }} />
                        <span>{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <SectionLabel label="Operations" />
          <NavItem item={nav[1]} location={location} />

          <SectionLabel label="Data" />
          {nav.slice(2, 7).map((item) => <NavItem key={item.href} item={item} location={location} />)}

          {user.role === "superadmin" && (
            <>
              <SectionLabel label="Admin" />
              {nav.slice(7).map((item) => <NavItem key={item.href} item={item} location={location} />)}
            </>
          )}
        </nav>

        {/* User section */}
        <div className="relative">
          <div className="h-px mx-4" style={{ background: "rgba(255,255,255,0.05)" }} />
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="relative shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${RA(0.18)}, ${RA(0.07)})`,
                  border: `1px solid ${RA(0.22)}`,
                }}
              >
                <User className="w-[15px] h-[15px]" style={{ color: R }} />
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 flex items-center justify-center" style={{ background: R, borderColor: "#0e0b0b" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate text-white/80" data-testid="text-user-email">
                  {user.email}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                    style={{ background: RA(0.10), color: R, border: `1px solid ${RA(0.20)}` }}
                    data-testid="text-user-role"
                  >
                    {user.role}
                  </span>
                </div>
              </div>
            </div>

            <button
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium transition-all duration-150 group"
              style={{ border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.03)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = RA(0.10);
                e.currentTarget.style.borderColor = RA(0.22);
                e.currentTarget.style.color = R;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                e.currentTarget.style.color = "rgba(255,255,255,0.45)";
              }}
              onClick={() => { sounds.logout(); onLogout(); }}
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto" style={{ background: "#0c0a0a" }}>
        <div className="p-7 max-w-[1400px] mx-auto">{children}</div>
      </main>

      <style>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}

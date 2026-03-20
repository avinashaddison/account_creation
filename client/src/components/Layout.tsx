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
  SYS: { bg: "rgba(255,255,255,0.07)", text: "rgba(255,255,255,0.5)", dot: "#e2e8f0", glow: "rgba(255,255,255,0.2)" },
  OPS: { bg: "rgba(191,90,242,0.14)", text: "rgba(191,90,242,0.9)", dot: "#bf5af2", glow: "rgba(191,90,242,0.3)" },
  DB:  { bg: "rgba(255,159,10,0.13)", text: "rgba(255,159,10,0.9)", dot: "#ff9f0a", glow: "rgba(255,159,10,0.3)" },
  NET: { bg: "rgba(10,132,255,0.13)", text: "rgba(10,132,255,0.9)", dot: "#0a84ff", glow: "rgba(10,132,255,0.3)" },
  FIN: { bg: "rgba(48,209,88,0.13)", text: "rgba(48,209,88,0.9)", dot: "#30d158", glow: "rgba(48,209,88,0.3)" },
  PVT: { bg: "rgba(255,69,58,0.13)", text: "rgba(255,69,58,0.9)", dot: "#ff453a", glow: "rgba(255,69,58,0.3)" },
  ADM: { bg: "rgba(255,159,10,0.12)", text: "rgba(255,159,10,0.85)", dot: "#ff9f0a", glow: "rgba(255,159,10,0.3)" },
  CFG: { bg: "rgba(174,174,178,0.12)", text: "rgba(174,174,178,0.85)", dot: "#aeaeb2", glow: "rgba(174,174,178,0.2)" },
  TKT: { bg: "rgba(10,132,255,0.12)", text: "rgba(10,132,255,0.9)", dot: "#0a84ff", glow: "rgba(10,132,255,0.3)" },
  CRD: { bg: "rgba(100,210,255,0.12)", text: "rgba(100,210,255,0.85)", dot: "#64d2ff", glow: "rgba(100,210,255,0.3)" },
};

function TagBadge({ tag }: { tag: string }) {
  const s = TAG_STYLES[tag] || TAG_STYLES.SYS;
  return (
    <span
      className="text-[8px] font-mono tracking-wider px-1.5 py-0.5 rounded-md flex items-center gap-1 shrink-0"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.dot}28` }}
    >
      <span className="w-1 h-1 rounded-full inline-block" style={{ background: s.dot }} />
      {tag}
    </span>
  );
}

function SectionDivider({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-3.5 pb-1">
      <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
      <span className="text-[9px] uppercase tracking-[0.2em] font-semibold" style={{ color: "rgba(255,255,255,0.28)", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>
        {label}
      </span>
      <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
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
        className="group/item relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-xl cursor-pointer transition-all duration-200"
        style={isActive ? {
          background: `linear-gradient(135deg, ${tag.dot}18 0%, ${tag.dot}08 100%)`,
          border: `1px solid ${tag.dot}28`,
          boxShadow: `0 2px 12px ${tag.dot}14, inset 0 1px 0 ${tag.dot}15`,
        } : {
          border: "1px solid transparent",
          background: "transparent",
        }}
        data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
      >
        {isActive && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
            style={{ height: "50%", background: tag.dot, boxShadow: `0 0 8px ${tag.dot}` }}
          />
        )}

        <div
          className="relative shrink-0 w-[28px] h-[28px] rounded-lg flex items-center justify-center transition-all duration-200"
          style={isActive
            ? { background: `${tag.dot}20`, border: `1px solid ${tag.dot}38` }
            : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }
          }
        >
          <item.icon
            className="w-[13px] h-[13px] shrink-0"
            style={{ color: isActive ? tag.dot : "rgba(255,255,255,0.55)" }}
          />
        </div>

        <span
          className="flex-1 text-[12px] font-medium tracking-tight transition-colors duration-200"
          style={{ color: isActive ? "#ffffff" : "rgba(255,255,255,0.82)", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}
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
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #08080f 0%, #0c0c18 50%, #08080f 100%)' }}>
      <aside
        className="w-[256px] flex flex-col shrink-0 h-screen sticky top-0 overflow-hidden glass-sidebar"
        data-testid="sidebar"
      >
        {/* Subtle top highlight */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />

        {/* Ambient blob */}
        <div className="absolute top-0 left-0 w-48 h-48 pointer-events-none" style={{ background: "radial-gradient(ellipse at top left, rgba(48,209,88,0.05), transparent 65%)" }} />

        {/* Header */}
        <div className="px-4 pt-5 pb-3">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm bg-white/5 border-white/15 text-white rounded-xl"
                onKeyDown={(e) => { if (e.key === "Enter") savePanelName(); if (e.key === "Escape") { setIsEditing(false); setEditName(panelName); } }}
                data-testid="input-panel-name"
              />
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-green-400 hover:text-green-300 hover:bg-green-500/10" onClick={savePanelName} disabled={saving} data-testid="button-save-panel-name">
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
                  background: "linear-gradient(135deg, rgba(48,209,88,0.22) 0%, rgba(48,209,88,0.08) 100%)",
                  border: "1px solid rgba(48,209,88,0.28)",
                  boxShadow: "0 4px 16px rgba(48,209,88,0.12), inset 0 1px 0 rgba(255,255,255,0.1)",
                }}
              >
                <Terminal className="w-4.5 h-4.5" style={{ color: "#30d158" }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2
                    className="text-[13px] font-semibold text-white tracking-tight truncate"
                    style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif" }}
                    data-testid="text-brand"
                  >
                    {panelName}
                  </h2>
                  <button
                    onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-white/8 transition-all shrink-0"
                    data-testid="button-edit-panel-name"
                  >
                    <Pencil className="w-2.5 h-2.5 text-white/35" />
                  </button>
                </div>
                <p className="text-[9px] uppercase tracking-[0.18em] mt-0.5" style={{ color: "rgba(255,255,255,0.28)", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif" }}>Command Center</p>
              </div>
            </div>
          )}
        </div>

        {/* Status strip */}
        <div className="mx-3 mb-1">
          <div
            className="px-3 py-2 rounded-xl"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-green-400 animate-ping opacity-50" />
                </div>
                <span className="text-[9px] font-medium tracking-wide" style={{ color: "rgba(48,209,88,0.85)", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}>Online</span>
              </div>
              <span className="text-[9px] tabular-nums font-mono" style={{ color: "rgba(255,255,255,0.32)" }}>
                {time.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.28)" }}>UP {formatUptime(uptime)}</span>
              <div className="flex items-center gap-0.5">
                {[1,2,3,4].map(i => (
                  <div key={i} className="w-0.5 rounded-full" style={{ height: `${4 + i * 2}px`, background: i <= 3 ? "rgba(48,209,88,0.55)" : "rgba(255,255,255,0.1)" }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto pb-2 space-y-0.5 mt-1">
          <SectionDivider label="Core" color="rgba(255,255,255,0.15)" />
          <NavItem item={nav[0]} location={location} />

          {/* Ticket Master expandable */}
          <SectionDivider label="Ticket Master" color="rgba(255,255,255,0.12)" />
          <div>
            <div
              onClick={() => { setTmExpanded((v) => !v); sounds.navigate(); }}
              onMouseEnter={() => sounds.hover()}
              className="relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-xl cursor-pointer transition-all duration-200"
              style={isTmRoute ? {
                background: "linear-gradient(135deg, rgba(10,132,255,0.16) 0%, rgba(10,132,255,0.07) 100%)",
                border: "1px solid rgba(10,132,255,0.28)",
                boxShadow: "0 2px 12px rgba(10,132,255,0.12), inset 0 1px 0 rgba(10,132,255,0.14)",
              } : { border: "1px solid transparent" }}
              data-testid="nav-ticket-master"
            >
              {isTmRoute && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full" style={{ height: "50%", background: "#0a84ff", boxShadow: "0 0 8px #0a84ff" }} />
              )}
              <div
                className="shrink-0 w-[28px] h-[28px] rounded-lg flex items-center justify-center transition-all duration-200"
                style={isTmRoute
                  ? { background: "rgba(10,132,255,0.18)", border: "1px solid rgba(10,132,255,0.35)" }
                  : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }
                }
              >
                <Ticket className="w-[13px] h-[13px]" style={{ color: isTmRoute ? "#0a84ff" : "rgba(255,255,255,0.55)" }} />
              </div>
              <span className="flex-1 text-[12px] font-medium tracking-tight" style={{ color: isTmRoute ? "#ffffff" : "rgba(255,255,255,0.82)", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>Ticket Master</span>
              <TagBadge tag="TKT" />
              <ChevronRight className="w-3 h-3 transition-transform duration-200 ml-0.5" style={{ transform: tmExpanded ? "rotate(90deg)" : "rotate(0deg)", color: "rgba(255,255,255,0.35)" }} />
            </div>

            {tmExpanded && (
              <div className="ml-4 mt-1 pl-3 space-y-0.5" style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
                {TM_SUBNAV.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        onClick={() => sounds.navigate()}
                        onMouseEnter={() => sounds.hover()}
                        className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all duration-150"
                        style={isActive
                          ? { background: "rgba(10,132,255,0.10)", border: "1px solid rgba(10,132,255,0.20)", color: "#64d2ff" }
                          : { border: "1px solid transparent", color: "rgba(255,255,255,0.75)" }
                        }
                        data-testid={`nav-tm-${item.label.toLowerCase().replace(/ /g, "-")}`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3 rounded-r-full" style={{ background: "#0a84ff" }} />
                        )}
                        <item.icon className="w-[11px] h-[11px] shrink-0" style={{ color: isActive ? "#64d2ff" : "rgba(255,255,255,0.45)" }} />
                        <span style={{ fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif" }}>{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <SectionDivider label="Operations" color="rgba(255,255,255,0.12)" />
          <NavItem item={nav[1]} location={location} />

          <SectionDivider label="Data" color="rgba(255,255,255,0.12)" />
          {nav.slice(2, 6).map((item) => <NavItem key={item.href} item={item} location={location} />)}

          {user.role === "superadmin" && (
            <>
              <SectionDivider label="Admin" color="rgba(255,255,255,0.12)" />
              {nav.slice(6).map((item) => <NavItem key={item.href} item={item} location={location} />)}
            </>
          )}
        </nav>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none" style={{ background: "linear-gradient(0deg, rgba(8,8,18,0.9), transparent)" }} />

        {/* User card */}
        <div className="relative mx-3 mb-3 mt-1">
          <div
            className="p-3 rounded-2xl"
            style={{
              background: "rgba(255,255,255,0.045)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="relative shrink-0">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(48,209,88,0.15), rgba(48,209,88,0.06))",
                    border: "1px solid rgba(48,209,88,0.22)",
                  }}
                >
                  <User className="w-4 h-4" style={{ color: "#30d158" }} />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border border-black" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10.5px] font-mono truncate text-white/75" data-testid="text-user-email">
                  {user.email}
                </p>
                <p className="text-[8.5px] capitalize mt-0.5" style={{ color: "rgba(48,209,88,0.65)", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }} data-testid="text-user-role">
                  {user.role}
                </p>
              </div>
            </div>

            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-[10.5px] transition-all duration-150"
              style={{ border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.38)", background: "transparent", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,69,58,0.09)";
                e.currentTarget.style.borderColor = "rgba(255,69,58,0.22)";
                e.currentTarget.style.color = "rgba(255,100,90,0.95)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
                e.currentTarget.style.color = "rgba(255,255,255,0.38)";
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

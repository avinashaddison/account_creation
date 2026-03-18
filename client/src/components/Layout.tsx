import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users, Wallet, Server, Pencil, Check, X, TrendingUp, ChevronRight, Terminal, Activity, Cpu, Settings, Shield, Ticket, Search, Bell, Bookmark, SlidersHorizontal, Zap } from "lucide-react";
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
];

const TAG_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  SYS: { bg: "rgba(255,255,255,0.06)", text: "rgba(255,255,255,0.35)", dot: "#ffffff" },
  OPS: { bg: "rgba(167,139,250,0.12)", text: "rgba(167,139,250,0.7)", dot: "#a78bfa" },
  DB:  { bg: "rgba(251,191,36,0.10)", text: "rgba(251,191,36,0.65)", dot: "#fbbf24" },
  NET: { bg: "rgba(56,189,248,0.10)", text: "rgba(56,189,248,0.65)", dot: "#38bdf8" },
  FIN: { bg: "rgba(52,211,153,0.10)", text: "rgba(52,211,153,0.65)", dot: "#34d399" },
  PVT: { bg: "rgba(248,113,113,0.10)", text: "rgba(248,113,113,0.65)", dot: "#f87171" },
  ADM: { bg: "rgba(251,146,60,0.10)", text: "rgba(251,146,60,0.65)", dot: "#fb923c" },
  CFG: { bg: "rgba(148,163,184,0.10)", text: "rgba(148,163,184,0.65)", dot: "#94a3b8" },
  TKT: { bg: "rgba(0,255,65,0.08)", text: "rgba(0,255,65,0.5)", dot: "#00ff41" },
};

function TagBadge({ tag }: { tag: string }) {
  const s = TAG_STYLES[tag] || TAG_STYLES.SYS;
  return (
    <span
      className="text-[8px] font-mono tracking-wider px-1.5 py-0.5 rounded-sm flex items-center gap-1"
      style={{ background: s.bg, color: s.text }}
    >
      <span className="w-1 h-1 rounded-full inline-block" style={{ background: s.dot, boxShadow: `0 0 4px ${s.dot}` }} />
      {tag}
    </span>
  );
}

export default function Layout({ children, user, onLogout, onPanelNameChange }: LayoutProps) {
  const [location] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.panelName || "Addison Panel");
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState(new Date());
  const [tmExpanded, setTmExpanded] = useState(() => location.startsWith("/admin/tm-"));

  const panelName = user.panelName || "Addison Panel";

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
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

  function NavItem({ item, small = false }: { item: { href: string; label: string; icon: any; tag: string }; small?: boolean }) {
    const isActive = location === item.href || (item.href === "/admin/create-server" && (
      location === "/admin/la28-create" || location === "/admin/tm-create" ||
      location === "/admin/uefa-create" || location === "/admin/brunomars-create" ||
      location === "/admin/outlook-login" || location === "/admin/outlook-create" ||
      location === "/admin/zenrows-register" || location === "/admin/replit-create" ||
      location === "/admin/card-generator"
    ));
    const tag = TAG_STYLES[item.tag] || TAG_STYLES.SYS;

    return (
      <Link href={item.href}>
        <div
          onClick={() => sounds.navigate()}
          onMouseEnter={() => sounds.hover()}
          className={`group/item relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 ${
            isActive ? "text-white" : "text-zinc-500 hover:text-zinc-300"
          }`}
          style={isActive ? {
            background: `linear-gradient(135deg, ${tag.bg.replace("0.10", "0.18").replace("0.12", "0.18").replace("0.06", "0.12").replace("0.08", "0.12")}, rgba(0,0,0,0.3))`,
            border: `1px solid ${tag.dot}22`,
            boxShadow: `inset 0 0 20px ${tag.dot}08`
          } : { border: "1px solid transparent" }}
          data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
        >
          {isActive && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-r-full"
              style={{ height: "60%", background: tag.dot, boxShadow: `0 0 8px ${tag.dot}, 0 0 16px ${tag.dot}80` }}
            />
          )}
          <div
            className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-all duration-150`}
            style={isActive ? { background: `${tag.dot}15`, border: `1px solid ${tag.dot}30` } : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
          >
            <item.icon
              className={`w-[13px] h-[13px] shrink-0 transition-all`}
              style={{ color: isActive ? tag.dot : undefined }}
            />
          </div>
          <span className={`flex-1 font-mono text-[11.5px] font-medium`}>{item.label}</span>
          <TagBadge tag={item.tag} />
        </div>
      </Link>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: '#0a0a0a' }}>
      <aside
        className="w-[258px] flex flex-col shrink-0 h-screen sticky top-0"
        style={{
          background: 'linear-gradient(180deg, #0b0f0b 0%, #090909 100%)',
          borderRight: '1px solid rgba(0,255,65,0.08)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.4)'
        }}
        data-testid="sidebar"
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm bg-black/30 border-emerald-500/15 text-emerald-50 font-mono rounded-lg"
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
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-xl bg-emerald-400/20 blur-lg" />
                <div
                  className="relative w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(0,255,65,0.15) 0%, rgba(0,255,65,0.05) 100%)',
                    border: '1px solid rgba(0,255,65,0.25)',
                    boxShadow: '0 0 12px rgba(0,255,65,0.1), inset 0 1px 0 rgba(0,255,65,0.1)'
                  }}
                >
                  <Terminal className="w-4.5 h-4.5 text-emerald-400" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[13px] font-bold text-white tracking-tight truncate font-mono" data-testid="text-brand">
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
                  <Zap className="w-2.5 h-2.5 text-emerald-400/40" />
                  <p className="text-[9px] text-emerald-400/40 font-mono tracking-[0.12em] uppercase">Command Center</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Clock + status bar */}
        <div className="mx-4 mb-2 px-3 py-1.5 rounded-lg flex items-center gap-2" style={{ background: "rgba(0,255,65,0.03)", border: "1px solid rgba(0,255,65,0.06)" }}>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: "0 0 6px rgba(0,255,65,0.6)" }} />
            <span className="text-[9px] font-mono text-emerald-400/60 uppercase tracking-wider">Online</span>
          </div>
          <div className="flex-1" />
          <span className="text-[9px] font-mono text-zinc-600 tabular-nums">{time.toLocaleTimeString('en-US', { hour12: false })}</span>
        </div>

        {/* Section label — core */}
        <div className="px-4 pb-1 flex items-center gap-2">
          <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(0,255,65,0.15), transparent)" }} />
          <span className="text-[8px] font-mono text-emerald-400/30 uppercase tracking-[0.2em]">Core</span>
          <div className="h-px flex-1" style={{ background: "linear-gradient(270deg, rgba(0,255,65,0.15), transparent)" }} />
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto pb-2">
          {/* Dashboard (always first) */}
          <NavItem item={nav[0]} />

          {/* Ticket Master section */}
          <div className="pt-1.5">
            <div className="px-1 pb-1 flex items-center gap-2">
              <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(0,255,65,0.1), transparent)" }} />
              <span className="text-[8px] font-mono text-emerald-400/25 uppercase tracking-[0.2em]">Ticket Master</span>
              <div className="h-px flex-1" style={{ background: "linear-gradient(270deg, rgba(0,255,65,0.1), transparent)" }} />
            </div>
            <div
              onClick={() => { setTmExpanded((v) => !v); sounds.navigate(); }}
              onMouseEnter={() => sounds.hover()}
              className={`group/item relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 ${
                location.startsWith("/admin/tm-") ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
              style={location.startsWith("/admin/tm-") ? {
                background: "linear-gradient(135deg, rgba(0,255,65,0.12), rgba(0,0,0,0.3))",
                border: "1px solid rgba(0,255,65,0.15)",
                boxShadow: "inset 0 0 20px rgba(0,255,65,0.04)"
              } : { border: "1px solid transparent" }}
              data-testid="nav-ticket-master"
            >
              {location.startsWith("/admin/tm-") && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-r-full" style={{ height: "60%", background: "#00ff41", boxShadow: "0 0 8px #00ff41, 0 0 16px #00ff4180" }} />
              )}
              <div
                className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center"
                style={location.startsWith("/admin/tm-") ? { background: "rgba(0,255,65,0.15)", border: "1px solid rgba(0,255,65,0.3)" } : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}
              >
                <Ticket className={`w-[13px] h-[13px] ${location.startsWith("/admin/tm-") ? "text-emerald-400" : "text-zinc-600"}`} />
              </div>
              <span className="flex-1 font-mono text-[11.5px] font-medium">Ticket Master</span>
              <TagBadge tag="TKT" />
              <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${tmExpanded ? "rotate-90 text-emerald-400/50" : "text-zinc-700"}`} />
            </div>
            {tmExpanded && (
              <div className="ml-3 mt-0.5 pl-3 border-l border-emerald-500/[0.08] space-y-0.5">
                {TM_SUBNAV.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        onClick={() => sounds.navigate()}
                        onMouseEnter={() => sounds.hover()}
                        className={`group/sub relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all duration-150 ${
                          isActive ? "text-emerald-300" : "text-zinc-600 hover:text-zinc-300"
                        }`}
                        style={isActive ? { background: "rgba(0,255,65,0.06)", border: "1px solid rgba(0,255,65,0.1)" } : { border: "1px solid transparent" }}
                        data-testid={`nav-tm-${item.label.toLowerCase().replace(/ /g, "-")}`}
                      >
                        {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3 rounded-r-full bg-emerald-400" style={{ boxShadow: "0 0 5px rgba(0,255,65,0.5)" }} />}
                        <item.icon className={`w-[11px] h-[11px] shrink-0 ${isActive ? "text-emerald-400" : "text-zinc-700"}`} />
                        <span className="font-mono">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section label — ops */}
          <div className="pt-1.5 pb-1 flex items-center gap-2 px-1">
            <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(167,139,250,0.15), transparent)" }} />
            <span className="text-[8px] font-mono text-violet-400/30 uppercase tracking-[0.2em]">Operations</span>
            <div className="h-px flex-1" style={{ background: "linear-gradient(270deg, rgba(167,139,250,0.15), transparent)" }} />
          </div>

          {/* nav[1] = Create Server */}
          <NavItem item={nav[1]} />

          {/* Section label — data */}
          <div className="pt-1.5 pb-1 flex items-center gap-2 px-1">
            <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(251,191,36,0.12), transparent)" }} />
            <span className="text-[8px] font-mono text-amber-400/25 uppercase tracking-[0.2em]">Data</span>
            <div className="h-px flex-1" style={{ background: "linear-gradient(270deg, rgba(251,191,36,0.12), transparent)" }} />
          </div>

          {/* nav[2..5] = Account Stock, Email Workspace, Billing, Wallet */}
          {nav.slice(2, 6).map((item) => <NavItem key={item.href} item={item} />)}

          {/* Superadmin section */}
          {user.role === "superadmin" && (
            <>
              <div className="pt-1.5 pb-1 flex items-center gap-2 px-1">
                <div className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(248,113,113,0.12), transparent)" }} />
                <span className="text-[8px] font-mono text-red-400/30 uppercase tracking-[0.2em]">Admin</span>
                <div className="h-px flex-1" style={{ background: "linear-gradient(270deg, rgba(248,113,113,0.12), transparent)" }} />
              </div>
              {nav.slice(6).map((item) => <NavItem key={item.href} item={item} />)}
            </>
          )}
        </nav>

        {/* User card */}
        <div
          className="mx-3 mb-3 p-3 rounded-xl"
          style={{
            background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.3) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 -4px 24px rgba(0,0,0,0.3)"
          }}
        >
          <div className="flex items-center gap-2.5 mb-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(0,255,65,0.06)", border: "1px solid rgba(0,255,65,0.12)" }}
            >
              <User className="w-3.5 h-3.5 text-emerald-400/60" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-mono text-zinc-300 truncate" data-testid="text-user-email">{user.email}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 5px rgba(0,255,65,0.6)" }} />
                <p className="text-[9px] text-emerald-400/50 capitalize font-mono" data-testid="text-user-role">{user.role}</p>
              </div>
            </div>
          </div>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono text-zinc-600 hover:text-red-400 transition-all duration-150"
            style={{ border: "1px solid rgba(255,255,255,0.04)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.06)", e.currentTarget.style.borderColor = "rgba(239,68,68,0.12)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent", e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)")}
            onClick={() => { sounds.logout(); onLogout(); }}
            data-testid="button-logout"
          >
            <LogOut className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto cyber-grid scan-line crt-overlay animate-flicker" style={{ background: 'linear-gradient(135deg, #0a0a0a 0%, #0d120d 50%, #0a0a0a 100%)' }}>
        <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

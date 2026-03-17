import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users, Wallet, Server, Pencil, Check, X, TrendingUp, ChevronRight, Terminal, Activity, Cpu, Settings, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sounds } from "@/lib/sounds";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string; panelName?: string };
  onLogout: () => void;
  onPanelNameChange?: (name: string) => void;
};

export default function Layout({ children, user, onLogout, onPanelNameChange }: LayoutProps) {
  const [location] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.panelName || "Addison Panel");
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState(new Date());

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
    { href: "/admin/accounts", label: "Account Stock", icon: Archive, tag: "DB" },
    { href: "/admin/email-workspace", label: "Email Workspace", icon: Mail, tag: "NET" },
    { href: "/admin/billing", label: "Billing", icon: Receipt, tag: "FIN" },
    { href: "/admin/wallet", label: "Wallet", icon: Wallet, tag: "FIN" },
    { href: "/admin/create-server", label: "Create Server", icon: Server, tag: "OPS" },
    ...(user.role === "superadmin" ? [
      { href: "/admin/private-account", label: "Private Account", icon: Shield, tag: "PVT" },
      { href: "/admin/earnings", label: "Earnings", icon: TrendingUp, tag: "ADM" },
      { href: "/admin/manage-admins", label: "Manage Admins", icon: Users, tag: "ADM" },
      { href: "/admin/settings", label: "API Settings", icon: Settings, tag: "CFG" },
    ] : []),
  ];

  return (
    <div className="min-h-screen flex" style={{ background: '#0d1117' }}>
      <aside className="w-[260px] flex flex-col shrink-0 h-screen sticky top-0 border-r border-cyan-500/[0.12]" style={{ background: 'linear-gradient(180deg, #0f1520 0%, #0d1117 100%)' }} data-testid="sidebar">
        <div className="px-5 pt-4 pb-2">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm bg-black/30 border-cyan-500/15 text-cyan-50 font-mono rounded-lg"
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
                <div className="absolute inset-0 rounded-lg bg-cyan-400/10 blur-md animate-glow" />
                <div className="relative w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(0,240,255,0.1) 0%, rgba(168,85,247,0.1) 100%)', border: '1px solid rgba(0,240,255,0.2)' }}>
                  <Terminal className="w-4.5 h-4.5 text-cyan-400" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-bold text-white tracking-tight truncate font-mono" data-testid="text-brand">
                    {panelName}
                  </h2>
                  <button
                    onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-cyan-500/10 transition-all shrink-0"
                    data-testid="button-edit-panel-name"
                  >
                    <Pencil className="w-2.5 h-2.5 text-cyan-500/50" />
                  </button>
                </div>
                <p className="text-[9px] text-cyan-400/30 font-mono tracking-[0.15em] uppercase">Command Center</p>
              </div>
            </div>
          )}
        </div>

        <div className="mx-4 my-1.5 flex items-center gap-2">
          <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent" />
          <span className="text-[8px] font-mono text-cyan-400/20">{time.toLocaleTimeString('en-US', { hour12: false })}</span>
          <div className="flex-1 h-px bg-gradient-to-l from-cyan-500/10 via-cyan-500/5 to-transparent" />
        </div>

        <div className="px-4 pt-1 pb-1.5 flex items-center gap-1.5">
          <Activity className="w-2.5 h-2.5 text-cyan-400/25" />
          <span className="text-[9px] font-mono text-cyan-400/25 uppercase tracking-[0.15em]">Modules</span>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => {
            const isActive = location === item.href || (item.href === "/admin/create-server" && (location === "/admin/la28-create" || location === "/admin/tm-create" || location === "/admin/uefa-create" || location === "/admin/brunomars-create" || location === "/admin/outlook-login" || location === "/admin/outlook-create" || location === "/admin/zenrows-register"));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  onClick={() => sounds.navigate()}
                  onMouseEnter={() => sounds.hover()}
                  className={`group/item flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150 relative ${
                    isActive
                      ? "text-cyan-300"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-cyan-500/[0.03]"
                  }`}
                  style={isActive ? { background: 'linear-gradient(135deg, rgba(0,240,255,0.06) 0%, rgba(168,85,247,0.04) 100%)', border: '1px solid rgba(0,240,255,0.1)' } : { border: '1px solid transparent' }}
                  data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
                >
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-cyan-400 shadow-[0_0_6px_rgba(0,240,255,0.5)]" />}
                  <item.icon className={`w-[14px] h-[14px] shrink-0 ${isActive ? "text-cyan-400" : "text-zinc-600 group-hover/item:text-zinc-400"}`} />
                  <span className="flex-1 font-mono">{item.label}</span>
                  <span className={`text-[8px] font-mono tracking-wider ${isActive ? "text-cyan-400/40" : "text-zinc-700"}`}>{item.tag}</span>
                  {isActive && <ChevronRight className="w-3 h-3 text-cyan-400/40" />}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 mx-2 mb-2 rounded-lg cyber-card">
          <div className="flex items-center gap-2.5 px-1 mb-2.5">
            <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: 'rgba(0,240,255,0.05)', border: '1px solid rgba(0,240,255,0.1)' }}>
              <User className="w-3 h-3 text-cyan-400/50" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-mono text-zinc-300 truncate" data-testid="text-user-email">{user.email}</p>
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-emerald-400 animate-glow" />
                <p className="text-[9px] text-emerald-400/50 capitalize font-mono" data-testid="text-user-role">{user.role}</p>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-zinc-600 hover:text-red-400 hover:bg-red-500/8 px-3 rounded-md text-[11px] h-7 font-mono transition-all"
            onClick={() => { sounds.logout(); onLogout(); }}
            data-testid="button-logout"
          >
            <LogOut className="w-3 h-3 mr-2" />
            Disconnect
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto cyber-grid scan-line" style={{ background: 'linear-gradient(135deg, #0d1117 0%, #111824 50%, #0d1117 100%)' }}>
        <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

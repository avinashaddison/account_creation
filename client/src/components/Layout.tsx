import { useState } from "react";
import { useLocation, Link } from "wouter";
import { LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users, Wallet, Server, Pencil, Check, X, TrendingUp, ChevronRight, Sparkles } from "lucide-react";
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

  const panelName = user.panelName || "Addison Panel";

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
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/accounts", label: "Account Stock", icon: Archive },
    { href: "/admin/email-server", label: "Email Server", icon: Mail },
    { href: "/admin/billing", label: "Billing", icon: Receipt },
    { href: "/admin/wallet", label: "Wallet", icon: Wallet },
    { href: "/admin/create-server", label: "Create Server", icon: Server },
    ...(user.role === "superadmin" ? [
      { href: "/admin/earnings", label: "Earnings", icon: TrendingUp },
      { href: "/admin/manage-admins", label: "Manage Admins", icon: Users },
    ] : []),
  ];

  return (
    <div className="min-h-screen flex" style={{ background: '#07071a' }}>
      <aside className="w-[250px] flex flex-col shrink-0 h-screen sticky top-0 border-r border-white/[0.04]" style={{ background: 'linear-gradient(180deg, #0c0c22 0%, #09091c 100%)' }} data-testid="sidebar">
        <div className="px-5 pt-5 pb-3">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm bg-white/[0.03] border-white/[0.08] text-white font-semibold rounded-lg"
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
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center shadow-lg shadow-violet-900/30 shrink-0">
                <Sparkles className="w-4.5 h-4.5 text-white/90" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-bold text-white tracking-tight truncate" data-testid="text-brand">
                    {panelName}
                  </h2>
                  <button
                    onClick={() => { setEditName(panelName); setIsEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-all shrink-0"
                    data-testid="button-edit-panel-name"
                  >
                    <Pencil className="w-2.5 h-2.5 text-zinc-500" />
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600 font-medium tracking-wide">Account Manager</p>
              </div>
            </div>
          )}
        </div>

        <div className="mx-5 my-2 border-t border-white/[0.04]" />

        <p className="px-5 pt-2 pb-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.15em]">Navigation</p>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => {
            const isActive = location === item.href || (item.href === "/admin/create-server" && (location === "/admin/la28-create" || location === "/admin/tm-create" || location === "/admin/uefa-create" || location === "/admin/brunomars-create"));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  onClick={() => sounds.navigate()}
                  onMouseEnter={() => sounds.hover()}
                  className={`group/item flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150 relative ${
                    isActive
                      ? "bg-violet-600/12 text-white"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
                >
                  {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-violet-500" />}
                  <item.icon className={`w-[16px] h-[16px] shrink-0 ${isActive ? "text-violet-400" : "text-zinc-600 group-hover/item:text-zinc-400"}`} />
                  <span className="flex-1">{item.label}</span>
                  {isActive && <ChevronRight className="w-3 h-3 text-violet-400/50" />}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 mx-2 mb-2 rounded-xl glass-panel">
          <div className="flex items-center gap-2.5 px-1 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/15 to-purple-500/15 border border-violet-500/10 flex items-center justify-center shrink-0">
              <User className="w-3.5 h-3.5 text-violet-300/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-300 truncate" data-testid="text-user-email">{user.email}</p>
              <p className="text-[10px] text-violet-400/60 capitalize font-medium" data-testid="text-user-role">{user.role}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-zinc-500 hover:text-red-400 hover:bg-red-500/8 px-3 rounded-lg text-xs h-8 transition-all"
            onClick={() => { sounds.logout(); onLogout(); }}
            data-testid="button-logout"
          >
            <LogOut className="w-3.5 h-3.5 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto" style={{ background: 'linear-gradient(135deg, #07071a 0%, #0a0a22 50%, #07071a 100%)' }}>
        <div className="p-7 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

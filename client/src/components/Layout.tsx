import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import {
  LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users,
  Wallet, Server, Pencil, Check, X, TrendingUp,
  Settings, Shield, Ticket, Search, Bell, Bookmark,
  SlidersHorizontal, CreditCard, ShoppingCart, ChevronDown, MailOpen,
  Film, Circle,
} from "lucide-react";
import { Input } from "@/components/ui/input";

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

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pt-5 pb-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-white/20">
        {label}
      </span>
    </div>
  );
}

function NavItem({
  item,
  location,
}: {
  item: { href: string; label: string; icon: any };
  location: string;
}) {
  const isActive =
    location === item.href ||
    (item.href === "/admin/create-server" &&
      [
        "/admin/la28-create", "/admin/tm-create", "/admin/uefa-create",
        "/admin/brunomars-create", "/admin/outlook-login", "/admin/outlook-create",
        "/admin/zenrows-register", "/admin/replit-create", "/admin/lovable-create",
        "/admin/v0-create", "/admin/adobe-create", "/admin/elevenlabs-create",
        "/admin/chatgpt-create", "/admin/card-generator",
      ].includes(location));

  return (
    <Link href={item.href}>
      <div
        className={`group flex items-center gap-2.5 mx-2 px-3 py-2 rounded-md cursor-pointer transition-all duration-150 ${
          isActive
            ? "bg-emerald-500/10 text-emerald-400"
            : "text-white/45 hover:text-white/75 hover:bg-white/5"
        }`}
        data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
      >
        <item.icon
          className={`w-4 h-4 shrink-0 transition-colors ${
            isActive ? "text-emerald-400" : "text-white/30 group-hover:text-white/55"
          }`}
        />
        <span className="text-[13px] font-medium leading-none">{item.label}</span>
        {isActive && (
          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400" />
        )}
      </div>
    </Link>
  );
}

const FULLSCREEN_ROUTES = ["/admin/outlook-workspace", "/admin/email-workspace", "/admin/private-account"];

export default function Layout({ children, user, onLogout, onPanelNameChange }: LayoutProps) {
  const [location] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(user.panelName || "Addison Panel");
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState(new Date());
  const isTmRoute = location.startsWith("/admin/tm-") || location === "/admin/my-cards";
  const [tmExpanded, setTmExpanded] = useState(
    () => location.startsWith("/admin/tm-") || location === "/admin/my-cards"
  );

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
    } catch {}
    finally {
      setSaving(false);
    }
  }

  const nav = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/create-server", label: "Create Account", icon: Server },
    { href: "/admin/accounts", label: "Account Stock", icon: Archive },
    { href: "/admin/email-workspace", label: "Email Workspace", icon: Mail },
    { href: "/admin/outlook-workspace", label: "Outlook Workspace", icon: MailOpen },
    { href: "/admin/billing", label: "Billing", icon: Receipt },
    { href: "/admin/wallet", label: "Wallet", icon: Wallet },
    { href: "/admin/checkout-cards", label: "Checkout Cards", icon: ShoppingCart },
    ...(user.role === "superadmin"
      ? [
          { href: "/admin/private-account", label: "Private Account", icon: Shield },
          { href: "/admin/earnings", label: "Earnings", icon: TrendingUp },
          { href: "/admin/manage-admins", label: "Manage Admins", icon: Users },
          { href: "/admin/settings", label: "API Settings", icon: Settings },
        ]
      : []),
  ];

  return (
    <div className="h-screen flex overflow-hidden bg-[#09090e]">
      {/* ── SIDEBAR ── */}
      <aside
        className="w-[260px] flex flex-col shrink-0 h-screen"
        style={{
          background: "#0e0e16",
          borderRight: "1px solid rgba(255,255,255,0.07)",
        }}
        data-testid="sidebar"
      >
        {/* ── BRAND ── */}
        <div className="px-4 pt-5 pb-4">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
                autoFocus
                className="h-8 text-sm bg-white/5 border-white/10 text-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePanelName();
                  if (e.key === "Escape") { setIsEditing(false); setEditName(panelName); }
                }}
                data-testid="input-panel-name"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={savePanelName}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
                  data-testid="button-save-panel-name"
                >
                  <Check className="w-3 h-3" /> Save
                </button>
                <button
                  onClick={() => { setIsEditing(false); setEditName(panelName); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-white/5 text-white/40 border border-white/8 hover:bg-white/8 transition-colors"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group flex items-center gap-3">
              <div className="shrink-0 w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <span className="text-emerald-400 text-sm font-bold">A</span>
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                <h2 className="text-[14px] font-semibold text-white truncate" data-testid="text-brand">
                  {panelName}
                </h2>
                <button
                  onClick={() => { setEditName(panelName); setIsEditing(true); }}
                  className="opacity-0 group-hover:opacity-100 text-white/25 hover:text-white/55 transition-all"
                  data-testid="button-edit-panel-name"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── STATUS ── */}
        <div className="mx-3 mb-3">
          <div className="flex items-center justify-between px-3 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="relative flex w-2 h-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                <span className="relative inline-flex rounded-full w-2 h-2 bg-emerald-400" />
              </span>
              <span className="text-[11px] font-medium text-emerald-400">Online</span>
            </div>
            <span className="text-[11px] font-mono text-white/30 tabular-nums">
              {time.toLocaleTimeString("en-US", { hour12: false })}
            </span>
          </div>
        </div>

        <div className="mx-4 mb-1 h-px bg-white/[0.06]" />

        {/* ── NAV ── */}
        <nav className="flex-1 overflow-y-auto pb-3" style={{ scrollbarWidth: "none" }}>
          <style>{`.overflow-y-auto::-webkit-scrollbar { display: none; }`}</style>

          <SectionLabel label="Core" />
          <NavItem item={nav[0]} location={location} />

          <SectionLabel label="Ticketmaster" />
          <div>
            <div
              onClick={() => setTmExpanded((v) => !v)}
              className={`group flex items-center gap-2.5 mx-2 px-3 py-2 rounded-md cursor-pointer transition-all duration-150 ${
                isTmRoute
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-white/45 hover:text-white/75 hover:bg-white/5"
              }`}
              data-testid="nav-ticket-master"
            >
              <Ticket
                className={`w-4 h-4 shrink-0 ${
                  isTmRoute ? "text-emerald-400" : "text-white/30 group-hover:text-white/55"
                }`}
              />
              <span className="flex-1 text-[13px] font-medium leading-none">Ticket Master</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  tmExpanded ? "rotate-0" : "-rotate-90"
                } ${isTmRoute ? "text-emerald-400/50" : "text-white/20"}`}
              />
            </div>

            {tmExpanded && (
              <div className="ml-6 mt-0.5 pl-2.5 space-y-0.5 border-l border-white/[0.07]">
                {TM_SUBNAV.map((sub) => {
                  const on = location === sub.href;
                  return (
                    <Link key={sub.href} href={sub.href}>
                      <div
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all duration-100 text-[12px] font-medium ${
                          on
                            ? "text-emerald-400 bg-emerald-500/8"
                            : "text-white/35 hover:text-white/65 hover:bg-white/4"
                        }`}
                        data-testid={`nav-tm-${sub.label.toLowerCase().replace(/ /g, "-")}`}
                      >
                        <sub.icon className={`w-3.5 h-3.5 shrink-0 ${on ? "text-emerald-400" : "text-white/25"}`} />
                        {sub.label}
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
          {nav.slice(2, 8).map((item) => (
            <NavItem key={item.href} item={item} location={location} />
          ))}

          {user.role === "superadmin" && (
            <>
              <SectionLabel label="Admin" />
              {nav.slice(8).map((item) => (
                <NavItem key={item.href} item={item} location={location} />
              ))}
            </>
          )}

          <SectionLabel label="Media" />
          <NavItem
            item={{ href: "/admin/movies-drive", label: "MoviesDrive Server", icon: Film }}
            location={location}
          />
        </nav>

        {/* ── USER CARD ── */}
        <div>
          <div className="mx-4 h-px bg-white/[0.06]" />
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-md bg-white/[0.03] border border-white/[0.05]">
              <div className="shrink-0 w-8 h-8 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center">
                <User className="w-4 h-4 text-white/45" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-white/70 truncate font-medium" data-testid="text-user-email">
                  {user.email}
                </p>
                <span
                  className="text-[10px] font-medium capitalize px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-block mt-0.5"
                  data-testid="text-user-role"
                >
                  {user.role}
                </span>
              </div>
            </div>

            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[12px] font-medium text-white/35 border border-white/8 hover:bg-white/5 hover:text-white/60 hover:border-white/12 transition-all duration-150"
              onClick={onLogout}
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      {FULLSCREEN_ROUTES.some((r) => location.startsWith(r)) ? (
        <main className="flex-1 overflow-hidden flex flex-col bg-[#09090e] h-screen">
          {children}
        </main>
      ) : (
        <main className="flex-1 overflow-auto bg-[#09090e]">
          <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
        </main>
      )}
    </div>
  );
}

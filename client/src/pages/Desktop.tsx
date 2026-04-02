import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Archive, Server, Mail, MailOpen,
  Zap, Ticket, Shield, Music, Terminal, Heart, Code2,
  Layers, Mic2, MessageSquare, Globe, Search, Bell,
  Bookmark, SlidersHorizontal, CreditCard, Receipt,
  Wallet, ShoppingCart, TrendingUp, Users, Settings,
  Lock, LogOut, User,
} from "lucide-react";
import { sounds } from "@/lib/sounds";
import type { AuthUser } from "@/App";

const BLUE   = "#0a84ff";
const GREEN  = "#30d158";
const PURPLE = "#bf5af2";
const AMBER  = "#ff9f0a";
const RED    = "#ff453a";
const GREY   = "#8e8e93";

type AppDef = { name: string; href: string; icon: any; color: string };
type Category = { label: string; apps: AppDef[] };

const CATEGORIES: Category[] = [
  {
    label: "Core System",
    apps: [
      { name: "Dashboard",      href: "/admin/home",              icon: LayoutDashboard, color: GREEN  },
      { name: "Account Stock",  href: "/admin/accounts",          icon: Archive,         color: AMBER  },
      { name: "Create Account", href: "/admin/create-server",     icon: Server,          color: GREEN  },
      { name: "Email",          href: "/admin/email-workspace",   icon: Mail,            color: BLUE   },
      { name: "Outlook",        href: "/admin/outlook-workspace", icon: MailOpen,        color: BLUE   },
    ],
  },
  {
    label: "Platforms",
    apps: [
      { name: "LA28",        href: "/admin/la28-create",        icon: Zap,           color: BLUE   },
      { name: "Ticketmaster",href: "/admin/tm-create",          icon: Ticket,        color: RED    },
      { name: "UEFA",        href: "/admin/uefa-create",        icon: Shield,        color: BLUE   },
      { name: "Bruno Mars",  href: "/admin/brunomars-create",   icon: Music,         color: AMBER  },
      { name: "Replit",      href: "/admin/replit-create",      icon: Terminal,      color: PURPLE },
      { name: "Lovable",     href: "/admin/lovable-create",     icon: Heart,         color: RED    },
      { name: "V0",          href: "/admin/v0-create",          icon: Code2,         color: GREY   },
      { name: "Adobe",       href: "/admin/adobe-create",       icon: Layers,        color: RED    },
      { name: "ElevenLabs",  href: "/admin/elevenlabs-create",  icon: Mic2,          color: PURPLE },
      { name: "ChatGPT",     href: "/admin/chatgpt-create",     icon: MessageSquare, color: GREEN  },
      { name: "ZenRows",     href: "/admin/zenrows-register",   icon: Globe,         color: BLUE   },
    ],
  },
  {
    label: "Ticketmaster Suite",
    apps: [
      { name: "Event Scanner",   href: "/admin/tm-event-scanner",  icon: Search,            color: RED   },
      { name: "Live Alerts",     href: "/admin/tm-live-alerts",    icon: Bell,              color: RED   },
      { name: "Tracked Events",  href: "/admin/tm-tracked-events", icon: Bookmark,          color: RED   },
      { name: "TM Settings",     href: "/admin/tm-settings",       icon: SlidersHorizontal, color: AMBER },
      { name: "My Cards",        href: "/admin/my-cards",          icon: CreditCard,        color: AMBER },
    ],
  },
  {
    label: "Finance",
    apps: [
      { name: "Billing",        href: "/admin/billing",        icon: Receipt,     color: AMBER },
      { name: "Wallet",         href: "/admin/wallet",         icon: Wallet,      color: GREEN },
      { name: "Checkout Cards", href: "/admin/checkout-cards", icon: ShoppingCart,color: GREEN },
    ],
  },
];

const ADMIN_CATEGORY: Category = {
  label: "Administration",
  apps: [
    { name: "Earnings",        href: "/admin/earnings",        icon: TrendingUp, color: GREEN },
    { name: "Manage Admins",   href: "/admin/manage-admins",   icon: Users,      color: RED   },
    { name: "API Settings",    href: "/admin/settings",        icon: Settings,   color: GREY  },
    { name: "Private Account", href: "/admin/private-account", icon: Lock,       color: RED   },
  ],
};

const DOCK_APPS: AppDef[] = [
  { name: "Dashboard",   href: "/admin/home",           icon: LayoutDashboard, color: GREEN  },
  { name: "Accounts",    href: "/admin/accounts",       icon: Archive,         color: AMBER  },
  { name: "Replit",      href: "/admin/replit-create",  icon: Terminal,        color: PURPLE },
  { name: "Ticketmaster",href: "/admin/tm-create",      icon: Ticket,          color: RED    },
  { name: "Wallet",      href: "/admin/wallet",         icon: Wallet,          color: GREEN  },
  { name: "Email",       href: "/admin/email-workspace",icon: Mail,            color: BLUE   },
  { name: "Billing",     href: "/admin/billing",        icon: Receipt,         color: AMBER  },
];

function AppIcon({ app, onClick }: { app: AppDef; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => { setHovered(true); sounds.hover(); }}
      onMouseLeave={() => setHovered(false)}
      className="flex flex-col items-center gap-2.5 outline-none"
      style={{ width: 96, padding: "10px 4px", transition: "transform 0.16s cubic-bezier(0.34,1.56,0.64,1)" , transform: hovered ? "scale(1.1) translateY(-5px)" : "scale(1) translateY(0)" }}
      data-testid={`app-${app.name.toLowerCase().replace(/ /g, "-")}`}
    >
      {/* Icon box */}
      <div
        className="relative w-[72px] h-[72px] rounded-2xl flex items-center justify-center overflow-hidden"
        style={{
          background: hovered
            ? `linear-gradient(145deg, ${app.color}38, ${app.color}18)`
            : `linear-gradient(145deg, ${app.color}26, ${app.color}0e)`,
          border: `1px solid ${app.color}${hovered ? "65" : "30"}`,
          boxShadow: hovered
            ? `0 0 32px ${app.color}35, 0 8px 24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12)`
            : `0 2px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`,
          transition: "all 0.16s ease",
        }}
      >
        {/* Gloss overlay */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: "linear-gradient(145deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 45%, transparent 100%)",
          }}
        />
        <app.icon
          className="w-[34px] h-[34px] relative z-10"
          style={{
            color: app.color,
            filter: hovered
              ? `drop-shadow(0 0 12px ${app.color}) drop-shadow(0 0 4px ${app.color})`
              : `drop-shadow(0 0 5px ${app.color}90)`,
            transition: "filter 0.16s ease",
          }}
        />
      </div>
      {/* Label */}
      <span
        className="text-[11px] font-mono text-center leading-tight select-none"
        style={{
          color: hovered ? "rgba(255,255,255,0.90)" : "rgba(255,255,255,0.45)",
          transition: "color 0.16s ease",
          maxWidth: 80,
        }}
      >
        {app.name}
      </span>
    </button>
  );
}

function DockIcon({ app, onClick }: { app: AppDef; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="relative flex flex-col items-center">
      {/* Tooltip */}
      <div
        className="absolute bottom-full mb-2 px-2 py-1 rounded-lg text-[10px] font-mono whitespace-nowrap pointer-events-none"
        style={{
          background: "rgba(20,20,32,0.95)",
          border: "1px solid rgba(255,255,255,0.10)",
          color: "rgba(255,255,255,0.75)",
          opacity: hovered ? 1 : 0,
          transform: hovered ? "translateY(0)" : "translateY(4px)",
          transition: "all 0.12s ease",
        }}
      >
        {app.name}
      </div>
      <button
        onClick={onClick}
        onMouseEnter={() => { setHovered(true); sounds.hover(); }}
        onMouseLeave={() => setHovered(false)}
        className="outline-none"
        style={{
          transition: "transform 0.16s cubic-bezier(0.34,1.56,0.64,1)",
          transform: hovered ? "scale(1.22) translateY(-4px)" : "scale(1) translateY(0)",
        }}
        data-testid={`dock-${app.name.toLowerCase().replace(/ /g, "-")}`}
      >
        <div
          className="relative w-[44px] h-[44px] rounded-xl flex items-center justify-center overflow-hidden"
          style={{
            background: `linear-gradient(145deg, ${app.color}30, ${app.color}12)`,
            border: `1px solid ${app.color}${hovered ? "60" : "28"}`,
            boxShadow: hovered
              ? `0 0 20px ${app.color}40, 0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.14)`
              : `inset 0 1px 0 rgba(255,255,255,0.06)`,
            transition: "all 0.16s ease",
          }}
        >
          <div className="absolute inset-0 rounded-xl" style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.12) 0%, transparent 50%)" }} />
          <app.icon
            className="w-5 h-5 relative z-10"
            style={{
              color: app.color,
              filter: `drop-shadow(0 0 4px ${app.color}80)`,
            }}
          />
        </div>
      </button>
    </div>
  );
}

type Props = { user: AuthUser; onLogout: () => void };

export default function Desktop({ user, onLogout }: Props) {
  const [, navigate] = useLocation();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const categories = user.role === "superadmin"
    ? [...CATEGORIES, ADMIN_CATEGORY]
    : CATEGORIES;

  const panelName = user.panelName || "Control Panel";
  const hour      = time.getHours();
  const greeting  = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const timeStr   = time.toLocaleTimeString("en-US", { hour12: false });
  const dateStr   = time.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#06060e", position: "relative" }}>

      {/* ── Animated background orbs ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div style={{
          position: "absolute", width: 600, height: 600, borderRadius: "50%",
          background: `radial-gradient(circle, ${BLUE}18 0%, transparent 70%)`,
          top: "-10%", left: "-5%", animation: "orb1 20s ease-in-out infinite",
          filter: "blur(40px)",
        }} />
        <div style={{
          position: "absolute", width: 500, height: 500, borderRadius: "50%",
          background: `radial-gradient(circle, ${PURPLE}14 0%, transparent 70%)`,
          bottom: "-15%", right: "10%", animation: "orb2 25s ease-in-out infinite",
          filter: "blur(50px)",
        }} />
        <div style={{
          position: "absolute", width: 400, height: 400, borderRadius: "50%",
          background: `radial-gradient(circle, ${GREEN}10 0%, transparent 70%)`,
          top: "35%", right: "-5%", animation: "orb3 18s ease-in-out infinite",
          filter: "blur(35px)",
        }} />
      </div>

      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        zIndex: 1,
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.032) 1px, transparent 1px)",
        backgroundSize: "26px 26px",
      }} />

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        zIndex: 2,
        background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 50%, rgba(6,6,14,0.55) 100%)",
      }} />

      {/* ── OS Menu Bar ── */}
      <header
        className="relative flex items-center gap-3 px-5 shrink-0"
        style={{
          zIndex: 30, height: 44,
          background: "rgba(6,6,14,0.88)",
          backdropFilter: "blur(28px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* Traffic lights */}
        <div className="flex items-center gap-[7px] shrink-0">
          <div className="w-[11px] h-[11px] rounded-full" style={{ background: "#ff5f57", boxShadow: "0 0 8px #ff5f5780" }} />
          <div className="w-[11px] h-[11px] rounded-full" style={{ background: "#febc2e", boxShadow: "0 0 8px #febc2e80" }} />
          <div className="w-[11px] h-[11px] rounded-full" style={{ background: "#28c840", boxShadow: "0 0 8px #28c84080" }} />
        </div>

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.07)" }} />

        <span className="text-[12px] font-mono font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.62)" }}>
          {panelName}
        </span>

        <div className="flex-1" />

        {/* Live dot */}
        <div className="flex items-center gap-1.5">
          <div className="w-[7px] h-[7px] rounded-full" style={{ background: GREEN, boxShadow: `0 0 10px ${GREEN}`, animation: "pulse 2s ease-in-out infinite" }} />
          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.22)" }}>LIVE</span>
        </div>

        <div className="w-px h-5 mx-2" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* Time */}
        <div className="flex flex-col items-end gap-[1px]">
          <span className="text-[12px] font-mono tabular-nums font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>{timeStr}</span>
          <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.22)" }}>{dateStr}</span>
        </div>

        <div className="w-px h-5 mx-2" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* User avatar */}
        <div className="flex items-center gap-2">
          <div
            className="w-[26px] h-[26px] rounded-full flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${BLUE}35, ${PURPLE}25)`,
              border: `1px solid ${BLUE}45`,
              boxShadow: `0 0 10px ${BLUE}25`,
            }}
          >
            <User className="w-3 h-3" style={{ color: BLUE }} />
          </div>
          <div className="flex flex-col gap-0">
            <span className="text-[11px] font-mono leading-none" style={{ color: "rgba(255,255,255,0.55)" }}>{user.username}</span>
            <span className="text-[8px] font-mono leading-none mt-0.5 uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.22)" }}>{user.role}</span>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={() => { sounds.logout(); onLogout(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono outline-none ml-1"
          style={{
            background: "rgba(255,68,58,0.09)", border: "1px solid rgba(255,68,58,0.22)", color: "rgba(255,68,58,0.55)",
            transition: "all 0.12s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,68,58,0.18)"; e.currentTarget.style.borderColor = "rgba(255,68,58,0.50)"; e.currentTarget.style.color = RED; e.currentTarget.style.boxShadow = `0 0 14px rgba(255,68,58,0.20)`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,68,58,0.09)"; e.currentTarget.style.borderColor = "rgba(255,68,58,0.22)"; e.currentTarget.style.color = "rgba(255,68,58,0.55)"; e.currentTarget.style.boxShadow = "none"; }}
          data-testid="button-logout"
        >
          <LogOut className="w-3 h-3" />
          Sign Out
        </button>
      </header>

      {/* ── Desktop Content ── */}
      <main
        className="relative flex-1 overflow-y-auto px-14 py-8"
        style={{ zIndex: 10, scrollbarWidth: "none", paddingBottom: 96 }}
      >
        {/* Welcome */}
        <div className="mb-12">
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-[0.25em] mb-2" style={{ color: "rgba(255,255,255,0.22)" }}>
                {greeting}
              </p>
              <h1 className="text-[32px] font-mono font-bold leading-none" style={{ color: "rgba(255,255,255,0.88)" }}>
                {user.username}
                <span className="text-[32px]" style={{
                  background: `linear-gradient(90deg, ${BLUE}, ${PURPLE})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}>_</span>
              </h1>
            </div>
          </div>

          {/* Stat chips */}
          <div className="flex items-center gap-2.5 mt-5 flex-wrap">
            {[
              { label: "All systems", value: "OPERATIONAL", color: GREEN },
              { label: "Role", value: user.role.toUpperCase(), color: BLUE },
              { label: "Panel", value: panelName, color: PURPLE },
            ].map((chip) => (
              <div
                key={chip.label}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{
                  background: `${chip.color}0e`,
                  border: `1px solid ${chip.color}28`,
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: chip.color, boxShadow: `0 0 6px ${chip.color}` }} />
                <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.30)" }}>{chip.label}</span>
                <span className="text-[10px] font-mono font-bold" style={{ color: chip.color }}>{chip.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* App categories */}
        {categories.map((cat) => (
          <div key={cat.label} className="mb-12">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-[3px] h-4 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.28em]" style={{ color: "rgba(255,255,255,0.22)" }}>
                {cat.label}
              </span>
              <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.06), transparent)" }} />
              <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.14)" }}>
                {cat.apps.length} apps
              </span>
            </div>

            <div className="flex flex-wrap gap-0">
              {cat.apps.map((app) => (
                <AppIcon
                  key={app.href}
                  app={app}
                  onClick={() => { sounds.navigate(); navigate(app.href); }}
                />
              ))}
            </div>
          </div>
        ))}
      </main>

      {/* ── Bottom Dock ── */}
      <div
        className="absolute bottom-0 left-0 right-0 flex justify-center pb-4 pt-2"
        style={{ zIndex: 30 }}
      >
        <div
          className="flex items-end gap-2 px-5 py-3 rounded-2xl"
          style={{
            background: "rgba(18,18,28,0.75)",
            backdropFilter: "blur(32px)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.07) inset",
          }}
        >
          {DOCK_APPS.map((app, i) => (
            <>
              {i === 2 && (
                <div key="sep" className="w-px self-stretch mx-1" style={{ background: "rgba(255,255,255,0.10)" }} />
              )}
              <DockIcon
                key={app.href}
                app={app}
                onClick={() => { sounds.navigate(); navigate(app.href); }}
              />
            </>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes orb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%       { transform: translate(40px, -30px) scale(1.06); }
          66%       { transform: translate(-25px, 40px) scale(0.94); }
        }
        @keyframes orb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%       { transform: translate(-35px, 45px) scale(1.04); }
          66%       { transform: translate(30px, -30px) scale(0.96); }
        }
        @keyframes orb3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%       { transform: translate(-20px, -40px) scale(1.08); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        main::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

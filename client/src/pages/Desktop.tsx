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
      { name: "Event Scanner",   href: "/admin/tm-event-scanner",  icon: Search,           color: RED   },
      { name: "Live Alerts",     href: "/admin/tm-live-alerts",    icon: Bell,             color: RED   },
      { name: "Tracked Events",  href: "/admin/tm-tracked-events", icon: Bookmark,         color: RED   },
      { name: "TM Settings",     href: "/admin/tm-settings",       icon: SlidersHorizontal,color: AMBER },
      { name: "My Cards",        href: "/admin/my-cards",          icon: CreditCard,       color: AMBER },
    ],
  },
  {
    label: "Finance",
    apps: [
      { name: "Billing",       href: "/admin/billing",        icon: Receipt,     color: AMBER },
      { name: "Wallet",        href: "/admin/wallet",         icon: Wallet,      color: GREEN },
      { name: "Checkout Cards",href: "/admin/checkout-cards", icon: ShoppingCart,color: GREEN },
    ],
  },
];

const ADMIN_CATEGORY: Category = {
  label: "Administration",
  apps: [
    { name: "Earnings",        href: "/admin/earnings",         icon: TrendingUp, color: GREEN },
    { name: "Manage Admins",   href: "/admin/manage-admins",    icon: Users,      color: RED   },
    { name: "API Settings",    href: "/admin/settings",         icon: Settings,   color: GREY  },
    { name: "Private Account", href: "/admin/private-account",  icon: Lock,       color: RED   },
  ],
};

function AppIcon({ app, onClick }: { app: AppDef; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => { setHovered(true); sounds.hover(); }}
      onMouseLeave={() => setHovered(false)}
      className="flex flex-col items-center gap-2.5 p-3 rounded-2xl outline-none"
      style={{
        background: hovered ? `${app.color}12` : "transparent",
        transform: hovered ? "scale(1.07) translateY(-3px)" : "scale(1) translateY(0)",
        transition: "transform 0.14s ease, background 0.14s ease",
        width: 96,
      }}
      data-testid={`app-${app.name.toLowerCase().replace(/ /g, "-")}`}
    >
      <div
        className="w-[68px] h-[68px] rounded-2xl flex items-center justify-center"
        style={{
          background: hovered
            ? `linear-gradient(145deg, ${app.color}30, ${app.color}14)`
            : `linear-gradient(145deg, ${app.color}1e, ${app.color}0a)`,
          border: `1px solid ${app.color}${hovered ? "55" : "28"}`,
          boxShadow: hovered
            ? `0 0 24px ${app.color}28, 0 6px 20px rgba(0,0,0,0.5)`
            : `0 2px 10px rgba(0,0,0,0.35)`,
          transition: "all 0.14s ease",
        }}
      >
        <app.icon
          className="w-8 h-8"
          style={{
            color: app.color,
            filter: hovered
              ? `drop-shadow(0 0 10px ${app.color})`
              : `drop-shadow(0 0 4px ${app.color}80)`,
            transition: "filter 0.14s ease",
          }}
        />
      </div>
      <span
        className="text-[11px] font-mono text-center leading-tight"
        style={{
          color: hovered ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.48)",
          transition: "color 0.14s ease",
          maxWidth: 80,
        }}
      >
        {app.name}
      </span>
    </button>
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
  const timeStr   = time.toLocaleTimeString("en-US", { hour12: false });
  const dateStr   = time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#08080f" }}>
      {/* Dot-grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* ── OS Menu Bar ── */}
      <header
        className="relative z-20 flex items-center gap-3 px-5 shrink-0"
        style={{
          height: 44,
          background: "rgba(8,8,15,0.90)",
          backdropFilter: "blur(24px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Traffic lights */}
        <div className="flex items-center gap-[6px] shrink-0">
          <div className="w-3 h-3 rounded-full" style={{ background: "#ff5f57", boxShadow: "0 0 6px #ff5f5770" }} />
          <div className="w-3 h-3 rounded-full" style={{ background: "#febc2e", boxShadow: "0 0 6px #febc2e70" }} />
          <div className="w-3 h-3 rounded-full" style={{ background: "#28c840", boxShadow: "0 0 6px #28c84070" }} />
        </div>

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.07)" }} />

        <span className="text-[12px] font-mono font-semibold" style={{ color: "rgba(255,255,255,0.65)" }}>
          {panelName}
        </span>

        <div className="flex-1" />

        {/* Online dot */}
        <div className="flex items-center gap-1.5">
          <div className="w-[6px] h-[6px] rounded-full animate-pulse" style={{ background: GREEN, boxShadow: `0 0 8px ${GREEN}` }} />
          <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>ONLINE</span>
        </div>

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* Date / time */}
        <div className="flex flex-col items-end leading-none gap-0.5">
          <span className="text-[11px] font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.60)" }}>{timeStr}</span>
          <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{dateStr}</span>
        </div>

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* User */}
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `${BLUE}22`, border: `1px solid ${BLUE}40` }}
          >
            <User className="w-3 h-3" style={{ color: BLUE }} />
          </div>
          <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.45)" }}>
            {user.username}
          </span>
        </div>

        {/* Logout */}
        <button
          onClick={() => { sounds.logout(); onLogout(); }}
          className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg text-[10px] font-mono"
          style={{
            background: "rgba(255,68,58,0.08)",
            border: "1px solid rgba(255,68,58,0.20)",
            color: "rgba(255,68,58,0.55)",
            transition: "all 0.12s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,68,58,0.16)";
            e.currentTarget.style.borderColor = "rgba(255,68,58,0.45)";
            e.currentTarget.style.color = RED;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,68,58,0.08)";
            e.currentTarget.style.borderColor = "rgba(255,68,58,0.20)";
            e.currentTarget.style.color = "rgba(255,68,58,0.55)";
          }}
          data-testid="button-logout"
        >
          <LogOut className="w-3 h-3" />
          Sign Out
        </button>
      </header>

      {/* ── Desktop Content ── */}
      <main
        className="relative z-10 flex-1 overflow-y-auto px-12 py-10"
        style={{ scrollbarWidth: "none" }}
      >
        <style>{`main::-webkit-scrollbar { display: none; }`}</style>

        {/* Welcome */}
        <div className="mb-10">
          <h1 className="text-[26px] font-mono font-bold" style={{ color: "rgba(255,255,255,0.85)" }}>
            Welcome back,{" "}
            <span style={{ color: BLUE, textShadow: `0 0 24px ${BLUE}60` }}>{user.username}</span>
          </h1>
          <p className="text-[11px] font-mono mt-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>
            {dateStr} &nbsp;·&nbsp; {user.role.toUpperCase()} &nbsp;·&nbsp; All systems operational
          </p>
        </div>

        {/* Categories */}
        {categories.map((cat) => (
          <div key={cat.label} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span
                className="text-[10px] font-mono font-bold uppercase tracking-[0.25em] shrink-0"
                style={{ color: "rgba(255,255,255,0.25)" }}
              >
                {cat.label}
              </span>
              <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
            </div>

            <div className="flex flex-wrap gap-1">
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

        <div className="h-10" />
      </main>
    </div>
  );
}

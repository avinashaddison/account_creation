import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Archive, Server, Mail, MailOpen,
  Zap, Ticket, Shield, Music, Terminal, Heart, Code2,
  Layers, Mic2, MessageSquare, Globe, Search, Bell,
  Bookmark, SlidersHorizontal, CreditCard, Receipt,
  Wallet, ShoppingCart, TrendingUp, Users, Settings,
  Lock, LogOut, User, Wifi, Battery,
} from "lucide-react";
import { sounds } from "@/lib/sounds";
import type { AuthUser } from "@/App";

const SF = "-apple-system, 'Helvetica Neue', BlinkMacSystemFont, sans-serif";

type AppDef = {
  name: string;
  href: string;
  icon: any;
  gradient: string;
  shadow: string;
};

type Category = { label: string; apps: AppDef[] };

const CATEGORIES: Category[] = [
  {
    label: "Core System",
    apps: [
      { name: "Dashboard",      href: "/admin/home",              icon: LayoutDashboard, gradient: "linear-gradient(145deg,#34c759,#248a3d)",  shadow: "#248a3d" },
      { name: "Account Stock",  href: "/admin/accounts",          icon: Archive,         gradient: "linear-gradient(145deg,#ff9f0a,#c93400)",  shadow: "#c93400" },
      { name: "Create Account", href: "/admin/create-server",     icon: Server,          gradient: "linear-gradient(145deg,#30d158,#1a6b2e)",  shadow: "#1a6b2e" },
      { name: "Email",          href: "/admin/email-workspace",   icon: Mail,            gradient: "linear-gradient(145deg,#0a84ff,#004fc4)",  shadow: "#004fc4" },
      { name: "Outlook",        href: "/admin/outlook-workspace", icon: MailOpen,        gradient: "linear-gradient(145deg,#0078d4,#00408a)",  shadow: "#00408a" },
    ],
  },
  {
    label: "Platforms",
    apps: [
      { name: "LA28",        href: "/admin/la28-create",        icon: Zap,           gradient: "linear-gradient(145deg,#0a84ff,#0050cc)",  shadow: "#0050cc" },
      { name: "Ticketmaster",href: "/admin/tm-create",          icon: Ticket,        gradient: "linear-gradient(145deg,#ff453a,#900000)",  shadow: "#900000" },
      { name: "UEFA",        href: "/admin/uefa-create",        icon: Shield,        gradient: "linear-gradient(145deg,#005baa,#003070)",  shadow: "#003070" },
      { name: "Bruno Mars",  href: "/admin/brunomars-create",   icon: Music,         gradient: "linear-gradient(145deg,#ff9f0a,#d4680d)",  shadow: "#d4680d" },
      { name: "Replit",      href: "/admin/replit-create",      icon: Terminal,      gradient: "linear-gradient(145deg,#bf5af2,#7b24cc)",  shadow: "#7b24cc" },
      { name: "Lovable",     href: "/admin/lovable-create",     icon: Heart,         gradient: "linear-gradient(145deg,#ff375f,#b00028)",  shadow: "#b00028" },
      { name: "V0",          href: "/admin/v0-create",          icon: Code2,         gradient: "linear-gradient(145deg,#636366,#3a3a3c)",  shadow: "#3a3a3c" },
      { name: "Adobe",       href: "/admin/adobe-create",       icon: Layers,        gradient: "linear-gradient(145deg,#fa0f00,#8c0000)",  shadow: "#8c0000" },
      { name: "ElevenLabs",  href: "/admin/elevenlabs-create",  icon: Mic2,          gradient: "linear-gradient(145deg,#5e5ce6,#30309e)",  shadow: "#30309e" },
      { name: "ChatGPT",     href: "/admin/chatgpt-create",     icon: MessageSquare, gradient: "linear-gradient(145deg,#19c37d,#0b7048)",  shadow: "#0b7048" },
      { name: "ZenRows",     href: "/admin/zenrows-register",   icon: Globe,         gradient: "linear-gradient(145deg,#1d9bf0,#0042a0)",  shadow: "#0042a0" },
    ],
  },
  {
    label: "Ticketmaster Suite",
    apps: [
      { name: "Event Scanner",   href: "/admin/tm-event-scanner",  icon: Search,            gradient: "linear-gradient(145deg,#ff3b30,#820000)", shadow: "#820000" },
      { name: "Live Alerts",     href: "/admin/tm-live-alerts",    icon: Bell,              gradient: "linear-gradient(145deg,#ff453a,#a50000)", shadow: "#a50000" },
      { name: "Tracked Events",  href: "/admin/tm-tracked-events", icon: Bookmark,          gradient: "linear-gradient(145deg,#ff9500,#bf5100)", shadow: "#bf5100" },
      { name: "TM Settings",     href: "/admin/tm-settings",       icon: SlidersHorizontal, gradient: "linear-gradient(145deg,#8e8e93,#48484a)", shadow: "#48484a" },
      { name: "My Cards",        href: "/admin/my-cards",          icon: CreditCard,        gradient: "linear-gradient(145deg,#ff9f0a,#8a5000)", shadow: "#8a5000" },
    ],
  },
  {
    label: "Finance",
    apps: [
      { name: "Billing",        href: "/admin/billing",        icon: Receipt,     gradient: "linear-gradient(145deg,#ff9500,#c05000)", shadow: "#c05000" },
      { name: "Wallet",         href: "/admin/wallet",         icon: Wallet,      gradient: "linear-gradient(145deg,#34c759,#1a7035)", shadow: "#1a7035" },
      { name: "Checkout Cards", href: "/admin/checkout-cards", icon: ShoppingCart,gradient: "linear-gradient(145deg,#30d158,#1a6b2e)", shadow: "#1a6b2e" },
    ],
  },
];

const ADMIN_CATEGORY: Category = {
  label: "Administration",
  apps: [
    { name: "Earnings",        href: "/admin/earnings",        icon: TrendingUp, gradient: "linear-gradient(145deg,#30d158,#1a7035)", shadow: "#1a7035" },
    { name: "Manage Admins",   href: "/admin/manage-admins",   icon: Users,      gradient: "linear-gradient(145deg,#ff453a,#8c0000)", shadow: "#8c0000" },
    { name: "API Settings",    href: "/admin/settings",        icon: Settings,   gradient: "linear-gradient(145deg,#636366,#3a3a3c)", shadow: "#3a3a3c" },
    { name: "Private Account", href: "/admin/private-account", icon: Lock,       gradient: "linear-gradient(145deg,#ff453a,#700000)", shadow: "#700000" },
  ],
};

const DOCK_APPS: AppDef[] = [
  { name: "Dashboard",   href: "/admin/home",            icon: LayoutDashboard, gradient: "linear-gradient(145deg,#34c759,#248a3d)", shadow: "#248a3d" },
  { name: "Accounts",    href: "/admin/accounts",        icon: Archive,         gradient: "linear-gradient(145deg,#ff9f0a,#c93400)", shadow: "#c93400" },
  { name: "Replit",      href: "/admin/replit-create",   icon: Terminal,        gradient: "linear-gradient(145deg,#bf5af2,#7b24cc)", shadow: "#7b24cc" },
  { name: "Ticketmaster",href: "/admin/tm-create",       icon: Ticket,          gradient: "linear-gradient(145deg,#ff453a,#900000)", shadow: "#900000" },
  { name: "Wallet",      href: "/admin/wallet",          icon: Wallet,          gradient: "linear-gradient(145deg,#34c759,#1a7035)", shadow: "#1a7035" },
  { name: "Email",       href: "/admin/email-workspace", icon: Mail,            gradient: "linear-gradient(145deg,#0a84ff,#004fc4)", shadow: "#004fc4" },
];

function AppIcon({ app, onClick }: { app: AppDef; onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex flex-col items-center gap-[7px] cursor-pointer select-none"
      style={{ width: 88 }}
      onClick={onClick}
      onMouseEnter={() => { setHovered(true); sounds.hover(); }}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      data-testid={`app-${app.name.toLowerCase().replace(/ /g, "-")}`}
    >
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          width: 64, height: 64,
          borderRadius: 15,
          background: app.gradient,
          boxShadow: pressed
            ? `0 2px 8px ${app.shadow}70`
            : hovered
              ? `0 10px 30px ${app.shadow}80, 0 4px 12px rgba(0,0,0,0.4)`
              : `0 6px 20px ${app.shadow}60, 0 2px 6px rgba(0,0,0,0.3)`,
          transform: pressed
            ? "scale(0.88)"
            : hovered
              ? "scale(1.08) translateY(-3px)"
              : "scale(1) translateY(0)",
          transition: pressed
            ? "transform 0.06s ease, box-shadow 0.06s ease"
            : "transform 0.28s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease",
        }}
      >
        {/* iOS gloss: top half shine */}
        <div
          className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.06) 100%)", borderRadius: "15px 15px 0 0" }}
        />
        {/* Pressed overlay */}
        {pressed && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(0,0,0,0.18)", borderRadius: 15 }} />
        )}
        <app.icon className="w-8 h-8 relative z-10" style={{ color: "rgba(255,255,255,0.95)", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }} />
      </div>

      <span
        className="text-center leading-tight"
        style={{
          fontFamily: SF,
          fontSize: 11,
          fontWeight: 500,
          color: "rgba(255,255,255,0.88)",
          textShadow: "0 1px 3px rgba(0,0,0,0.8)",
          maxWidth: 80,
          letterSpacing: -0.1,
        }}
      >
        {app.name}
      </span>
    </div>
  );
}

function DockIcon({ app, onClick }: { app: AppDef; onClick: () => void }) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative flex flex-col items-center" style={{ width: 60 }}>
      {/* Tooltip */}
      <div
        className="absolute px-2.5 py-1 rounded-xl text-[11px] whitespace-nowrap pointer-events-none"
        style={{
          fontFamily: SF, fontWeight: 600,
          background: "rgba(30,30,30,0.88)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "rgba(255,255,255,0.90)",
          bottom: "calc(100% + 10px)",
          backdropFilter: "blur(20px)",
          opacity: hovered ? 1 : 0,
          transform: hovered ? "translateY(0) scale(1)" : "translateY(4px) scale(0.95)",
          transition: "all 0.14s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        {app.name}
      </div>

      <div
        className="relative flex items-center justify-center overflow-hidden cursor-pointer"
        style={{
          width: 52, height: 52,
          borderRadius: 12,
          background: app.gradient,
          boxShadow: pressed
            ? `0 2px 6px ${app.shadow}70`
            : `0 6px 18px ${app.shadow}65, 0 2px 6px rgba(0,0,0,0.3)`,
          transform: pressed
            ? "scale(0.88)"
            : hovered
              ? "scale(1.14) translateY(-5px)"
              : "scale(1)",
          transition: pressed
            ? "transform 0.06s ease"
            : "transform 0.28s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease",
        }}
        onClick={onClick}
        onMouseEnter={() => { setHovered(true); sounds.hover(); }}
        onMouseLeave={() => { setHovered(false); setPressed(false); }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        data-testid={`dock-${app.name.toLowerCase().replace(/ /g, "-")}`}
      >
        <div
          className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.05) 100%)", borderRadius: "12px 12px 0 0" }}
        />
        {pressed && <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(0,0,0,0.18)", borderRadius: 12 }} />}
        <app.icon className="w-[26px] h-[26px] relative z-10" style={{ color: "rgba(255,255,255,0.95)", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }} />
      </div>

      {/* Active dot */}
      <div className="w-[4px] h-[4px] rounded-full mt-1.5" style={{ background: "rgba(255,255,255,0.55)" }} />
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

  const hour    = time.getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const timeStr  = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ position: "relative" }}>

      {/* ── iOS Wallpaper ── */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        {/* Base gradient */}
        <div className="absolute inset-0" style={{
          background: "linear-gradient(160deg, #0b0b24 0%, #0e1042 25%, #130832 50%, #0a0f3a 75%, #060615 100%)",
        }} />
        {/* Aurora layer 1 */}
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 70% 50% at 20% 10%, rgba(120,50,220,0.45) 0%, transparent 70%)",
          animation: "aurora1 18s ease-in-out infinite",
        }} />
        {/* Aurora layer 2 */}
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 55% 65% at 80% 90%, rgba(30,80,200,0.40) 0%, transparent 65%)",
          animation: "aurora2 24s ease-in-out infinite",
        }} />
        {/* Aurora layer 3 */}
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 45% 35% at 60% 40%, rgba(80,20,180,0.25) 0%, transparent 60%)",
          animation: "aurora3 20s ease-in-out infinite",
        }} />
        {/* Stars / sparkle dots */}
        <div className="absolute inset-0" style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.55) 1px, transparent 1px), radial-gradient(circle, rgba(255,255,255,0.30) 1px, transparent 1px)",
          backgroundSize: "120px 120px, 80px 80px",
          backgroundPosition: "0 0, 40px 40px",
        }} />
      </div>

      {/* ── iOS Status Bar ── */}
      <div
        className="relative flex items-center justify-between px-7 shrink-0"
        style={{ zIndex: 20, height: 44 }}
      >
        {/* Time */}
        <span style={{ fontFamily: SF, fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.95)", letterSpacing: -0.3 }}>
          {timeStr}
        </span>

        {/* Right: status icons */}
        <div className="flex items-center gap-2">
          {/* Signal bars */}
          <div className="flex items-end gap-[3px]">
            {[10, 14, 18, 22].map((h, i) => (
              <div key={i} style={{ width: 3, height: h, borderRadius: 1.5, background: i < 3 ? "rgba(255,255,255,0.90)" : "rgba(255,255,255,0.35)" }} />
            ))}
          </div>
          <Wifi className="w-4 h-4" style={{ color: "rgba(255,255,255,0.90)" }} />
          {/* Battery */}
          <div className="relative flex items-center">
            <div style={{ width: 22, height: 11, border: "1.5px solid rgba(255,255,255,0.75)", borderRadius: 3, padding: "1.5px 1.5px", display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1, height: "100%", background: "rgba(255,255,255,0.88)", borderRadius: 1.5 }} />
            </div>
            <div style={{ width: 2, height: 5, background: "rgba(255,255,255,0.60)", borderRadius: "0 1px 1px 0", marginLeft: 1 }} />
          </div>
        </div>
      </div>

      {/* ── Greeting ── */}
      <div className="relative px-8 pt-2 pb-6 shrink-0" style={{ zIndex: 10 }}>
        <p style={{ fontFamily: SF, fontSize: 13, color: "rgba(255,255,255,0.50)", fontWeight: 400, letterSpacing: 0.2 }}>
          {greeting},
        </p>
        <h1 style={{ fontFamily: SF, fontSize: 28, fontWeight: 700, color: "rgba(255,255,255,0.95)", letterSpacing: -0.5, lineHeight: 1.1 }}>
          {user.username}
        </h1>
      </div>

      {/* ── App Grid ── */}
      <main
        className="relative flex-1 overflow-y-auto"
        style={{ zIndex: 10, paddingBottom: 120, scrollbarWidth: "none" }}
      >
        <style>{`main::-webkit-scrollbar{display:none}`}</style>

        {categories.map((cat) => (
          <div key={cat.label} className="mb-8 px-6">
            {/* Category label */}
            <div className="mb-4">
              <span
                style={{
                  fontFamily: SF, fontSize: 12, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: 0.8,
                  color: "rgba(255,255,255,0.35)",
                }}
              >
                {cat.label}
              </span>
            </div>

            {/* Icons */}
            <div className="flex flex-wrap gap-3">
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

      {/* ── iOS Dock ── */}
      <div
        className="absolute bottom-0 left-0 right-0 flex justify-center"
        style={{ zIndex: 30, paddingBottom: 18, paddingTop: 10 }}
      >
        <div
          className="flex items-end gap-4 px-6 py-3 rounded-3xl"
          style={{
            background: "rgba(255,255,255,0.14)",
            backdropFilter: "blur(40px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.20)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22)",
          }}
        >
          {DOCK_APPS.flatMap((app, i) => {
            const items = [];
            if (i === 3) items.push(
              <div key="separator" style={{ width: 1, height: 42, background: "rgba(255,255,255,0.18)", alignSelf: "center" }} />
            );
            items.push(
              <DockIcon
                key={app.href}
                app={app}
                onClick={() => { sounds.navigate(); navigate(app.href); }}
              />
            );
            return items;
          })}
        </div>
      </div>

      {/* User / logout pill */}
      <div
        className="absolute top-10 right-4"
        style={{ zIndex: 30 }}
      >
        <button
          onClick={() => { sounds.logout(); onLogout(); }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full outline-none"
          style={{
            background: "rgba(255,255,255,0.12)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.20)",
            color: "rgba(255,255,255,0.70)",
            fontFamily: SF,
            fontSize: 12,
            fontWeight: 500,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.20)"; e.currentTarget.style.color = "rgba(255,255,255,0.95)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.70)"; }}
          data-testid="button-logout"
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.18)" }}
          >
            <User className="w-3 h-3" />
          </div>
          {user.username}
          <LogOut className="w-3 h-3 opacity-60" />
        </button>
      </div>

      <style>{`
        @keyframes aurora1 {
          0%,100% { transform: translate(0,0) scale(1); opacity:1; }
          33%      { transform: translate(60px,-40px) scale(1.1); opacity:0.8; }
          66%      { transform: translate(-30px,50px) scale(0.9); opacity:1; }
        }
        @keyframes aurora2 {
          0%,100% { transform: translate(0,0) scale(1); opacity:1; }
          40%      { transform: translate(-50px,30px) scale(1.08); opacity:0.75; }
          70%      { transform: translate(40px,-40px) scale(0.92); opacity:1; }
        }
        @keyframes aurora3 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-30px,-50px) scale(1.12); }
        }
      `}</style>
    </div>
  );
}

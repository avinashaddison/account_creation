import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Archive, Server, Mail, MailOpen,
  Zap, Ticket, Shield, Music, Terminal, Heart, Code2,
  Layers, Mic2, MessageSquare, Globe, Search, Bell,
  Bookmark, SlidersHorizontal, CreditCard, Receipt,
  Wallet, ShoppingCart, TrendingUp, Users, Settings,
  Lock, LogOut, User, Home,
} from "lucide-react";
import { sounds } from "@/lib/sounds";

const BLUE   = "#0a84ff";
const GREEN  = "#30d158";
const PURPLE = "#bf5af2";
const AMBER  = "#ff9f0a";
const RED    = "#ff453a";
const GREY   = "#8e8e93";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string; panelName?: string };
  onLogout: () => void;
  onPanelNameChange?: (name: string) => void;
};

type RouteMeta = { name: string; color: string; icon: any };

const ROUTE_META: Record<string, RouteMeta> = {
  "/admin/home":               { name: "Dashboard",        color: GREEN,  icon: LayoutDashboard  },
  "/admin/accounts":           { name: "Account Stock",    color: AMBER,  icon: Archive          },
  "/admin/create-server":      { name: "Create Account",   color: GREEN,  icon: Server           },
  "/admin/la28-create":        { name: "LA28",             color: BLUE,   icon: Zap              },
  "/admin/tm-create":          { name: "Ticketmaster",     color: RED,    icon: Ticket           },
  "/admin/uefa-create":        { name: "UEFA",             color: BLUE,   icon: Shield           },
  "/admin/brunomars-create":   { name: "Bruno Mars",       color: AMBER,  icon: Music            },
  "/admin/replit-create":      { name: "Replit",           color: PURPLE, icon: Terminal         },
  "/admin/lovable-create":     { name: "Lovable",          color: RED,    icon: Heart            },
  "/admin/v0-create":          { name: "V0",               color: GREY,   icon: Code2            },
  "/admin/adobe-create":       { name: "Adobe",            color: RED,    icon: Layers           },
  "/admin/elevenlabs-create":  { name: "ElevenLabs",       color: PURPLE, icon: Mic2             },
  "/admin/chatgpt-create":     { name: "ChatGPT",          color: GREEN,  icon: MessageSquare    },
  "/admin/zenrows-register":   { name: "ZenRows",          color: BLUE,   icon: Globe            },
  "/admin/outlook-login":      { name: "Outlook Login",    color: BLUE,   icon: MailOpen         },
  "/admin/outlook-create":     { name: "Outlook Create",   color: BLUE,   icon: MailOpen         },
  "/admin/outlook-workspace":  { name: "Outlook",          color: BLUE,   icon: MailOpen         },
  "/admin/email-workspace":    { name: "Email",            color: BLUE,   icon: Mail             },
  "/admin/tm-event-scanner":   { name: "Event Scanner",    color: RED,    icon: Search           },
  "/admin/tm-live-alerts":     { name: "Live Alerts",      color: RED,    icon: Bell             },
  "/admin/tm-tracked-events":  { name: "Tracked Events",   color: RED,    icon: Bookmark         },
  "/admin/tm-settings":        { name: "TM Settings",      color: AMBER,  icon: SlidersHorizontal},
  "/admin/my-cards":           { name: "My Cards",         color: AMBER,  icon: CreditCard       },
  "/admin/billing":            { name: "Billing",          color: AMBER,  icon: Receipt          },
  "/admin/wallet":             { name: "Wallet",           color: GREEN,  icon: Wallet           },
  "/admin/checkout-cards":     { name: "Checkout Cards",   color: GREEN,  icon: ShoppingCart     },
  "/admin/earnings":           { name: "Earnings",         color: GREEN,  icon: TrendingUp       },
  "/admin/manage-admins":      { name: "Manage Admins",    color: RED,    icon: Users            },
  "/admin/settings":           { name: "API Settings",     color: GREY,   icon: Settings         },
  "/admin/private-account":    { name: "Private Account",  color: RED,    icon: Lock             },
  "/admin/card-generator":     { name: "Card Generator",   color: AMBER,  icon: CreditCard       },
};

function getRouteMeta(location: string): RouteMeta {
  if (ROUTE_META[location]) return ROUTE_META[location];
  for (const [key, meta] of Object.entries(ROUTE_META)) {
    if (location.startsWith(key)) return meta;
  }
  return { name: "Panel", color: BLUE, icon: LayoutDashboard };
}

const FULLSCREEN_ROUTES = [
  "/admin/outlook-workspace",
  "/admin/email-workspace",
  "/admin/private-account",
];

export default function Layout({ children, user, onLogout }: LayoutProps) {
  const [location, navigate] = useLocation();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const meta        = getRouteMeta(location);
  const isFullscreen= FULLSCREEN_ROUTES.some((r) => location.startsWith(r));
  const timeStr     = time.toLocaleTimeString("en-US", { hour12: false });

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "#08080f" }}>
      {/* Dot-grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* ── Window Title Bar ── */}
      <header
        className="relative z-20 flex items-center gap-3 px-4 shrink-0"
        style={{
          height: 44,
          background: "rgba(8,8,15,0.92)",
          backdropFilter: "blur(24px)",
          borderBottom: `1px solid ${meta.color}18`,
        }}
      >
        {/* Traffic lights — red closes (goes home) */}
        <div className="flex items-center gap-[6px] shrink-0">
          <button
            onClick={() => { sounds.navigate(); navigate("/admin"); }}
            className="w-3 h-3 rounded-full outline-none cursor-pointer transition-opacity hover:opacity-75"
            style={{ background: "#ff5f57", boxShadow: "0 0 6px #ff5f5760" }}
            title="Back to desktop"
            data-testid="button-window-close"
          />
          <div className="w-3 h-3 rounded-full" style={{ background: "#febc2e", boxShadow: "0 0 6px #febc2e60" }} />
          <div className="w-3 h-3 rounded-full" style={{ background: "#28c840", boxShadow: "0 0 6px #28c84060" }} />
        </div>

        <div className="w-px h-5 mx-0.5" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* Home button */}
        <button
          onClick={() => { sounds.navigate(); navigate("/admin"); }}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-mono outline-none"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.35)",
            transition: "all 0.12s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(255,255,255,0.65)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            e.currentTarget.style.color = "rgba(255,255,255,0.35)";
          }}
          data-testid="button-home"
        >
          <Home className="w-3 h-3" />
          Desktop
        </button>

        <div className="w-px h-5 mx-0.5" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* Current app icon + name */}
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: `${meta.color}18`,
              border: `1px solid ${meta.color}30`,
            }}
          >
            <meta.icon className="w-3.5 h-3.5" style={{ color: meta.color, filter: `drop-shadow(0 0 4px ${meta.color}80)` }} />
          </div>
          <span
            className="text-[13px] font-mono font-semibold"
            style={{ color: "rgba(255,255,255,0.78)" }}
          >
            {meta.name}
          </span>
        </div>

        {/* Color accent line under title */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${meta.color}40, transparent)` }}
        />

        <div className="flex-1" />

        {/* Time */}
        <span className="text-[11px] font-mono tabular-nums" style={{ color: "rgba(255,255,255,0.30)" }}>
          {timeStr}
        </span>

        <div className="w-px h-5 mx-1" style={{ background: "rgba(255,255,255,0.07)" }} />

        {/* User */}
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
            style={{ background: `${BLUE}20`, border: `1px solid ${BLUE}35` }}
          >
            <User className="w-2.5 h-2.5" style={{ color: BLUE }} />
          </div>
          <span className="text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.38)" }}>
            {user.username}
          </span>
        </div>

        {/* Logout */}
        <button
          onClick={() => { sounds.logout(); onLogout(); }}
          className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg text-[10px] font-mono outline-none"
          style={{
            background: "rgba(255,68,58,0.07)",
            border: "1px solid rgba(255,68,58,0.18)",
            color: "rgba(255,68,58,0.50)",
            transition: "all 0.12s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,68,58,0.15)";
            e.currentTarget.style.borderColor = "rgba(255,68,58,0.42)";
            e.currentTarget.style.color = RED;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,68,58,0.07)";
            e.currentTarget.style.borderColor = "rgba(255,68,58,0.18)";
            e.currentTarget.style.color = "rgba(255,68,58,0.50)";
          }}
          data-testid="button-logout"
        >
          <LogOut className="w-3 h-3" />
          Sign Out
        </button>
      </header>

      {/* ── Content ── */}
      {isFullscreen ? (
        <main className="relative z-10 flex-1 overflow-hidden flex flex-col">
          {children}
        </main>
      ) : (
        <main className="relative z-10 flex-1 overflow-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
          <div className="p-7 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      )}
    </div>
  );
}

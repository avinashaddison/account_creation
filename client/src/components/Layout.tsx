import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Archive, Server, Mail, MailOpen,
  Zap, Ticket, Shield, Music, Terminal, Heart, Code2,
  Layers, Mic2, MessageSquare, Globe, Search, Bell,
  Bookmark, SlidersHorizontal, CreditCard, Receipt,
  Wallet, ShoppingCart, TrendingUp, Users, Settings,
  Lock, LogOut, User, ChevronLeft,
} from "lucide-react";
import { sounds } from "@/lib/sounds";

const SF = "-apple-system, 'Helvetica Neue', BlinkMacSystemFont, sans-serif";
const BLUE   = "#0a84ff";
const PURPLE = "#bf5af2";
const RED    = "#ff453a";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string; panelName?: string };
  onLogout: () => void;
  onPanelNameChange?: (name: string) => void;
};

type RouteMeta = { name: string; gradient: string; shadow: string; icon: any };

const ROUTE_META: Record<string, RouteMeta> = {
  "/admin/home":               { name: "Dashboard",        gradient: "linear-gradient(145deg,#34c759,#248a3d)",  shadow: "#248a3d", icon: LayoutDashboard  },
  "/admin/accounts":           { name: "Account Stock",    gradient: "linear-gradient(145deg,#ff9f0a,#c93400)",  shadow: "#c93400", icon: Archive          },
  "/admin/create-server":      { name: "Create Account",   gradient: "linear-gradient(145deg,#30d158,#1a6b2e)",  shadow: "#1a6b2e", icon: Server           },
  "/admin/la28-create":        { name: "LA28",             gradient: "linear-gradient(145deg,#0a84ff,#004fc4)",  shadow: "#004fc4", icon: Zap              },
  "/admin/tm-create":          { name: "Ticketmaster",     gradient: "linear-gradient(145deg,#ff453a,#900000)",  shadow: "#900000", icon: Ticket           },
  "/admin/uefa-create":        { name: "UEFA",             gradient: "linear-gradient(145deg,#005baa,#003070)",  shadow: "#003070", icon: Shield           },
  "/admin/brunomars-create":   { name: "Bruno Mars",       gradient: "linear-gradient(145deg,#ff9f0a,#d4680d)",  shadow: "#d4680d", icon: Music            },
  "/admin/replit-create":      { name: "Replit",           gradient: "linear-gradient(145deg,#bf5af2,#7b24cc)",  shadow: "#7b24cc", icon: Terminal         },
  "/admin/lovable-create":     { name: "Lovable",          gradient: "linear-gradient(145deg,#ff375f,#b00028)",  shadow: "#b00028", icon: Heart            },
  "/admin/v0-create":          { name: "V0",               gradient: "linear-gradient(145deg,#636366,#3a3a3c)",  shadow: "#3a3a3c", icon: Code2            },
  "/admin/adobe-create":       { name: "Adobe",            gradient: "linear-gradient(145deg,#fa0f00,#8c0000)",  shadow: "#8c0000", icon: Layers           },
  "/admin/elevenlabs-create":  { name: "ElevenLabs",       gradient: "linear-gradient(145deg,#5e5ce6,#30309e)",  shadow: "#30309e", icon: Mic2             },
  "/admin/chatgpt-create":     { name: "ChatGPT",          gradient: "linear-gradient(145deg,#19c37d,#0b7048)",  shadow: "#0b7048", icon: MessageSquare    },
  "/admin/zenrows-register":   { name: "ZenRows",          gradient: "linear-gradient(145deg,#1d9bf0,#0042a0)",  shadow: "#0042a0", icon: Globe            },
  "/admin/outlook-login":      { name: "Outlook",          gradient: "linear-gradient(145deg,#0078d4,#00408a)",  shadow: "#00408a", icon: MailOpen         },
  "/admin/outlook-create":     { name: "Outlook",          gradient: "linear-gradient(145deg,#0078d4,#00408a)",  shadow: "#00408a", icon: MailOpen         },
  "/admin/outlook-workspace":  { name: "Outlook",          gradient: "linear-gradient(145deg,#0078d4,#00408a)",  shadow: "#00408a", icon: MailOpen         },
  "/admin/email-workspace":    { name: "Email",            gradient: "linear-gradient(145deg,#0a84ff,#004fc4)",  shadow: "#004fc4", icon: Mail             },
  "/admin/tm-event-scanner":   { name: "Event Scanner",    gradient: "linear-gradient(145deg,#ff3b30,#820000)",  shadow: "#820000", icon: Search           },
  "/admin/tm-live-alerts":     { name: "Live Alerts",      gradient: "linear-gradient(145deg,#ff453a,#a50000)",  shadow: "#a50000", icon: Bell             },
  "/admin/tm-tracked-events":  { name: "Tracked Events",   gradient: "linear-gradient(145deg,#ff9500,#bf5100)",  shadow: "#bf5100", icon: Bookmark         },
  "/admin/tm-settings":        { name: "TM Settings",      gradient: "linear-gradient(145deg,#8e8e93,#48484a)",  shadow: "#48484a", icon: SlidersHorizontal},
  "/admin/my-cards":           { name: "My Cards",         gradient: "linear-gradient(145deg,#ff9f0a,#8a5000)",  shadow: "#8a5000", icon: CreditCard       },
  "/admin/billing":            { name: "Billing",          gradient: "linear-gradient(145deg,#ff9500,#c05000)",  shadow: "#c05000", icon: Receipt          },
  "/admin/wallet":             { name: "Wallet",           gradient: "linear-gradient(145deg,#34c759,#1a7035)",  shadow: "#1a7035", icon: Wallet           },
  "/admin/checkout-cards":     { name: "Checkout Cards",   gradient: "linear-gradient(145deg,#30d158,#1a6b2e)",  shadow: "#1a6b2e", icon: ShoppingCart     },
  "/admin/earnings":           { name: "Earnings",         gradient: "linear-gradient(145deg,#30d158,#1a7035)",  shadow: "#1a7035", icon: TrendingUp       },
  "/admin/manage-admins":      { name: "Manage Admins",    gradient: "linear-gradient(145deg,#ff453a,#8c0000)",  shadow: "#8c0000", icon: Users            },
  "/admin/settings":           { name: "API Settings",     gradient: "linear-gradient(145deg,#636366,#3a3a3c)",  shadow: "#3a3a3c", icon: Settings         },
  "/admin/private-account":    { name: "Private Account",  gradient: "linear-gradient(145deg,#ff453a,#700000)",  shadow: "#700000", icon: Lock             },
  "/admin/card-generator":     { name: "Card Generator",   gradient: "linear-gradient(145deg,#ff9f0a,#8a5000)",  shadow: "#8a5000", icon: CreditCard       },
};

function getRouteMeta(location: string): RouteMeta {
  if (ROUTE_META[location]) return ROUTE_META[location];
  for (const [key, meta] of Object.entries(ROUTE_META)) {
    if (location.startsWith(key)) return meta;
  }
  return { name: "Panel", gradient: "linear-gradient(145deg,#0a84ff,#004fc4)", shadow: "#004fc4", icon: LayoutDashboard };
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
  const timeStr     = time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ position: "relative" }}>

      {/* ── Wallpaper (same as desktop but dimmed) ── */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <div className="absolute inset-0" style={{
          background: "linear-gradient(160deg, #080820 0%, #0c0e38 25%, #100628 50%, #080d30 75%, #050510 100%)",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 70% 50% at 20% 10%, rgba(100,40,200,0.30) 0%, transparent 70%)",
          animation: "aurora1 18s ease-in-out infinite",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 55% 65% at 80% 90%, rgba(30,70,180,0.25) 0%, transparent 65%)",
          animation: "aurora2 24s ease-in-out infinite",
        }} />
        <div className="absolute inset-0" style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.35) 1px, transparent 1px)",
          backgroundSize: "100px 100px",
        }} />
      </div>

      {/* ── iOS Navigation Bar ── */}
      <header
        className="relative flex items-center px-4 shrink-0"
        style={{
          zIndex: 20, height: 52,
          background: "rgba(10,10,28,0.72)",
          backdropFilter: "blur(36px) saturate(180%)",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        {/* Back button — iOS chevron style */}
        <button
          onClick={() => { sounds.navigate(); navigate("/admin"); }}
          className="flex items-center gap-0.5 outline-none mr-3"
          style={{
            color: BLUE, fontFamily: SF, fontSize: 16, fontWeight: 400,
            transition: "opacity 0.12s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.6"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          data-testid="button-home"
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={2.5} />
          <span style={{ marginLeft: -2 }}>Desktop</span>
        </button>

        {/* Center: App icon + name (iOS nav center) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
          <div
            className="relative w-[26px] h-[26px] flex items-center justify-center overflow-hidden shrink-0"
            style={{
              borderRadius: 6,
              background: meta.gradient,
              boxShadow: `0 2px 8px ${meta.shadow}60`,
            }}
          >
            <div className="absolute inset-x-0 top-0 h-1/2" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, transparent 100%)", borderRadius: "6px 6px 0 0" }} />
            <meta.icon className="w-3.5 h-3.5 relative z-10" style={{ color: "rgba(255,255,255,0.95)" }} />
          </div>
          <span style={{ fontFamily: SF, fontSize: 17, fontWeight: 600, color: "rgba(255,255,255,0.92)", letterSpacing: -0.3 }}>
            {meta.name}
          </span>
        </div>

        <div className="flex-1" />

        {/* Right: time + user + logout */}
        <div className="flex items-center gap-3">
          <span style={{ fontFamily: SF, fontSize: 13, color: "rgba(255,255,255,0.35)", fontWeight: 400 }}>
            {timeStr}
          </span>

          <div className="flex items-center gap-1.5">
            <div
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${BLUE}40, ${PURPLE}30)`, border: `1px solid ${BLUE}50` }}
            >
              <User className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.85)" }} />
            </div>
            <span style={{ fontFamily: SF, fontSize: 13, color: "rgba(255,255,255,0.42)", fontWeight: 400 }}>
              {user.username}
            </span>
          </div>

          <button
            onClick={() => { sounds.logout(); onLogout(); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full outline-none"
            style={{
              background: "rgba(255,68,58,0.12)", border: "1px solid rgba(255,68,58,0.25)",
              color: "rgba(255,68,58,0.70)", fontFamily: SF, fontSize: 12, fontWeight: 500,
              transition: "all 0.12s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,68,58,0.22)"; e.currentTarget.style.color = RED; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,68,58,0.12)"; e.currentTarget.style.color = "rgba(255,68,58,0.70)"; }}
            data-testid="button-logout"
          >
            <LogOut className="w-3 h-3" />
            Sign Out
          </button>
        </div>
      </header>

      {/* ── Content ── */}
      {isFullscreen ? (
        <main className="relative z-10 flex-1 overflow-hidden flex flex-col">
          {children}
        </main>
      ) : (
        <main
          className="relative z-10 flex-1 overflow-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.10) transparent" }}
        >
          <div className="p-6 max-w-[1400px] mx-auto">
            {children}
          </div>
        </main>
      )}

      <style>{`
        @keyframes aurora1 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(60px,-40px) scale(1.1); }
          66%      { transform: translate(-30px,50px) scale(0.9); }
        }
        @keyframes aurora2 {
          0%,100% { transform: translate(0,0) scale(1); }
          40%      { transform: translate(-50px,30px) scale(1.08); }
          70%      { transform: translate(40px,-40px) scale(0.92); }
        }
      `}</style>
    </div>
  );
}

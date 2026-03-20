import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Globe, Shield, Zap, Server, Ticket, Lock, Mail, ArrowUpRight, Radio, CreditCard, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import la28Logo from "@assets/{D0DAE68E-FBCF-411B-8803-46B146A5A0FC}_1772412089243.png";
import ticketmasterLogo from "@assets/{9D4CF467-7C69-4EAC-A803-17352A19FCD5}_1772418022222.png";
import uefaLogo from "@assets/UEFA_Champions_League.svg_1772418059822.png";
import replitLogo from "@assets/Replit_Logo_1773851974177.jpg";
import lovableLogo from "@assets/HoAUvKDcTAK6IrppvKMCpHzdIo4_1773933589988.avif";

type Platform = {
  id: string;
  name: string;
  description: string;
  href: string | null;
  accentColor: string;
  accentGlow: string;
  gradientFrom: string;
  gradientTo: string;
  badge: string;
  badgeActive: boolean;
  stats: { label: string; icon: React.ComponentType<{ className?: string }> }[];
  comingSoon?: boolean;
};

const platforms: Platform[] = [
  {
    id: "la28",
    name: "LA28 Olympic",
    description: "Automated LA28 ID creation with draw registration and OIDC linking",
    href: "/admin/la28-create",
    accentColor: "#ff3366",
    accentGlow: "rgba(255,51,102,0.3)",
    gradientFrom: "rgba(220,38,38,0.18)",
    gradientTo: "rgba(136,19,55,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Verify", icon: Shield }, { label: "Bulk Ops", icon: Zap }, { label: "US Region", icon: Globe }],
  },
  {
    id: "ticketmaster",
    name: "Ticket Master",
    description: "Automated Ticketmaster account creation with email verification",
    href: "/admin/tm-create",
    accentColor: "#38bdf8",
    accentGlow: "rgba(56,189,248,0.25)",
    gradientFrom: "rgba(14,165,233,0.18)",
    gradientTo: "rgba(30,64,175,0.06)",
    badge: "PROXY REQ",
    badgeActive: false,
    stats: [{ label: "Auto Verify", icon: Shield }, { label: "Bulk Ops", icon: Zap }, { label: "Global", icon: Globe }],
  },
  {
    id: "uefa",
    name: "UEFA Account",
    description: "Create verified UEFA accounts for European football ticket access",
    href: "/admin/uefa-create",
    accentColor: "#00ff41",
    accentGlow: "rgba(0,255,65,0.25)",
    gradientFrom: "rgba(16,185,129,0.18)",
    gradientTo: "rgba(6,78,59,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Verify", icon: Shield }, { label: "Bulk Ops", icon: Zap }, { label: "EU Region", icon: Globe }],
  },
  {
    id: "brunomars",
    name: "TM — Bruno Mars",
    description: "Automated presale signup for Bruno Mars tour via Ticketmaster CA",
    href: "/admin/brunomars-create",
    accentColor: "#c084fc",
    accentGlow: "rgba(192,132,252,0.28)",
    gradientFrom: "rgba(147,51,234,0.18)",
    gradientTo: "rgba(112,26,117,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Signup", icon: Shield }, { label: "Bulk Ops", icon: Zap }, { label: "Presale", icon: Ticket }],
  },
  {
    id: "outlook-create",
    name: "Create Outlook",
    description: "Auto-create Microsoft accounts with captcha solving & batch support",
    href: "/admin/outlook-create",
    accentColor: "#60a5fa",
    accentGlow: "rgba(96,165,250,0.25)",
    gradientFrom: "rgba(59,130,246,0.18)",
    gradientTo: "rgba(30,58,138,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "Captcha", icon: Zap }, { label: "Batch 1–10", icon: Globe }],
  },
  {
    id: "zenrows",
    name: "Proxy Register",
    description: "Auto-register proxy accounts via Outlook email & extract API keys",
    href: "/admin/zenrows-register",
    accentColor: "#34d399",
    accentGlow: "rgba(52,211,153,0.25)",
    gradientFrom: "rgba(16,185,129,0.16)",
    gradientTo: "rgba(6,78,59,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Register", icon: Shield }, { label: "Email Verify", icon: Mail }, { label: "API Key", icon: Zap }],
  },
  {
    id: "replit",
    name: "Create Replit Account",
    description: "Auto-create Replit accounts via Outlook OWA verification & onboarding",
    href: "/admin/replit-create",
    accentColor: "#a78bfa",
    accentGlow: "rgba(167,139,250,0.28)",
    gradientFrom: "rgba(124,58,237,0.18)",
    gradientTo: "rgba(49,10,101,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "OWA Verify", icon: Mail }, { label: "Onboarding", icon: Zap }],
  },
  {
    id: "lovable",
    name: "Create Lovable Account",
    description: "Auto-create Lovable.dev accounts via magic-link email verification",
    href: "/admin/lovable-create",
    accentColor: "#ec4899",
    accentGlow: "rgba(236,72,153,0.28)",
    gradientFrom: "rgba(219,39,119,0.18)",
    gradientTo: "rgba(131,24,67,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "Magic Link", icon: Mail }, { label: "OWA Verify", icon: Zap }],
  },
  {
    id: "adobe",
    name: "Create Adobe Account",
    description: "Auto-create Adobe accounts with email verification via Outlook OWA",
    href: "/admin/adobe-create",
    accentColor: "#ff4500",
    accentGlow: "rgba(255,69,0,0.28)",
    gradientFrom: "rgba(255,69,0,0.18)",
    gradientTo: "rgba(139,27,0,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "OWA Verify", icon: Mail }, { label: "6-Digit Code", icon: Zap }],
  },
  {
    id: "card-generator",
    name: "Card Generator",
    description: "Generate test card numbers with BIN lookup, network selection & bulk export",
    href: "/admin/card-generator",
    accentColor: "#fbbf24",
    accentGlow: "rgba(251,191,36,0.28)",
    gradientFrom: "rgba(245,158,11,0.18)",
    gradientTo: "rgba(120,53,15,0.06)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "BIN Lookup", icon: Shield }, { label: "Bulk Export", icon: Zap }, { label: "Multi-Network", icon: CreditCard }],
  },
];

function PlatformIcon({ id, accentColor }: { id: string; accentColor: string }) {
  const base = "w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden shrink-0";
  if (id === "la28") return (
    <div className={`${base} bg-white/90`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <img src={la28Logo} alt="LA28" className="w-7 h-7 object-contain" />
    </div>
  );
  if (id === "ticketmaster") return (
    <div className={`${base} bg-white`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <img src={ticketmasterLogo} alt="TM" className="w-full h-full object-cover" />
    </div>
  );
  if (id === "uefa") return (
    <div className={`${base} bg-white p-1`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <img src={uefaLogo} alt="UEFA" className="w-full h-full object-contain" />
    </div>
  );
  if (id === "brunomars") return (
    <div className={`${base} bg-gradient-to-br from-purple-500 to-fuchsia-600`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <span className="text-base font-black text-white font-mono">BM</span>
    </div>
  );
  if (id === "outlook-create") return (
    <div className={`${base} bg-gradient-to-br from-blue-500 to-indigo-600`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <Mail className="w-5 h-5 text-white" />
    </div>
  );
  if (id === "zenrows") return (
    <div className={`${base} bg-gradient-to-br from-emerald-500 to-teal-700`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <Globe className="w-5 h-5 text-white" />
    </div>
  );
  if (id === "replit") return (
    <div className={`${base} bg-white p-1`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <img src={replitLogo} alt="Replit" className="w-full h-full object-contain" />
    </div>
  );
  if (id === "lovable") return (
    <div className={`${base} bg-black overflow-hidden`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <img src={lovableLogo} alt="Lovable" className="w-full h-full object-cover object-center scale-110" />
    </div>
  );
  if (id === "adobe") return (
    <div className={`${base} bg-gradient-to-br from-red-600 to-orange-700`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M13.966 22.624l-1.69-4.281H8.122l4.294-8.835 4.808 13.116zM3 6.834l3.682 10.093H1.212zm17.786 0L18 16.927h5.47z"/></svg>
    </div>
  );
  if (id === "card-generator") return (
    <div className={`${base} bg-gradient-to-br from-amber-400 to-orange-600`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <CreditCard className="w-5 h-5 text-white" />
    </div>
  );
  return null;
}

export default function CreateServer() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [userRole, setUserRole] = useState<string>("");
  const [allowedServices, setAllowedServices] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [uptime, setUptime] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.json())
      .then(data => { setUserRole(data.role || ""); setAllowedServices(data.allowedServices || []); setLoaded(true); })
      .catch(() => setLoaded(true));
    const t = setInterval(() => setUptime(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  function handleClick(platform: Platform) {
    if (platform.comingSoon || !platform.href) {
      sounds.error();
      toast({ title: "Offline", description: `${platform.name} module is not available yet.` });
      return;
    }
    sounds.navigate();
    navigate(platform.href);
  }

  const isLocked = (platformId: string) => {
    if (!loaded || userRole === "superadmin") return false;
    return !allowedServices.includes(platformId);
  };

  const visible = platforms.filter((p) => !isLocked(p.id));
  const activeCount = visible.filter((p) => p.badgeActive).length;
  const fmtUptime = `${String(Math.floor(uptime / 3600)).padStart(2,"0")}:${String(Math.floor((uptime % 3600) / 60)).padStart(2,"0")}:${String(uptime % 60).padStart(2,"0")}`;

  return (
    <div className="space-y-4 animate-float-up">

      {/* ── GLASS HEADER BANNER ── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.045)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        {/* Subtle top shimmer */}
        <div className="absolute top-0 inset-x-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)" }} />

        <div className="relative px-6 py-5 flex items-center justify-between gap-4">
          {/* Left: branding */}
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(48,209,88,0.2) 0%, rgba(48,209,88,0.07) 100%)",
                  border: "1px solid rgba(48,209,88,0.28)",
                  boxShadow: "0 4px 16px rgba(48,209,88,0.15), inset 0 1px 0 rgba(255,255,255,0.1)",
                }}
              >
                <Server className="w-5.5 h-5.5" style={{ color: "#30d158" }} />
              </div>
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-[#08080f]" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h1
                  className="text-[17px] font-semibold tracking-tight text-white"
                  style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif" }}
                  data-testid="text-create-server-title"
                >
                  Create Account
                </h1>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-md font-medium"
                  style={{ color: "rgba(48,209,88,0.85)", background: "rgba(48,209,88,0.12)", border: "1px solid rgba(48,209,88,0.22)", fontFamily: "SF Mono, JetBrains Mono, monospace" }}
                >
                  v2.4.1
                </span>
              </div>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}>
                Select an automation module to initialize
              </p>
            </div>
          </div>

          {/* Right: stats */}
          <div className="flex items-center gap-4 shrink-0">
            <div
              className="flex flex-col items-end gap-1.5 px-4 py-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3" style={{ color: "rgba(48,209,88,0.7)" }} />
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>Uptime</span>
                <span className="text-[10px] font-mono font-bold" style={{ color: "#30d158" }}>{fmtUptime}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3" style={{ color: "rgba(48,209,88,0.5)" }} />
                <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.38)", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}>
                  <span className="font-semibold" style={{ color: "#30d158" }}>{activeCount}</span> / {visible.length} active
                </span>
              </div>
            </div>
            <div className="flex items-end gap-0.5 h-8">
              {[0.4,0.7,0.5,0.9,0.6,0.8,1.0,0.75,0.55,0.85].map((h, i) => (
                <div key={i} className="w-1 rounded-sm" style={{ height: `${h * 100}%`, background: `rgba(48,209,88,${0.18 + h * 0.42})` }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── MODULE GRID ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {visible.map((platform) => {
          const isHovered = hoveredId === platform.id;
          return (
            <div
              key={platform.id}
              onClick={() => handleClick(platform)}
              onMouseEnter={() => { setHoveredId(platform.id); sounds.hover(); }}
              onMouseLeave={() => setHoveredId(null)}
              className="group relative cursor-pointer select-none"
              data-testid={`card-platform-${platform.id}`}
              style={{ transition: "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)" }}
            >
              {/* Hover ambient glow */}
              <div
                className="absolute -inset-1 rounded-3xl pointer-events-none transition-opacity duration-300"
                style={{
                  background: `radial-gradient(ellipse at 50% 100%, ${platform.accentGlow}, transparent 70%)`,
                  opacity: isHovered ? 0.7 : 0,
                  filter: "blur(16px)",
                }}
              />

              <div
                className="relative rounded-2xl overflow-hidden flex flex-col"
                style={{
                  background: isHovered
                    ? `linear-gradient(160deg, ${platform.gradientFrom}, rgba(255,255,255,0.05))`
                    : "rgba(255,255,255,0.05)",
                  backdropFilter: "blur(20px) saturate(160%)",
                  WebkitBackdropFilter: "blur(20px) saturate(160%)",
                  border: `1px solid ${isHovered ? platform.accentColor + "40" : "rgba(255,255,255,0.09)"}`,
                  boxShadow: isHovered
                    ? `0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px ${platform.accentColor}18, inset 0 1px 0 ${platform.accentColor}28`
                    : "0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
                  transform: isHovered ? "translateY(-5px) scale(1.018)" : "translateY(0) scale(1)",
                  transition: "all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
                }}
              >
                {/* Top accent line */}
                <div
                  className="absolute top-0 inset-x-0 h-px pointer-events-none"
                  style={{
                    background: `linear-gradient(90deg, transparent 10%, ${platform.accentColor}${isHovered ? "80" : "28"} 50%, transparent 90%)`,
                    transition: "opacity 0.25s",
                  }}
                />

                {/* Corner accent glow */}
                <div
                  className="absolute top-0 right-0 w-24 h-24 pointer-events-none overflow-hidden rounded-2xl"
                  style={{ opacity: isHovered ? 0.18 : 0.05, transition: "opacity 0.25s" }}
                >
                  <div className="absolute -top-8 -right-8 w-20 h-20 rounded-full" style={{ background: platform.accentColor, filter: "blur(20px)" }} />
                </div>

                <div className="relative p-4 flex flex-col gap-3">
                  {/* Icon + badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div style={{ filter: isHovered ? `drop-shadow(0 4px 12px ${platform.accentColor}50)` : "none", transition: "filter 0.25s" }}>
                      <PlatformIcon id={platform.id} accentColor={platform.accentColor} />
                    </div>
                    <div
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        background: platform.badgeActive ? "rgba(48,209,88,0.12)" : "rgba(255,159,10,0.12)",
                        border: `1px solid ${platform.badgeActive ? "rgba(48,209,88,0.28)" : "rgba(255,159,10,0.28)"}`,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: platform.badgeActive ? "#30d158" : "#ff9f0a" }}
                      />
                      <span
                        className="text-[8px] font-medium uppercase tracking-wide"
                        style={{ color: platform.badgeActive ? "rgba(48,209,88,0.9)" : "rgba(255,159,10,0.9)", fontFamily: "SF Mono, JetBrains Mono, monospace" }}
                      >
                        {platform.badge}
                      </span>
                    </div>
                  </div>

                  {/* Name + description */}
                  <div>
                    <h3
                      className="text-[13px] font-semibold leading-tight transition-colors duration-200"
                      style={{
                        color: isHovered ? platform.accentColor : "rgba(255,255,255,0.92)",
                        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
                      }}
                    >
                      {platform.name}
                    </h3>
                    <p
                      className="text-[10px] leading-relaxed mt-1"
                      style={{
                        color: "rgba(255,255,255,0.42)",
                        fontFamily: "-apple-system, BlinkMacSystemFont, system-ui",
                      }}
                    >
                      {platform.description}
                    </p>
                  </div>

                  {/* Footer */}
                  <div
                    className="flex items-center justify-between pt-2.5"
                    style={{ borderTop: `1px solid ${isHovered ? platform.accentColor + "18" : "rgba(255,255,255,0.06)"}` }}
                  >
                    <div className="flex gap-2 flex-wrap">
                      {platform.stats.map((stat) => (
                        <div
                          key={stat.label}
                          className="flex items-center gap-1 text-[9px] transition-colors duration-200"
                          style={{
                            color: "rgba(255,255,255,0.35)",
                            fontFamily: "-apple-system, BlinkMacSystemFont, system-ui",
                          }}
                        >
                          <stat.icon className="w-2.5 h-2.5" />
                          <span>{stat.label}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200"
                      style={{
                        background: isHovered ? `${platform.accentColor}22` : "rgba(255,255,255,0.05)",
                        border: `1px solid ${isHovered ? platform.accentColor + "55" : "rgba(255,255,255,0.09)"}`,
                      }}
                    >
                      {platform.comingSoon
                        ? <Lock className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.25)" }} />
                        : <ArrowUpRight
                            className="w-3 h-3"
                            style={{
                              color: isHovered ? platform.accentColor : "rgba(255,255,255,0.3)",
                              transform: isHovered ? "translate(1px,-1px)" : "none",
                              transition: "all 0.2s",
                            }}
                          />
                      }
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── BOTTOM STATUS STRIP ── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 rounded-xl"
        style={{
          background: "rgba(255,255,255,0.035)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="flex items-center gap-5">
          {[
            { label: "System", val: "Nominal", color: "#30d158" },
            { label: "Captcha", val: "CapSolver", color: "#0a84ff" },
            { label: "Proxy", val: "ZenRows", color: "#bf5af2" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.28)", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}>{s.label}</span>
              <span className="text-[9px] font-medium" style={{ color: s.color, fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}>{s.val}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.22)", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui" }}>Session</span>
          <span className="text-[9px] font-mono font-bold" style={{ color: "#30d158" }}>{fmtUptime}</span>
        </div>
      </div>

    </div>
  );
}

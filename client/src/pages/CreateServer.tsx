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

      {/* ── TERMINAL HEADER BANNER ── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(0,0,0,0.97) 0%, rgba(5,5,14,0.99) 100%)",
          border: "1px solid rgba(0,255,65,0.14)",
          boxShadow: "0 0 60px rgba(0,255,65,0.03) inset, 0 4px 32px rgba(0,0,0,0.6)",
        }}
      >
        {/* scanline */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,65,0.012) 2px,rgba(0,255,65,0.012) 3px)" }} />
        {/* bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(90deg,transparent,rgba(0,255,65,0.2),rgba(0,191,255,0.2),rgba(236,72,153,0.2),transparent)" }} />

        <div className="relative px-6 py-5 flex items-center justify-between gap-4">
          {/* Left: branding */}
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(0,255,65,0.05)", border: "1px solid rgba(0,255,65,0.2)", boxShadow: "0 0 24px rgba(0,255,65,0.12)" }}
              >
                <Server className="w-6 h-6 text-emerald-400" />
              </div>
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: "0 0 8px #00ff41" }} />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-0.5">
                <h1 className="text-lg font-black font-mono tracking-tight" data-testid="text-create-server-title"
                  style={{ background: "linear-gradient(90deg,#00ff41 0%,#00bfff 55%,#ec4899 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  CREATE_ACCOUNT
                </h1>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border" style={{ color: "#00ff41", borderColor: "rgba(0,255,65,0.25)", background: "rgba(0,255,65,0.05)" }}>
                  v2.4.1
                </span>
              </div>
              <p className="text-[10px] font-mono" style={{ color: "rgba(0,255,65,0.35)" }}>
                &#9632; module registry &#9632; select automation target to initialize
              </p>
            </div>
          </div>

          {/* Right: live stats row */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] font-mono text-emerald-400/70">UPTIME</span>
                <span className="text-[10px] font-mono font-bold text-emerald-400">{fmtUptime}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span className="text-[10px] font-mono" style={{ color: "rgba(0,255,65,0.5)" }}>
                  <span className="text-emerald-400 font-bold">{activeCount}</span>/{visible.length} active
                </span>
              </div>
            </div>
            {/* mini bar chart */}
            <div className="flex items-end gap-0.5 h-8">
              {[0.4,0.7,0.5,0.9,0.6,0.8,1.0,0.75,0.55,0.85].map((h, i) => (
                <div key={i} className="w-1 rounded-sm" style={{ height: `${h * 100}%`, background: `rgba(0,255,65,${0.15 + h * 0.4})` }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── MODULE GRID ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {visible.map((platform, idx) => {
          const isHovered = hoveredId === platform.id;
          const cardNum = String(idx + 1).padStart(2, "0");
          return (
            <div
              key={platform.id}
              onClick={() => handleClick(platform)}
              onMouseEnter={() => { setHoveredId(platform.id); sounds.hover(); }}
              onMouseLeave={() => setHoveredId(null)}
              className="group relative cursor-pointer select-none"
              data-testid={`card-platform-${platform.id}`}
            >
              {/* Ambient glow blob */}
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-400"
                style={{
                  background: `radial-gradient(ellipse at 50% 0%, ${platform.accentGlow}, transparent 65%)`,
                  opacity: isHovered ? 1 : 0,
                  transform: "scaleY(1.2) translateY(-8px)",
                  filter: "blur(12px)",
                }}
              />

              <div
                className="relative rounded-2xl overflow-hidden transition-all duration-250 flex flex-col"
                style={{
                  background: isHovered
                    ? `linear-gradient(160deg, ${platform.gradientFrom}, ${platform.gradientTo}, rgba(6,6,10,0.98))`
                    : "linear-gradient(160deg, rgba(255,255,255,0.028), rgba(0,0,0,0.65))",
                  border: `1px solid ${isHovered ? platform.accentColor + "50" : "rgba(255,255,255,0.07)"}`,
                  boxShadow: isHovered
                    ? `0 0 0 1px ${platform.accentColor}15, 0 16px 48px ${platform.accentGlow}, inset 0 1px 0 ${platform.accentColor}30`
                    : "0 2px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
                  transform: isHovered ? "translateY(-4px) scale(1.015)" : "translateY(0) scale(1)",
                }}
              >
                {/* Top shimmer line */}
                <div className="absolute top-0 inset-x-0 h-px pointer-events-none transition-opacity duration-300"
                  style={{ background: `linear-gradient(90deg,transparent 5%,${platform.accentColor}90 50%,transparent 95%)`, opacity: isHovered ? 1 : 0.15 }} />

                {/* Scanlines */}
                <div className="absolute inset-0 pointer-events-none rounded-2xl"
                  style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.007) 3px,rgba(255,255,255,0.007) 4px)" }} />

                {/* Corner glow */}
                <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none overflow-hidden rounded-2xl"
                  style={{ opacity: isHovered ? 0.22 : 0.07 }}>
                  <div className="absolute -top-10 -right-10 w-20 h-20 rounded-full"
                    style={{ background: platform.accentColor, filter: "blur(18px)" }} />
                </div>

                {/* Card index — top-left corner bracket */}
                <div className="absolute top-2.5 left-3 font-mono text-[9px] font-bold pointer-events-none transition-all duration-200"
                  style={{ color: isHovered ? platform.accentColor + "90" : "rgba(255,255,255,0.1)" }}>
                  [{cardNum}]
                </div>

                <div className="relative p-3.5 pt-4 flex flex-col gap-2.5">
                  {/* Icon row + status badge */}
                  <div className="flex items-start justify-between gap-1.5">
                    <div style={{ filter: isHovered ? `drop-shadow(0 0 8px ${platform.accentColor}60)` : "none", transition: "filter 0.2s" }}>
                      <PlatformIcon id={platform.id} accentColor={platform.accentColor} />
                    </div>
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md shrink-0"
                      style={{
                        background: platform.badgeActive ? "rgba(0,255,65,0.07)" : "rgba(251,191,36,0.07)",
                        border: `1px solid ${platform.badgeActive ? "rgba(0,255,65,0.2)" : "rgba(251,191,36,0.2)"}`,
                        boxShadow: isHovered ? (platform.badgeActive ? "0 0 8px rgba(0,255,65,0.15)" : "0 0 8px rgba(251,191,36,0.15)") : "none",
                      }}>
                      <span className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: platform.badgeActive ? "#00ff41" : "#fbbf24",
                          boxShadow: platform.badgeActive ? "0 0 6px rgba(0,255,65,0.9)" : "0 0 6px rgba(251,191,36,0.8)",
                          animation: platform.badgeActive ? "pulse 2s infinite" : "none",
                        }} />
                      <span className="text-[8px] font-mono uppercase tracking-widest"
                        style={{ color: platform.badgeActive ? "rgba(0,255,65,0.8)" : "rgba(251,191,36,0.8)" }}>
                        {platform.badge}
                      </span>
                    </div>
                  </div>

                  {/* Name + description */}
                  <div>
                    <h3 className="text-[13px] font-bold tracking-tight font-mono leading-tight transition-all duration-200"
                      style={{ color: isHovered ? platform.accentColor : "#f0f0f2", textShadow: isHovered ? `0 0 20px ${platform.accentColor}70` : "none" }}>
                      {platform.name}
                    </h3>
                    <p className="text-[10px] leading-relaxed font-mono mt-1"
                      style={{ color: isHovered ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.25)" }}>
                      {platform.description}
                    </p>
                  </div>

                  {/* Footer: stats + arrow */}
                  <div className="flex items-center justify-between pt-2.5"
                    style={{ borderTop: `1px solid ${isHovered ? platform.accentColor + "18" : "rgba(255,255,255,0.05)"}` }}>
                    <div className="flex gap-2 flex-wrap">
                      {platform.stats.map((stat) => (
                        <div key={stat.label} className="flex items-center gap-1 text-[8.5px] font-mono transition-colors duration-200"
                          style={{ color: isHovered ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.18)" }}>
                          <stat.icon className="w-2 h-2" />
                          <span>{stat.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200"
                      style={{
                        background: isHovered ? `${platform.accentColor}25` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isHovered ? platform.accentColor + "65" : "rgba(255,255,255,0.08)"}`,
                        boxShadow: isHovered ? `0 0 12px ${platform.accentColor}35` : "none",
                      }}>
                      {platform.comingSoon
                        ? <Lock className="w-2.5 h-2.5 text-zinc-600" />
                        : <ArrowUpRight className="w-3 h-3 transition-all duration-200"
                            style={{
                              color: isHovered ? platform.accentColor : "rgba(255,255,255,0.2)",
                              transform: isHovered ? "translate(1px,-1px)" : "none",
                              filter: isHovered ? `drop-shadow(0 0 5px ${platform.accentColor})` : "none",
                            }} />
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
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl"
        style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-4">
          {[
            { label: "SYS", val: "NOMINAL", color: "#00ff41" },
            { label: "CAPTCHA", val: "CAPSOLVER", color: "#00bfff" },
            { label: "PROXY", val: "ZENROWS", color: "#a855f7" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="text-[8px] font-mono tracking-widest" style={{ color: "rgba(255,255,255,0.2)" }}>{s.label}</span>
              <span className="text-[8px] font-mono font-bold" style={{ color: s.color }}>{s.val}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.15)" }}>SESSION</span>
          <span className="text-[8px] font-mono font-bold text-emerald-400">{fmtUptime}</span>
        </div>
      </div>

    </div>
  );
}

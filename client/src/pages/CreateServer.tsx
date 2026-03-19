import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Globe, Shield, Zap, Server, Ticket, Lock, Mail, ArrowUpRight, Radio, CreditCard, Heart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sounds } from "@/lib/sounds";
import la28Logo from "@assets/{D0DAE68E-FBCF-411B-8803-46B146A5A0FC}_1772412089243.png";
import ticketmasterLogo from "@assets/{9D4CF467-7C69-4EAC-A803-17352A19FCD5}_1772418022222.png";
import uefaLogo from "@assets/UEFA_Champions_League.svg_1772418059822.png";
import replitLogo from "@assets/Replit_Logo_1773851974177.jpg";

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
    name: "Create Replit",
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
    name: "Create Lovable",
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
    <div className={`${base} bg-gradient-to-br from-pink-500 to-rose-600`} style={{ boxShadow: `0 0 18px ${accentColor}55` }}>
      <Heart className="w-5 h-5 text-white" />
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

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.json())
      .then(data => { setUserRole(data.role || ""); setAllowedServices(data.allowedServices || []); setLoaded(true); })
      .catch(() => setLoaded(true));
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

  return (
    <div className="space-y-5 animate-float-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-emerald-400/50" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono" data-testid="text-create-server-title">
              Create<span className="text-emerald-400">_</span>Account
            </h1>
          </div>
          <p className="text-emerald-400/30 mt-0.5 text-[11px] font-mono pl-8">Select module to initialize</p>
        </div>
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: "rgba(0,255,65,0.04)", border: "1px solid rgba(0,255,65,0.08)" }}
        >
          <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-400/50">{visible.length} modules online</span>
        </div>
      </div>

      {/* 4-column grid */}
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
            >
              {/* Ambient glow blob behind card */}
              <div
                className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-400"
                style={{
                  background: `radial-gradient(ellipse at 50% 0%, ${platform.accentGlow}, transparent 65%)`,
                  opacity: isHovered ? 1 : 0,
                  transform: "scaleY(1.15) translateY(-6px)",
                  filter: "blur(10px)",
                }}
              />

              <div
                className="relative rounded-2xl overflow-hidden transition-all duration-250 flex flex-col"
                style={{
                  background: isHovered
                    ? `linear-gradient(160deg, ${platform.gradientFrom}, ${platform.gradientTo}, rgba(8,8,12,0.98))`
                    : "linear-gradient(160deg, rgba(255,255,255,0.035), rgba(0,0,0,0.6))",
                  border: `1px solid ${isHovered ? platform.accentColor + "45" : "rgba(255,255,255,0.065)"}`,
                  boxShadow: isHovered
                    ? `0 0 0 1px ${platform.accentColor}18, 0 12px 40px ${platform.accentGlow}, inset 0 1px 0 ${platform.accentColor}25`
                    : "0 2px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
                  transform: isHovered ? "translateY(-3px) scale(1.01)" : "translateY(0) scale(1)",
                }}
              >
                {/* Animated top shimmer */}
                <div
                  className="absolute top-0 inset-x-0 h-px pointer-events-none transition-opacity duration-300"
                  style={{
                    background: `linear-gradient(90deg, transparent 5%, ${platform.accentColor}80 50%, transparent 95%)`,
                    opacity: isHovered ? 1 : 0.2,
                  }}
                />

                {/* Scanline texture overlay */}
                <div
                  className="absolute inset-0 pointer-events-none rounded-2xl"
                  style={{
                    backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.008) 3px, rgba(255,255,255,0.008) 4px)",
                    opacity: isHovered ? 1 : 0.5,
                  }}
                />

                {/* Corner accent */}
                <div
                  className="absolute top-0 right-0 w-16 h-16 pointer-events-none rounded-2xl overflow-hidden"
                  style={{ opacity: isHovered ? 0.18 : 0.06 }}
                >
                  <div
                    className="absolute -top-8 -right-8 w-16 h-16 rounded-full"
                    style={{ background: platform.accentColor, filter: "blur(16px)" }}
                  />
                </div>

                <div className="relative p-3.5 flex flex-col gap-2.5">
                  {/* Header: icon + badge */}
                  <div className="flex items-start justify-between gap-1.5">
                    <PlatformIcon id={platform.id} accentColor={platform.accentColor} />
                    <div
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md shrink-0"
                      style={{
                        background: platform.badgeActive ? "rgba(0,255,65,0.07)" : "rgba(251,191,36,0.07)",
                        border: `1px solid ${platform.badgeActive ? "rgba(0,255,65,0.18)" : "rgba(251,191,36,0.18)"}`,
                      }}
                    >
                      <span
                        className="w-1 h-1 rounded-full"
                        style={{
                          background: platform.badgeActive ? "#00ff41" : "#fbbf24",
                          boxShadow: platform.badgeActive ? "0 0 5px rgba(0,255,65,0.8)" : "0 0 5px rgba(251,191,36,0.7)",
                        }}
                      />
                      <span
                        className="text-[8px] font-mono uppercase tracking-widest"
                        style={{ color: platform.badgeActive ? "rgba(0,255,65,0.75)" : "rgba(251,191,36,0.75)" }}
                      >
                        {platform.badge}
                      </span>
                    </div>
                  </div>

                  {/* Name */}
                  <div>
                    <h3
                      className="text-[13px] font-bold tracking-tight font-mono leading-tight transition-colors duration-200"
                      style={{ color: isHovered ? platform.accentColor : "#f0f0f2", textShadow: isHovered ? `0 0 16px ${platform.accentColor}80` : "none" }}
                    >
                      {platform.name}
                    </h3>
                    <p
                      className="text-[10px] leading-relaxed font-mono mt-1"
                      style={{ color: isHovered ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.27)" }}
                    >
                      {platform.description}
                    </p>
                  </div>

                  {/* Footer: stats + arrow */}
                  <div
                    className="flex items-center justify-between pt-2.5"
                    style={{ borderTop: `1px solid ${isHovered ? platform.accentColor + "15" : "rgba(255,255,255,0.05)"}` }}
                  >
                    <div className="flex gap-2 flex-wrap">
                      {platform.stats.map((stat) => (
                        <div
                          key={stat.label}
                          className="flex items-center gap-1 text-[8.5px] font-mono"
                          style={{ color: isHovered ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)" }}
                        >
                          <stat.icon className="w-2 h-2" />
                          <span>{stat.label}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200"
                      style={{
                        background: isHovered ? `${platform.accentColor}22` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isHovered ? platform.accentColor + "60" : "rgba(255,255,255,0.07)"}`,
                        boxShadow: isHovered ? `0 0 10px ${platform.accentColor}30` : "none",
                      }}
                    >
                      {platform.comingSoon ? (
                        <Lock className="w-2.5 h-2.5 text-zinc-600" />
                      ) : (
                        <ArrowUpRight
                          className="w-3 h-3 transition-all duration-200"
                          style={{
                            color: isHovered ? platform.accentColor : "rgba(255,255,255,0.2)",
                            transform: isHovered ? "translate(1px,-1px)" : "none",
                            filter: isHovered ? `drop-shadow(0 0 4px ${platform.accentColor})` : "none",
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

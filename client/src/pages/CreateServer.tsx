import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Globe, Shield, Zap, Server, Ticket, Lock, Mail, ArrowUpRight, Radio } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
    accentGlow: "rgba(255,51,102,0.25)",
    gradientFrom: "rgba(220,38,38,0.15)",
    gradientTo: "rgba(136,19,55,0.08)",
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
    accentGlow: "rgba(56,189,248,0.2)",
    gradientFrom: "rgba(14,165,233,0.15)",
    gradientTo: "rgba(30,64,175,0.08)",
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
    accentGlow: "rgba(0,255,65,0.2)",
    gradientFrom: "rgba(16,185,129,0.15)",
    gradientTo: "rgba(6,78,59,0.08)",
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
    accentGlow: "rgba(192,132,252,0.22)",
    gradientFrom: "rgba(147,51,234,0.15)",
    gradientTo: "rgba(112,26,117,0.08)",
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
    accentGlow: "rgba(96,165,250,0.2)",
    gradientFrom: "rgba(59,130,246,0.15)",
    gradientTo: "rgba(30,58,138,0.08)",
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
    accentGlow: "rgba(52,211,153,0.2)",
    gradientFrom: "rgba(16,185,129,0.13)",
    gradientTo: "rgba(6,78,59,0.07)",
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
    accentGlow: "rgba(167,139,250,0.22)",
    gradientFrom: "rgba(124,58,237,0.15)",
    gradientTo: "rgba(49,10,101,0.08)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "OWA Verify", icon: Mail }, { label: "Onboarding", icon: Zap }],
  },
];

function PlatformIcon({ id }: { id: string }) {
  const base = "w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden shrink-0";
  if (id === "la28") return (
    <div className={`${base} bg-white/90`} style={{ boxShadow: "0 0 16px rgba(255,51,102,0.3)" }}>
      <img src={la28Logo} alt="LA28" className="w-9 h-9 object-contain" />
    </div>
  );
  if (id === "ticketmaster") return (
    <div className={`${base} bg-white`} style={{ boxShadow: "0 0 16px rgba(56,189,248,0.3)" }}>
      <img src={ticketmasterLogo} alt="TM" className="w-full h-full object-cover" />
    </div>
  );
  if (id === "uefa") return (
    <div className={`${base} bg-white p-1.5`} style={{ boxShadow: "0 0 16px rgba(0,255,65,0.25)" }}>
      <img src={uefaLogo} alt="UEFA" className="w-full h-full object-contain" />
    </div>
  );
  if (id === "brunomars") return (
    <div className={`${base} bg-gradient-to-br from-purple-500 to-fuchsia-600`} style={{ boxShadow: "0 0 16px rgba(192,132,252,0.3)" }}>
      <span className="text-xl font-black text-white font-mono">BM</span>
    </div>
  );
  if (id === "outlook-create") return (
    <div className={`${base} bg-gradient-to-br from-blue-500 to-indigo-600`} style={{ boxShadow: "0 0 16px rgba(96,165,250,0.3)" }}>
      <Mail className="w-6 h-6 text-white" />
    </div>
  );
  if (id === "outlook") return (
    <div className={`${base} bg-gradient-to-br from-sky-400 to-blue-600`} style={{ boxShadow: "0 0 16px rgba(125,211,252,0.25)" }}>
      <Mail className="w-6 h-6 text-white" />
    </div>
  );
  if (id === "zenrows") return (
    <div className={`${base} bg-gradient-to-br from-emerald-500 to-teal-700`} style={{ boxShadow: "0 0 16px rgba(52,211,153,0.25)" }}>
      <Globe className="w-6 h-6 text-white" />
    </div>
  );
  if (id === "replit") return (
    <div className={`${base} bg-white p-1`} style={{ boxShadow: "0 0 16px rgba(167,139,250,0.3)" }}>
      <img src={replitLogo} alt="Replit" className="w-full h-full object-contain" />
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
      toast({ title: "Offline", description: `${platform.name} module is not available yet.` });
      return;
    }
    navigate(platform.href);
  }

  const isLocked = (platformId: string) => {
    if (!loaded || userRole === "superadmin") return false;
    return !allowedServices.includes(platformId);
  };

  const visible = platforms.filter((p) => !isLocked(p.id));

  return (
    <div className="space-y-6 animate-float-up">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-emerald-400/50" />
            <h1 className="text-xl font-bold tracking-tight text-white font-mono" data-testid="text-create-server-title">
              Create<span className="text-emerald-400">_</span>Account
            </h1>
          </div>
          <p className="text-emerald-400/30 mt-1 text-[11px] font-mono pl-7.5">Select module to initialize</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(0,255,65,0.04)", border: "1px solid rgba(0,255,65,0.08)" }}>
          <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span className="text-[10px] font-mono text-emerald-400/50">{visible.length} modules online</span>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((platform) => {
          const isHovered = hoveredId === platform.id;
          return (
            <div
              key={platform.id}
              onClick={() => handleClick(platform)}
              onMouseEnter={() => setHoveredId(platform.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="group relative cursor-pointer select-none"
              style={{ transition: "transform 0.18s ease" }}
              data-testid={`card-platform-${platform.id}`}
            >
              {/* Outer glow on hover */}
              <div
                className="absolute inset-0 rounded-2xl transition-opacity duration-300 pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse at 50% 0%, ${platform.accentGlow}, transparent 70%)`,
                  opacity: isHovered ? 1 : 0,
                  filter: "blur(8px)",
                  transform: "translateY(-4px) scale(1.02)",
                }}
              />

              <div
                className="relative rounded-2xl overflow-hidden transition-all duration-300"
                style={{
                  background: `linear-gradient(145deg, ${platform.gradientFrom}, ${platform.gradientTo}, rgba(10,10,10,0.95))`,
                  border: `1px solid ${isHovered ? platform.accentColor + "40" : "rgba(255,255,255,0.06)"}`,
                  boxShadow: isHovered ? `0 8px 32px ${platform.accentGlow}, inset 0 1px 0 ${platform.accentColor}20` : "0 2px 12px rgba(0,0,0,0.4)",
                  transform: isHovered ? "translateY(-2px)" : "translateY(0)",
                }}
              >
                {/* Top shimmer line */}
                <div
                  className="absolute top-0 inset-x-0 h-px transition-opacity duration-300"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${platform.accentColor}60, transparent)`,
                    opacity: isHovered ? 1 : 0.3,
                  }}
                />

                <div className="relative p-4 flex flex-col gap-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <PlatformIcon id={platform.id} />
                    <div className="flex flex-col items-end gap-1.5">
                      <div
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md"
                        style={{
                          background: platform.badgeActive ? "rgba(0,255,65,0.08)" : "rgba(251,191,36,0.08)",
                          border: `1px solid ${platform.badgeActive ? "rgba(0,255,65,0.15)" : "rgba(251,191,36,0.15)"}`,
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            background: platform.badgeActive ? "#00ff41" : "#fbbf24",
                            boxShadow: platform.badgeActive ? "0 0 5px rgba(0,255,65,0.6)" : "0 0 5px rgba(251,191,36,0.5)",
                          }}
                        />
                        <span
                          className="text-[9px] font-mono uppercase tracking-wider"
                          style={{ color: platform.badgeActive ? "rgba(0,255,65,0.7)" : "rgba(251,191,36,0.7)" }}
                        >
                          {platform.badge}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Name + description */}
                  <div>
                    <h3
                      className="text-[14px] font-bold tracking-tight font-mono mb-1 transition-colors duration-200"
                      style={{ color: isHovered ? platform.accentColor : "#f4f4f5" }}
                    >
                      {platform.name}
                    </h3>
                    <p className="text-[11px] leading-relaxed font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {platform.description}
                    </p>
                  </div>

                  {/* Stats + launch */}
                  <div
                    className="flex items-center justify-between pt-3"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <div className="flex gap-3 flex-wrap">
                      {platform.stats.map((stat) => (
                        <div key={stat.label} className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.28)" }}>
                          <stat.icon className="w-2.5 h-2.5" />
                          <span>{stat.label}</span>
                        </div>
                      ))}
                    </div>
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200"
                      style={{
                        background: isHovered ? `${platform.accentColor}20` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isHovered ? platform.accentColor + "50" : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      {platform.comingSoon ? (
                        <Lock className="w-3 h-3 text-zinc-600" />
                      ) : (
                        <ArrowUpRight
                          className="w-3.5 h-3.5 transition-all duration-200"
                          style={{ color: isHovered ? platform.accentColor : "rgba(255,255,255,0.25)", transform: isHovered ? "translate(1px,-1px)" : "none" }}
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

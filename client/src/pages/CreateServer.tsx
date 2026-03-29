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

const RED = "#ff1a1a";
const RA = (a: number) => `rgba(255,26,26,${a})`;

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
    gradientFrom: "rgba(255,51,102,0.12)",
    gradientTo: "rgba(136,19,55,0.04)",
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
    accentGlow: "rgba(56,189,248,0.20)",
    gradientFrom: "rgba(14,165,233,0.12)",
    gradientTo: "rgba(30,64,175,0.04)",
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
    accentGlow: "rgba(0,255,65,0.20)",
    gradientFrom: "rgba(0,255,65,0.10)",
    gradientTo: "rgba(6,78,59,0.04)",
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
    gradientFrom: "rgba(147,51,234,0.12)",
    gradientTo: "rgba(112,26,117,0.04)",
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
    accentGlow: "rgba(96,165,250,0.20)",
    gradientFrom: "rgba(59,130,246,0.12)",
    gradientTo: "rgba(30,58,138,0.04)",
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
    accentGlow: "rgba(52,211,153,0.20)",
    gradientFrom: "rgba(16,185,129,0.12)",
    gradientTo: "rgba(6,78,59,0.04)",
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
    gradientFrom: "rgba(124,58,237,0.12)",
    gradientTo: "rgba(49,10,101,0.04)",
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
    accentGlow: "rgba(236,72,153,0.22)",
    gradientFrom: "rgba(219,39,119,0.12)",
    gradientTo: "rgba(131,24,67,0.04)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "Magic Link", icon: Mail }, { label: "OWA Verify", icon: Zap }],
  },
  {
    id: "v0",
    name: "Create v0.dev Account",
    description: "Auto-create v0.dev accounts via Clerk OTP email verification · promo FARZA-V0 auto-redeemed",
    href: "/admin/v0-create",
    accentColor: "#6366f1",
    accentGlow: "rgba(99,102,241,0.22)",
    gradientFrom: "rgba(99,102,241,0.12)",
    gradientTo: "rgba(49,46,129,0.04)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "OTP Verify", icon: Mail }, { label: "FARZA-V0", icon: Zap }],
  },
  {
    id: "adobe",
    name: "Create Adobe Account",
    description: "Auto-create Adobe accounts with email verification via Outlook OWA",
    href: "/admin/adobe-create",
    accentColor: "#ff4500",
    accentGlow: "rgba(255,69,0,0.22)",
    gradientFrom: "rgba(255,69,0,0.12)",
    gradientTo: "rgba(139,27,0,0.04)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "OWA Verify", icon: Mail }, { label: "6-Digit Code", icon: Zap }],
  },
  {
    id: "elevenlabs",
    name: "Create ElevenLabs Account",
    description: "Auto-create ElevenLabs accounts via mail.gw temp email + SOAX residential proxy",
    href: "/admin/elevenlabs-create",
    accentColor: "#f97316",
    accentGlow: "rgba(249,115,22,0.22)",
    gradientFrom: "rgba(249,115,22,0.12)",
    gradientTo: "rgba(124,45,18,0.04)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "Auto Create", icon: Shield }, { label: "mail.gw Email", icon: Mail }, { label: "API Key", icon: Zap }],
  },
  {
    id: "card-generator",
    name: "Card Generator",
    description: "Generate test card numbers with BIN lookup, network selection & bulk export",
    href: "/admin/card-generator",
    accentColor: "#fbbf24",
    accentGlow: "rgba(251,191,36,0.22)",
    gradientFrom: "rgba(245,158,11,0.12)",
    gradientTo: "rgba(120,53,15,0.04)",
    badge: "ACTIVE",
    badgeActive: true,
    stats: [{ label: "BIN Lookup", icon: Shield }, { label: "Bulk Export", icon: Zap }, { label: "Multi-Network", icon: CreditCard }],
  },
];

function PlatformIcon({ id, accentColor, hovered }: { id: string; accentColor: string; hovered: boolean }) {
  const base = "w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden shrink-0 transition-all duration-200";
  const glow = hovered ? `0 0 22px ${accentColor}60, 0 0 8px ${accentColor}30` : `0 0 10px ${accentColor}25`;

  if (id === "la28") return (
    <div className={`${base} bg-white/90`} style={{ boxShadow: glow }}>
      <img src={la28Logo} alt="LA28" className="w-7 h-7 object-contain" />
    </div>
  );
  if (id === "ticketmaster") return (
    <div className={`${base} bg-white`} style={{ boxShadow: glow }}>
      <img src={ticketmasterLogo} alt="TM" className="w-full h-full object-cover" />
    </div>
  );
  if (id === "uefa") return (
    <div className={`${base} bg-white p-1`} style={{ boxShadow: glow }}>
      <img src={uefaLogo} alt="UEFA" className="w-full h-full object-contain" />
    </div>
  );
  if (id === "brunomars") return (
    <div className={`${base} bg-gradient-to-br from-purple-500 to-fuchsia-600`} style={{ boxShadow: glow }}>
      <span className="text-base font-black text-white font-mono">BM</span>
    </div>
  );
  if (id === "outlook-create") return (
    <div className={`${base} bg-gradient-to-br from-blue-500 to-indigo-600`} style={{ boxShadow: glow }}>
      <Mail className="w-5 h-5 text-white" />
    </div>
  );
  if (id === "zenrows") return (
    <div className={`${base} bg-gradient-to-br from-emerald-500 to-teal-700`} style={{ boxShadow: glow }}>
      <Globe className="w-5 h-5 text-white" />
    </div>
  );
  if (id === "replit") return (
    <div className={`${base} bg-white p-1`} style={{ boxShadow: glow }}>
      <img src={replitLogo} alt="Replit" className="w-full h-full object-contain" />
    </div>
  );
  if (id === "lovable") return (
    <div className={`${base} bg-black`} style={{ boxShadow: glow }}>
      <img src={lovableLogo} alt="Lovable" className="w-full h-full object-cover object-center scale-110" />
    </div>
  );
  if (id === "v0") return (
    <div className={`${base} bg-gradient-to-br from-indigo-500 to-violet-700`} style={{ boxShadow: glow }}>
      <Zap className="w-5 h-5 text-white" />
    </div>
  );
  if (id === "adobe") return (
    <div className={`${base} bg-gradient-to-br from-red-600 to-orange-700`} style={{ boxShadow: glow }}>
      <svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M13.966 22.624l-1.69-4.281H8.122l4.294-8.835 4.808 13.116zM3 6.834l3.682 10.093H1.212zm17.786 0L18 16.927h5.47z"/></svg>
    </div>
  );
  if (id === "elevenlabs") return (
    <div className={`${base} bg-gradient-to-br from-orange-500 to-orange-700`} style={{ boxShadow: glow }}>
      <span className="text-white font-black text-sm tracking-tight">11</span>
    </div>
  );
  if (id === "card-generator") return (
    <div className={`${base} bg-gradient-to-br from-amber-400 to-orange-600`} style={{ boxShadow: glow }}>
      <CreditCard className="w-5 h-5 text-white" />
    </div>
  );
  return null;
}

function SignalBars({ count = 10 }: { count?: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 900);
    return () => clearInterval(t);
  }, []);
  const heights = [0.35, 0.55, 0.42, 0.75, 0.58, 0.88, 0.66, 0.95, 0.72, 0.80];
  return (
    <div className="flex items-end gap-[2px] h-7">
      {heights.slice(0, count).map((h, i) => {
        const active = (tick + i) % 7 < 5;
        return (
          <div key={i} className="w-1.5 rounded-sm transition-all duration-500"
            style={{ height: `${h * 100}%`, background: active ? RED : RA(0.15), boxShadow: active ? `0 0 4px ${RA(0.6)}` : "none" }} />
        );
      })}
    </div>
  );
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

  const isLocked = (id: string) => {
    if (!loaded || userRole === "superadmin") return false;
    return !allowedServices.includes(id);
  };

  const visible = platforms.filter(p => !isLocked(p.id));
  const activeCount = visible.filter(p => p.badgeActive).length;
  const fmtUptime = `${String(Math.floor(uptime / 3600)).padStart(2, "0")}:${String(Math.floor((uptime % 3600) / 60)).padStart(2, "0")}:${String(uptime % 60).padStart(2, "0")}`;

  return (
    <div className="space-y-4">

      {/* ── HEADER ── */}
      <div className="relative rounded-xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(255,26,26,0.06) 0%, rgba(0,0,0,0.55) 60%, rgba(255,26,26,0.03) 100%)",
          border: `1px solid ${RA(0.22)}`,
          boxShadow: `0 0 40px ${RA(0.06)}, inset 0 1px 0 ${RA(0.12)}`,
        }}>
        {/* Top neon line */}
        <div className="absolute top-0 inset-x-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${RED}, transparent)`, boxShadow: `0 0 8px ${RED}` }} />

        <div className="relative px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Icon */}
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${RA(0.22)}, ${RA(0.07)})`,
                  border: `1px solid ${RA(0.40)}`,
                  boxShadow: `0 0 20px ${RA(0.20)}, inset 0 1px 0 ${RA(0.15)}`,
                }}>
                <Server className="w-5 h-5" style={{ color: RED, filter: `drop-shadow(0 0 6px ${RED})` }} />
              </div>
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2"
                style={{ background: RED, borderColor: "#07050a", boxShadow: `0 0 6px ${RED}` }} />
            </div>

            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <h1 className="text-[17px] font-mono font-bold tracking-tight text-white"
                  style={{ textShadow: `0 0 20px ${RA(0.25)}` }}
                  data-testid="text-create-server-title">
                  Create Account
                </h1>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold tracking-widest"
                  style={{ color: RED, background: RA(0.12), border: `1px solid ${RA(0.30)}`, textShadow: `0 0 6px ${RA(0.6)}` }}>
                  v2.4.1
                </span>
              </div>
              <p className="text-[11px] font-mono" style={{ color: RA(0.45) }}>
                // Select an automation module to initialize
              </p>
            </div>
          </div>

          {/* Right stats */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex flex-col items-end gap-1.5 px-4 py-2.5 rounded-lg"
              style={{ background: "rgba(0,0,0,0.45)", border: `1px solid ${RA(0.18)}` }}>
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3" style={{ color: RA(0.60) }} />
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.28)" }}>Uptime</span>
                <span className="text-[10px] font-mono font-bold tabular-nums"
                  style={{ color: RED, textShadow: `0 0 8px ${RA(0.6)}` }}>{fmtUptime}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3" style={{ color: RA(0.45) }} />
                <span className="text-[10px] font-mono" style={{ color: "rgba(255,255,255,0.28)" }}>
                  <span className="font-bold" style={{ color: RED }}>{activeCount}</span>
                  <span> / {visible.length} active</span>
                </span>
              </div>
            </div>
            <SignalBars />
          </div>
        </div>
      </div>

      {/* ── MODULE GRID ── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {visible.map((p) => {
          const hovered = hoveredId === p.id;
          return (
            <div
              key={p.id}
              onClick={() => handleClick(p)}
              onMouseEnter={() => { setHoveredId(p.id); sounds.hover(); }}
              onMouseLeave={() => setHoveredId(null)}
              className="group relative cursor-pointer select-none"
              data-testid={`card-platform-${p.id}`}
            >
              {/* Ambient under-glow */}
              <div className="absolute -inset-1 rounded-2xl pointer-events-none transition-all duration-300"
                style={{
                  background: `radial-gradient(ellipse at 50% 110%, ${p.accentGlow}, transparent 65%)`,
                  opacity: hovered ? 1 : 0,
                  filter: "blur(12px)",
                }} />

              <div className="relative rounded-xl overflow-hidden flex flex-col transition-all duration-200"
                style={{
                  background: hovered
                    ? `linear-gradient(145deg, ${p.gradientFrom}, rgba(0,0,0,0.70))`
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${hovered ? p.accentColor + "45" : RA(0.12)}`,
                  boxShadow: hovered
                    ? `0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px ${p.accentColor}15, inset 0 1px 0 ${p.accentColor}20`
                    : `0 4px 20px rgba(0,0,0,0.30), inset 0 1px 0 ${RA(0.06)}`,
                  transform: hovered ? "translateY(-4px) scale(1.015)" : "translateY(0) scale(1)",
                }}>

                {/* Top accent line */}
                <div className="absolute top-0 inset-x-0 h-px pointer-events-none transition-all duration-200"
                  style={{ background: `linear-gradient(90deg, transparent 5%, ${p.accentColor}${hovered ? "80" : "30"} 50%, transparent 95%)` }} />

                {/* Corner glow */}
                <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none overflow-hidden rounded-xl"
                  style={{ opacity: hovered ? 0.22 : 0.05, transition: "opacity 0.25s" }}>
                  <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full"
                    style={{ background: p.accentColor, filter: "blur(16px)" }} />
                </div>

                <div className="relative p-4 flex flex-col gap-3">
                  {/* Icon + badge row */}
                  <div className="flex items-start justify-between gap-2">
                    <PlatformIcon id={p.id} accentColor={p.accentColor} hovered={hovered} />

                    {/* Status badge */}
                    <div className="flex items-center gap-1 px-2 py-[3px] rounded-sm shrink-0"
                      style={{
                        background: p.badgeActive ? "rgba(0,255,65,0.10)" : "rgba(255,159,10,0.10)",
                        border: `1px solid ${p.badgeActive ? "rgba(0,255,65,0.28)" : "rgba(255,159,10,0.28)"}`,
                      }}>
                      <span className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: p.badgeActive ? "#00ff41" : "#ff9f0a",
                          boxShadow: p.badgeActive ? "0 0 6px #00ff41" : "0 0 6px #ff9f0a",
                        }} />
                      <span className="text-[8px] font-mono font-bold tracking-widest uppercase"
                        style={{ color: p.badgeActive ? "#00ff41" : "#ff9f0a" }}>
                        {p.badge}
                      </span>
                    </div>
                  </div>

                  {/* Name + description */}
                  <div>
                    <h3 className="text-[13px] font-mono font-semibold leading-tight transition-colors duration-200"
                      style={{
                        color: hovered ? p.accentColor : "rgba(255,255,255,0.90)",
                        textShadow: hovered ? `0 0 12px ${p.accentColor}60` : "none",
                      }}>
                      {p.name}
                    </h3>
                    <p className="text-[10px] leading-relaxed mt-1" style={{ color: "rgba(255,255,255,0.38)" }}>
                      {p.description}
                    </p>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-2.5 gap-2"
                    style={{ borderTop: `1px solid ${hovered ? p.accentColor + "20" : RA(0.10)}` }}>
                    <div className="flex gap-2 flex-wrap">
                      {p.stats.map(stat => (
                        <div key={stat.label} className="flex items-center gap-1 text-[9px]"
                          style={{ color: hovered ? "rgba(255,255,255,0.50)" : "rgba(255,255,255,0.28)" }}>
                          <stat.icon className="w-2.5 h-2.5" />
                          <span className="font-mono">{stat.label}</span>
                        </div>
                      ))}
                    </div>

                    <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 transition-all duration-200"
                      style={{
                        background: hovered ? `${p.accentColor}20` : RA(0.06),
                        border: `1px solid ${hovered ? p.accentColor + "50" : RA(0.18)}`,
                      }}>
                      {p.comingSoon
                        ? <Lock className="w-2.5 h-2.5" style={{ color: "rgba(255,255,255,0.20)" }} />
                        : <ArrowUpRight className="w-3 h-3 transition-all duration-200"
                            style={{
                              color: hovered ? p.accentColor : RA(0.40),
                              transform: hovered ? "translate(1px,-1px)" : "none",
                              filter: hovered ? `drop-shadow(0 0 4px ${p.accentColor}80)` : "none",
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

      {/* ── STATUS STRIP ── */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-lg"
        style={{ background: "rgba(0,0,0,0.40)", border: `1px solid ${RA(0.14)}` }}>
        <div className="flex items-center gap-5">
          {[
            { label: "SYSTEM",  val: "NOMINAL",  color: "#00ff41" },
            { label: "CAPTCHA", val: "CAPSOLVER", color: "#38bdf8" },
            { label: "PROXY",   val: "SOAX RES",  color: "#c084fc" },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="text-[8px] font-mono uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.22)" }}>{s.label}</span>
              <span className="text-[9px] font-mono font-bold" style={{ color: s.color, textShadow: `0 0 6px ${s.color}60` }}>{s.val}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.20)" }}>SESSION</span>
          <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: RED, textShadow: `0 0 6px ${RA(0.5)}` }}>{fmtUptime}</span>
        </div>
      </div>

    </div>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Globe, Shield, Zap, Server, Ticket, Trophy, Lock, Cpu, Radio, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import la28Logo from "@assets/{D0DAE68E-FBCF-411B-8803-46B146A5A0FC}_1772412089243.png";
import ticketmasterLogo from "@assets/{9D4CF467-7C69-4EAC-A803-17352A19FCD5}_1772418022222.png";
import uefaLogo from "@assets/UEFA_Champions_League.svg_1772418059822.png";

type Platform = {
  id: string;
  name: string;
  description: string;
  href: string | null;
  gradient: string;
  badge: string;
  badgeColor: string;
  borderColor: string;
  icon?: React.ReactNode;
  stats: { label: string; icon: React.ComponentType<{ className?: string }> }[];
  comingSoon?: boolean;
};

const platforms: Platform[] = [
  {
    id: "la28",
    name: "LA28 Olympic",
    description: "Automated LA28 ID creation with draw registration and OIDC linking",
    href: "/admin/la28-create",
    gradient: "from-red-600/80 via-rose-600/60 to-red-900/80",
    badge: "ACTIVE",
    badgeColor: "text-emerald-400",
    borderColor: "rgba(255,51,102,0.2)",
    stats: [
      { label: "Auto Verify", icon: Shield },
      { label: "Bulk Ops", icon: Zap },
      { label: "US Region", icon: Globe },
    ],
  },
  {
    id: "ticketmaster",
    name: "Ticket Master",
    description: "Automated Ticketmaster account creation with email verification",
    href: "/admin/tm-create",
    gradient: "from-sky-600/80 via-blue-700/60 to-indigo-900/80",
    badge: "PROXY REQ",
    badgeColor: "text-amber-400",
    borderColor: "rgba(0,150,255,0.2)",
    comingSoon: false,
    stats: [
      { label: "Auto Verify", icon: Shield },
      { label: "Bulk Ops", icon: Zap },
      { label: "Global", icon: Globe },
    ],
  },
  {
    id: "uefa",
    name: "UEFA Account",
    description: "Create verified UEFA accounts for European football ticket access",
    href: "/admin/uefa-create",
    gradient: "from-emerald-600/80 via-teal-700/60 to-cyan-900/80",
    badge: "ACTIVE",
    badgeColor: "text-emerald-400",
    borderColor: "rgba(0,255,136,0.2)",
    comingSoon: false,
    stats: [
      { label: "Auto Verify", icon: Shield },
      { label: "Bulk Ops", icon: Zap },
      { label: "EU Region", icon: Globe },
    ],
  },
  {
    id: "brunomars",
    name: "TM - Bruno Mars",
    description: "Automated presale signup for Bruno Mars tour via Ticketmaster CA",
    href: "/admin/brunomars-create",
    gradient: "from-purple-600/80 via-fuchsia-700/60 to-pink-900/80",
    badge: "ACTIVE",
    badgeColor: "text-emerald-400",
    borderColor: "rgba(168,85,247,0.2)",
    comingSoon: false,
    stats: [
      { label: "Auto Signup", icon: Shield },
      { label: "Bulk Ops", icon: Zap },
      { label: "Presale", icon: Ticket },
    ],
  },
  {
    id: "outlook",
    name: "Outlook Login",
    description: "Automated Microsoft/Outlook account login via ZenRows with FunCaptcha solving",
    href: "/admin/outlook-login",
    gradient: "from-blue-600/80 via-indigo-700/60 to-blue-900/80",
    badge: "ACTIVE",
    badgeColor: "text-emerald-400",
    borderColor: "rgba(59,130,246,0.2)",
    comingSoon: false,
    icon: <Mail className="w-7 h-7 text-white" />,
    stats: [
      { label: "Auto Login", icon: Shield },
      { label: "Captcha Solve", icon: Zap },
      { label: "ZenRows", icon: Globe },
    ],
  },
  {
    id: "zenrows",
    name: "ZenRows Register",
    description: "Auto-create ZenRows accounts via Outlook email verification & extract API keys",
    href: "/admin/zenrows-register",
    gradient: "from-emerald-600/80 via-teal-700/60 to-green-900/80",
    badge: "ACTIVE",
    badgeColor: "text-emerald-400",
    borderColor: "rgba(34,197,94,0.2)",
    comingSoon: false,
    icon: <Globe className="w-7 h-7 text-white" />,
    stats: [
      { label: "Auto Register", icon: Shield },
      { label: "Email Verify", icon: Mail },
      { label: "API Key", icon: Zap },
    ],
  },
];

export default function CreateServer() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  function handleClick(platform: Platform) {
    if (platform.comingSoon || !platform.href) {
      toast({
        title: "Offline",
        description: `${platform.name} module is not available yet.`,
      });
      return;
    }
    navigate(platform.href);
  }

  return (
    <div className="space-y-6 animate-float-up">
      <div>
        <div className="flex items-center gap-2.5">
          <Server className="w-5 h-5 text-cyan-400/50" />
          <h1 className="text-xl font-bold tracking-tight text-white font-mono" data-testid="text-create-server-title">
            Create<span className="text-cyan-400">_</span>Server
          </h1>
        </div>
        <p className="text-cyan-400/30 mt-1 text-[11px] font-mono pl-7.5">Select target module to initialize</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {platforms.map((platform) => (
          <div
            key={platform.id}
            onClick={() => handleClick(platform)}
            className="group relative cursor-pointer"
            data-testid={`card-platform-${platform.id}`}
          >
            <div className="relative rounded-xl overflow-hidden" style={{ border: `1px solid ${platform.borderColor}` }}>
              <div className={`absolute inset-0 bg-gradient-to-br ${platform.gradient} ${platform.comingSoon ? "opacity-30" : "opacity-50 group-hover:opacity-70"} transition-all duration-300`} />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(13,17,23,0.6) 0%, rgba(13,17,23,0.92) 100%)' }} />
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

              <div className="relative p-5 min-h-[240px] flex flex-col justify-between text-white">
                <div>
                  <div className="flex items-start justify-between mb-4">
                    {platform.id === "la28" ? (
                      <div className="w-16 h-16 rounded-xl bg-white/90 flex items-center justify-center overflow-hidden" style={{ boxShadow: '0 0 20px rgba(255,51,102,0.2)' }}>
                        <img src={la28Logo} alt="LA28" className="w-12 h-12 object-contain" />
                      </div>
                    ) : platform.id === "ticketmaster" ? (
                      <div className="w-16 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden" style={{ boxShadow: '0 0 20px rgba(0,150,255,0.2)' }}>
                        <img src={ticketmasterLogo} alt="Ticketmaster" className="w-full h-full object-cover" />
                      </div>
                    ) : platform.id === "brunomars" ? (
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center overflow-hidden" style={{ boxShadow: '0 0 20px rgba(168,85,247,0.2)' }}>
                        <span className="text-2xl font-black text-white font-mono">BM</span>
                      </div>
                    ) : platform.id === "outlook" ? (
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden" style={{ boxShadow: '0 0 20px rgba(59,130,246,0.2)' }}>
                        <Mail className="w-7 h-7 text-white" />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-white flex items-center justify-center overflow-hidden p-2" style={{ boxShadow: '0 0 20px rgba(0,255,136,0.2)' }}>
                        <img src={uefaLogo} alt="UEFA" className="w-11 h-11 object-contain" />
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,240,255,0.1)' }}>
                      <Radio className="w-2.5 h-2.5 text-emerald-400 animate-glow" />
                      <span className={`text-[9px] font-mono ${platform.badgeColor} uppercase tracking-wider`}>
                        {platform.badge}
                      </span>
                    </div>
                  </div>

                  <h3 className="text-lg font-bold mb-1.5 tracking-tight font-mono">{platform.name}</h3>
                  <p className="text-[11px] text-white/40 leading-relaxed font-mono">{platform.description}</p>
                </div>

                <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.06]">
                  <div className="flex gap-3">
                    {platform.stats.map((stat) => (
                      <div key={stat.label} className="flex items-center gap-1 text-[9px] text-white/30 font-mono">
                        <stat.icon className="w-3 h-3" />
                        <span>{stat.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="w-8 h-8 rounded-md flex items-center justify-center transition-all duration-300" style={{ background: 'rgba(0,240,255,0.05)', border: '1px solid rgba(0,240,255,0.15)' }}>
                    {platform.comingSoon ? (
                      <Lock className="w-3.5 h-3.5 text-zinc-500" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5 text-cyan-400 group-hover:translate-x-0.5 transition-transform duration-300" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

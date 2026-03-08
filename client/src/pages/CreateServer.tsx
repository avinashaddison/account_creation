import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Globe, Shield, Zap, Server, Ticket, Trophy, Lock } from "lucide-react";
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
  icon?: React.ReactNode;
  stats: { label: string; icon: React.ComponentType<{ className?: string }> }[];
  comingSoon?: boolean;
};

const platforms: Platform[] = [
  {
    id: "la28",
    name: "LA28 Accounts",
    description: "Create verified LA28 Olympic ID accounts with automated email verification",
    href: "/admin/la28-create",
    gradient: "from-red-600 via-rose-600 to-red-800",
    badge: "Active",
    badgeColor: "bg-emerald-400/20 text-emerald-300",
    stats: [
      { label: "Auto Verify", icon: Shield },
      { label: "Bulk Create", icon: Zap },
      { label: "US Region", icon: Globe },
    ],
  },
  {
    id: "ticketmaster",
    name: "Ticket Master",
    description: "Automated Ticketmaster account creation with email verification and profile setup",
    href: "/admin/tm-create",
    gradient: "from-sky-600 via-blue-700 to-indigo-800",
    badge: "Proxy Required",
    badgeColor: "bg-amber-400/20 text-amber-300",
    comingSoon: false,
    stats: [
      { label: "Auto Verify", icon: Shield },
      { label: "Bulk Create", icon: Zap },
      { label: "Global", icon: Globe },
    ],
  },
  {
    id: "uefa",
    name: "UEFA Account",
    description: "Create verified UEFA accounts for European football events and ticket access",
    href: "/admin/uefa-create",
    gradient: "from-emerald-600 via-teal-700 to-cyan-800",
    badge: "Active",
    badgeColor: "bg-emerald-400/20 text-emerald-300",
    comingSoon: false,
    stats: [
      { label: "Auto Verify", icon: Shield },
      { label: "Bulk Create", icon: Zap },
      { label: "EU Region", icon: Globe },
    ],
  },
  {
    id: "brunomars",
    name: "TM - Bruno Mars",
    description: "Automated presale signup for Bruno Mars tour on signup.ticketmaster.ca/brunomars",
    href: "/admin/brunomars-create",
    gradient: "from-purple-600 via-fuchsia-700 to-pink-800",
    badge: "Active",
    badgeColor: "bg-emerald-400/20 text-emerald-300",
    comingSoon: false,
    stats: [
      { label: "Auto Signup", icon: Shield },
      { label: "Bulk Create", icon: Zap },
      { label: "Presale", icon: Ticket },
    ],
  },
];

export default function CreateServer() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  function handleClick(platform: Platform) {
    if (platform.comingSoon || !platform.href) {
      toast({
        title: "Coming Soon",
        description: `${platform.name} account creation is not available yet. Stay tuned!`,
      });
      return;
    }
    navigate(platform.href);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white" data-testid="text-create-server-title">
          Account Create Server
        </h1>
        <p className="text-zinc-500 mt-1">Select a platform to start creating accounts</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {platforms.map((platform) => (
          <div
            key={platform.id}
            onClick={() => handleClick(platform)}
            className="group relative cursor-pointer"
            data-testid={`card-platform-${platform.id}`}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${platform.gradient} rounded-2xl ${platform.comingSoon ? "opacity-50 group-hover:opacity-65" : "opacity-80 group-hover:opacity-100"} transition-all duration-300`} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent rounded-2xl" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-white/10 group-hover:ring-white/25 transition-all" />

            <div className="relative p-6 rounded-2xl min-h-[280px] flex flex-col justify-between text-white">
              <div>
                <div className="flex items-start justify-between mb-5">
                  {platform.id === "la28" ? (
                    <div className="w-20 h-20 rounded-2xl bg-white flex items-center justify-center shadow-2xl shadow-black/30 overflow-hidden">
                      <img src={la28Logo} alt="LA28" className="w-16 h-16 object-contain" />
                    </div>
                  ) : platform.id === "ticketmaster" ? (
                    <div className="w-20 h-20 rounded-2xl bg-white flex items-center justify-center shadow-2xl shadow-black/30 overflow-hidden">
                      <img src={ticketmasterLogo} alt="Ticketmaster" className="w-full h-full object-cover" />
                    </div>
                  ) : platform.id === "brunomars" ? (
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center shadow-2xl shadow-black/30 overflow-hidden">
                      <span className="text-3xl font-black text-white">BM</span>
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-white flex items-center justify-center shadow-2xl shadow-black/30 overflow-hidden p-2">
                      <img src={uefaLogo} alt="UEFA" className="w-14 h-14 object-contain" />
                    </div>
                  )}
                  <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${platform.badgeColor} backdrop-blur-sm`}>
                    {platform.badge}
                  </span>
                </div>

                <h3 className="text-2xl font-bold mb-2 tracking-tight">{platform.name}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{platform.description}</p>
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/10">
                <div className="flex gap-4">
                  {platform.stats.map((stat) => (
                    <div key={stat.label} className="flex items-center gap-1.5 text-xs text-white/50">
                      <stat.icon className="w-3.5 h-3.5" />
                      <span>{stat.label}</span>
                    </div>
                  ))}
                </div>
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/25 transition-all duration-300">
                  {platform.comingSoon ? (
                    <Lock className="w-4 h-4 text-white/60" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform duration-300" />
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useLocation } from "wouter";
import { ArrowRight, Globe, Shield, Zap, Server } from "lucide-react";
import la28Logo from "@assets/{D0DAE68E-FBCF-411B-8803-46B146A5A0FC}_1772412089243.png";

const platforms = [
  {
    id: "la28",
    name: "LA28 Accounts",
    description: "Create verified LA28 Olympic ID accounts with automated email verification",
    href: "/admin/la28-create",
    gradient: "from-blue-600 via-indigo-600 to-purple-700",
    badge: "Active",
    badgeColor: "bg-emerald-400/20 text-emerald-300",
    stats: [
      { label: "Auto Verify", icon: Shield },
      { label: "Bulk Create", icon: Zap },
      { label: "US Region", icon: Globe },
    ],
  },
];

export default function CreateServer() {
  const [, navigate] = useLocation();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-create-server-title">
          Account Create Server
        </h1>
        <p className="text-muted-foreground mt-1">Select a platform to start creating accounts</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {platforms.map((platform) => (
          <div
            key={platform.id}
            onClick={() => navigate(platform.href)}
            className="group relative cursor-pointer"
            data-testid={`card-platform-${platform.id}`}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${platform.gradient} rounded-2xl opacity-90 group-hover:opacity-100 transition-all duration-300`} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent rounded-2xl" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-white/10 group-hover:ring-white/20 transition-all" />

            <div className="relative p-6 rounded-2xl min-h-[260px] flex flex-col justify-between text-white">
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div className="w-14 h-14 rounded-xl bg-white flex items-center justify-center shadow-lg shadow-black/20 overflow-hidden">
                    <img src={la28Logo} alt="LA28" className="w-12 h-12 object-contain" />
                  </div>
                  <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${platform.badgeColor} backdrop-blur-sm`}>
                    {platform.badge}
                  </span>
                </div>

                <h3 className="text-2xl font-bold mb-2 tracking-tight">{platform.name}</h3>
                <p className="text-sm text-white/70 leading-relaxed">{platform.description}</p>
              </div>

              <div className="flex items-center justify-between mt-6 pt-4 border-t border-white/10">
                <div className="flex gap-4">
                  {platform.stats.map((stat) => (
                    <div key={stat.label} className="flex items-center gap-1.5 text-xs text-white/60">
                      <stat.icon className="w-3.5 h-3.5" />
                      <span>{stat.label}</span>
                    </div>
                  ))}
                </div>
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/25 transition-all duration-300">
                  <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform duration-300" />
                </div>
              </div>
            </div>
          </div>
        ))}

        <div className="relative rounded-2xl border-2 border-dashed border-slate-200 min-h-[260px] flex flex-col items-center justify-center text-slate-400 p-6">
          <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
            <Server className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm font-medium text-slate-400">More Platforms</p>
          <p className="text-xs text-slate-300 mt-1">Coming Soon</p>
        </div>
      </div>
    </div>
  );
}

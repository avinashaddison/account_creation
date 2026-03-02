import { useLocation } from "wouter";
import { Server, ArrowRight, Globe, Shield, Zap } from "lucide-react";

const platforms = [
  {
    id: "la28",
    name: "LA28 Accounts",
    description: "Create verified LA28 Olympic ID accounts with automated email verification",
    href: "/admin/la28-create",
    gradient: "from-blue-600 via-indigo-600 to-purple-700",
    iconBg: "bg-white/20",
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
            <div className={`absolute inset-0 bg-gradient-to-br ${platform.gradient} rounded-2xl opacity-90 group-hover:opacity-100 transition-opacity`} />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent rounded-2xl" />

            <div className="relative p-6 rounded-2xl min-h-[220px] flex flex-col justify-between text-white">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-xl ${platform.iconBg} backdrop-blur-sm`}>
                    <Server className="w-6 h-6" />
                  </div>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${platform.badgeColor}`}>
                    {platform.badge}
                  </span>
                </div>

                <h3 className="text-xl font-bold mb-1">{platform.name}</h3>
                <p className="text-sm text-white/70 leading-relaxed">{platform.description}</p>
              </div>

              <div className="flex items-center justify-between mt-6">
                <div className="flex gap-3">
                  {platform.stats.map((stat) => (
                    <div key={stat.label} className="flex items-center gap-1.5 text-xs text-white/60">
                      <stat.icon className="w-3.5 h-3.5" />
                      <span>{stat.label}</span>
                    </div>
                  ))}
                </div>
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                  <ArrowRight className="w-4 h-4 text-white/80 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </div>
          </div>
        ))}

        <div className="relative rounded-2xl border-2 border-dashed border-slate-200 min-h-[220px] flex flex-col items-center justify-center text-slate-400 p-6">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
            <Server className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-medium">More Platforms</p>
          <p className="text-xs text-slate-300 mt-1">Coming Soon</p>
        </div>
      </div>
    </div>
  );
}

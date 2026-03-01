import { useLocation, Link } from "wouter";
import { LayoutDashboard, Archive, Receipt, Zap } from "lucide-react";

const nav = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/accounts", label: "Account Stock", icon: Archive },
  { href: "/admin/billing", label: "Billing", icon: Receipt },
  { href: "/admin/auto-create", label: "Auto Create", icon: Zap },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 bg-zinc-900 text-white flex flex-col shrink-0" data-testid="sidebar">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="text-xl font-black tracking-tight" data-testid="text-brand">LA28 Panel</h2>
          <p className="text-xs text-zinc-400 mt-1">Account Management</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-zinc-400 hover:text-white hover:bg-white/5"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <div className="text-xs text-zinc-500">$0.11 per account</div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

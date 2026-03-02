import { useLocation, Link } from "wouter";
import { LayoutDashboard, Archive, Receipt, LogOut, User, Mail, Users, Wallet, Server } from "lucide-react";
import { Button } from "@/components/ui/button";

type LayoutProps = {
  children: React.ReactNode;
  user: { id: string; username: string; email: string; role: string };
  onLogout: () => void;
};

export default function Layout({ children, user, onLogout }: LayoutProps) {
  const [location] = useLocation();

  const nav = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/accounts", label: "Account Stock", icon: Archive },
    { href: "/admin/email-server", label: "Email Server", icon: Mail },
    { href: "/admin/billing", label: "Billing", icon: Receipt },
    { href: "/admin/wallet", label: "Wallet", icon: Wallet },
    { href: "/admin/create-server", label: "Account Create Server", icon: Server },
    ...(user.role === "superadmin" ? [{ href: "/admin/manage-admins", label: "Manage Admins", icon: Users }] : []),
  ];

  return (
    <div className="min-h-screen flex bg-[#0a0a0f]">
      <aside className="w-64 bg-[#111118] border-r border-white/5 text-white flex flex-col shrink-0" data-testid="sidebar">
        <div className="p-6 border-b border-white/5">
          <h2 className="text-xl font-black tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent" data-testid="text-brand">Addison Panel</h2>
          <p className="text-[11px] text-zinc-500 mt-1">Account Management</p>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {nav.map((item) => {
            const isActive = location === item.href || (item.href === "/admin/create-server" && location === "/admin/la28-create");
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-all duration-200 ${
                    isActive
                      ? "bg-gradient-to-r from-blue-600/20 to-purple-600/20 text-white border border-blue-500/20"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase().replace(/ /g, "-")}`}
                >
                  <item.icon className={`w-4 h-4 ${isActive ? "text-blue-400" : ""}`} />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
              <User className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-300 truncate" data-testid="text-user-email">{user.email}</p>
              <p className="text-[11px] text-zinc-600 capitalize" data-testid="text-user-role">{user.role}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            onClick={onLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

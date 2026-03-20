import { useState, useEffect } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setLogoutCallback } from "./lib/auth";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import AccountStock from "@/pages/AccountStock";
import Billing from "@/pages/Billing";
import AutoCreate from "@/pages/AutoCreate";
import TMCreate from "@/pages/TMCreate";
import UEFACreate from "@/pages/UEFACreate";
import BrunoMarsCreate from "@/pages/BrunoMarsCreate";
import CreateServer from "@/pages/CreateServer";
import EmailWorkspace from "@/pages/EmailWorkspace";
import ManageAdmins from "@/pages/ManageAdmins";
import Earnings from "@/pages/Earnings";
import WalletPage from "@/pages/Wallet";
import Home from "@/pages/Home";
import Settings from "@/pages/Settings";
import OutlookLogin from "@/pages/OutlookLogin";
import OutlookCreate from "@/pages/OutlookCreate";
import ZenRowsRegister from "@/pages/ZenRowsRegister";
import ReplitCreate from "@/pages/ReplitCreate";
import LovableCreate from "@/pages/LovableCreate";
import AdobeCreate from "@/pages/AdobeCreate";
import CardGenerator from "@/pages/CardGenerator";
import MyCards from "@/pages/MyCards";
import PrivateAccount from "@/pages/PrivateAccount";
import CheckoutCards from "@/pages/CheckoutCards";
import TMEventScanner from "@/pages/TMEventScanner";
import TMLiveAlerts from "@/pages/TMLiveAlerts";
import TMTrackedEvents from "@/pages/TMTrackedEvents";
import TMSettings from "@/pages/TMSettings";
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: string;
  freeAccountsUsed?: number;
  walletBalance?: string;
  panelName?: string;
};

function AdminRoutes({ user, onLogout, onPanelNameChange }: { user: AuthUser; onLogout: () => void; onPanelNameChange: (name: string) => void }) {
  return (
    <Layout user={user} onLogout={onLogout} onPanelNameChange={onPanelNameChange}>
      <Switch>
        <Route path="/admin" component={Dashboard} />
        <Route path="/admin/home" component={Home} />
        <Route path="/admin/accounts" component={AccountStock} />
        <Route path="/admin/billing" component={Billing} />
        <Route path="/admin/create-server" component={CreateServer} />
        <Route path="/admin/la28-create" component={AutoCreate} />
        <Route path="/admin/tm-create" component={TMCreate} />
        <Route path="/admin/uefa-create" component={UEFACreate} />
        <Route path="/admin/brunomars-create" component={BrunoMarsCreate} />
        <Route path="/admin/outlook-login" component={OutlookLogin} />
        <Route path="/admin/outlook-create" component={OutlookCreate} />
        <Route path="/admin/zenrows-register" component={ZenRowsRegister} />
        <Route path="/admin/replit-create" component={ReplitCreate} />
        <Route path="/admin/lovable-create" component={LovableCreate} />
        <Route path="/admin/adobe-create" component={AdobeCreate} />
        <Route path="/admin/card-generator" component={CardGenerator} />
        <Route path="/admin/my-cards" component={MyCards} />
        <Route path="/admin/tm-event-scanner" component={TMEventScanner} />
        <Route path="/admin/tm-live-alerts" component={TMLiveAlerts} />
        <Route path="/admin/tm-tracked-events" component={TMTrackedEvents} />
        <Route path="/admin/tm-settings" component={TMSettings} />
        <Route path="/admin/auto-create"><Redirect to="/admin/create-server" /></Route>
        <Route path="/admin/email-server"><Redirect to="/admin/email-workspace" /></Route>
        <Route path="/admin/email-workspace" component={EmailWorkspace} />
        <Route path="/admin/wallet" component={WalletPage} />
        <Route path="/admin/checkout-cards" component={CheckoutCards} />
        {user.role === "superadmin" && (
          <>
            <Route path="/admin/earnings" component={Earnings} />
            <Route path="/admin/manage-admins" component={ManageAdmins} />
            <Route path="/admin/settings" component={Settings} />
            <Route path="/admin/private-account" component={PrivateAccount} />
          </>
        )}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.ok) return r.json();
        throw new Error("Not authenticated");
      })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    setLogoutCallback(() => {
      setUser(null);
    });
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  function handleLogin(u: AuthUser) {
    setUser(u);
  }

  function handlePanelNameChange(name: string) {
    setUser((prev) => prev ? { ...prev, panelName: name } : prev);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center cyber-grid" style={{ background: '#0d1117' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-emerald-400/10 blur-md animate-glow" />
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400/60 relative" />
          </div>
          <p className="text-[9px] text-emerald-400/30 font-mono uppercase tracking-[0.2em]">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {user ? (
          <Switch>
            <Route path="/">
              <Redirect to="/admin" />
            </Route>
            <Route path="/admin/:rest*">
              <AdminRoutes user={user} onLogout={handleLogout} onPanelNameChange={handlePanelNameChange} />
            </Route>
            <Route path="/admin">
              <AdminRoutes user={user} onLogout={handleLogout} onPanelNameChange={handlePanelNameChange} />
            </Route>
            <Route path="/login">
              <Redirect to="/admin" />
            </Route>
            <Route component={NotFound} />
          </Switch>
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

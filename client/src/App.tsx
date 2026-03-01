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
import Login from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

type AuthUser = {
  id: string;
  username: string;
  email: string;
  role: string;
};

function AdminRoutes({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return (
    <Layout user={user} onLogout={onLogout}>
      <Switch>
        <Route path="/admin" component={Dashboard} />
        <Route path="/admin/accounts" component={AccountStock} />
        <Route path="/admin/billing" component={Billing} />
        <Route path="/admin/auto-create" component={AutoCreate} />
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

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-900">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
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
              <AdminRoutes user={user} onLogout={handleLogout} />
            </Route>
            <Route path="/admin">
              <AdminRoutes user={user} onLogout={handleLogout} />
            </Route>
            <Route path="/login">
              <Redirect to="/admin" />
            </Route>
            <Route component={NotFound} />
          </Switch>
        ) : (
          <Login onLogin={setUser} />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

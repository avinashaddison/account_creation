import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import AccountStock from "@/pages/AccountStock";
import Billing from "@/pages/Billing";
import AutoCreate from "@/pages/AutoCreate";
import NotFound from "@/pages/not-found";

function AdminRoutes() {
  return (
    <Layout>
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

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/admin" />
      </Route>
      <Route path="/admin/:rest*" component={AdminRoutes} />
      <Route path="/admin" component={AdminRoutes} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

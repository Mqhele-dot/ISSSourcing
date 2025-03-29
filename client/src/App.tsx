import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Inventory from "@/pages/inventory";
import OrdersPage from "@/pages/orders";
import SuppliersPage from "@/pages/suppliers";
import Reports from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import Home from "@/pages/home";
import ReorderPage from "@/pages/reorder";
import { ThemeProvider } from "@/components/theme-provider";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import { useState } from "react";
import { TutorialProvider } from "./contexts/TutorialContext";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/inventory" component={Inventory} />
      <Route path="/orders" component={OrdersPage} />
      <Route path="/suppliers" component={SuppliersPage} />
      <Route path="/reports" component={Reports} />
      <Route path="/reorder" component={ReorderPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-neutral-100 dark:bg-neutral-900 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="invtrack-theme">
      <QueryClientProvider client={queryClient}>
        <TutorialProvider>
          <AppLayout>
            <Router />
          </AppLayout>
          <Toaster />
        </TutorialProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;

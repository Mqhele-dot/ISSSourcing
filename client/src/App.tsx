import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Inventory from "@/pages/inventory";
import InventoryItemDetail from "@/pages/inventory-item";
import OrdersPage from "@/pages/orders";
import SuppliersPage from "@/pages/suppliers";
import Reports from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import UserRolesPage from "@/pages/user-roles";
import Home from "@/pages/home";
import ReorderPage from "@/pages/reorder";
import AuthPage from "@/pages/auth-page";
import { ThemeProvider } from "@/components/theme-provider";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import { useState } from "react";
import { TutorialProvider } from "./contexts/TutorialContext";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { ElectronProvider, TitleBar, UpdateNotification } from "@/components/electron";

function Router() {
  return (
    <Switch>
      <ProtectedRoute path="/" component={Home} />
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/inventory" component={Inventory} />
      <ProtectedRoute path="/inventory/:id" component={InventoryItemDetail} />
      <ProtectedRoute path="/orders" component={OrdersPage} />
      <ProtectedRoute path="/suppliers" component={SuppliersPage} />
      <ProtectedRoute path="/reports" component={Reports} />
      <ProtectedRoute path="/reorder" component={ReorderPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <ProtectedRoute path="/user-roles" component={UserRolesPage} />
      <Route path="/auth" component={AuthPage} />
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
        <TitleBar title="InvTrack" />
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-neutral-100 dark:bg-neutral-900 p-4 md:p-6">
          <UpdateNotification />
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
        <AuthProvider>
          <TutorialProvider>
            <ElectronProvider>
              <div className="relative min-h-screen">
                <Route path="/auth">
                  <Router />
                </Route>
                <Route path="*">
                  {(params) => {
                    // Don't wrap non-auth routes with AppLayout
                    const pathname = params["*"] || "";
                    if (pathname === "auth") return null;
                    return (
                      <AppLayout>
                        <Router />
                      </AppLayout>
                    );
                  }}
                </Route>
              </div>
              <Toaster />
            </ElectronProvider>
          </TutorialProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;

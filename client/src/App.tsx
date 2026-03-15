import React from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Analytics from "@/pages/analytics";
import Inventory from "@/pages/inventory";
import InventoryItemDetail from "@/pages/inventory-item";
import OrdersPage from "@/pages/orders";
import PurchasePage from "@/pages/purchase-page";
import RequisitionsPage from "@/pages/requisitions";
import RequisitionFormPage from "@/pages/requisition-form";
import SuppliersPage from "@/pages/suppliers";
import ContractsPage from "@/pages/contracts";
import Reports from "@/pages/reports";
import InvoicesPage from "@/pages/invoices";
import SettingsPage from "@/pages/settings";
import UserRolesPage from "@/pages/user-roles";
import Home from "@/pages/home";
import ReorderPage from "@/pages/reorder";
import AuthPage from "@/pages/auth-page";
import BarcodeScannerPage from "@/pages/barcode-scanner-page";
import RealTimeUpdatesPage from "@/pages/real-time-updates-page";
import SyncTestPage from "@/pages/sync-test-page";
import SyncDashboard from "@/pages/sync-dashboard";
import DownloadPage from "@/pages/download";
import BillingPage from "@/pages/billing";
import ProfilePage from "@/pages/profile";
import ImageRecognitionPage from "@/pages/image-recognition-page";
import DocumentExtractorPage from "@/pages/document-extractor-page";
import WarehousesPage from "@/pages/warehouses";
import LogisticsPage from "@/pages/logistics";
import ExceptionsPage from "@/pages/exceptions";
import IntegrationsPage from "@/pages/integrations";
import MasterDataPage from "@/pages/master-data";
import CycleCountsPage from "@/pages/cycle-counts";
import AuditLogsPage from "@/pages/audit-logs";
import SupplierPortalPage from "@/pages/supplier-portal";
import DocumentsPage from "@/pages/documents";
import SupplyAnalyticsPage from "@/pages/supply-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { AccentProvider } from "@/components/accent-provider";
import { DensityProvider } from "@/components/density-provider";
import { useEffect } from "react";
import { TutorialProvider } from "@/contexts/tutorial-context";
import { HelpExplainProvider } from "@/contexts/help-explain-context";
import { TutorialSteps } from "@/components/tutorial/tutorial-steps";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { isElectronEnvironment } from "./lib/electron-bridge";
import { ElectronProvider } from "./contexts/electron-provider";
import { UpdateNotification } from "./components/electron";
import { DesktopLayout } from "./components/layout/desktop-layout";

// Error boundary component
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4">
          <Alert variant="destructive" className="max-w-2xl">
            <AlertTitle className="text-lg font-semibold">Something went wrong</AlertTitle>
            <AlertDescription className="mt-2">
              <div className="mb-4 text-sm">
                {this.state.error?.message || "An unexpected error occurred"}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => window.location.reload()}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reload Application
                </Button>
                <Button
                  variant="outline"
                  onClick={() => (window.location.href = "/")}
                >
                  Go back
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

function Router() {
  return (
    <Switch>
      <ProtectedRoute path="/" component={Home} />
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/analytics" component={Analytics} />
      <ProtectedRoute path="/inventory" component={Inventory} />
      <ProtectedRoute path="/inventory/:sku" component={InventoryItemDetail} />
      <ProtectedRoute path="/orders" component={PurchasePage} />
      <ProtectedRoute path="/orders/requisitions" component={PurchasePage} />
      <ProtectedRoute path="/orders/requisitions/new" component={RequisitionFormPage} />
      <ProtectedRoute path="/orders/requisitions/:id" component={RequisitionFormPage} />
      <ProtectedRoute path="/orders/:po" component={OrdersPage} />
      <ProtectedRoute path="/purchase/requisitions" component={PurchasePage} />
      <ProtectedRoute path="/purchase/:po" component={OrdersPage} />
      <ProtectedRoute path="/purchase" component={PurchasePage} />
      <ProtectedRoute path="/requisitions" component={RequisitionsPage} />
      <ProtectedRoute path="/requisitions/new" component={RequisitionFormPage} />
      <ProtectedRoute path="/requisitions/:id" component={RequisitionFormPage} />
      <ProtectedRoute path="/purchase/requisitions/new" component={RequisitionFormPage} />
      <ProtectedRoute path="/purchase/requisitions/:id" component={RequisitionFormPage} />
      <ProtectedRoute path="/logistics" component={LogisticsPage} />
      <ProtectedRoute path="/logistics/:id" component={LogisticsPage} />
      <ProtectedRoute path="/exceptions" component={ExceptionsPage} />
      <ProtectedRoute path="/exceptions/:id" component={ExceptionsPage} />
      <ProtectedRoute path="/integrations" component={IntegrationsPage} />
      <ProtectedRoute path="/master-data" component={MasterDataPage} />
      <ProtectedRoute path="/audit-logs" component={AuditLogsPage} />
      <ProtectedRoute path="/supplier-portal" component={SupplierPortalPage} />
      <ProtectedRoute path="/documents" component={DocumentsPage} />
      <ProtectedRoute path="/supply-analytics" component={SupplyAnalyticsPage} />
      <ProtectedRoute path="/suppliers" component={SuppliersPage} />
      <ProtectedRoute path="/contracts" component={ContractsPage} />
      <ProtectedRoute path="/invoices" component={InvoicesPage} />
      <ProtectedRoute path="/reports" component={Reports} />
      <ProtectedRoute path="/reorder" component={ReorderPage} />
      <ProtectedRoute path="/barcode-scanner" component={BarcodeScannerPage} />
      <ProtectedRoute path="/real-time-updates" component={RealTimeUpdatesPage} />
      <ProtectedRoute path="/sync-test" component={SyncTestPage} />
      <ProtectedRoute path="/sync-dashboard" component={SyncDashboard} />
      <ProtectedRoute path="/download" component={DownloadPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <ProtectedRoute path="/user-roles" component={UserRolesPage} />
      <ProtectedRoute path="/billing" component={BillingPage} />
      <ProtectedRoute path="/profile" component={ProfilePage} />
      <ProtectedRoute path="/image-recognition" component={ImageRecognitionPage} />
      <ProtectedRoute path="/document-extractor" component={DocumentExtractorPage} />
      <ProtectedRoute path="/warehouses" component={WarehousesPage} />
      <ProtectedRoute path="/cycle-counts" component={CycleCountsPage} />
      <Route path="/auth" component={AuthPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DesktopLayout>
      <UpdateNotification />
      {children}
    </DesktopLayout>
  );
}

// Function to set up Electron-specific features
function setupElectronApp() {
  if (isElectronEnvironment()) {
    // Add a class to the HTML element to allow for Electron-specific styling
    document.documentElement.classList.add('electron-app');
    
    // Disable drag and drop file behavior that may interfere with the app
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
    
    // Override the context menu for custom behavior if needed
    // document.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

function App() {
  // Set up Electron-specific HTML classes when in Electron environment
  useEffect(() => {
    setupElectronApp();
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" storageKey="invtrack-theme">
        <DensityProvider>
          <AccentProvider>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <TutorialProvider>
                  <HelpExplainProvider>
                  <ElectronProvider>
                    <div className="app-shell relative min-h-screen">
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
                    <TutorialSteps />
                    <Toaster />
                  </ElectronProvider>
                  </HelpExplainProvider>
                </TutorialProvider>
              </AuthProvider>
            </QueryClientProvider>
          </AccentProvider>
        </DensityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

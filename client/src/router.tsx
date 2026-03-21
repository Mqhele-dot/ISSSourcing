import React, { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/lib/protected-route";
import { Skeleton } from "@/components/ui/skeleton";

const NotFound = lazy(() => import("@/pages/not-found"));
const AuthPage = lazy(() => import("@/pages/auth-page"));
const Home = lazy(() => import("@/pages/home"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Analytics = lazy(() => import("@/pages/analytics"));
const Inventory = lazy(() => import("@/pages/inventory"));
const InventoryItemDetail = lazy(() => import("@/pages/inventory-item"));
const OrdersPage = lazy(() => import("@/pages/orders"));
const PurchasePage = lazy(() => import("@/pages/purchase-page"));
const RequisitionsPage = lazy(() => import("@/pages/requisitions"));
const RequisitionFormPage = lazy(() => import("@/pages/requisition-form"));
const SuppliersPage = lazy(() => import("@/pages/suppliers"));
const SupplierDetailPage = lazy(() => import("@/pages/supplier-detail"));
const ContractsPage = lazy(() => import("@/pages/contracts"));
const Reports = lazy(() => import("@/pages/reports"));
const InvoicesPage = lazy(() => import("@/pages/invoices"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const UserRolesPage = lazy(() => import("@/pages/user-roles"));
const ReorderPage = lazy(() => import("@/pages/reorder"));
const BarcodeScannerPage = lazy(() => import("@/pages/barcode-scanner-page"));
const RealTimeUpdatesPage = lazy(() => import("@/pages/real-time-updates-page"));
const SyncTestPage = lazy(() => import("@/pages/sync-test-page"));
const SyncDashboard = lazy(() => import("@/pages/sync-dashboard"));
const DownloadPage = lazy(() => import("@/pages/download"));
const BillingPage = lazy(() => import("@/pages/billing"));
const ProfilePage = lazy(() => import("@/pages/profile"));
const EmployeeProfilesPage = lazy(() => import("@/pages/employee-profiles"));
const ImageRecognitionPage = lazy(() => import("@/pages/image-recognition-page"));
const DocumentExtractorPage = lazy(() => import("@/pages/document-extractor-page"));
const WarehousesPage = lazy(() => import("@/pages/warehouses"));
const WarehouseDetailPage = lazy(() => import("@/pages/warehouse-detail"));
const LogisticsPage = lazy(() => import("@/pages/logistics"));
const ExceptionsPage = lazy(() => import("@/pages/exceptions"));
const IntegrationsPage = lazy(() => import("@/pages/integrations"));
const MasterDataPage = lazy(() => import("@/pages/master-data"));
const CycleCountsPage = lazy(() => import("@/pages/cycle-counts"));
const ApprovalPoliciesPage = lazy(() => import("@/pages/approval-policies"));
const WarehouseOperationsPage = lazy(() => import("@/pages/warehouse-operations"));
const AuditLogsPage = lazy(() => import("@/pages/audit-logs"));
const SupplierPortalPage = lazy(() => import("@/pages/supplier-portal"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const SupplyAnalyticsPage = lazy(() => import("@/pages/supply-analytics"));
const ControlTowerPage = lazy(() => import("@/pages/control-tower"));
const MobileReceivePage = lazy(() => import("@/pages/mobile-receive"));
const MobilePickPage = lazy(() => import("@/pages/mobile-pick"));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] flex-col gap-4 p-4 md:p-6" aria-busy="true" aria-label="Loading page">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        <span>Loading workspace…</span>
      </div>
      <div className="grid gap-3 max-w-3xl">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 pt-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}

export function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <ProtectedRoute path="/" component={Home} />
        <ProtectedRoute path="/control-tower" component={ControlTowerPage} />
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
        <ProtectedRoute path="/suppliers/:id" component={SupplierDetailPage} />
        <ProtectedRoute path="/suppliers" component={SuppliersPage} />
        <ProtectedRoute path="/contracts" component={ContractsPage} />
        <ProtectedRoute path="/invoices" component={InvoicesPage} />
        <ProtectedRoute path="/approval-policies" component={ApprovalPoliciesPage} />
        <ProtectedRoute path="/warehouse-operations" component={WarehouseOperationsPage} />
        <ProtectedRoute path="/mobile/receive" component={MobileReceivePage} />
        <ProtectedRoute path="/mobile/pick" component={MobilePickPage} />
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
        <ProtectedRoute path="/employee-profiles" component={EmployeeProfilesPage} />
        <ProtectedRoute path="/image-recognition" component={ImageRecognitionPage} />
        <ProtectedRoute path="/document-extractor" component={DocumentExtractorPage} />
        <ProtectedRoute path="/warehouses/:id" component={WarehouseDetailPage} />
        <ProtectedRoute path="/warehouses" component={WarehousesPage} />
        <ProtectedRoute path="/cycle-counts" component={CycleCountsPage} />
        <Route path="/auth" component={AuthPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

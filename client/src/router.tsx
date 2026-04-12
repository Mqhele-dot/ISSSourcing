import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/lib/protected-route";
import { APP_ROUTES } from "@/lib/routes/app-routes";
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
const UploadsPathRedirect = lazy(() => import("@/pages/uploads-redirect"));
const SupplyAnalyticsPage = lazy(() => import("@/pages/supply-analytics"));
const ControlTowerPage = lazy(() => import("@/pages/control-tower"));
const AccountsPayablePage = lazy(() => import("@/pages/accounts-payable"));
const AnalyticsWorkspacePage = lazy(() => import("@/pages/analytics-workspace"));
const SavedReportsPage = lazy(() => import("@/pages/saved-reports"));
const ExportCenterPage = lazy(() => import("@/pages/export-center"));
const MobileReceivePage = lazy(() => import("@/pages/mobile-receive"));
const MobilePickPage = lazy(() => import("@/pages/mobile-pick"));
const MobileHubHome = lazy(() => import("@/pages/mobile-hub-home"));
const MobileHubTasks = lazy(() => import("@/pages/mobile-hub-tasks"));
const MobileHubMore = lazy(() => import("@/pages/mobile-hub-more"));

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
        <ProtectedRoute path={APP_ROUTES.operations.mobileHub} component={MobileHubHome} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileTasks} component={MobileHubTasks} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileScan} component={BarcodeScannerPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileApprovals} component={PurchasePage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileMore} component={MobileHubMore} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileReceive} component={MobileReceivePage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobilePick} component={MobilePickPage} />

        <ProtectedRoute path={APP_ROUTES.home} component={Home} />

        <Route path={APP_ROUTES.analytics.root}>
          <Redirect to={APP_ROUTES.analytics.overview} />
        </Route>
        <ProtectedRoute path={APP_ROUTES.analytics.overview} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.inventory} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.procurement} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.finance} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.logistics} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.reports} component={Reports} />
        <ProtectedRoute path="/analytics/reports/:tab" component={Reports} />
        <ProtectedRoute path={APP_ROUTES.analytics.savedReports} component={SavedReportsPage} />
        <ProtectedRoute path={APP_ROUTES.analytics.exportCenter} component={ExportCenterPage} />

        <ProtectedRoute path={APP_ROUTES.operations.controlTower} component={ControlTowerPage} />
        <ProtectedRoute path={APP_ROUTES.operations.logistics} component={LogisticsPage} />
        <ProtectedRoute path="/operations/logistics/:id" component={LogisticsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.exceptions} component={ExceptionsPage} />
        <ProtectedRoute path="/operations/exceptions/:id" component={ExceptionsPage} />

        <ProtectedRoute path={APP_ROUTES.inventory.root} component={Inventory} />
        <ProtectedRoute path={APP_ROUTES.inventory.item(":sku")} component={InventoryItemDetail} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouses} component={WarehousesPage} />
        <ProtectedRoute path="/inventory/warehouses/:id" component={WarehouseDetailPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.cycleCounts} component={CycleCountsPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.reorder} component={ReorderPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.barcodeScanner} component={BarcodeScannerPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouseOperations} component={WarehouseOperationsPage} />

        <ProtectedRoute path={APP_ROUTES.procurement.orders} component={PurchasePage} />
        <ProtectedRoute path={APP_ROUTES.procurement.order(":po")} component={OrdersPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.requisitions} component={PurchasePage} />
        <ProtectedRoute path={APP_ROUTES.procurement.requisitionNew} component={RequisitionFormPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.requisition(":id")} component={RequisitionFormPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.suppliers} component={SuppliersPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.supplier(":id")} component={SupplierDetailPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.contracts} component={ContractsPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.supplierPortal} component={SupplierPortalPage} />

        <ProtectedRoute path={APP_ROUTES.finance.invoices} component={InvoicesPage} />
        <ProtectedRoute path={APP_ROUTES.finance.accountsPayable} component={AccountsPayablePage} />
        <ProtectedRoute path={APP_ROUTES.finance.approvalPolicies} component={ApprovalPoliciesPage} />
        <ProtectedRoute path={APP_ROUTES.finance.billing} component={BillingPage} />

        <ProtectedRoute path={APP_ROUTES.admin.integrations} component={IntegrationsPage} />
        <ProtectedRoute path={APP_ROUTES.admin.masterData} component={MasterDataPage} />
        <ProtectedRoute path="/admin/master-data/:section" component={MasterDataPage} />
        <ProtectedRoute path={APP_ROUTES.admin.auditLogs} component={AuditLogsPage} />
        <ProtectedRoute path={APP_ROUTES.admin.documents} component={DocumentsPage} />
        <ProtectedRoute path="/uploads/*" component={UploadsPathRedirect} />
        <ProtectedRoute path="/Uploads/*" component={UploadsPathRedirect} />
        <ProtectedRoute path={APP_ROUTES.admin.realTimeUpdates} component={RealTimeUpdatesPage} />
        <ProtectedRoute path={APP_ROUTES.admin.syncTest} component={SyncTestPage} />
        <ProtectedRoute path={APP_ROUTES.admin.syncDashboard} component={SyncDashboard} />
        <ProtectedRoute path={APP_ROUTES.admin.downloads} component={DownloadPage} />
        <ProtectedRoute path={APP_ROUTES.admin.settings} component={SettingsPage} />
        <ProtectedRoute path="/admin/settings/:section" component={SettingsPage} />
        <ProtectedRoute path={APP_ROUTES.admin.userRoles} component={UserRolesPage} />
        <ProtectedRoute path={APP_ROUTES.admin.profile} component={ProfilePage} />
        <ProtectedRoute path={APP_ROUTES.admin.employeeProfiles} component={EmployeeProfilesPage} />
        <ProtectedRoute path={APP_ROUTES.admin.imageRecognition} component={ImageRecognitionPage} />
        <ProtectedRoute path={APP_ROUTES.admin.documentExtractor} component={DocumentExtractorPage} />
        <ProtectedRoute path="/admin/document-extractor/:mode" component={DocumentExtractorPage} />

        <Route path="/dashboard">
          <Redirect to={APP_ROUTES.analytics.overview} />
        </Route>
        <Route path="/analytics">
          <Redirect to={APP_ROUTES.analytics.overview} />
        </Route>
        <Route path="/supply-analytics">
          <Redirect to={APP_ROUTES.analytics.procurement} />
        </Route>
        <Route path="/reports">
          <Redirect to={APP_ROUTES.analytics.reports} />
        </Route>
        <Route path="/control-tower">
          <Redirect to={APP_ROUTES.operations.controlTower} />
        </Route>
        <Route path="/logistics">
          <Redirect to={APP_ROUTES.operations.logistics} />
        </Route>
        <Route path="/logistics/:id">
          {(params) => <Redirect to={`/operations/logistics/${params.id}`} />}
        </Route>
        <Route path="/exceptions">
          <Redirect to={APP_ROUTES.operations.exceptions} />
        </Route>
        <Route path="/exceptions/:id">
          {(params) => <Redirect to={`/operations/exceptions/${params.id}`} />}
        </Route>
        <Route path="/purchase">
          <Redirect to={APP_ROUTES.procurement.orders} />
        </Route>
        <Route path="/orders">
          <Redirect to={APP_ROUTES.procurement.orders} />
        </Route>
        <Route path="/purchase/:po">
          {(params) => <Redirect to={APP_ROUTES.procurement.order(params.po)} />}
        </Route>
        <Route path="/orders/:po">
          {(params) => <Redirect to={APP_ROUTES.procurement.order(params.po)} />}
        </Route>
        <Route path="/purchase/requisitions">
          <Redirect to={APP_ROUTES.procurement.requisitions} />
        </Route>
        <Route path="/orders/requisitions">
          <Redirect to={APP_ROUTES.procurement.requisitions} />
        </Route>
        <Route path="/requisitions">
          <Redirect to={APP_ROUTES.procurement.requisitions} />
        </Route>
        <Route path="/purchase/requisitions/new">
          <Redirect to={APP_ROUTES.procurement.requisitionNew} />
        </Route>
        <Route path="/orders/requisitions/new">
          <Redirect to={APP_ROUTES.procurement.requisitionNew} />
        </Route>
        <Route path="/requisitions/new">
          <Redirect to={APP_ROUTES.procurement.requisitionNew} />
        </Route>
        <Route path="/purchase/requisitions/:id">
          {(params) => <Redirect to={APP_ROUTES.procurement.requisition(params.id)} />}
        </Route>
        <Route path="/orders/requisitions/:id">
          {(params) => <Redirect to={APP_ROUTES.procurement.requisition(params.id)} />}
        </Route>
        <Route path="/requisitions/:id">
          {(params) => <Redirect to={APP_ROUTES.procurement.requisition(params.id)} />}
        </Route>
        <Route path="/suppliers">
          <Redirect to={APP_ROUTES.procurement.suppliers} />
        </Route>
        <Route path="/suppliers/:id">
          {(params) => <Redirect to={APP_ROUTES.procurement.supplier(params.id)} />}
        </Route>
        <Route path="/contracts">
          <Redirect to={APP_ROUTES.procurement.contracts} />
        </Route>
        <Route path="/supplier-portal">
          <Redirect to={APP_ROUTES.procurement.supplierPortal} />
        </Route>
        <Route path="/invoices">
          <Redirect to={APP_ROUTES.finance.invoices} />
        </Route>
        <Route path="/accounts-payable">
          <Redirect to={APP_ROUTES.finance.accountsPayable} />
        </Route>
        <Route path="/approval-policies">
          <Redirect to={APP_ROUTES.finance.approvalPolicies} />
        </Route>
        <Route path="/billing">
          <Redirect to={APP_ROUTES.finance.billing} />
        </Route>
        <Route path="/integrations">
          <Redirect to={APP_ROUTES.admin.integrations} />
        </Route>
        <Route path="/master-data">
          <Redirect to={APP_ROUTES.admin.masterData} />
        </Route>
        <Route path="/audit-logs">
          <Redirect to={APP_ROUTES.admin.auditLogs} />
        </Route>
        <Route path="/documents">
          <Redirect to={APP_ROUTES.admin.documents} />
        </Route>
        <Route path="/mobile/receive">
          <Redirect to={APP_ROUTES.operations.mobileReceive} />
        </Route>
        <Route path="/mobile/pick">
          <Redirect to={APP_ROUTES.operations.mobilePick} />
        </Route>
        <Route path="/reorder">
          <Redirect to={APP_ROUTES.inventory.reorder} />
        </Route>
        <Route path="/barcode-scanner">
          <Redirect to={APP_ROUTES.inventory.barcodeScanner} />
        </Route>
        <Route path="/warehouse-operations">
          <Redirect to={APP_ROUTES.inventory.warehouseOperations} />
        </Route>
        <Route path="/warehouses">
          <Redirect to={APP_ROUTES.inventory.warehouses} />
        </Route>
        <Route path="/warehouses/:id">
          {(params) => <Redirect to={`/inventory/warehouses/${params.id}`} />}
        </Route>
        <Route path="/cycle-counts">
          <Redirect to={APP_ROUTES.inventory.cycleCounts} />
        </Route>
        <Route path="/settings">
          <Redirect to={APP_ROUTES.admin.settings} />
        </Route>
        <Route path="/user-roles">
          <Redirect to={APP_ROUTES.admin.userRoles} />
        </Route>
        <Route path="/profile">
          <Redirect to={APP_ROUTES.admin.profile} />
        </Route>
        <Route path="/employee-profiles">
          <Redirect to={APP_ROUTES.admin.employeeProfiles} />
        </Route>
        <Route path="/image-recognition">
          <Redirect to={APP_ROUTES.admin.imageRecognition} />
        </Route>
        <Route path="/document-extractor">
          <Redirect to={APP_ROUTES.admin.documentExtractor} />
        </Route>
        <Route path="/download">
          <Redirect to={APP_ROUTES.admin.downloads} />
        </Route>
        <Route path="/real-time-updates">
          <Redirect to={APP_ROUTES.admin.realTimeUpdates} />
        </Route>
        <Route path="/sync-test">
          <Redirect to={APP_ROUTES.admin.syncTest} />
        </Route>
        <Route path="/sync-dashboard">
          <Redirect to={APP_ROUTES.admin.syncDashboard} />
        </Route>
        <Route path="/auth" component={AuthPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

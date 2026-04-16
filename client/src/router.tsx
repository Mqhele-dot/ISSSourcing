import React, { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { ProtectedRoute } from "@/lib/protected-route";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { buildLegacyRedirectRules, type LegacyRedirectRule } from "@/lib/routes/legacy-redirects";
import { Skeleton } from "@/components/ui/skeleton";

const NotFound = lazy(() => import("@/pages/not-found"));
const AuthPage = lazy(() => import("@/pages/auth-page"));
const Home = lazy(() => import("@/pages/home"));
const Inventory = lazy(() => import("@/pages/inventory"));
const InventoryItemDetail = lazy(() => import("@/pages/inventory-item"));
const OrdersPage = lazy(() => import("@/pages/orders"));
const PurchasePage = lazy(() => import("@/pages/purchase-page"));
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
const ControlTowerPage = lazy(() => import("@/pages/control-tower"));
const AccountsPayablePage = lazy(() => import("@/pages/accounts-payable"));
const AccountsPayableRedirectToIntake = lazy(() => import("@/pages/accounts-payable/accounts-payable-redirect-to-intake"));
const AnalyticsWorkspacePage = lazy(() => import("@/pages/analytics-workspace"));
const SavedReportsPage = lazy(() => import("@/pages/saved-reports"));
const ExportCenterPage = lazy(() => import("@/pages/export-center"));
const OnboardingPage = lazy(() => import("@/pages/onboarding-page"));
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

const LEGACY_REDIRECT_RULES: LegacyRedirectRule[] = buildLegacyRedirectRules();

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
        <ProtectedRoute path={`${APP_ROUTES.operations.logistics}/:id`} component={LogisticsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.exceptions} component={ExceptionsPage} />
        <ProtectedRoute path={`${APP_ROUTES.operations.exceptions}/:id`} component={ExceptionsPage} />

        <ProtectedRoute path={APP_ROUTES.inventory.root} component={Inventory} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouses} component={WarehousesPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouse(":id")} component={WarehouseDetailPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.cycleCounts} component={CycleCountsPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.reorder} component={ReorderPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.barcodeScanner} component={BarcodeScannerPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouseOperations} component={WarehouseOperationsPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.item(":sku")} component={InventoryItemDetail} />

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
        <ProtectedRoute path="/finance/accounts-payable/:section" component={AccountsPayablePage} />
        <ProtectedRoute path={APP_ROUTES.finance.accountsPayable} component={AccountsPayableRedirectToIntake} />
        <ProtectedRoute path={APP_ROUTES.finance.approvalPolicies} component={ApprovalPoliciesPage} />
        <ProtectedRoute path={APP_ROUTES.finance.billing} component={BillingPage} />

        <ProtectedRoute path={APP_ROUTES.admin.integrations} component={IntegrationsPage} />
        <ProtectedRoute path={APP_ROUTES.admin.masterData} component={MasterDataPage} />
        <ProtectedRoute path={APP_ROUTES.admin.masterDataSection(":section")} component={MasterDataPage} />
        <ProtectedRoute path={APP_ROUTES.admin.auditLogs} component={AuditLogsPage} />
        <ProtectedRoute path={APP_ROUTES.admin.documents} component={DocumentsPage} />
        <ProtectedRoute path="/uploads/*" component={UploadsPathRedirect} />
        <ProtectedRoute path="/Uploads/*" component={UploadsPathRedirect} />
        <ProtectedRoute path={APP_ROUTES.admin.realTimeUpdates} component={RealTimeUpdatesPage} />
        <ProtectedRoute path={APP_ROUTES.admin.syncTest} component={SyncTestPage} />
        <ProtectedRoute path={APP_ROUTES.admin.syncDashboard} component={SyncDashboard} />
        <ProtectedRoute path={APP_ROUTES.admin.downloads} component={DownloadPage} />
        <ProtectedRoute path={APP_ROUTES.admin.onboarding} component={OnboardingPage} />
        <ProtectedRoute path={APP_ROUTES.admin.settings} component={SettingsPage} />
        <ProtectedRoute path={APP_ROUTES.admin.settingsSection(":section")} component={SettingsPage} />
        <ProtectedRoute path={APP_ROUTES.admin.userRoles} component={UserRolesPage} />
        <ProtectedRoute path={APP_ROUTES.admin.profile} component={ProfilePage} />
        <ProtectedRoute path={APP_ROUTES.admin.employeeProfiles} component={EmployeeProfilesPage} />
        <ProtectedRoute path={APP_ROUTES.admin.imageRecognition} component={ImageRecognitionPage} />
        <ProtectedRoute path={APP_ROUTES.admin.documentExtractor} component={DocumentExtractorPage} />
        <ProtectedRoute path={APP_ROUTES.admin.documentExtractorMode(":mode")} component={DocumentExtractorPage} />

        {LEGACY_REDIRECT_RULES.map((rule) => {
          if (rule.kind === "static") {
            return (
              <Route key={`s:${rule.path}`} path={rule.path}>
                <Redirect to={rule.to} />
              </Route>
            );
          }
          if (rule.kind === "idParam") {
            return (
              <Route key={`i:${rule.path}`} path={rule.path}>
                {(params) => <Redirect to={rule.to(params as { id: string })} />}
              </Route>
            );
          }
          return (
            <Route key={`p:${rule.path}`} path={rule.path}>
              {(params) => <Redirect to={rule.to(params as { po: string })} />}
            </Route>
          );
        })}
        <Route path="/auth" component={AuthPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

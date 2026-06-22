import React, { lazy } from "react";
import { Switch, Route, Redirect } from "wouter";
import { ProtectedRoute } from "@/lib/protected-route";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { buildLegacyRedirectRules, type LegacyRedirectRule } from "@/lib/routes/legacy-redirects";
import { RouteLoadingBoundary } from "@/app/route-loading-boundary";
import AuthPage from "@/pages/auth-page";

const NotFound = lazy(() => import("@/pages/not-found"));
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
const ProductSetupPage = lazy(() => import("@/pages/product-setup-page"));
const SystemDiagnosticsPage = lazy(() => import("@/pages/system-diagnostics-page"));
const MobileReceivePage = lazy(() => import("@/pages/mobile-receive"));
const MobilePickPage = lazy(() => import("@/pages/mobile-pick"));
const MobileCountsPage = lazy(() => import("@/pages/mobile-counts"));
const MobileHubHome = lazy(() => import("@/pages/mobile-hub-home"));
const MobileHubTasks = lazy(() => import("@/pages/mobile-hub-tasks"));
const MobileHubMore = lazy(() => import("@/pages/mobile-hub-more"));
const OperationsOverviewPage = lazy(() => import("@/pages/operations-overview-page"));
const MobileWorkflowsLauncherPage = lazy(() => import("@/pages/mobile-workflows-launcher-page"));
const DevTestPage = lazy(() => import("@/pages/dev-test-page"));
const GetEducatedPage = lazy(() => import("@/pages/get-educated"));
const GetEducatedModulePage = lazy(() => import("@/pages/get-educated-module"));

const LEGACY_REDIRECT_RULES: LegacyRedirectRule[] = buildLegacyRedirectRules();

export function AppRouter() {
  return (
    <RouteLoadingBoundary>
      <Switch>
        <ProtectedRoute path={APP_ROUTES.operations.mobileHub} component={MobileHubHome} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileTasks} component={MobileHubTasks} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileCountSpot} component={MobileCountsPage} />
        <ProtectedRoute path="/m/counts/:id/review" component={MobileCountsPage} />
        <ProtectedRoute path="/m/counts/:id" component={MobileCountsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileCounts} component={MobileCountsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileScan} component={BarcodeScannerPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileApprovals} component={PurchasePage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileMore} component={MobileHubMore} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileReceive} component={MobileReceivePage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobilePick} component={MobilePickPage} />

        <ProtectedRoute path={APP_ROUTES.setup.product} component={ProductSetupPage} />
        <ProtectedRoute path={APP_ROUTES.admin.systemDiagnostics} component={SystemDiagnosticsPage} />

        <ProtectedRoute path={APP_ROUTES.home} component={Home} />
        <ProtectedRoute path="/get-educated/:moduleId" component={GetEducatedModulePage} />
        <ProtectedRoute path={APP_ROUTES.training.getEducated} component={GetEducatedPage} />

        <ProtectedRoute path={APP_ROUTES.analytics.overview} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.inventory} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.procurement} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.finance} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.logistics} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.reports} component={Reports} />
        <ProtectedRoute path="/analytics/reports/:tab" component={Reports} />
        <ProtectedRoute path={APP_ROUTES.analytics.savedReports} component={SavedReportsPage} />
        <ProtectedRoute path={APP_ROUTES.analytics.exportCenter} component={ExportCenterPage} />

        <ProtectedRoute path={APP_ROUTES.operations.mobileWorkflows} component={MobileWorkflowsLauncherPage} />
        <ProtectedRoute path={APP_ROUTES.operations.root} component={OperationsOverviewPage} />
        <ProtectedRoute path={APP_ROUTES.operations.controlTower} component={ControlTowerPage} />
        <ProtectedRoute path={APP_ROUTES.operations.logistics} component={LogisticsPage} />
        <ProtectedRoute path={`${APP_ROUTES.operations.logistics}/:id`} component={LogisticsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.exceptions} component={ExceptionsPage} />
        <ProtectedRoute path={`${APP_ROUTES.operations.exceptions}/:id`} component={ExceptionsPage} />

        <ProtectedRoute path={APP_ROUTES.inventory.warehouses} component={WarehousesPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouse(":id")} component={WarehouseDetailPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.cycleCounts} component={CycleCountsPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.reorder} component={ReorderPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.barcodeScanner} component={BarcodeScannerPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouseOperations} component={WarehouseOperationsPage} />
        <ProtectedRoute path={`${APP_ROUTES.inventory.root}/:sku`} component={InventoryItemDetail} />
        <ProtectedRoute path={APP_ROUTES.inventory.root} component={Inventory} />

        <ProtectedRoute path={APP_ROUTES.procurement.orders} component={PurchasePage} />
        <ProtectedRoute path={`${APP_ROUTES.procurement.orders}/:po`} component={OrdersPage} />
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
        <Route path="/dev-test" component={DevTestPage} />
        <Route path="/auth" component={AuthPage} />
        <Route component={NotFound} />
      </Switch>
    </RouteLoadingBoundary>
  );
}

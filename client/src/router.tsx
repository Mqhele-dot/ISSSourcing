import React, { lazy } from "react";
import { Switch, Route, Redirect } from "wouter";
import { ProtectedRoute } from "@/lib/protected-route";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { buildLegacyRedirectRules, type LegacyRedirectRule } from "@/lib/routes/legacy-redirects";
import { RouteLoadingBoundary } from "@/app/route-loading-boundary";
import AuthPage from "@/pages/auth-page";
import { withProductionBoundary } from "@/components/production-boundary";

function LegacyRedirect({ to }: { to: string }) {
  const suffix = typeof window !== "undefined" ? window.location.search : "";
  return <Redirect to={`${to}${suffix && !to.includes("?") ? suffix : ""}`} />;
}

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
const SubscriptionPage = lazy(() => import("@/pages/subscription"));
const ReorderPage = lazy(() => import("@/pages/reorder"));
const BarcodeScannerPage = lazy(() => import("@/pages/barcode-scanner-page"));
const RealTimeUpdatesPage = lazy(() => import("@/pages/real-time-updates-page"));
const SyncTestPage = lazy(() => import("@/pages/sync-test-page"));
const SyncDashboard = lazy(() => import("@/pages/sync-dashboard"));
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
const SourcingPage = lazy(() => import("@/pages/sourcing"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const UploadsPathRedirect = lazy(() => import("@/pages/uploads-redirect"));
const ControlTowerPage = lazy(() => import("@/pages/control-tower"));
const FuelOperationsPage = lazy(() => import("@/pages/fuel-operations"));
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
const MobileHubMore = lazy(() => import("@/pages/mobile-hub-more"));
const MobileApprovalsPage = lazy(() => import("@/pages/mobile-approvals"));
const OperationsOverviewPage = lazy(() => import("@/pages/operations-overview-page"));
const MobileWorkflowsLauncherPage = lazy(() => import("@/pages/mobile-workflows-launcher-page"));
const DevTestPage = lazy(() => import("@/pages/dev-test-page"));
const GetEducatedPage = lazy(() => import("@/pages/get-educated"));
const GetEducatedModulePage = lazy(() => import("@/pages/get-educated-module"));

const ProductionLogisticsPage = withProductionBoundary(LogisticsPage, "logistics");
const ProductionExceptionsPage = withProductionBoundary(ExceptionsPage, "logistics");
const ProductionInventoryPage = withProductionBoundary(Inventory, "inventory");
const ProductionMobileReceivePage = withProductionBoundary(MobileReceivePage, "receiving");
const ProductionInvoicesPage = withProductionBoundary(InvoicesPage, "finance");
const ProductionAccountsPayablePage = withProductionBoundary(AccountsPayablePage, "finance");
const ProductionAccountsPayableRedirect = withProductionBoundary(AccountsPayableRedirectToIntake, "finance");
const ProductionInventoryDetailPage = withProductionBoundary(InventoryItemDetail, "inventory");
const ProductionWarehousesPage = withProductionBoundary(WarehousesPage, "inventory");
const ProductionWarehouseDetailPage = withProductionBoundary(WarehouseDetailPage, "inventory");
const ProductionWarehouseOperationsPage = withProductionBoundary(WarehouseOperationsPage, "inventory");
const ProductionCycleCountsPage = withProductionBoundary(CycleCountsPage, "inventory");
const ProductionReorderPage = withProductionBoundary(ReorderPage, "inventory");
const ProductionBarcodeScannerPage = withProductionBoundary(BarcodeScannerPage, "mobile_operations");
const ProductionMobileCountsPage = withProductionBoundary(MobileCountsPage, "mobile_operations");
const ProductionMobilePickPage = withProductionBoundary(MobilePickPage, "mobile_operations");
const ProductionMobileHubHome = withProductionBoundary(MobileHubHome, "mobile_operations");
const ProductionMobileHubMore = withProductionBoundary(MobileHubMore, "mobile_operations");
const ProductionOperationsOverviewPage = withProductionBoundary(OperationsOverviewPage, "logistics");
const ProductionControlTowerPage = withProductionBoundary(ControlTowerPage, "logistics");
const ProductionFuelOperationsPage = withProductionBoundary(FuelOperationsPage, "logistics");
const ProductionInventoryAnalyticsPage = withProductionBoundary(AnalyticsWorkspacePage, "inventory");
const ProductionFinanceAnalyticsPage = withProductionBoundary(AnalyticsWorkspacePage, "finance");
const ProductionLogisticsAnalyticsPage = withProductionBoundary(AnalyticsWorkspacePage, "logistics");

const LEGACY_REDIRECT_RULES: LegacyRedirectRule[] = buildLegacyRedirectRules();

export function AppRouter() {
  return (
    <RouteLoadingBoundary>
      <Switch>
        <ProtectedRoute path={APP_ROUTES.operations.mobileHub} component={ProductionMobileHubHome} />
        <Route path={APP_ROUTES.operations.mobileTasks}>
          <LegacyRedirect to={APP_ROUTES.operations.mobileHub} />
        </Route>
        <ProtectedRoute path={APP_ROUTES.operations.mobileCountSpot} component={ProductionMobileCountsPage} />
        <ProtectedRoute path="/m/counts/:id/review" component={ProductionMobileCountsPage} />
        <ProtectedRoute path="/m/counts/:id" component={ProductionMobileCountsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileCounts} component={ProductionMobileCountsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileScan} component={ProductionBarcodeScannerPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileApprovals} component={MobileApprovalsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileMore} component={ProductionMobileHubMore} />
        <ProtectedRoute path="/m/receive/:po" component={ProductionMobileReceivePage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobileReceive} component={ProductionMobileReceivePage} />
        <ProtectedRoute path={APP_ROUTES.operations.mobilePick} component={ProductionMobilePickPage} />

        <ProtectedRoute path={APP_ROUTES.setup.product} component={ProductSetupPage} />
        <ProtectedRoute path={APP_ROUTES.admin.systemDiagnostics} component={SystemDiagnosticsPage} allowedRoles={["admin"]} />

        <ProtectedRoute path={APP_ROUTES.home} component={Home} />
        <ProtectedRoute path="/get-educated/:moduleId" component={GetEducatedModulePage} />
        <ProtectedRoute path={APP_ROUTES.training.getEducated} component={GetEducatedPage} />

        <ProtectedRoute path={APP_ROUTES.analytics.overview} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.inventory} component={ProductionInventoryAnalyticsPage} />
        <ProtectedRoute path={APP_ROUTES.analytics.procurement} component={AnalyticsWorkspacePage} />
        <ProtectedRoute path={APP_ROUTES.analytics.finance} component={ProductionFinanceAnalyticsPage} />
        <ProtectedRoute path={APP_ROUTES.analytics.logistics} component={ProductionLogisticsAnalyticsPage} />
        <ProtectedRoute path={APP_ROUTES.analytics.reports} component={Reports} />
        <ProtectedRoute path="/analytics/reports/:tab" component={Reports} />
        <ProtectedRoute path={APP_ROUTES.analytics.savedReports} component={SavedReportsPage} />
        <ProtectedRoute path={APP_ROUTES.analytics.exportCenter} component={ExportCenterPage} />

        <ProtectedRoute path={APP_ROUTES.operations.mobileWorkflows} component={MobileWorkflowsLauncherPage} />
        <ProtectedRoute path={APP_ROUTES.operations.root} component={ProductionOperationsOverviewPage} />
        <ProtectedRoute path={APP_ROUTES.operations.controlTower} component={ProductionControlTowerPage} />
        <ProtectedRoute path={APP_ROUTES.operations.fuel} component={ProductionFuelOperationsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.logistics} component={ProductionLogisticsPage} />
        <ProtectedRoute path={`${APP_ROUTES.operations.logistics}/:id`} component={ProductionLogisticsPage} />
        <ProtectedRoute path={APP_ROUTES.operations.exceptions} component={ProductionExceptionsPage} />
        <ProtectedRoute path={`${APP_ROUTES.operations.exceptions}/:id`} component={ProductionExceptionsPage} />

        <ProtectedRoute path={APP_ROUTES.inventory.warehouses} component={ProductionWarehousesPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouse(":id")} component={ProductionWarehouseDetailPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.cycleCounts} component={ProductionCycleCountsPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.reorder} component={ProductionReorderPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.barcodeScanner} component={ProductionBarcodeScannerPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.warehouseOperations} component={ProductionWarehouseOperationsPage} />
        <ProtectedRoute path={`${APP_ROUTES.inventory.root}/:sku`} component={ProductionInventoryDetailPage} />
        <ProtectedRoute path={APP_ROUTES.inventory.root} component={ProductionInventoryPage} />

        <ProtectedRoute path={`${APP_ROUTES.procurement.sourcing}/:id`} component={SourcingPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.sourcing} component={SourcingPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.orders} component={PurchasePage} />
        <ProtectedRoute path={`${APP_ROUTES.procurement.orders}/:po`} component={OrdersPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.requisitions} component={PurchasePage} />
        <ProtectedRoute path={APP_ROUTES.procurement.requisitionNew} component={RequisitionFormPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.requisition(":id")} component={RequisitionFormPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.suppliers} component={SuppliersPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.supplier(":id")} component={SupplierDetailPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.contracts} component={ContractsPage} />
        <ProtectedRoute path={APP_ROUTES.procurement.supplierPortal} component={SupplierPortalPage} />

        <ProtectedRoute path={APP_ROUTES.finance.invoices} component={ProductionInvoicesPage} />
        <ProtectedRoute path="/finance/accounts-payable/:section" component={ProductionAccountsPayablePage} />
        <ProtectedRoute path={APP_ROUTES.finance.accountsPayable} component={ProductionAccountsPayableRedirect} />
        <ProtectedRoute path={APP_ROUTES.finance.approvalPolicies} component={ApprovalPoliciesPage} />
        <Route path={APP_ROUTES.finance.billing}>
          <Redirect to={APP_ROUTES.finance.invoices} />
        </Route>

        <ProtectedRoute path={APP_ROUTES.admin.integrations} component={IntegrationsPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.masterData} component={MasterDataPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.masterDataSection(":section")} component={MasterDataPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.auditLogs} component={AuditLogsPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.documents} component={DocumentsPage} allowedRoles={["manager", "admin"]} />
        <ProtectedRoute path="/uploads/*" component={UploadsPathRedirect} />
        <ProtectedRoute path="/Uploads/*" component={UploadsPathRedirect} />
        <ProtectedRoute path={APP_ROUTES.admin.realTimeUpdates} component={RealTimeUpdatesPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.syncTest} component={SyncTestPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.syncDashboard} component={SyncDashboard} allowedRoles={["admin"]} />
        <Route path={APP_ROUTES.admin.downloads}>
          <Redirect to={APP_ROUTES.analytics.exportCenter} />
        </Route>
        <ProtectedRoute path={APP_ROUTES.admin.onboarding} component={OnboardingPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.settings} component={SettingsPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.settingsSection(":section")} component={SettingsPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.userRoles} component={UserRolesPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.subscription} component={SubscriptionPage} allowedRoles={["admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.profile} component={ProfilePage} />
        <ProtectedRoute path={APP_ROUTES.admin.employeeProfiles} component={EmployeeProfilesPage} allowedRoles={["manager", "admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.imageRecognition} component={ImageRecognitionPage} />
        <ProtectedRoute path={APP_ROUTES.admin.documentExtractor} component={DocumentExtractorPage} allowedRoles={["manager", "admin"]} />
        <ProtectedRoute path={APP_ROUTES.admin.documentExtractorMode(":mode")} component={DocumentExtractorPage} allowedRoles={["manager", "admin"]} />

        {LEGACY_REDIRECT_RULES.map((rule) => {
          if (rule.kind === "static") {
            return (
              <Route key={`s:${rule.path}`} path={rule.path}>
                <LegacyRedirect to={rule.to} />
              </Route>
            );
          }
          if (rule.kind === "idParam") {
            return (
              <Route key={`i:${rule.path}`} path={rule.path}>
                {(params) => <LegacyRedirect to={rule.to(params as { id: string })} />}
              </Route>
            );
          }
          return (
            <Route key={`p:${rule.path}`} path={rule.path}>
              {(params) => <LegacyRedirect to={rule.to(params as { po: string })} />}
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

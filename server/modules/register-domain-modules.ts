import type { Express, RequestHandler } from "express";
import { registerInventoryCrudRoutes } from "./inventory/register-inventory-routes";
import { registerStockMovementRoutes } from "./inventory/register-stock-movement-routes";
import { registerBarcodeRoutes } from "./inventory/register-barcode-routes";
import { registerProcurementRoutes } from "./procurement/register-procurement-routes";
import { registerExtensionRoutes } from "./extensions/register-extensions";
import { registerOrganizationRoutes } from "./organization/register-organization-routes";
import { registerOnboardingRoutes } from "./onboarding/register-onboarding-routes";
import { registerSyncRoutes } from "./sync/register-sync-routes";
import { registerSupplierRoutes } from "./suppliers/register-supplier-routes";
import { registerNotificationRoutes } from "./notifications/register-notification-routes";
import { registerDocumentRoutes } from "./documents/register-document-routes";
import { registerContractRoutes } from "./contracts/register-contract-routes";
import { registerWarehouseRoutes } from "./warehouses/register-warehouse-routes";
import { registerReorderRequestRoutes } from "./reorder/register-reorder-routes";
import { registerGasRoutes } from "./gas/register-gas-routes";
import { registerApRoutes } from "./accounts-payable/register-ap-routes";
import { registerExportCenterRoutes } from "./exports/register-export-center-routes";
import { registerMobileCountRoutes } from "./mobile-counts/register-mobile-count-routes";
import { registerAuditRoutes } from "./audit/register-audit-routes";
import { registerSourcingRoutes } from "./sourcing/register-sourcing-routes";
import { registerV2Routes } from "./v2/register-v2-routes";
import { registerInventoryIssueRoutes } from "./inventory-issues/register-inventory-issue-routes";
import { registerCommercialQuotationRoutes } from "./commercial-quotations/register-commercial-quotation-routes";
import { registerCapabilityRoutes } from "./capabilities/register-capability-routes";
import { registerFinanceRoutes } from "./finance/register-finance-routes";
import { registerArRoutes } from "./finance/register-ar-routes";
import { registerProcurementCompletionRoutes } from "./procurement-completion/register-procurement-completion-routes";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
  ensureTwoFactorAuthenticated: RequestHandler;
};

/**
 * Domain routers mounted from `registerRoutes` before RBAC/catalog.
 * Master data CRUD + analytics JSON routes are registered separately in `routes.ts`
 * (after catalog) via `registerMasterDataRoutes` / `registerAnalyticsRoutes`.
 */
export function registerDomainModules(app: Express, auth: AuthBundle): void {
  registerV2Routes(app, auth);
  registerCapabilityRoutes(app, auth);
  registerFinanceRoutes(app, auth);
  registerArRoutes(app, auth);
  registerInventoryCrudRoutes(app, auth);
  registerStockMovementRoutes(app, auth);
  registerBarcodeRoutes(app, auth);
  registerMobileCountRoutes(app, auth);
  registerNotificationRoutes(app, auth);
  registerAuditRoutes(app, auth);
  registerDocumentRoutes(app, auth);
  registerContractRoutes(app, auth);
  registerWarehouseRoutes(app, auth);
  registerSupplierRoutes(app, auth);
  registerProcurementRoutes(app, auth);
  registerProcurementCompletionRoutes(app, auth);
  registerSourcingRoutes(app, auth);
  registerCommercialQuotationRoutes(app, auth);
  registerApRoutes(app, auth);
  registerInventoryIssueRoutes(app, auth);
  registerExportCenterRoutes(app, auth);
  registerOrganizationRoutes(app, auth);
  registerOnboardingRoutes(app, auth);
  registerSyncRoutes(app, auth);
  registerExtensionRoutes(app, auth);
  registerReorderRequestRoutes(app, auth);
  registerGasRoutes(app, auth);
}

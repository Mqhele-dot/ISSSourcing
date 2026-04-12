import type { Express } from "express";
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

type AuthBundle = {
  ensureAuthenticated: import("express").RequestHandler;
  ensureRole: (roles: string[]) => import("express").RequestHandler;
};

/**
 * Domain routers mounted from `registerRoutes` before RBAC/catalog.
 * Master data CRUD + analytics JSON routes are registered separately in `routes.ts`
 * (after catalog) via `registerMasterDataRoutes` / `registerAnalyticsRoutes`.
 */
export function registerDomainModules(app: Express, auth: AuthBundle): void {
  registerInventoryCrudRoutes(app, auth);
  registerStockMovementRoutes(app);
  registerBarcodeRoutes(app);
  registerNotificationRoutes(app, auth);
  registerDocumentRoutes(app, auth);
  registerContractRoutes(app, auth);
  registerWarehouseRoutes(app, auth);
  registerSupplierRoutes(app, auth);
  registerProcurementRoutes(app, auth);
  registerApRoutes(app, auth);
  registerOrganizationRoutes(app, auth);
  registerOnboardingRoutes(app, auth);
  registerSyncRoutes(app, auth);
  registerExtensionRoutes(app, auth);
  registerReorderRequestRoutes(app, auth);
  registerGasRoutes(app, auth);
}

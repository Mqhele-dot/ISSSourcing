import type { Express } from "express";
import { registerInventoryCrudRoutes } from "./inventory/register-inventory-routes";
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

type AuthBundle = {
  ensureAuthenticated: import("express").RequestHandler;
  ensureRole: (roles: string[]) => import("express").RequestHandler;
};

/** Domain routers mounted from `registerRoutes` (inventory, procurement slices, extensions). */
export function registerDomainModules(app: Express, auth: AuthBundle): void {
  registerInventoryCrudRoutes(app, auth);
  registerNotificationRoutes(app, auth);
  registerDocumentRoutes(app, auth);
  registerContractRoutes(app, auth);
  registerWarehouseRoutes(app, auth);
  registerSupplierRoutes(app, auth);
  registerProcurementRoutes(app, auth);
  registerOrganizationRoutes(app, auth);
  registerOnboardingRoutes(app, auth);
  registerSyncRoutes(app, auth);
  registerExtensionRoutes(app, auth);
  registerReorderRequestRoutes(app, auth);
}

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = path.join(__dirname, "../server/modules/suppliers");

const header = `import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { sendFunctionError } from "../../api-response";
import { emitNotificationToRoles } from "../../services/notification-emitter";
import { createSupplierRepository } from "../../repositories";
import { createSupplierService } from "../../services/supplier-service";
import { insertSupplierSchema, insertSupplierLogoSchema, PurchaseOrderStatus } from "@shared/schema";
import type { AuthBundle } from "../procurement/types";

const supplierRepo = createSupplierRepository(storage);
const supplierService = createSupplierService(supplierRepo, storage);

/**
 * Supplier CRUD, supplier portal, logos — org-scoped via repositories/storage.
 */
export function registerSupplierRoutes(app: Express, auth: AuthBundle): void {
`;

const a = fs.readFileSync(path.join(mod, "_body-a.txt"), "utf8");
const logos = fs.readFileSync(path.join(mod, "_body-logos.txt"), "utf8");
const footer = "}\n";

fs.writeFileSync(path.join(mod, "register-supplier-routes.ts"), header + a + "\n" + logos + footer);
console.log("wrote register-supplier-routes.ts", fs.statSync(path.join(mod, "register-supplier-routes.ts")).size);

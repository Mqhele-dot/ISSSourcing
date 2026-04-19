import type { Express, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { approvalPolicies, departments, organizations, paymentTerms, warehouses } from "@shared/schema";
import { db, pool } from "../../db";
import { sendOk } from "../../api-response";
import { appEnv } from "../../config/env";
import { readiness } from "../../readiness";
import { storage } from "../../storage";
import { getActiveOrganizationId } from "../../organization-context";
import { getProductBootstrapHints } from "../../lib/product-bootstrap";
import { getBuildInfo } from "../../lib/build-info";
import fs from "node:fs";
import path from "node:path";
import { exportsDir, uploadsDir } from "../../http/upload-config";
import { getLatestFailedExportJobForOrg } from "../exports/export-jobs";

type Auth = { ensureAuthenticated: RequestHandler };

function currencySymbolFromCode(code: string, locale = "en"): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: "currency", currency: code }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

function directoryWritableProbe(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}-${Date.now()}`);
    try {
      fs.writeFileSync(probe, "ok");
      return true;
    } finally {
      try {
        fs.unlinkSync(probe);
      } catch {
        /* ignore */
      }
    }
  } catch {
    return false;
  }
}

async function ensureStarterApprovalPolicies(organizationId: number): Promise<void> {
  const existing = await db
    .select({ id: approvalPolicies.id })
    .from(approvalPolicies)
    .where(eq(approvalPolicies.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(approvalPolicies).values([
    {
      organizationId,
      name: "Requisition Standard Approval",
      entityType: "requisition",
      amountMin: 0,
      amountMax: 5000,
      approvalLevel: 1,
      approverRole: "manager",
      isActive: true,
    },
    {
      organizationId,
      name: "PO High Value Approval",
      entityType: "purchase_order",
      amountMin: 5000,
      amountMax: null,
      approvalLevel: 2,
      approverRole: "admin",
      isActive: true,
    },
  ]);
}

const checkpointBodySchema = z.object({
  step: z.string().min(1).max(64),
  draft: z.record(z.unknown()).optional(),
});

const completeBodySchema = z.object({
  companyName: z.string().min(2).max(200),
  currencyCode: z
    .string()
    .length(3)
    .regex(/^[A-Za-z]{3}$/)
    .transform((s) => s.toUpperCase()),
  businessCountryCode: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .transform((s) => s.toUpperCase()),
  taxMode: z.enum(["none", "vat", "us_sales_tax"]),
  warehouseName: z.string().min(1).max(120),
  departmentCodes: z.array(z.string().min(1).max(16)).max(12).optional(),
  departmentNames: z.array(z.string().min(1).max(120)).max(12).optional(),
  paymentTermCode: z.string().min(1).max(32).optional(),
  paymentTermName: z.string().min(1).max(120).optional(),
  paymentTermNetDays: z.coerce.number().int().min(0).max(365).optional(),
});

export function registerSetupRoutes(app: Express, auth: Auth): void {
  app.get("/api/setup/status", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
      const settings = await storage.getAppSettings();
      const hints = await getProductBootstrapHints().catch(() => null);
      const completedAt = settings?.productOnboardingCompletedAt ?? null;
      const onboardingRequired = !appEnv.skipProductOnboarding && !completedAt;
      const role = req.user && typeof req.user === "object" && "role" in req.user ? String((req.user as { role?: string }).role) : null;

      let databaseOk = true;
      let databaseError: string | null = null;
      try {
        await pool.query("SELECT 1");
      } catch (e) {
        databaseOk = false;
        databaseError = e instanceof Error ? e.message : "Unknown database error";
      }

      let drizzleMigrationCount: number | null = null;
      try {
        const mig = await pool.query(`SELECT COUNT(*)::int AS c FROM __drizzle_migrations`);
        drizzleMigrationCount = mig.rows[0]?.c != null ? Number(mig.rows[0].c) : null;
      } catch {
        drizzleMigrationCount = null;
      }

      let lastExportFailure: { id: number; lastError: string; updatedAt: string } | null = null;
      try {
        lastExportFailure = await getLatestFailedExportJobForOrg(orgId);
      } catch {
        lastExportFailure = null;
      }

      return sendOk(res, {
        deploymentMode: appEnv.deploymentMode,
        runtimeProfile: appEnv.runtimeProfile,
        build: getBuildInfo(),
        skipProductOnboarding: appEnv.skipProductOnboarding,
        allowSetupSkip: appEnv.allowSetupSkip,
        database: { ok: databaseOk, error: databaseError },
        productBootstrap: hints,
        organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
        onboarding: {
          completedAt: completedAt ? completedAt.toISOString() : null,
          required: onboardingRequired,
          adminMayContinue: role === "admin",
          checkpoint: settings?.productOnboardingState ?? null,
        },
        uploads: { pathReady: fs.existsSync(uploadsDir), path: uploadsDir, writable: directoryWritableProbe(uploadsDir) },
        exports: { pathReady: fs.existsSync(exportsDir), path: exportsDir, writable: directoryWritableProbe(exportsDir) },
        diagnostics: {
          drizzleMigrationCount,
          lastExportFailure,
        },
        realtime: { websocketReady: readiness.websocketReady },
        sessionStoreReady: readiness.sessionStoreReady,
      });
    } catch (e) {
      console.error("GET /api/setup/status:", e);
      res.status(500).json({ message: "Failed to load setup status" });
    }
  });

  app.put("/api/setup/product/checkpoint", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!req.user || (req.user as { role?: string }).role !== "admin") {
        return res.status(403).json({ message: "Only administrators can update setup progress." });
      }
      const body = checkpointBodySchema.parse(req.body);
      const settings = await storage.getAppSettings();
      if (!settings) {
        return res.status(400).json({ message: "App settings are not initialized for this organization." });
      }
      if (settings.productOnboardingCompletedAt) {
        return res.status(400).json({ message: "Product onboarding is already complete." });
      }
      const checkpoint = {
        step: body.step,
        ...(body.draft ? { draft: body.draft } : {}),
        savedAt: new Date().toISOString(),
      };
      const updated = await storage.updateAppSettings({
        productOnboardingState: checkpoint,
      });
      return sendOk(res, updated);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("PUT /api/setup/product/checkpoint:", error);
      res.status(500).json({ message: "Failed to save setup progress" });
    }
  });

  app.post("/api/setup/product/complete", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!req.user || (req.user as { role?: string }).role !== "admin") {
        return res.status(403).json({ message: "Only administrators can complete product setup." });
      }
      const body = completeBodySchema.parse(req.body);
      const orgId = getActiveOrganizationId();
      const settings = await storage.getAppSettings();
      if (!settings) {
        return res.status(400).json({ message: "App settings are not initialized for this organization." });
      }
      if (settings.productOnboardingCompletedAt) {
        return res.status(400).json({ message: "Product onboarding is already complete." });
      }

      const whName = body.warehouseName.trim();
      const [dupWh] = await db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.name, whName)))
        .limit(1);
      if (dupWh) {
        return res.status(409).json({
          message: `A warehouse named "${whName}" already exists for this organization. Choose a different name.`,
        });
      }

      const enableVat = body.taxMode === "vat";
      const defaultVatCountry = body.businessCountryCode;

      const wh = await storage.createWarehouse({
        name: whName,
        organizationId: orgId,
        isDefault: true,
      });
      await storage.setDefaultWarehouse(wh.id);

      const codes = body.departmentCodes?.length ? body.departmentCodes : ["OPS", "PROC", "FIN"];
      const names = body.departmentNames?.length ? body.departmentNames : codes;
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i]!;
        const name = names[i] ?? code;
        await db
          .insert(departments)
          .values({
            organizationId: orgId,
            code: code.toUpperCase(),
            name,
            active: true,
          })
          .onConflictDoNothing({ target: [departments.organizationId, departments.code] });
      }

      if (body.paymentTermCode && body.paymentTermName) {
        await db
          .insert(paymentTerms)
          .values({
            code: body.paymentTermCode.toUpperCase(),
            name: body.paymentTermName,
            netDays: body.paymentTermNetDays ?? 30,
            active: true,
          })
          .onConflictDoNothing({ target: paymentTerms.code });
      }

      const updated = await storage.updateAppSettings({
        companyName: body.companyName.trim(),
        currencyCode: body.currencyCode,
        currencySymbol: currencySymbolFromCode(body.currencyCode),
        businessCountryCode: body.businessCountryCode,
        taxMode: body.taxMode,
        enableVat,
        defaultVatCountry,
        showPricesWithVat: enableVat,
        defaultWarehouseId: wh.id,
        productOnboardingCompletedAt: new Date(),
        productOnboardingState: null,
      });

      await db
        .update(organizations)
        .set({ name: body.companyName.trim(), updatedAt: new Date() })
        .where(and(eq(organizations.id, orgId)));

      await ensureStarterApprovalPolicies(orgId);

      return sendOk(res, updated);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("POST /api/setup/product/complete:", error);
      res.status(500).json({ message: "Failed to complete product setup" });
    }
  });

  app.post("/api/setup/product/skip", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      if (!appEnv.allowSetupSkip) {
        return res.status(403).json({ message: "Product setup skip is not enabled on this server." });
      }
      if (!req.user || (req.user as { role?: string }).role !== "admin") {
        return res.status(403).json({ message: "Only administrators can skip product setup." });
      }
      const settings = await storage.getAppSettings();
      if (!settings) {
        return res.status(400).json({ message: "App settings are not initialized for this organization." });
      }
      if (settings.productOnboardingCompletedAt) {
        return res.status(400).json({ message: "Product onboarding is already complete." });
      }
      const updated = await storage.updateAppSettings({
        productOnboardingCompletedAt: new Date(),
        productOnboardingState: null,
      });
      return sendOk(res, updated);
    } catch (e) {
      console.error("POST /api/setup/product/skip:", e);
      res.status(500).json({ message: "Failed to skip product setup" });
    }
  });
}

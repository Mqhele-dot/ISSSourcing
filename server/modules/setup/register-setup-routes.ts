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

type SetupStatusIssueLevel = "critical" | "warning";

type SetupStatusIssueEntry = { code: string; message: string; level: SetupStatusIssueLevel };

function resolveRequestIdForLog(res: Response): string {
  const fromLocals =
    res.locals && typeof (res.locals as { requestId?: unknown }).requestId === "string"
      ? (res.locals as { requestId: string }).requestId
      : "";
  const fromHeader = res.getHeader("X-Request-Id");
  const headerStr = typeof fromHeader === "string" ? fromHeader : Array.isArray(fromHeader) ? fromHeader[0] : "";
  return fromLocals || headerStr || "-";
}

function resolveUserIdForLog(req: Request): string | number | undefined {
  const u = req.user as { id?: unknown } | undefined;
  if (u && typeof u === "object" && "id" in u && (typeof u.id === "string" || typeof u.id === "number")) {
    return u.id;
  }
  return undefined;
}

function safeGetBuildInfo() {
  try {
    return getBuildInfo();
  } catch (e) {
    console.error("[SETUP_STATUS] SETUP_STATUS_BUILD_INFO_FAILED", e instanceof Error ? e.message : e);
    return {
      version: "unknown",
      commitSha: null as string | null,
      buildId: null as string | null,
      builtAt: null as string | null,
      runtimeProfile: appEnv.runtimeProfile,
      deploymentMode: appEnv.deploymentMode,
    };
  }
}

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
  dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]).optional(),
  timeFormat: z.enum(["HH:mm", "hh:mm A"]).optional(),
});

export function registerSetupRoutes(app: Express, auth: Auth): void {
  app.get("/api/setup/status", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    const requestId = resolveRequestIdForLog(res);
    const userId = resolveUserIdForLog(req);
    const orgId = getActiveOrganizationId();

    try {
      const issues: SetupStatusIssueEntry[] = [];
      const role = req.user && typeof req.user === "object" && "role" in req.user ? String((req.user as { role?: string }).role) : null;

      let org: { id: number; name: string; slug: string | null } | null = null;
      try {
        const rows = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
        org = rows[0] ?? null;
        if (!org) {
          issues.push({
            code: "SETUP_STATUS_ORG_NOT_FOUND",
            message: `No organization row for active org id ${orgId}.`,
            level: "critical",
          });
          console.error("[SETUP_STATUS] SETUP_STATUS_ORG_NOT_FOUND", orgId);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        issues.push({ code: "SETUP_STATUS_ORG_QUERY_FAILED", message: msg, level: "critical" });
        console.error("[SETUP_STATUS] SETUP_STATUS_ORG_QUERY_FAILED", msg);
      }

      let settings: Awaited<ReturnType<typeof storage.getAppSettings>> | undefined;
      try {
        settings = await storage.getAppSettings();
        if (!settings) {
          issues.push({
            code: "SETUP_STATUS_SETTINGS_MISSING",
            message: "App settings are not initialized for this organization.",
            level: "critical",
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        issues.push({ code: "SETUP_STATUS_SETTINGS_FAILED", message: msg, level: "critical" });
        console.error("[SETUP_STATUS] SETUP_STATUS_SETTINGS_FAILED", msg);
      }

      const hints = await getProductBootstrapHints().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        issues.push({ code: "SETUP_STATUS_BOOTSTRAP_HINTS_FAILED", message: msg, level: "warning" });
        console.error("[SETUP_STATUS] SETUP_STATUS_BOOTSTRAP_HINTS_FAILED", msg);
        return null;
      });

      const completedAt = settings?.productOnboardingCompletedAt ?? null;
      const onboardingRequired = !appEnv.skipProductOnboarding && !completedAt;

      let databaseOk = true;
      let databaseError: string | null = null;
      try {
        await pool.query("SELECT 1");
      } catch (e) {
        databaseOk = false;
        databaseError = e instanceof Error ? e.message : "Unknown database error";
        issues.push({ code: "SETUP_STATUS_DB_PING_FAILED", message: databaseError, level: "critical" });
        console.error("[SETUP_STATUS] SETUP_STATUS_DB_PING_FAILED", databaseError);
      }

      let drizzleMigrationCount: number | null = null;
      try {
        const existsRow = await pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
          ) AS exists`,
        );
        if (existsRow.rows[0]?.exists) {
          const mig = await pool.query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM __drizzle_migrations`);
          drizzleMigrationCount = mig.rows[0]?.c != null ? Number(mig.rows[0].c) : null;
        }
        // No table: normal for `drizzle-kit push`–only workflows (migrate never ran).
      } catch (e) {
        drizzleMigrationCount = null;
        const msg = e instanceof Error ? e.message : String(e);
        issues.push({ code: "SETUP_STATUS_MIGRATIONS_QUERY_FAILED", message: msg, level: "warning" });
        console.error("[SETUP_STATUS] SETUP_STATUS_MIGRATIONS_QUERY_FAILED", msg);
      }

      let lastExportFailure: { id: number; lastError: string; updatedAt: string } | null = null;
      try {
        lastExportFailure = await getLatestFailedExportJobForOrg(orgId);
      } catch (e) {
        lastExportFailure = null;
        const msg = e instanceof Error ? e.message : String(e);
        issues.push({ code: "SETUP_STATUS_EXPORT_DIAG_FAILED", message: msg, level: "warning" });
        console.error("[SETUP_STATUS] SETUP_STATUS_EXPORT_DIAG_FAILED", msg);
      }

      const criticalIssues = issues.filter((i) => i.level === "critical");
      const setupStatusHealth: "ok" | "degraded" = !databaseOk || criticalIssues.length > 0 ? "degraded" : "ok";

      const firstCode =
        criticalIssues[0]?.code ?? issues[0]?.code ?? (setupStatusHealth === "ok" ? "OK" : "UNKNOWN");
      const summaryLine = `[SETUP_STATUS] summary requestId=${requestId} userId=${userId ?? "-"} orgId=${orgId} health=${setupStatusHealth} firstCode=${firstCode} criticalCount=${criticalIssues.length} warningCount=${issues.length - criticalIssues.length}`;
      if (setupStatusHealth === "degraded" || criticalIssues.length > 0) {
        console.error(summaryLine);
      } else {
        console.info(summaryLine);
      }

      let uploadsPathReady = false;
      let exportsPathReady = false;
      let uploadsWritable = false;
      let exportsWritable = false;
      try {
        uploadsPathReady = fs.existsSync(uploadsDir);
        exportsPathReady = fs.existsSync(exportsDir);
        uploadsWritable = directoryWritableProbe(uploadsDir);
        exportsWritable = directoryWritableProbe(exportsDir);
      } catch (probeErr) {
        console.error("[SETUP_STATUS] SETUP_STATUS_PATH_PROBE_FAILED", probeErr instanceof Error ? probeErr.message : probeErr);
      }

      return sendOk(res, {
        setupStatusHealth,
        issues: issues.length > 0 ? issues : undefined,
        deploymentMode: appEnv.deploymentMode,
        runtimeProfile: appEnv.runtimeProfile,
        build: safeGetBuildInfo(),
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
        uploads: { pathReady: uploadsPathReady, path: uploadsDir, writable: uploadsWritable },
        exports: { pathReady: exportsPathReady, path: exportsDir, writable: exportsWritable },
        diagnostics: {
          drizzleMigrationCount,
          lastExportFailure,
        },
        realtime: { websocketReady: readiness.websocketReady },
        sessionStoreReady: readiness.sessionStoreReady,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[SETUP_STATUS] SETUP_STATUS_UNHANDLED", { requestId, userId, orgId, message: msg });
      return sendOk(res, {
        setupStatusHealth: "degraded",
        issues: [{ code: "SETUP_STATUS_UNHANDLED", message: msg, level: "critical" }],
        deploymentMode: appEnv.deploymentMode,
        runtimeProfile: appEnv.runtimeProfile,
        build: safeGetBuildInfo(),
        skipProductOnboarding: appEnv.skipProductOnboarding,
        allowSetupSkip: appEnv.allowSetupSkip,
        database: { ok: false, error: msg },
        productBootstrap: null,
        organization: null,
        onboarding: {
          completedAt: null,
          required: true,
          adminMayContinue: false,
          checkpoint: null,
        },
        uploads: { pathReady: false, path: uploadsDir, writable: false },
        exports: { pathReady: false, path: exportsDir, writable: false },
        diagnostics: { drizzleMigrationCount: null, lastExportFailure: null },
        realtime: { websocketReady: readiness.websocketReady },
        sessionStoreReady: readiness.sessionStoreReady,
      });
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
        ...(body.dateFormat ? { dateFormat: body.dateFormat } : {}),
        ...(body.timeFormat ? { timeFormat: body.timeFormat } : {}),
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

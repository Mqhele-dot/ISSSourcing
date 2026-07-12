import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  billingWebhookEvents,
  companyConfigurationSettings,
  organizationMembers,
  organizationSettings,
  organizations,
  planChangeAudit,
  usageCounters,
  warehouses,
  inventoryItems,
} from "@shared/schema";
import { getActiveOrganizationId } from "../../organization-context";
import { getOrgSubscriptionForActiveOrg } from "../../org-features";
import { sendError, sendOk } from "../../api-response";
import { getConfigurationDefinitionsForPlan } from "../../company-configuration-registry";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensurePermission?: (resource: string, permissionType: string) => RequestHandler;
};

type BillingProviderStatus = {
  provider: "stripe" | "paypal";
  supported: boolean;
  configured: boolean;
  publicKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  checkoutReady: boolean;
  portalReady: boolean;
  webhookConfigured: boolean;
  priceMappingsConfigured: boolean;
};

type UsageSummary = {
  key: string;
  value: number;
  limit: number | null;
  remaining: number | null;
  percentUsed: number | null;
  withinPlan: boolean;
};

const changePlanSchema = z.object({
  planTier: z.enum(["starter", "standard", "growth", "enterprise"]),
  reason: z.string().max(500).optional(),
});

const configUpdateSchema = z.object({
  value: z.unknown(),
  scope: z.enum(["organization", "warehouse", "role"]).default("organization"),
  scopeId: z.string().max(128).optional().nullable(),
});

const usageEventSchema = z.object({
  counterKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_.-]+$/i, "Counter key may only include letters, numbers, dots, hyphens, and underscores."),
  value: z.coerce.number().int().min(1).default(1),
});

function buildUsageSummary(
  limits: { users: number | null; warehouses: number | null; skus: number | null },
  rows: Array<{ counterKey: string; value: number }>,
): UsageSummary[] {
  const limitByKey: Record<string, number | null> = {
    users: limits.users,
    warehouses: limits.warehouses,
    skus: limits.skus,
  };

  return rows
    .map((row) => {
      const limit = Object.prototype.hasOwnProperty.call(limitByKey, row.counterKey) ? limitByKey[row.counterKey] : null;
      const remaining = typeof limit === "number" ? Math.max(limit - row.value, 0) : null;
      const percentUsed = typeof limit === "number" && limit > 0 ? Math.min(100, Math.round((row.value / limit) * 100)) : null;
      return {
        key: row.counterKey,
        value: row.value,
        limit,
        remaining,
        percentUsed,
        withinPlan: limit == null ? true : row.value <= limit,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function currentUserId(req: Request): number | null {
  return (req as Request & { user?: { id?: number } }).user?.id ?? null;
}

function requireConfigWrite(auth: Auth): RequestHandler[] {
  return auth.ensurePermission
    ? [auth.ensureAuthenticated, auth.ensurePermission("settings", "configure")]
    : [auth.ensureAuthenticated];
}

function hasConfiguredValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function hasStripePriceMappings(): boolean {
  return Object.entries(process.env).some(
    ([key, value]) => key.startsWith("STRIPE_PRICE_ID_") && hasConfiguredValue(value),
  );
}

function getBillingProviderStatuses(): {
  activeProvider: "stripe" | "paypal" | null;
  stripe: BillingProviderStatus;
  paypal: BillingProviderStatus;
} {
  const stripePublicKeyConfigured =
    hasConfiguredValue(process.env.VITE_STRIPE_PUBLIC_KEY) || hasConfiguredValue(process.env.STRIPE_PUBLIC_KEY);
  const stripeSecretKeyConfigured = hasConfiguredValue(process.env.STRIPE_SECRET_KEY);
  const stripeWebhookConfigured = hasConfiguredValue(process.env.STRIPE_WEBHOOK_SECRET);
  const stripePriceMappingsConfigured = hasStripePriceMappings();

  const paypalPublicKeyConfigured =
    hasConfiguredValue(process.env.PAYPAL_CLIENT_ID) || hasConfiguredValue(process.env.VITE_PAYPAL_CLIENT_ID);
  const paypalSecretKeyConfigured = hasConfiguredValue(process.env.PAYPAL_CLIENT_SECRET);
  const paypalWebhookConfigured = hasConfiguredValue(process.env.PAYPAL_WEBHOOK_ID);

  const stripe: BillingProviderStatus = {
    provider: "stripe",
    supported: true,
    configured: stripePublicKeyConfigured && stripeSecretKeyConfigured,
    publicKeyConfigured: stripePublicKeyConfigured,
    secretKeyConfigured: stripeSecretKeyConfigured,
    checkoutReady: stripePublicKeyConfigured && stripeSecretKeyConfigured && stripePriceMappingsConfigured,
    portalReady: stripeSecretKeyConfigured,
    webhookConfigured: stripeWebhookConfigured,
    priceMappingsConfigured: stripePriceMappingsConfigured,
  };

  const paypal: BillingProviderStatus = {
    provider: "paypal",
    supported: false,
    configured: paypalPublicKeyConfigured && paypalSecretKeyConfigured,
    publicKeyConfigured: paypalPublicKeyConfigured,
    secretKeyConfigured: paypalSecretKeyConfigured,
    checkoutReady: false,
    portalReady: false,
    webhookConfigured: paypalWebhookConfigured,
    priceMappingsConfigured: false,
  };

  return {
    activeProvider: stripe.configured ? "stripe" : paypal.configured ? "paypal" : null,
    stripe,
    paypal,
  };
}

/** GET branding / plan metadata for the active organization (Phase 4). */
export function registerOrganizationRoutes(app: Express, auth: Auth): void {
  app.get("/api/organization/settings", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
      const [settings] = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, orgId))
        .limit(1);
      const subscription = await getOrgSubscriptionForActiveOrg();
      res.json({
        organizationId: orgId,
        organization: org ?? null,
        settings: settings ?? null,
        subscription,
      });
    } catch (e) {
      console.error("GET /api/organization/settings:", e);
      res.status(500).json({ message: "Failed to load organization settings" });
    }
  });

  app.get("/api/subscription/current", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const subscription = await getOrgSubscriptionForActiveOrg();
      const [memberCount, warehouseCount, skuCount] = await Promise.all([
        db.select().from(organizationMembers).where(eq(organizationMembers.organizationId, orgId)),
        db.select().from(warehouses).where(eq(warehouses.organizationId, orgId)),
        db.select().from(inventoryItems).where(eq(inventoryItems.organizationId, orgId)),
      ]);
      const billingProviders = getBillingProviderStatuses();

      return sendOk(res, {
        organizationId: orgId,
        provider: "stripe",
        sourceOfTruth: "local_entitlements",
        status: "active",
        billingProviders,
        ...subscription,
        usage: {
          users: memberCount.length,
          warehouses: warehouseCount.length,
          skus: skuCount.length,
        },
      });
    } catch (error) {
      console.error("GET /api/subscription/current:", error);
      return sendError(res, 500, "SUBSCRIPTION_CURRENT_FAILED", "Failed to load subscription state.");
    }
  });

  app.post("/api/subscription/checkout-session", ...requireConfigWrite(auth), async (_req: Request, res: Response) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return sendError(res, 503, "BILLING_PROVIDER_NOT_CONFIGURED", "Stripe checkout is not configured for this environment.", {
        hint: "Set STRIPE_SECRET_KEY and billing price IDs before enabling checkout.",
      });
    }
    return sendOk(res, {
      provider: "stripe",
      mode: "checkout",
      url: null,
      message: "Stripe checkout transport is ready; product price mapping must be configured before session creation.",
    });
  });

  app.post("/api/subscription/portal-session", ...requireConfigWrite(auth), async (_req: Request, res: Response) => {
    if (!process.env.STRIPE_SECRET_KEY) {
      return sendError(res, 503, "BILLING_PROVIDER_NOT_CONFIGURED", "Stripe customer portal is not configured for this environment.", {
        hint: "Set STRIPE_SECRET_KEY and customer billing records before enabling portal sessions.",
      });
    }
    return sendOk(res, {
      provider: "stripe",
      mode: "portal",
      url: null,
      message: "Stripe portal transport is ready; customer mapping must be configured before session creation.",
    });
  });

  app.post("/api/subscription/webhook/stripe", async (req: Request, res: Response) => {
    try {
      const eventId = String(req.body?.id ?? "");
      if (!eventId) {
        return sendError(res, 400, "STRIPE_WEBHOOK_EVENT_ID_REQUIRED", "Stripe webhook payload must include an event id.");
      }
      const [existing] = await db
        .select()
        .from(billingWebhookEvents)
        .where(and(eq(billingWebhookEvents.provider, "stripe"), eq(billingWebhookEvents.providerEventId, eventId)))
        .limit(1);
      if (existing) return sendOk(res, { duplicate: true, eventId });

      await db.insert(billingWebhookEvents).values({
        provider: "stripe",
        providerEventId: eventId,
        signatureState: process.env.STRIPE_WEBHOOK_SECRET ? "received_pending_verification" : "unverified_dev",
        payload: req.body ?? {},
        processedAt: new Date(),
      });
      return sendOk(res, { received: true, eventId });
    } catch (error) {
      console.error("POST /api/subscription/webhook/stripe:", error);
      return sendError(res, 500, "STRIPE_WEBHOOK_FAILED", "Failed to process Stripe webhook.");
    }
  });

  app.post("/api/subscription/change-plan", ...requireConfigWrite(auth), async (req: Request, res: Response) => {
    try {
      const parsed = changePlanSchema.parse(req.body);
      const orgId = getActiveOrganizationId();
      const [settings] = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, orgId))
        .limit(1);
      const previousPlan = settings?.planTier ?? null;

      if (settings) {
        await db
          .update(organizationSettings)
          .set({ planTier: parsed.planTier, updatedAt: new Date() })
          .where(eq(organizationSettings.organizationId, orgId));
      } else {
        await db.insert(organizationSettings).values({
          organizationId: orgId,
          planTier: parsed.planTier,
          featureFlags: {},
        });
      }

      await db.insert(planChangeAudit).values({
        organizationId: orgId,
        fromPlan: previousPlan,
        toPlan: parsed.planTier,
        reason: parsed.reason ?? "manual_change",
        changedBy: currentUserId(req),
      });

      return sendOk(res, await getOrgSubscriptionForActiveOrg());
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "PLAN_CHANGE_INVALID", "Invalid plan change request.", { details: error.flatten() });
      }
      console.error("POST /api/subscription/change-plan:", error);
      return sendError(res, 500, "PLAN_CHANGE_FAILED", "Failed to change plan.");
    }
  });

  app.get("/api/subscription/usage", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const subscription = await getOrgSubscriptionForActiveOrg();
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const rows = await db
        .select()
        .from(usageCounters)
        .where(
          and(
            eq(usageCounters.organizationId, orgId),
            gte(usageCounters.periodStart, periodStart),
            lt(usageCounters.periodStart, periodEnd),
          ),
        );
      return sendOk(res, {
        periodStart,
        periodEnd,
        counters: rows,
        limits: subscription.limits,
        summary: buildUsageSummary(subscription.limits, rows),
      });
    } catch (error) {
      console.error("GET /api/subscription/usage:", error);
      return sendError(res, 500, "SUBSCRIPTION_USAGE_FAILED", "Failed to load subscription usage.");
    }
  });

  app.post("/api/subscription/usage-events", ...requireConfigWrite(auth), async (req: Request, res: Response) => {
    try {
      const parsed = usageEventSchema.parse(req.body);
      const orgId = getActiveOrganizationId();
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const [row] = await db
        .insert(usageCounters)
        .values({
          organizationId: orgId,
          counterKey: parsed.counterKey,
          periodStart,
          periodEnd,
          value: parsed.value,
        })
        .onConflictDoUpdate({
          target: [usageCounters.organizationId, usageCounters.counterKey, usageCounters.periodStart],
          set: {
            value: sql`${usageCounters.value} + ${parsed.value}`,
            periodEnd,
            updatedAt: now,
          },
        })
        .returning();
      const subscription = await getOrgSubscriptionForActiveOrg();
      const [summary] = buildUsageSummary(subscription.limits, [row]);
      return sendOk(
        res,
        {
          counter: row,
          appliedDelta: parsed.value,
          summary,
        },
        201,
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "USAGE_EVENT_INVALID", "Invalid usage event.", { details: error.flatten() });
      }
      console.error("POST /api/subscription/usage-events:", error);
      return sendError(res, 500, "USAGE_EVENT_FAILED", "Failed to record usage event.");
    }
  });

  app.get("/api/company-configuration", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const orgId = getActiveOrganizationId();
      const subscription = await getOrgSubscriptionForActiveOrg();
      const definitions = getConfigurationDefinitionsForPlan(subscription.normalizedPlanTier, subscription.effectiveFeatureFlags);
      const overrides = await db
        .select()
        .from(companyConfigurationSettings)
        .where(eq(companyConfigurationSettings.organizationId, orgId));
      const effective = definitions.map((definition) => {
        const override = overrides.find((row) => row.key === definition.key && row.scope === "organization" && !row.scopeId);
        return {
          ...definition,
          value: override?.value ?? definition.defaultValue,
          overridden: Boolean(override),
        };
      });
      return sendOk(res, { organizationId: orgId, definitions: effective, overrides });
    } catch (error) {
      console.error("GET /api/company-configuration:", error);
      return sendError(res, 500, "COMPANY_CONFIGURATION_FAILED", "Failed to load company configuration.");
    }
  });

  app.put("/api/company-configuration/:key", ...requireConfigWrite(auth), async (req: Request, res: Response) => {
    try {
      const key = decodeURIComponent(req.params.key);
      const parsed = configUpdateSchema.parse(req.body);
      const orgId = getActiveOrganizationId();
      const subscription = await getOrgSubscriptionForActiveOrg();
      const definitions = getConfigurationDefinitionsForPlan(subscription.normalizedPlanTier, subscription.effectiveFeatureFlags);
      const definition = definitions.find((row) => row.key === key);
      if (!definition) return sendError(res, 404, "CONFIGURATION_KEY_NOT_FOUND", "Configuration key not found.");
      if (!definition.enabled) {
        return sendError(res, 403, "CONFIGURATION_PLAN_RESTRICTED", "This setting is not available on the current plan.", {
          hint: definition.upgradeHint,
        });
      }
      if (!definition.scopes.includes(parsed.scope)) {
        return sendError(res, 400, "CONFIGURATION_SCOPE_INVALID", "This setting does not support the requested scope.");
      }

      const [row] = await db
        .insert(companyConfigurationSettings)
        .values({
          organizationId: orgId,
          key,
          scope: parsed.scope,
          scopeId: parsed.scopeId ?? null,
          value: parsed.value,
          updatedBy: currentUserId(req),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            companyConfigurationSettings.organizationId,
            companyConfigurationSettings.key,
            companyConfigurationSettings.scope,
            companyConfigurationSettings.scopeId,
          ],
          set: { value: parsed.value, updatedBy: currentUserId(req), updatedAt: new Date() },
        })
        .returning();
      return sendOk(res, { setting: row, invalidationMode: definition.invalidationMode });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "CONFIGURATION_UPDATE_INVALID", "Invalid configuration update.", {
          details: error.flatten(),
        });
      }
      console.error("PUT /api/company-configuration/:key:", error);
      return sendError(res, 500, "CONFIGURATION_UPDATE_FAILED", "Failed to update company configuration.");
    }
  });
}

import type { Express, Request, RequestHandler, Response } from "express";
import { and, eq, gte, lt } from "drizzle-orm";
import Stripe from "stripe";
import { z } from "zod";
import { db } from "../../db";
import {
  billingCustomers,
  billingSubscriptions,
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
import { normalizeOrgPlanTier, type OrgPlanTier } from "../../org-feature-registry";
import { buildSubscriptionDiagnostics } from "../../subscription-enforcement";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensurePermission?: (resource: string, permissionType: string) => RequestHandler;
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

const checkoutSessionSchema = z.object({
  planTier: z.enum(["starter", "standard", "growth", "enterprise"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const portalSessionSchema = z.object({
  returnUrl: z.string().url(),
});

const STRIPE_PRICE_ENV: Record<OrgPlanTier, string> = {
  starter: "STRIPE_PRICE_STARTER",
  standard: "STRIPE_PRICE_STANDARD",
  growth: "STRIPE_PRICE_GROWTH",
  enterprise: "STRIPE_PRICE_ENTERPRISE",
};

function stripeClient(): Stripe | null {
  return process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
}

function billingProviderReadiness() {
  const stripePriceIds = Object.values(STRIPE_PRICE_ENV)
    .map((envName) => process.env[envName])
    .filter(Boolean);
  const stripeSecretConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
  const stripePublicConfigured = Boolean(process.env.VITE_STRIPE_PUBLIC_KEY || process.env.STRIPE_PUBLIC_KEY);
  const stripeWebhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);

  return {
    activeProvider: "stripe",
    stripe: {
      configured: stripeSecretConfigured,
      publicKeyConfigured: stripePublicConfigured,
      secretKeyConfigured: stripeSecretConfigured,
      checkoutReady: stripeSecretConfigured && stripePriceIds.length > 0,
      portalReady: stripeSecretConfigured,
      webhookConfigured: stripeWebhookConfigured,
      priceMappingsConfigured: stripePriceIds.length,
    },
    paypal: {
      supported: false,
      configured: false,
      reason: "PayPal is planned but not implemented. Use Stripe for hosted billing in this build.",
    },
  };
}

function planTierFromStripePrice(priceId: string | null | undefined, metadataPlan?: unknown): OrgPlanTier {
  if (typeof metadataPlan === "string") return normalizeOrgPlanTier(metadataPlan);
  for (const [tier, envName] of Object.entries(STRIPE_PRICE_ENV) as Array<[OrgPlanTier, string]>) {
    if (process.env[envName] && process.env[envName] === priceId) return tier;
  }
  return "standard";
}

function timestampToDate(value: unknown): Date | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

function currentUserId(req: Request): number | null {
  return (req as Request & { user?: { id?: number } }).user?.id ?? null;
}

function requireConfigWrite(auth: Auth): RequestHandler[] {
  return auth.ensurePermission
    ? [auth.ensureAuthenticated, auth.ensurePermission("settings", "configure")]
    : [auth.ensureAuthenticated];
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
      const [billingSubscription] = await db
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.organizationId, orgId))
        .limit(1);
      const [memberCount, warehouseCount, skuCount] = await Promise.all([
        db.select().from(organizationMembers).where(eq(organizationMembers.organizationId, orgId)),
        db.select().from(warehouses).where(eq(warehouses.organizationId, orgId)),
        db.select().from(inventoryItems).where(eq(inventoryItems.organizationId, orgId)),
      ]);
      const usage = {
        users: memberCount.length,
        warehouses: warehouseCount.length,
        skus: skuCount.length,
      };
      const diagnostics = buildSubscriptionDiagnostics({
        planTier: subscription.normalizedPlanTier,
        limits: subscription.limits,
        usage,
        stripeStatus: billingSubscription?.status ?? "active",
        currentPeriodEnd: billingSubscription?.currentPeriodEnd ?? null,
      });

      return sendOk(res, {
        organizationId: orgId,
        provider: "stripe",
        sourceOfTruth: "local_entitlements",
        status: billingSubscription?.status ?? "active",
        billingSubscription: billingSubscription ?? null,
        billingProviders: billingProviderReadiness(),
        ...subscription,
        usage,
        access: diagnostics.access,
        usageLimits: diagnostics.usageLimits,
        usageStatus: diagnostics.usageStatus,
        upgradeHints: diagnostics.upgradeHints,
      });
    } catch (error) {
      console.error("GET /api/subscription/current:", error);
      return sendError(res, 500, "SUBSCRIPTION_CURRENT_FAILED", "Failed to load subscription state.");
    }
  });

  app.post("/api/subscription/checkout-session", ...requireConfigWrite(auth), async (req: Request, res: Response) => {
    const stripe = stripeClient();
    if (!stripe) {
      return sendError(res, 503, "BILLING_PROVIDER_NOT_CONFIGURED", "Stripe checkout is not configured for this environment.", {
        hint: "Set STRIPE_SECRET_KEY and billing price IDs before enabling checkout.",
      });
    }
    try {
      const parsed = checkoutSessionSchema.parse(req.body);
      const priceId = process.env[STRIPE_PRICE_ENV[parsed.planTier]];
      if (!priceId) {
        return sendError(res, 503, "BILLING_PRICE_NOT_CONFIGURED", "Stripe price ID is not configured for this plan.", {
          hint: `Set ${STRIPE_PRICE_ENV[parsed.planTier]} before checkout.`,
        });
      }
      const orgId = getActiveOrganizationId();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: parsed.successUrl,
        cancel_url: parsed.cancelUrl,
        metadata: { organizationId: String(orgId), planTier: parsed.planTier },
        subscription_data: { metadata: { organizationId: String(orgId), planTier: parsed.planTier } },
      });
      return sendOk(res, { provider: "stripe", mode: "checkout", url: session.url });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "CHECKOUT_SESSION_INVALID", "Invalid checkout session request.", { details: error.flatten() });
      }
      console.error("POST /api/subscription/checkout-session:", error);
      return sendError(res, 500, "CHECKOUT_SESSION_FAILED", "Failed to create Stripe checkout session.");
    }
  });

  app.post("/api/subscription/portal-session", ...requireConfigWrite(auth), async (req: Request, res: Response) => {
    const stripe = stripeClient();
    if (!stripe) {
      return sendError(res, 503, "BILLING_PROVIDER_NOT_CONFIGURED", "Stripe customer portal is not configured for this environment.", {
        hint: "Set STRIPE_SECRET_KEY and customer billing records before enabling portal sessions.",
      });
    }
    try {
      const parsed = portalSessionSchema.parse(req.body);
      const orgId = getActiveOrganizationId();
      const [customer] = await db
        .select()
        .from(billingCustomers)
        .where(and(eq(billingCustomers.organizationId, orgId), eq(billingCustomers.provider, "stripe")))
        .limit(1);
      if (!customer) {
        return sendError(res, 409, "BILLING_CUSTOMER_NOT_FOUND", "No Stripe customer is linked to this organization yet.");
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.providerCustomerId,
        return_url: parsed.returnUrl,
      });
      return sendOk(res, { provider: "stripe", mode: "portal", url: session.url });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return sendError(res, 400, "PORTAL_SESSION_INVALID", "Invalid portal session request.", { details: error.flatten() });
      }
      console.error("POST /api/subscription/portal-session:", error);
      return sendError(res, 500, "PORTAL_SESSION_FAILED", "Failed to create Stripe portal session.");
    }
  });

  app.post("/api/subscription/webhook/stripe", async (req: Request, res: Response) => {
    try {
      const stripe = stripeClient();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      let event = req.body as Stripe.Event;
      let signatureState = "unverified_dev";
      if (webhookSecret) {
        const signature = req.get("stripe-signature");
        const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
        if (!stripe || !signature || !rawBody) {
          return sendError(res, 400, "STRIPE_WEBHOOK_SIGNATURE_REQUIRED", "Stripe webhook signature verification is required.");
        }
        try {
          event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
          signatureState = "verified";
        } catch (signatureError) {
          const rejectedId = String(req.body?.id ?? `rejected-${Date.now()}`);
          await db.insert(billingWebhookEvents).values({
            provider: "stripe",
            providerEventId: rejectedId,
            signatureState: "rejected",
            payload: { error: signatureError instanceof Error ? signatureError.message : "Invalid Stripe signature" },
            processedAt: null,
          }).onConflictDoNothing();
          return sendError(res, 400, "STRIPE_WEBHOOK_SIGNATURE_INVALID", "Stripe webhook signature is invalid.");
        }
      }

      const eventId = String(event?.id ?? "");
      if (!eventId) {
        return sendError(res, 400, "STRIPE_WEBHOOK_EVENT_ID_REQUIRED", "Stripe webhook payload must include an event id.");
      }
      const [existing] = await db
        .select()
        .from(billingWebhookEvents)
        .where(and(eq(billingWebhookEvents.provider, "stripe"), eq(billingWebhookEvents.providerEventId, eventId)))
        .limit(1);
      if (existing) return sendOk(res, { duplicate: true, eventId });

      let processed = false;
      if (signatureState === "verified" && event.type.startsWith("customer.subscription.")) {
        const subscription = event.data.object as Stripe.Subscription & {
          metadata?: Record<string, string>;
          current_period_end?: number;
          plan?: { id?: string };
        };
        const orgId = Number(subscription.metadata?.organizationId);
        const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
        const priceId = subscription.items?.data?.[0]?.price?.id ?? subscription.plan?.id ?? null;
        const planTier = planTierFromStripePrice(priceId, subscription.metadata?.planTier);
        if (Number.isFinite(orgId) && orgId > 0 && customerId) {
          await db
            .insert(billingCustomers)
            .values({ organizationId: orgId, provider: "stripe", providerCustomerId: customerId })
            .onConflictDoUpdate({
              target: [billingCustomers.provider, billingCustomers.providerCustomerId],
              set: { organizationId: orgId, updatedAt: new Date() },
            });
          await db
            .insert(billingSubscriptions)
            .values({
              organizationId: orgId,
              provider: "stripe",
              providerSubscriptionId: subscription.id,
              status: subscription.status,
              planTier,
              priceId,
              currentPeriodEnd: timestampToDate(subscription.current_period_end),
              cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            })
            .onConflictDoUpdate({
              target: [billingSubscriptions.provider, billingSubscriptions.providerSubscriptionId],
              set: {
                status: subscription.status,
                planTier,
                priceId,
                currentPeriodEnd: timestampToDate(subscription.current_period_end),
                cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
                updatedAt: new Date(),
              },
            });
          await db
            .insert(organizationSettings)
            .values({ organizationId: orgId, planTier, featureFlags: {} })
            .onConflictDoUpdate({
              target: organizationSettings.organizationId,
              set: { planTier, updatedAt: new Date() },
            });
          processed = true;
        }
      }

      await db.insert(billingWebhookEvents).values({
        provider: "stripe",
        providerEventId: eventId,
        signatureState,
        payload: event as unknown as Record<string, unknown>,
        processedAt: new Date(),
      });
      return sendOk(res, { received: true, eventId, processed, signatureState });
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
      return sendOk(res, { periodStart, periodEnd, counters: rows });
    } catch (error) {
      console.error("GET /api/subscription/usage:", error);
      return sendError(res, 500, "SUBSCRIPTION_USAGE_FAILED", "Failed to load subscription usage.");
    }
  });

  app.post("/api/subscription/usage-events", ...requireConfigWrite(auth), async (req: Request, res: Response) => {
    const schema = z.object({ counterKey: z.string().min(1).max(80), value: z.coerce.number().int().min(1).default(1) });
    try {
      const parsed = schema.parse(req.body);
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
          set: { value: parsed.value, updatedAt: now },
        })
        .returning();
      return sendOk(res, row, 201);
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

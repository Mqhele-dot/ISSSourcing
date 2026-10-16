import type { OrgPlanLimit, OrgPlanTier } from "./org-feature-registry";

export type SubscriptionAccessCode =
  | "ACTIVE"
  | "TRIAL_EXPIRED"
  | "BILLING_GRACE"
  | "SUBSCRIPTION_INACTIVE";

export type SubscriptionUsageKey = keyof OrgPlanLimit;

export type SubscriptionUsageSummary = {
  key: SubscriptionUsageKey;
  label: string;
  current: number;
  limit: number | null;
  remaining: number | null;
  atLimit: boolean;
  overLimit: boolean;
};

export type SubscriptionWriteAccessDecision = {
  allowed: boolean;
  code: SubscriptionAccessCode | "ACTIVE";
  message?: string;
  hint?: string;
};

const USAGE_LABELS: Record<SubscriptionUsageKey, string> = {
  users: "users",
  warehouses: "warehouses",
  skus: "SKUs",
};

type AccessStatusInput = {
  stripeStatus?: string | null;
  currentPeriodEnd?: Date | string | null;
};

export function getSubscriptionAccessStatus(input: AccessStatusInput): {
  code: SubscriptionAccessCode;
  label: string;
  message: string;
  restricted: boolean;
} {
  const status = input.stripeStatus?.trim().toLowerCase() ?? "active";
  const currentPeriodEnd = coerceDate(input.currentPeriodEnd);
  const now = new Date();

  if (status === "trialing" && currentPeriodEnd && currentPeriodEnd.getTime() < now.getTime()) {
    return {
      code: "TRIAL_EXPIRED",
      label: "Trial expired",
      message: "The trial has ended. Upgrade to keep advanced workflows and new writes available.",
      restricted: true,
    };
  }

  if (status === "past_due" || status === "unpaid") {
    return {
      code: "BILLING_GRACE",
      label: "Billing grace",
      message: "Billing needs attention. Existing access remains available while payment details are corrected.",
      restricted: false,
    };
  }

  if (status === "canceled" || status === "incomplete" || status === "incomplete_expired") {
    return {
      code: "SUBSCRIPTION_INACTIVE",
      label: "Subscription inactive",
      message: "Hosted billing is inactive. Update the subscription before enabling new paid workflows.",
      restricted: true,
    };
  }

  if (status === "trialing") {
    return {
      code: "ACTIVE",
      label: "Trial active",
      message: currentPeriodEnd
        ? `Trial access remains active until ${currentPeriodEnd.toISOString()}.`
        : "Trial access remains active.",
      restricted: false,
    };
  }

  return {
    code: "ACTIVE",
    label: "Active",
    message: "Subscription access is active.",
    restricted: false,
  };
}

export function getSubscriptionWriteAccessDecision(input: AccessStatusInput): SubscriptionWriteAccessDecision {
  const access = getSubscriptionAccessStatus(input);
  if (!access.restricted) {
    return { allowed: true, code: "ACTIVE" };
  }

  return {
    allowed: false,
    code: access.code,
    message: access.message,
    hint:
      access.code === "TRIAL_EXPIRED"
        ? "Upgrade the subscription before creating new records that depend on paid workflows."
        : "Update the hosted billing subscription before creating new paid workflow records.",
  };
}

export function buildUsageSummaries(
  limits: OrgPlanLimit,
  usage: Record<SubscriptionUsageKey, number>,
): SubscriptionUsageSummary[] {
  return (Object.keys(USAGE_LABELS) as SubscriptionUsageKey[]).map((key) => {
    const current = usage[key] ?? 0;
    const limit = limits[key];
    const remaining = limit == null ? null : Math.max(limit - current, 0);
    const atLimit = limit != null && current >= limit;
    const overLimit = limit != null && current > limit;

    return {
      key,
      label: USAGE_LABELS[key],
      current,
      limit,
      remaining,
      atLimit,
      overLimit,
    };
  });
}

export function buildSubscriptionDiagnostics(input: {
  planTier: OrgPlanTier;
  limits: OrgPlanLimit;
  usage: Record<SubscriptionUsageKey, number>;
  stripeStatus?: string | null;
  currentPeriodEnd?: Date | string | null;
}) {
  const access = getSubscriptionAccessStatus({
    stripeStatus: input.stripeStatus,
    currentPeriodEnd: input.currentPeriodEnd,
  });
  const usageLimits = buildUsageSummaries(input.limits, input.usage);
  const exceeded = usageLimits.filter((entry) => entry.overLimit);
  const nearing = usageLimits.filter((entry) => !entry.overLimit && entry.atLimit);

  return {
    access,
    usageLimits,
    usageStatus: {
      withinLimits: exceeded.length === 0,
      code: exceeded.length > 0 ? ("USAGE_LIMIT_REACHED" as const) : ("ACTIVE" as const),
      message:
        exceeded.length > 0
          ? `This ${input.planTier} plan is over the limit for ${exceeded.map((entry) => entry.label).join(", ")}.`
          : nearing.length > 0
            ? `This ${input.planTier} plan is at the configured limit for ${nearing.map((entry) => entry.label).join(", ")}.`
            : `This ${input.planTier} plan is within its configured usage limits.`,
      overLimitKeys: exceeded.map((entry) => entry.key),
      atLimitKeys: nearing.map((entry) => entry.key),
    },
    upgradeHints:
      exceeded.length > 0 || nearing.length > 0
        ? usageLimits
            .filter((entry) => entry.atLimit || entry.overLimit)
            .map((entry) => `Upgrade to add more ${entry.label}.`)
        : [`Current ${input.planTier} plan limits are healthy.`],
  };
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

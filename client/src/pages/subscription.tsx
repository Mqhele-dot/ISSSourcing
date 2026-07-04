import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, CheckCircle2, CreditCard, Crown, LockKeyhole, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { apiRequest, getQueryFn, queryClient } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type PlanTier = "starter" | "standard" | "growth" | "enterprise";

type SubscriptionPlan = {
  tier: PlanTier;
  displayName: string;
  description: string;
  idealCustomer: string;
  monthlyPrice: string;
  annualPrice: string;
  limits: { users: number | null; warehouses: number | null; skus: number | null };
  includedFeatures: string[];
  lockedFeatures: string[];
  upgradeCta: string;
  supportLevel: string;
};

type FeatureEntry = {
  key: string;
  label: string;
  enabled: boolean;
  minimumPlan: PlanTier;
  upgradeHint: string;
};

type SubscriptionCurrent = {
  normalizedPlanTier: PlanTier;
  status: string;
  plan: SubscriptionPlan;
  access: { code: string; label: string; message: string; restricted: boolean };
  usageLimits: Array<{
    key: "users" | "warehouses" | "skus";
    label: string;
    current: number;
    limit: number | null;
    remaining: number | null;
    atLimit: boolean;
    overLimit: boolean;
  }>;
  usageStatus: { code: string; message: string; withinLimits: boolean };
  featureCatalog: FeatureEntry[];
  lockedFeatures: FeatureEntry[];
  billingProviders: {
    stripe?: {
      checkoutReady?: boolean;
      portalReady?: boolean;
      webhookConfigured?: boolean;
      priceMappingsConfigured?: number;
    };
  };
  lifecycle?: {
    trialEndsAt?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
    billingProvider?: string;
  };
  upgradeHints?: string[];
};

type PlansResponse = { plans: SubscriptionPlan[]; pricing: string; sourceOfTruth: string };

const FEATURE_LABELS: Record<string, string> = {
  core_procurement: "Core procurement",
  inventory: "Inventory",
  receiving: "Receiving",
  ap_basics: "AP basics",
  mobile_stock_counts: "Mobile counts",
  exports: "Exports",
  offline_sync: "Offline sync",
  industry_extensions: "Industry extensions",
  advanced_variance_approvals: "Variance approvals",
  analytics: "Analytics",
  api_access: "API access",
  document_branding: "Document branding",
  integration_runs: "Integrations",
  sso: "SSO",
  warehouse_limit_overrides: "Warehouse overrides",
  custom_enterprise_controls: "Enterprise controls",
};

function formatLimit(value: number | null, noun: string): string {
  return value == null ? `Unlimited ${noun}` : `${value.toLocaleString()} ${noun}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString();
}

async function postSubscriptionAction(path: string, body?: unknown) {
  const response = await apiRequest("POST", path, body);
  return response.json();
}

export default function SubscriptionPage() {
  const { toast } = useToast();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const { data: plansData, isLoading: plansLoading, error: plansError } = useQuery<PlansResponse>({
    queryKey: ["/api/subscription/plans"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const { data: current, isLoading: currentLoading, error: currentError } = useQuery<SubscriptionCurrent>({
    queryKey: ["/api/subscription/current"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => postSubscriptionAction(path, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/current"] });
      toast({ title: "Subscription updated", description: "The local entitlement snapshot was refreshed." });
    },
    onError: (error) => {
      toast({
        title: "Subscription action blocked",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  const plans = plansData?.plans ?? [];
  const activeTier = current?.normalizedPlanTier ?? "standard";
  const canManageSubscription = hasPermission("settings", "configure");
  const manageSubscriptionMessage = "You need settings:configure permission to manage subscription.";
  const actionDisabled = actionMutation.isPending || permissionsLoading || !canManageSubscription;
  const isLoading = plansLoading || currentLoading || permissionsLoading;
  const error = plansError || currentError;

  return (
    <div className="container max-w-7xl space-y-6 py-10" data-testid="subscription-admin-page">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Crown className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">Subscription</h1>
          </div>
          <p className="text-muted-foreground">
            SaaS plan, usage, and entitlement controls for ISSSourcing. Supplier billing and AP stay under Finance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/subscription/current"] });
              queryClient.invalidateQueries({ queryKey: ["/api/subscription/plans"] });
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            type="button"
            onClick={() =>
              actionMutation.mutate({
                path: "/api/subscription/billing-portal",
                body: { returnUrl: window.location.href },
              })
            }
            disabled={actionDisabled}
            title={!canManageSubscription ? manageSubscriptionMessage : undefined}
            data-testid="subscription-billing-portal"
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Billing portal
          </Button>
        </div>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Separate from AP billing</AlertTitle>
        <AlertDescription>
          This page manages the ISSSourcing SaaS subscription. Supplier invoices, AP matching, and payments remain in{" "}
          <Link className="font-medium underline" href={APP_ROUTES.finance.accountsPayable}>
            Accounts payable
          </Link>
          .
        </AlertDescription>
      </Alert>

      {!permissionsLoading && !canManageSubscription ? (
        <Alert data-testid="subscription-permission-denied">
          <LockKeyhole className="h-4 w-4" />
          <AlertTitle>Subscription management restricted</AlertTitle>
          <AlertDescription>{manageSubscriptionMessage}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Subscription failed to load</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
        </Alert>
      ) : null}

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">Loading subscription state...</CardContent>
        </Card>
      ) : current ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3">
                Current plan
                <Badge variant={current.access.restricted ? "destructive" : "default"}>{current.access.label}</Badge>
              </CardTitle>
              <CardDescription>{current.access.message}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <p className="text-sm text-muted-foreground">Plan</p>
                  <p className="text-xl font-semibold">{current.plan.displayName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="text-xl font-semibold uppercase">{current.status}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Trial ends</p>
                  <p className="text-xl font-semibold">{formatDate(current.lifecycle?.trialEndsAt)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Period ends</p>
                  <p className="text-xl font-semibold">{formatDate(current.lifecycle?.currentPeriodEnd)}</p>
                </div>
              </div>

              <Separator />

              <div className="grid gap-3 md:grid-cols-3">
                {current.usageLimits.map((entry) => (
                  <div key={entry.key} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{entry.label}</p>
                      <Badge variant={entry.overLimit ? "destructive" : entry.atLimit ? "secondary" : "outline"}>
                        {entry.limit == null ? "Unlimited" : `${entry.current}/${entry.limit}`}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {entry.limit == null
                        ? `${entry.current.toLocaleString()} used`
                        : `${entry.remaining?.toLocaleString() ?? 0} remaining`}
                    </p>
                  </div>
                ))}
              </div>

              <Alert variant={current.usageStatus.withinLimits ? "default" : "destructive"}>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{current.usageStatus.code === "ACTIVE" ? "Usage healthy" : current.usageStatus.code}</AlertTitle>
                <AlertDescription>{current.usageStatus.message}</AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Locked features</CardTitle>
              <CardDescription>Backend-enforced entitlements with upgrade guidance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {current.lockedFeatures.length === 0 ? (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">All catalog features are available.</div>
              ) : (
                current.lockedFeatures.slice(0, 8).map((feature) => (
                  <div key={feature.key} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <LockKeyhole className="h-4 w-4 text-muted-foreground" />
                      <p className="font-medium">{feature.label}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{feature.upgradeHint}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        {plans.length === 0 && !isLoading ? (
          <Card className="lg:col-span-4" data-testid="subscription-empty-state">
            <CardContent className="py-8 text-sm text-muted-foreground">
              No subscription plans are available from the server catalog.
            </CardContent>
          </Card>
        ) : null}
        {plans.map((plan) => {
          const active = plan.tier === activeTier;
          return (
            <Card key={plan.tier} className={active ? "border-primary" : undefined} data-testid={`subscription-plan-${plan.tier}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{plan.displayName}</CardTitle>
                  {active ? <Badge>Current</Badge> : null}
                </div>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Pricing</p>
                  <p className="font-semibold">{plan.monthlyPrice}</p>
                  <p className="text-sm text-muted-foreground">{plan.annualPrice}</p>
                </div>
                <div className="space-y-1 text-sm">
                  <p>{formatLimit(plan.limits.users, "users")}</p>
                  <p>{formatLimit(plan.limits.warehouses, "warehouses")}</p>
                  <p>{formatLimit(plan.limits.skus, "SKUs")}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Included</p>
                  <div className="flex flex-wrap gap-1">
                    {plan.includedFeatures.slice(0, 7).map((feature) => (
                      <Badge key={feature} variant="secondary" className="text-xs">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {FEATURE_LABELS[feature] ?? feature}
                      </Badge>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{plan.supportLevel}</p>
                <Button
                  type="button"
                  variant={active ? "outline" : "default"}
                  className="w-full"
                  disabled={active || actionDisabled}
                  title={!canManageSubscription ? manageSubscriptionMessage : undefined}
                  data-testid={`subscription-change-plan-${plan.tier}`}
                  onClick={() =>
                    actionMutation.mutate({
                      path: "/api/subscription/change-plan",
                      body: { planTier: plan.tier, reason: "admin_subscription_page" },
                    })
                  }
                >
                  {active ? "Current plan" : plan.upgradeCta}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trial and lifecycle controls</CardTitle>
          <CardDescription>
            Local controls are available for development/test. Production uses the billing provider and verified webhook sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
          type="button"
          variant="outline"
          disabled={actionDisabled}
          title={!canManageSubscription ? manageSubscriptionMessage : undefined}
          data-testid="subscription-start-trial"
          onClick={() =>
              actionMutation.mutate({
                path: "/api/subscription/start-trial",
                body: { planTier: activeTier, days: 14, reason: "admin_subscription_page" },
              })
            }
          >
            Start 14-day trial
          </Button>
          <Button
          type="button"
          variant="outline"
          disabled={actionDisabled}
          title={!canManageSubscription ? manageSubscriptionMessage : undefined}
          data-testid="subscription-resume"
          onClick={() => actionMutation.mutate({ path: "/api/subscription/resume" })}
          >
            Resume subscription
          </Button>
          <Button
          type="button"
          variant="destructive"
          disabled={actionDisabled}
          title={!canManageSubscription ? manageSubscriptionMessage : undefined}
          data-testid="subscription-cancel"
          onClick={() => actionMutation.mutate({ path: "/api/subscription/cancel" })}
          >
            Cancel subscription
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

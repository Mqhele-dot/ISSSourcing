import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ExternalLink, Loader2, Shield, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type ConfigDefinition = {
  key: string;
  label: string;
  category: string;
  minimumPlan: string;
  enabled: boolean;
  value: unknown;
  defaultValue: unknown;
  invalidationMode: string;
  upgradeHint?: string;
};

type ConfigResponse = {
  definitions: ConfigDefinition[];
};

export function SecuritySettingsForm() {
  const { toast } = useToast();
  const configuration = useQuery({
    queryKey: ["/api/company-configuration"],
    queryFn: () => requestJson<ConfigResponse>("GET", "/api/company-configuration"),
  });

  const requireTwoFactor = useMemo(
    () => configuration.data?.definitions.find((definition) => definition.key === "security.requireTwoFactor") ?? null,
    [configuration.data],
  );

  const updatePolicy = useMutation({
    mutationFn: async (enabled: boolean) =>
      requestJson("PUT", "/api/company-configuration/security.requireTwoFactor", {
        scope: "organization",
        value: enabled,
      }),
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-configuration"] });
      toast({
        title: "Security policy updated",
        description: enabled
          ? "Organization sign-ins now require each user to complete two-factor setup."
          : "Two-factor is now optional unless a user enables it on their own profile.",
      });
    },
    onError: (error) => {
      toast({
        title: "Security policy update failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  if (configuration.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading organization security policy...
        </CardContent>
      </Card>
    );
  }

  if (configuration.isError || !requireTwoFactor) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-sm text-destructive">Security policy could not be loaded.</p>
          <Button variant="outline" onClick={() => configuration.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const twoFactorRequired = Boolean(requireTwoFactor.value ?? requireTwoFactor.defaultValue);
  const policyLocked = !requireTwoFactor.enabled || updatePolicy.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Organization Security Policy
          </CardTitle>
          <CardDescription>
            Persisted admin controls for sign-in posture. Unsupported org-wide settings are called out explicitly instead of being silently “saved”.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={requireTwoFactor.enabled ? "outline" : "secondary"}>{requireTwoFactor.minimumPlan}+</Badge>
            <Badge variant="outline">{requireTwoFactor.invalidationMode}</Badge>
            <Badge variant={twoFactorRequired ? "default" : "secondary"}>
              {twoFactorRequired ? "2FA required" : "2FA optional"}
            </Badge>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Require two-factor authentication for all users
              </div>
              <p className="text-sm text-muted-foreground">
                Enforces the existing 2FA challenge flow at sign-in. Users still complete their own authenticator setup from Profile.
              </p>
              {!requireTwoFactor.enabled && requireTwoFactor.upgradeHint ? (
                <p className="text-sm text-muted-foreground">{requireTwoFactor.upgradeHint}</p>
              ) : null}
            </div>
            <Switch
              checked={twoFactorRequired}
              disabled={policyLocked}
              onCheckedChange={(checked) => updatePolicy.mutate(checked)}
              aria-label="Require two-factor authentication for the organization"
            />
          </div>

          <div className="rounded-md border border-amber-300/70 bg-amber-50/80 p-4 text-sm text-amber-950">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Honest scope
            </div>
            <p className="mt-2">
              Session timeout, password expiry, login-attempt lockout, and token lifetime are not yet backed by organization-wide enforcement in this screen.
              They are intentionally not exposed as editable “save” fields here until backend policy storage and enforcement exist.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">
            Per-user 2FA enrollment and individual session preferences remain under Profile.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={APP_ROUTES.admin.settingsSection("configuration")}>Open Configuration Center</Link>
            </Button>
            <Button asChild>
              <Link href={APP_ROUTES.admin.profile}>
                Open Profile Security
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

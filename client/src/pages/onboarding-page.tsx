import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { APP_ROUTES } from "@/lib/routes/app-routes";

export default function OnboardingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const isAdmin = user?.role === "admin";

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const body: { name: string; slug?: string } = { name: name.trim() };
      const s = slug.trim();
      if (s) body.slug = s;
      const res = await apiRequest("POST", "/api/onboarding/bootstrap", body);
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { message?: unknown };
          if (j?.message && typeof j.message === "string") message = j.message;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      return (await res.json()) as { organizationId: number };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/ready"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      toast({
        title: "Organization created",
        description: "Your workspace is ready. Continuing to the app…",
      });
      setLocation(APP_ROUTES.home);
    },
    onError: (e: Error) => {
      toast({
        title: "Setup failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  if (!user) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <PageHeader
          title="Organization setup"
          subtitle="Administrator access required"
          breadcrumb={<span>Admin / Onboarding</span>}
        />
        <Alert>
          <AlertTitle>Sign in as an administrator</AlertTitle>
          <AlertDescription>
            Creating the first organization requires an account with the <strong>admin</strong> role. If this is a fresh
            install, use your bootstrap admin user or run database seed, then return here.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <PageHeader
        title="Create your organization"
        subtitle="First-run setup for packaged installs (no organizations in the database yet)."
        breadcrumb={<span>Admin / Onboarding</span>}
      />
      <Alert>
        <AlertTitle>Then: product setup wizard</AlertTitle>
        <AlertDescription className="text-sm">
          After the organization exists, an administrator should complete{" "}
          <Link href={APP_ROUTES.setup.product} className="font-medium text-primary underline">
            business defaults ({APP_ROUTES.setup.product})
          </Link>{" "}
          (currency, tax, warehouse, starter data) before day-to-day procurement.
        </AlertDescription>
      </Alert>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || bootstrapMutation.isPending) return;
          bootstrapMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
            autoComplete="organization"
            required
            minLength={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-slug">URL slug (optional)</Label>
          <Input
            id="org-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-corp"
            pattern="[a-z0-9-]*"
            title="Lowercase letters, numbers, and hyphens only"
          />
          <p className="text-xs text-muted-foreground">
            If omitted, a slug is generated from the name. You can retry with a different slug if it collides.
          </p>
        </div>
        <Button type="submit" className="w-full sm:w-auto" disabled={bootstrapMutation.isPending || !name.trim()}>
          {bootstrapMutation.isPending ? "Creating…" : "Create organization"}
        </Button>
      </form>
    </div>
  );
}

import { Link, Redirect } from "wouter";
import { AlertTriangle, Fuel, Home, LayoutDashboard, Radar, Smartphone, Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PHONE_OPERATIONS_MEDIA_QUERY, phoneOperationsTarget } from "@/lib/layout/phone-operations-entry";

const desktopLinks = [
  {
    href: APP_ROUTES.operations.controlTower,
    title: "Control tower",
    description: "Operational KPIs, alerts, and execution signals.",
    icon: Radar,
  },
  {
    href: APP_ROUTES.operations.fuel,
    title: "Fuel operations",
    description: "Fuel stations, LPG stock, pumps, pricing, reconciliation, and safety.",
    icon: Fuel,
  },
  {
    href: APP_ROUTES.operations.logistics,
    title: "Logistics",
    description: "Shipments, carriers, and in-transit execution.",
    icon: Truck,
  },
  {
    href: APP_ROUTES.operations.exceptions,
    title: "Exceptions",
    description: "Open operational issues that need review or action.",
    icon: AlertTriangle,
  },
] as const;

/** Desktop-first entry for the Operations area (does not switch to the mobile shell). */
export default function OperationsOverviewPage() {
  const isPhone = useMediaQuery(PHONE_OPERATIONS_MEDIA_QUERY);
  if (isPhone) {
    return <Redirect to={phoneOperationsTarget(typeof window === "undefined" ? "" : window.location.search)} />;
  }

  return (
    <PageShell>
      <PageHeader
        title="Operations"
        subtitle="Desktop workspace for monitoring and resolving operational work."
        breadcrumb={<span>Operations</span>}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {desktopLinks.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:bg-accent/50">
              <CardHeader>
                <Icon className="mb-1 h-8 w-8 text-primary" />
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Frontline mobile workflows</CardTitle>
          </div>
          <CardDescription>
            Preview the live phone dashboard and open any frontline workflow in this browser for training or testing.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href={APP_ROUTES.operations.mobileWorkflows}>Preview phone workflows</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Product home</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p className="mb-3">Return to the main product landing and onboarding shortcuts.</p>
          <Button asChild variant="outline" size="sm">
            <Link href={APP_ROUTES.home}>
              <Home className="mr-2 h-4 w-4" />
              Go to home
            </Link>
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  );
}

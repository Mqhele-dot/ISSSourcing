import { Link } from "wouter";
import { Boxes, CreditCard, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSection } from "@/components/page-shell";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import type { AnalyticsSectionSlug } from "@/lib/routes/app-routes";

export function AnalyticsBoundaryMap({ section }: { section: AnalyticsSectionSlug }) {
  return (
    <PageSection
      id={section === "overview" ? "dashboard-activity" : undefined}
      title="Boundary map"
      description="Control tower remains the operational monitor, analytics is BI, and reports stays the tabular output layer."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <BoundaryCard
          title="Control tower"
          icon={<Truck className="h-4 w-4" />}
          description="Use for live execution, alerts, and recent operating activity."
          href={APP_ROUTES.operations.controlTower}
        />
        <BoundaryCard
          title="Analytics"
          icon={<Boxes className="h-4 w-4" />}
          description="Use for KPI views, drilldowns, and cross-domain business intelligence."
          href={APP_ROUTES.analytics.overview}
        />
        <BoundaryCard
          title="Reports"
          icon={<CreditCard className="h-4 w-4" />}
          description="Use for structured tables, saved report presets, and export generation."
          href={APP_ROUTES.analytics.reports}
        />
      </div>
    </PageSection>
  );
}

function BoundaryCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <Button asChild size="sm" variant="outline">
          <Link href={href}>Open</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

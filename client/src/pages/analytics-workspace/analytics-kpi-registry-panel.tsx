import { Link } from "wouter";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSection } from "@/components/page-shell";
import { KPI_REGISTRY } from "@/lib/analytics/kpi-registry";
import type { AnalyticsSectionSlug } from "@/lib/routes/app-routes";

export function AnalyticsKpiRegistryPanel({ section }: { section: AnalyticsSectionSlug }) {
  const registryEntries = KPI_REGISTRY.filter((entry) => section === "overview" || entry.domain === section);

  return (
    <PageSection
      id={section === "overview" ? "analytics" : undefined}
      title="KPI registry"
      description="Registry-backed KPI metadata keeps title, data source, drilldown, and export dataset mapping in one place."
    >
      <div className="grid gap-4 xl:grid-cols-2">
        {registryEntries.map((entry) => (
          <Card key={entry.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PackageCheck className="h-4 w-4" />
                {entry.title}
              </CardTitle>
              <CardDescription>{entry.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="font-medium">Source:</span> {entry.sourceKey}
              </div>
              <div>
                <span className="font-medium">Filters:</span> {entry.allowedFilters.join(", ") || "None"}
              </div>
              <div>
                <span className="font-medium">Export dataset:</span> {entry.exportDatasetKey}
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href={entry.drilldownRoute}>Open drilldown</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageSection>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PageSection } from "@/components/page-shell";
import { KPI_REGISTRY } from "@/lib/analytics/kpi-registry";
import type { AnalyticsSectionSlug } from "@/lib/routes/app-routes";

export function AnalyticsKpiRegistryPanel({ section }: { section: AnalyticsSectionSlug }) {
  const registryEntries = KPI_REGISTRY.filter(
    (entry) => section === "overview" || entry.domain === section,
  );
  const [openDefinitions, setOpenDefinitions] = useState(false);

  return (
    <PageSection
      id={section === "overview" ? "analytics-metric-definitions" : undefined}
      title="Metric definitions"
      description="Technical mapping (sources, filters, exports). Collapsed by default — open when you need integration details."
    >
      <Collapsible open={openDefinitions} onOpenChange={setOpenDefinitions}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-4"
            data-testid="analytics-kpi-definitions-trigger"
          >
            {openDefinitions ? (
              <>
                <ChevronUp className="mr-2 h-4 w-4" />
                Hide definitions
              </>
            ) : (
              <>
                <ChevronDown className="mr-2 h-4 w-4" />
                Show {registryEntries.length} metric definition{registryEntries.length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
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
        </CollapsibleContent>
      </Collapsible>
    </PageSection>
  );
}

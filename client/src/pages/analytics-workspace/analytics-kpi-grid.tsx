import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnalyticsKpiCard } from "./analytics-workspace-types";
import type { AnalyticsSectionSlug } from "@/lib/routes/app-routes";

export function AnalyticsKpiGrid({
  cards,
  section,
}: {
  cards: AnalyticsKpiCard[];
  section: AnalyticsSectionSlug;
}) {
  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      id={section === "overview" ? "dashboard-stats" : undefined}
    >
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="space-y-1">
            <CardDescription>{card.title}</CardDescription>
            <CardTitle className="text-2xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {card.sourceWarning ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{card.sourceWarning}</p>
            ) : null}
            {card.valueState === "unavailable" ? (
              <p className="text-xs font-medium text-destructive">Metric unavailable — check data feeds above.</p>
            ) : null}
            {card.valueState === "empty" ? (
              <p className="text-xs text-muted-foreground">No rows in dataset (feed responded OK).</p>
            ) : null}
            <p className="text-sm text-muted-foreground">{card.description}</p>
            <Button asChild size="sm" variant="outline">
              <Link href={card.href}>
                Drill down
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

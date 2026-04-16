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

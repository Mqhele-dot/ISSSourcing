import { useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Boxes, CreditCard, PackageCheck, Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageSection, PageShell } from "@/components/page-shell";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataState } from "@/components/ui/data-state";
import { requestJson } from "@/lib/queryClient";
import { KPI_REGISTRY } from "@/lib/analytics/kpi-registry";
import { APP_ROUTES, asSectionSlug, ANALYTICS_SECTION_SLUGS, type AnalyticsSectionSlug } from "@/lib/routes/app-routes";

type InventoryStats = {
  inventoryValue?: number;
  totalItems?: number;
  lowStockItems?: number;
};

type ControlTowerOverview = {
  kpis?: {
    lowStockSkus?: number;
    posAwaitingAction?: number;
    pendingRequisitions?: number;
    lateShipments?: number;
    inTransitShipments?: number;
    overdueInvoices?: number;
  };
};

type ApOverview = {
  outstandingAmount?: number;
  pendingApprovalCount?: number;
};

type SpendAnalytics = {
  spendBySupplier?: Array<{ supplierName: string; totalSpend: number }>;
  supplierPerformance?: Array<{ supplierName: string; onTimeDeliveryRate: number }>;
};

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

const ANALYTICS_NAV = [
  { label: "Overview", href: APP_ROUTES.analytics.overview },
  { label: "Inventory", href: APP_ROUTES.analytics.inventory },
  { label: "Procurement", href: APP_ROUTES.analytics.procurement },
  { label: "Finance", href: APP_ROUTES.analytics.finance },
  { label: "Logistics", href: APP_ROUTES.analytics.logistics },
  { label: "Reports", href: APP_ROUTES.analytics.reports },
  { label: "Saved reports", href: APP_ROUTES.analytics.savedReports },
  { label: "Export center", href: APP_ROUTES.analytics.exportCenter },
] as const;

function getAnalyticsSection(pathname: string): AnalyticsSectionSlug {
  const slug = pathname.split("/")[2];
  return asSectionSlug(slug, ANALYTICS_SECTION_SLUGS, "overview");
}

export default function AnalyticsWorkspacePage() {
  const [location] = useLocation();
  const section = getAnalyticsSection(location);

  const {
    data: inventoryStats,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/inventory/stats", "analytics-workspace"],
    queryFn: () => requestJson<InventoryStats>("GET", "/api/inventory/stats"),
  });

  const { data: controlTower } = useQuery({
    queryKey: ["/api/control-tower/overview", "analytics-workspace"],
    queryFn: () => requestJson<ControlTowerOverview>("GET", "/api/control-tower/overview"),
  });

  const { data: apOverview } = useQuery({
    queryKey: ["/api/ap/overview", "analytics-workspace"],
    queryFn: () => requestJson<ApOverview>("GET", "/api/ap/overview"),
  });

  const { data: spendAnalytics } = useQuery({
    queryKey: ["/api/reports/analytics", "analytics-workspace"],
    queryFn: () => requestJson<SpendAnalytics>("GET", "/api/reports/analytics"),
  });

  const cards = useMemo(() => {
    const kpis = controlTower?.kpis ?? {};
    switch (section) {
      case "inventory":
        return [
          {
            title: "Inventory value",
            value: money.format(Number(inventoryStats?.inventoryValue ?? 0)),
            description: "BI measure for on-hand stock value.",
            href: APP_ROUTES.analytics.reportSection("value"),
          },
          {
            title: "Tracked SKUs",
            value: String(inventoryStats?.totalItems ?? 0),
            description: "Active inventory master records.",
            href: APP_ROUTES.inventory.root,
          },
          {
            title: "Low-stock items",
            value: String(kpis.lowStockSkus ?? inventoryStats?.lowStockItems ?? 0),
            description: "Threshold breaches ready for replenishment.",
            href: APP_ROUTES.analytics.reportSection("low-stock"),
          },
        ];
      case "procurement":
        return [
          {
            title: "POs awaiting action",
            value: String(kpis.posAwaitingAction ?? 0),
            description: "Orders still open, approved, or ready to send.",
            href: APP_ROUTES.procurement.orders,
          },
          {
            title: "Pending requisitions",
            value: String(kpis.pendingRequisitions ?? 0),
            description: "Demand requests waiting for procurement review.",
            href: APP_ROUTES.procurement.requisitions,
          },
          {
            title: "Top supplier spend",
            value: spendAnalytics?.spendBySupplier?.[0]
              ? `${spendAnalytics.spendBySupplier[0].supplierName} (${money.format(spendAnalytics.spendBySupplier[0].totalSpend)})`
              : "No spend data",
            description: "Lead supplier by current spend in the BI model.",
            href: APP_ROUTES.analytics.reports,
          },
        ];
      case "finance":
        return [
          {
            title: "Outstanding AP",
            value: money.format(Number(apOverview?.outstandingAmount ?? 0)),
            description: "Current unpaid accounts payable exposure.",
            href: APP_ROUTES.finance.accountsPayable,
          },
          {
            title: "Pending AP approvals",
            value: String(apOverview?.pendingApprovalCount ?? 0),
            description: "Invoices still waiting for approval policy completion.",
            href: APP_ROUTES.finance.accountsPayable,
          },
          {
            title: "Overdue invoices",
            value: String(kpis.overdueInvoices ?? 0),
            description: "Invoices currently past due date in AP.",
            href: APP_ROUTES.analytics.reportSection("invoices"),
          },
        ];
      case "logistics":
        return [
          {
            title: "Late shipments",
            value: String(kpis.lateShipments ?? 0),
            description: "Late or at-risk shipments from control tower monitoring.",
            href: APP_ROUTES.operations.logistics,
          },
          {
            title: "In transit",
            value: String(kpis.inTransitShipments ?? 0),
            description: "Shipments currently moving through the network.",
            href: APP_ROUTES.operations.logistics,
          },
          {
            title: "Supplier performance lead",
            value: spendAnalytics?.supplierPerformance?.[0]
              ? `${spendAnalytics.supplierPerformance[0].supplierName} (${spendAnalytics.supplierPerformance[0].onTimeDeliveryRate.toFixed(1)}%)`
              : "No supplier performance data",
            description: "Top on-time supplier from procurement analytics.",
            href: APP_ROUTES.analytics.procurement,
          },
        ];
      case "overview":
      default:
        return [
          {
            title: "Inventory position",
            value: money.format(Number(inventoryStats?.inventoryValue ?? 0)),
            description: "Unified inventory value KPI from the registry.",
            href: APP_ROUTES.analytics.inventory,
          },
          {
            title: "Procurement flow",
            value: String(kpis.posAwaitingAction ?? 0),
            description: "Orders awaiting procurement action.",
            href: APP_ROUTES.analytics.procurement,
          },
          {
            title: "Finance exposure",
            value: money.format(Number(apOverview?.outstandingAmount ?? 0)),
            description: "Current AP exposure and approval backlog.",
            href: APP_ROUTES.analytics.finance,
          },
          {
            title: "Network execution",
            value: String(kpis.lateShipments ?? 0),
            description: "Late or at-risk logistics signals.",
            href: APP_ROUTES.analytics.logistics,
          },
        ];
    }
  }, [apOverview?.outstandingAmount, apOverview?.pendingApprovalCount, controlTower?.kpis, inventoryStats?.inventoryValue, inventoryStats?.lowStockItems, inventoryStats?.totalItems, section, spendAnalytics?.spendBySupplier, spendAnalytics?.supplierPerformance]);

  const registryEntries = KPI_REGISTRY.filter((entry) => section === "overview" || entry.domain === section);

  return (
    <PageShell variant="analytics-mode">
      <PageHeader
        title="Analytics workspace"
        subtitle="Business intelligence, saved reports, and export execution under one navigation model."
        breadcrumb={<span>Analytics</span>}
        actions={
          <div
            className="flex flex-wrap gap-2"
            id={section === "overview" ? "dashboard-actions" : undefined}
          >
            <Button asChild size="sm" variant="outline">
              <Link href={APP_ROUTES.operations.controlTower}>Open control tower</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={APP_ROUTES.analytics.exportCenter}>Export center</Link>
            </Button>
          </div>
        }
      />

      <SectionNav items={[...ANALYTICS_NAV]} />

      <DataState
        loading={isLoading}
        error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
        data={cards}
        isEmpty={() => false}
        emptyTitle="No analytics"
        onRetry={() => void refetch()}
      >
        {() => (
          <>
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
                      <div><span className="font-medium">Source:</span> {entry.sourceKey}</div>
                      <div><span className="font-medium">Filters:</span> {entry.allowedFilters.join(", ") || "None"}</div>
                      <div><span className="font-medium">Export dataset:</span> {entry.exportDatasetKey}</div>
                      <Button asChild size="sm" variant="outline">
                        <Link href={entry.drilldownRoute}>Open drilldown</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </PageSection>
          </>
        )}
      </DataState>
    </PageShell>
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

import { PageHeader } from "@/components/page-header";
import TutorialButton from "@/components/ui/tutorial-button";
import { TopItems } from "@/components/analytics/top-items";
import { InventoryValue } from "@/components/analytics/inventory-value";
import { StockUseChart } from "@/components/analytics/stock-use-chart";
import { ValueByCategoryChart } from "@/components/analytics/value-by-category-chart";

export default function AnalyticsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Inventory trends, value and demand insights"
        actions={<TutorialButton pageName="dashboard" />}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <InventoryValue />
        <TopItems />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <StockUseChart />
        <ValueByCategoryChart />
      </div>
    </div>
  );
}

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { ReportFilters } from "@/components/reports/report-filters";
import type { ReportsTabPanelsProps } from "./reports-tab-panels";
import { ProcurementLineReportPreview } from "./procurement-line-report-preview";

export function ReportsPurchaseOrdersTabPanel({
  filter,
  onFilterChange,
  safeWarehouses,
  safeSuppliers,
  safeProjects,
  formatMoney,
}: ReportsTabPanelsProps) {
  return (
    <TabsContent value="purchase-orders" className="mt-0">
      <ReportFilters
        filter={filter}
        setFilter={onFilterChange}
        warehouses={safeWarehouses}
        suppliers={safeSuppliers}
        projects={safeProjects}
        reportType="purchase-orders"
      />
      <Card>
        <CardHeader>
          <CardTitle>Purchase Orders Report</CardTitle>
          <CardDescription>Line-level purchase order values, fulfilment, finance mapping, and receipt evidence.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProcurementLineReportPreview dataset="purchase_orders" filter={filter} formatMoney={formatMoney} />
        </CardContent>
        <CardFooter className="border-t bg-muted/20 text-sm text-muted-foreground">
          Export applies the same tenant, supplier, status, project, and date filters as this preview.
        </CardFooter>
      </Card>
    </TabsContent>
  );
}

export function ReportsPurchaseRequisitionsTabPanel({
  filter,
  onFilterChange,
  safeWarehouses,
  safeSuppliers,
  safeProjects,
  formatMoney,
}: ReportsTabPanelsProps) {
  return (
    <TabsContent value="purchase-requisitions" className="mt-0">
      <ReportFilters
        filter={filter}
        setFilter={onFilterChange}
        warehouses={safeWarehouses}
        suppliers={safeSuppliers}
        projects={safeProjects}
        reportType="purchase-requisitions"
      />
      <Card>
        <CardHeader>
          <CardTitle>Purchase Requisitions Report</CardTitle>
          <CardDescription>Line-level requisition detail across catalogue, non-stock, and service purchases.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProcurementLineReportPreview dataset="purchase_requisitions" filter={filter} formatMoney={formatMoney} />
        </CardContent>
        <CardFooter className="border-t bg-muted/20 text-sm text-muted-foreground">
          Documents without lines remain visible as data-quality findings instead of disappearing.
        </CardFooter>
      </Card>
    </TabsContent>
  );
}

import { format } from "date-fns";
import { BarChart2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import type {
  InventoryStats,
  ReportFilter,
  PurchaseOrder,
  PurchaseRequisition,
  ReorderRequest,
  Supplier,
} from "@shared/schema";
import type { Category, InventoryItem, Warehouse } from "@shared/schema";
import { ReportFilters } from "@/components/reports/report-filters";

type ReportProjectOption = { id: number; code: string; name: string };

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function filterPurchaseOrdersForPreview(orders: PurchaseOrder[], f: ReportFilter): PurchaseOrder[] {
  let rows = orders;
  if (f.startDate && f.endDate) {
    const end = endOfDay(f.endDate);
    rows = rows.filter((o) => {
      const c = coerceDate(o.createdAt);
      return c >= f.startDate! && c <= end;
    });
  }
  if (f.supplierId) rows = rows.filter((o) => o.supplierId === f.supplierId);
  if (f.status) rows = rows.filter((o) => o.status === f.status);
  if (f.projectId) rows = rows.filter((o) => o.projectId === f.projectId);
  return rows;
}

function filterRequisitionsForPreview(rows: PurchaseRequisition[], f: ReportFilter): PurchaseRequisition[] {
  let r = rows;
  if (f.startDate && f.endDate) {
    const end = endOfDay(f.endDate);
    r = r.filter((row) => {
      const c = coerceDate(row.createdAt);
      return c >= f.startDate! && c <= end;
    });
  }
  if (f.supplierId) r = r.filter((row) => row.supplierId === f.supplierId);
  if (f.status) r = r.filter((row) => row.status === f.status);
  if (f.projectId) r = r.filter((row) => row.projectId === f.projectId);
  return r;
}

function filterReorderForPreview(rows: ReorderRequest[], f: ReportFilter): ReorderRequest[] {
  let r = rows;
  if (f.startDate && f.endDate) {
    const end = endOfDay(f.endDate);
    r = r.filter((row) => {
      const c = coerceDate(row.createdAt);
      return c >= f.startDate! && c <= end;
    });
  }
  if (f.supplierId) r = r.filter((row) => row.supplierId === f.supplierId);
  if (f.warehouseId) r = r.filter((row) => row.warehouseId === f.warehouseId);
  if (f.status) r = r.filter((row) => row.status === f.status);
  return r;
}

function filterSuppliersForPreview(suppliers: Supplier[], f: ReportFilter): Supplier[] {
  if (f.supplierId) return suppliers.filter((s) => s.id === f.supplierId);
  return suppliers;
}

function supplierName(suppliers: Supplier[], id: number | null | undefined): string {
  if (id == null) return "—";
  return suppliers.find((s) => s.id === id)?.name ?? `Supplier #${id}`;
}

function projectLabel(projects: ReportProjectOption[], projectId: number | null | undefined): string {
  if (projectId == null) return "—";
  const p = projects.find((x) => x.id === projectId);
  return p ? `${p.code} — ${p.name}` : `#${projectId}`;
}

export type ReportsTabPanelsProps = {
  filter: ReportFilter;
  onFilterChange: (f: ReportFilter) => void;
  safeCategories: Category[];
  safeWarehouses: Warehouse[];
  safeInventoryItems: InventoryItem[];
  safeLowStockItems: InventoryItem[];
  safePurchaseOrders: PurchaseOrder[];
  safePurchaseRequisitions: PurchaseRequisition[];
  safeReorderRequests: ReorderRequest[];
  safeSuppliers: Supplier[];
  safeProjects: ReportProjectOption[];
  itemsLoading: boolean;
  lowStockLoading: boolean;
  poLoading: boolean;
  requisitionsLoading: boolean;
  reorderLoading: boolean;
  stats: InventoryStats | undefined;
  getCategoryName: (categoryId: number | null | undefined) => string;
  calculateTotalValue: (items: unknown) => number;
  /** Org reporting currency (from app settings). */
  formatMoney: (amount: number) => string;
};

export function ReportsInventoryTabPanel(props: ReportsTabPanelsProps) {
  const {
    filter,
    onFilterChange,
    safeCategories,
    safeWarehouses,
    safeInventoryItems,
    itemsLoading,
    getCategoryName,
    calculateTotalValue,
    formatMoney,
  } = props;

  const filteredInventoryItems =
    filter.categoryId != null || filter.search?.trim()
      ? safeInventoryItems.filter((item) => {
          if (filter.categoryId != null && Number(item.categoryId) !== Number(filter.categoryId)) {
            return false;
          }
          const q = filter.search?.trim().toLowerCase();
          if (q) {
            const hay = `${item.sku ?? ""} ${item.name ?? ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
      : safeInventoryItems;

  return (
    <TabsContent value="inventory" className="mt-0">
      <ReportFilters
        filter={filter}
        setFilter={onFilterChange}
        categories={safeCategories}
        warehouses={safeWarehouses}
        reportType="inventory"
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>First rows mirror the export; adjust filters above to scope the file.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-white">Report Preview</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Generated on {format(new Date(), "MMMM d, yyyy")}
                </p>
              </div>
              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                {`${filteredInventoryItems.length} items • Total Value: ${formatMoney(calculateTotalValue(filteredInventoryItems))}`}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table
                data-testid="reports-inventory-preview-table"
                className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700"
              >
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Item
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      SKU
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-neutral-900 divide-y divide-neutral-200 dark:divide-neutral-700">
                  {itemsLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                        Loading inventory data...
                      </td>
                    </tr>
                  ) : filteredInventoryItems.length > 0 ? (
                    filteredInventoryItems.slice(0, 25).map((item) => (
                      <tr key={item.id} data-testid={`reports-inventory-preview-row-${item.sku}`}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-white">
                          {item.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {item.sku}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {getCategoryName(item.categoryId)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {item.quantity}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {formatMoney(Number(item.price) || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {formatMoney((Number(item.price) || 0) * (Number(item.quantity) || 0))}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                        No inventory items found.
                      </td>
                    </tr>
                  )}
                  {filteredInventoryItems.length > 25 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400 italic">
                        ... and {filteredInventoryItems.length - 25} more items
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th colSpan={3} className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      {safeInventoryItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0)}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400" />
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                      {formatMoney(calculateTotalValue(safeInventoryItems))}
                    </th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 flex justify-between">
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            The complete report includes all {safeInventoryItems.length} inventory items from the current inventory feed.
          </div>
        </CardFooter>
      </Card>
    </TabsContent>
  );
}

export function ReportsLowStockTabPanel(props: ReportsTabPanelsProps) {
  const {
    filter,
    onFilterChange,
    safeCategories,
    safeWarehouses,
    safeLowStockItems,
    lowStockLoading,
    stats,
    getCategoryName,
  } = props;

  return (
    <TabsContent value="low-stock" className="mt-0">
      <ReportFilters
        filter={filter}
        setFilter={onFilterChange}
        categories={safeCategories}
        warehouses={safeWarehouses}
        reportType="low-stock"
      />

      <Card>
        <CardHeader>
          <CardTitle>Low Stock Items Report</CardTitle>
          <CardDescription>Overview of items that are running low and need reordering</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-white">Report Preview</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Generated on {format(new Date(), "MMMM d, yyyy")}
                </p>
              </div>
              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                {stats?.lowStockItems || 0} items below threshold
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Item
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      SKU
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Current Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Threshold
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-neutral-900 divide-y divide-neutral-200 dark:divide-neutral-700">
                  {lowStockLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                        Loading low stock data...
                      </td>
                    </tr>
                  ) : safeLowStockItems.length > 0 ? (
                    safeLowStockItems.slice(0, 5).map((item) => (
                      <tr key={item.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-white">
                          {item.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {item.sku}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {getCategoryName(item.categoryId)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {item.quantity}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                          {item.lowStockThreshold}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">
                            Low Stock
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                        No low stock items found.
                      </td>
                    </tr>
                  )}
                  {safeLowStockItems.length > 5 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400 italic">
                        ... and {safeLowStockItems.length - 5} more items
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 flex justify-between">
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            The complete report will include all {stats?.lowStockItems || 0} low stock items.
          </div>
        </CardFooter>
      </Card>
    </TabsContent>
  );
}

export function ReportsValueTabPanel(props: ReportsTabPanelsProps) {
  const { filter, onFilterChange, safeCategories, stats, formatMoney } = props;

  return (
    <TabsContent value="value" className="mt-0">
      <ReportFilters filter={filter} setFilter={onFilterChange} categories={safeCategories} reportType="value" />

      <Card>
        <CardHeader>
          <CardTitle>Inventory Value Report</CardTitle>
          <CardDescription>Financial overview of your inventory value by category</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-white">Report Preview</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Generated on {format(new Date(), "MMMM d, yyyy")}
                </p>
              </div>
              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                Total Value: {formatMoney(stats?.inventoryValue || 0)}
              </div>
            </div>
            <div className="p-6">
              <div className="text-center mb-6">
                <h3 className="text-lg font-medium">Inventory Value by Category</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Breakdown of inventory value distribution</p>
              </div>
              <div className="w-full h-64 bg-neutral-50 dark:bg-neutral-800 rounded-lg flex items-center justify-center">
                <div className="text-neutral-500 dark:text-neutral-400 flex items-center gap-2">
                  <BarChart2 className="h-5 w-5" />
                  Chart preview — Export to see complete data visualization
                </div>
              </div>
              <Separator className="my-6" />
              <div>
                <h4 className="text-sm font-medium mb-3">Value Summary</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4 flex flex-col items-center justify-center">
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">Total Items</span>
                      <span className="text-2xl font-semibold mt-1">{stats?.totalItems || 0}</span>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 flex flex-col items-center justify-center">
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">Total Value</span>
                      <span className="text-2xl font-semibold mt-1">{formatMoney(stats?.inventoryValue || 0)}</span>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 flex flex-col items-center justify-center">
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">Avg. Item Value</span>
                      <span className="text-2xl font-semibold mt-1">
                        {stats?.totalItems && stats.totalItems > 0
                          ? formatMoney((stats?.inventoryValue || 0) / stats.totalItems)
                          : formatMoney(0)}
                      </span>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 flex justify-between">
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            The complete report will include detailed charts and value analysis.
          </div>
        </CardFooter>
      </Card>
    </TabsContent>
  );
}

export function ReportsPurchaseOrdersTabPanel(props: ReportsTabPanelsProps) {
  const {
    filter,
    onFilterChange,
    safeWarehouses,
    safeSuppliers,
    safeProjects,
    safePurchaseOrders,
    poLoading,
    formatMoney,
  } = props;
  const previewRows = filterPurchaseOrdersForPreview(safePurchaseOrders, filter);

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
          <CardDescription>Export purchase orders with supplier, status, and optional project filters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-white">Report Preview</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Generated on {format(new Date(), "MMMM d, yyyy")}
                </p>
              </div>
              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                {previewRows.length} orders match filters
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">PO #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Project</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-neutral-900 divide-y divide-neutral-200 dark:divide-neutral-700">
                  {poLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500">
                        Loading purchase orders...
                      </td>
                    </tr>
                  ) : previewRows.length > 0 ? (
                    previewRows.slice(0, 5).map((o) => (
                      <tr key={o.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{o.orderNumber}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{supplierName(safeSuppliers, o.supplierId)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{o.status}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">{projectLabel(safeProjects, o.projectId)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">{formatMoney(Number(o.totalAmount) || 0)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500">
                        No purchase orders match the current filters.
                      </td>
                    </tr>
                  )}
                  {previewRows.length > 5 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500 italic">
                        ... and {previewRows.length - 5} more orders
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-neutral-50 dark:bg-neutral-800 border-t flex justify-between">
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            Export applies the same filters as this preview (date range, supplier, status, project).
          </div>
        </CardFooter>
      </Card>
    </TabsContent>
  );
}

export function ReportsPurchaseRequisitionsTabPanel(props: ReportsTabPanelsProps) {
  const {
    filter,
    onFilterChange,
    safeWarehouses,
    safeSuppliers,
    safeProjects,
    safePurchaseRequisitions,
    requisitionsLoading,
    formatMoney,
  } = props;
  const previewRows = filterRequisitionsForPreview(safePurchaseRequisitions, filter);

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
          <CardDescription>Requisitions with approval status and optional project tag</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium text-neutral-900 dark:text-white">Report Preview</h3>
                <p className="text-xs text-neutral-500">{format(new Date(), "MMMM d, yyyy")}</p>
              </div>
              <div className="text-sm text-neutral-600 dark:text-neutral-300">{previewRows.length} requisitions match</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Req #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Project</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {requisitionsLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500">
                        Loading requisitions...
                      </td>
                    </tr>
                  ) : previewRows.length > 0 ? (
                    previewRows.slice(0, 5).map((r) => (
                      <tr key={r.id}>
                        <td className="px-6 py-4 text-sm font-medium">{r.requisitionNumber}</td>
                        <td className="px-6 py-4 text-sm">{supplierName(safeSuppliers, r.supplierId)}</td>
                        <td className="px-6 py-4 text-sm">{r.status}</td>
                        <td className="px-6 py-4 text-sm">{projectLabel(safeProjects, r.projectId)}</td>
                        <td className="px-6 py-4 text-sm text-right">{formatMoney(Number(r.totalAmount) || 0)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500">
                        No requisitions match the current filters.
                      </td>
                    </tr>
                  )}
                  {previewRows.length > 5 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500 italic">
                        ... and {previewRows.length - 5} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-neutral-50 dark:bg-neutral-800 border-t">
          <div className="text-sm text-neutral-600 dark:text-neutral-300">
            PDF export includes line detail and approval history when available.
          </div>
        </CardFooter>
      </Card>
    </TabsContent>
  );
}

export function ReportsSuppliersTabPanel(props: ReportsTabPanelsProps) {
  const { filter, onFilterChange, safeSuppliers } = props;
  const previewRows = filterSuppliersForPreview(safeSuppliers, filter);

  return (
    <TabsContent value="suppliers" className="mt-0">
      <ReportFilters filter={filter} setFilter={onFilterChange} suppliers={safeSuppliers} reportType="suppliers" />

      <Card>
        <CardHeader>
          <CardTitle>Suppliers Report</CardTitle>
          <CardDescription>Directory of suppliers; narrow with the supplier filter for a single record</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium">Report Preview</h3>
                <p className="text-xs text-neutral-500">{format(new Date(), "MMMM d, yyyy")}</p>
              </div>
              <div className="text-sm text-neutral-600">{previewRows.length} suppliers</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length > 0 ? (
                    previewRows.slice(0, 5).map((s) => (
                      <tr key={s.id}>
                        <td className="px-6 py-4 text-sm font-medium">{s.name}</td>
                        <td className="px-6 py-4 text-sm">{s.contactName ?? "—"}</td>
                        <td className="px-6 py-4 text-sm">{s.email ?? "—"}</td>
                        <td className="px-6 py-4 text-sm">{s.phone ?? "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-sm text-neutral-500">
                        No suppliers to show.
                      </td>
                    </tr>
                  )}
                  {previewRows.length > 5 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-sm text-neutral-500 italic">
                        ... and {previewRows.length - 5} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export function ReportsReorderRequestsTabPanel(props: ReportsTabPanelsProps) {
  const {
    filter,
    onFilterChange,
    safeWarehouses,
    safeSuppliers,
    safeReorderRequests,
    reorderLoading,
  } = props;
  const previewRows = filterReorderForPreview(safeReorderRequests, filter);

  return (
    <TabsContent value="reorder-requests" className="mt-0">
      <ReportFilters
        filter={filter}
        setFilter={onFilterChange}
        warehouses={safeWarehouses}
        suppliers={safeSuppliers}
        reportType="reorder-requests"
      />

      <Card>
        <CardHeader>
          <CardTitle>Reorder Requests Report</CardTitle>
          <CardDescription>Internal reorder requests by warehouse, supplier, and status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b flex justify-between items-center">
              <div>
                <h3 className="text-sm font-medium">Report Preview</h3>
                <p className="text-xs text-neutral-500">{format(new Date(), "MMMM d, yyyy")}</p>
              </div>
              <div className="text-sm text-neutral-600">{previewRows.length} requests match</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                <thead className="bg-neutral-50 dark:bg-neutral-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Request #</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Qty</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Warehouse</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reorderLoading ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500">
                        Loading reorder requests...
                      </td>
                    </tr>
                  ) : previewRows.length > 0 ? (
                    previewRows.slice(0, 5).map((req) => (
                      <tr key={req.id}>
                        <td className="px-6 py-4 text-sm font-medium">{req.requestNumber}</td>
                        <td className="px-6 py-4 text-sm">{req.quantity}</td>
                        <td className="px-6 py-4 text-sm">{supplierName(safeSuppliers, req.supplierId)}</td>
                        <td className="px-6 py-4 text-sm">
                          {req.warehouseId != null
                            ? safeWarehouses.find((w) => w.id === req.warehouseId)?.name ?? `#${req.warehouseId}`
                            : "—"}
                        </td>
                        <td className="px-6 py-4 text-sm">{req.status}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500">
                        No reorder requests match the current filters.
                      </td>
                    </tr>
                  )}
                  {previewRows.length > 5 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500 italic">
                        ... and {previewRows.length - 5} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}

export function ReportsInvoicesTabPanel(props: ReportsTabPanelsProps) {
  const { filter, onFilterChange, safeSuppliers } = props;
  return (
    <TabsContent value="invoices" className="mt-0">
      <ReportFilters
        filter={filter}
        setFilter={onFilterChange}
        suppliers={safeSuppliers}
        reportType="invoices"
      />
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            Export supplier invoices (PDF, CSV, Excel, Word) using the toolbar. Filter by issue date range, supplier, and
            status.
          </CardDescription>
        </CardHeader>
      </Card>
    </TabsContent>
  );
}

export function ReportsShipmentsTabPanel(props: ReportsTabPanelsProps) {
  const { filter, onFilterChange } = props;
  return (
    <TabsContent value="shipments" className="mt-0">
      <ReportFilters filter={filter} setFilter={onFilterChange} reportType="shipments" />
      <Card>
        <CardHeader>
          <CardTitle>Shipments</CardTitle>
          <CardDescription>
            Export operational shipment rows. Filter by updated time, status, partial PO or carrier, and late risk.
          </CardDescription>
        </CardHeader>
      </Card>
    </TabsContent>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, BarChart2, FileText, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from "date-fns";
import { downloadFile, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { type ReportFilter, type Category, type InventoryItem, type InventoryStats, type Warehouse, type Supplier, DocumentType } from "@shared/schema";
import { ReportFilters } from "@/components/reports/report-filters";

type ReportTab =
  | "inventory"
  | "low-stock"
  | "value"
  | "purchase-orders"
  | "purchase-requisitions"
  | "suppliers"
  | "reorder-requests";

export default function Reports() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReportTab>("inventory");
  const [exportFormat, setExportFormat] = useState<DocumentType>("pdf");
  const [filter, setFilter] = useState<ReportFilter>({});
  const [exporting, setExporting] = useState(false);

  // Fetch inventory items (normalize to array so reduce/map never see non-array)
  const { data: inventoryItems, isLoading: itemsLoading, isError: itemsError, error: itemsErrorDetail } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const response = await fetch("/api/inventory");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory items");
      }
      const raw = await response.json();
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Fetch low stock items
  const { data: lowStockItems, isLoading: lowStockLoading } = useQuery({
    queryKey: ["/api/inventory/low-stock"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/low-stock");
      if (!response.ok) {
        throw new Error("Failed to fetch low stock items");
      }
      const raw = await response.json();
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Fetch categories (normalize to array)
  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const response = await fetch("/api/categories");
      if (!response.ok) {
        throw new Error("Failed to fetch categories");
      }
      const raw = await response.json();
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Fetch inventory stats
  const { data: stats } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory stats");
      }
      return response.json() as Promise<InventoryStats>;
    },
  });
  
  // Fetch warehouses for filtering (normalize to array)
  const { data: warehouses } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: async () => {
      const response = await fetch("/api/warehouses");
      if (!response.ok) {
        throw new Error("Failed to fetch warehouses");
      }
      const raw = await response.json();
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Fetch suppliers for filtering (normalize to array)
  const { data: suppliers } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const response = await fetch("/api/suppliers");
      if (!response.ok) {
        throw new Error("Failed to fetch suppliers");
      }
      const raw = await response.json();
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Ensure API responses are always arrays (avoid "x?.reduce is not a function" when API returns error object)
  const safeInventoryItems = Array.isArray(inventoryItems) ? inventoryItems : [];
  const safeLowStockItems = Array.isArray(lowStockItems) ? lowStockItems : [];
  const safeCategories = Array.isArray(categories) ? categories : [];
  const safeWarehouses = Array.isArray(warehouses) ? warehouses : [];
  const safeSuppliers = Array.isArray(suppliers) ? suppliers : [];

  // Handle filter change
  const handleFilterChange = (newFilter: ReportFilter) => {
    setFilter(newFilter);
  };

  // Handle export with filters
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Build URL with filter parameters
      let url = `/api/export/${activeTab}/${exportFormat}`;
      
      // Add filter parameters to URL
      const queryParams = new URLSearchParams();
      
      if (filter.startDate && filter.endDate) {
        queryParams.append('startDate', filter.startDate.toISOString());
        queryParams.append('endDate', filter.endDate.toISOString());
      }
      
      if (filter.categoryId) {
        queryParams.append('categoryId', filter.categoryId.toString());
      }
      
      if (filter.warehouseId) {
        queryParams.append('warehouseId', filter.warehouseId.toString());
      }
      
      if (filter.supplierId) {
        queryParams.append('supplierId', filter.supplierId.toString());
      }
      
      if (filter.status) {
        queryParams.append('status', filter.status);
      }
      
      if (filter.tags && filter.tags.length > 0) {
        queryParams.append('tags', filter.tags.join(','));
      }
      
      // Append query parameters to URL
      if (queryParams.toString()) {
        url += `?${queryParams.toString()}`;
      }
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to export ${exportFormat} report`);
      }
      
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      // Use .xlsx extension for Excel files
      const fileExtension = exportFormat === 'excel' ? 'xlsx' : exportFormat;
      downloadFile(objectUrl, `${activeTab}-report.${fileExtension}`);
      
      URL.revokeObjectURL(objectUrl);
      
      toast({
        title: "Export Successful",
        description: `${getReportTitle(activeTab)} has been exported as ${exportFormat === 'excel' ? 'XLSX' : exportFormat.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export report",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  // Helper function to get report title
  const getReportTitle = (reportType: ReportTab): string => {
    switch (reportType) {
      case "inventory":
        return "Inventory Report";
      case "low-stock":
        return "Low Stock Items Report";
      case "value":
        return "Inventory Value Report";
      case "purchase-orders":
        return "Purchase Orders Report";
      case "purchase-requisitions":
        return "Purchase Requisitions Report";
      case "suppliers":
        return "Suppliers Report";
      case "reorder-requests":
        return "Reorder Requests Report";
      default:
        return "Report";
    }
  };

  // Helper function to get category name
  const getCategoryName = (categoryId: number | null | undefined): string => {
    if (!categoryId) return "Uncategorized";
    const category = safeCategories.find(c => c.id === categoryId);
    return category?.name || "Uncategorized";
  };

  // Calculate total value (items must be array)
  const calculateTotalValue = (items: unknown): number => {
    const arr = Array.isArray(items) ? items : [];
    return arr.reduce((total: number, item: { price?: number; quantity?: number }) => total + (Number(item?.price) || 0) * (Number(item?.quantity) || 0), 0);
  };

  return (
    <div className="max-w-7xl mx-auto">
      {itemsError && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Could not load report data</AlertTitle>
          <AlertDescription>{itemsErrorDetail instanceof Error ? itemsErrorDetail.message : "Failed to fetch inventory data."}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Reports</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            Generate and export inventory reports in multiple formats
          </p>
        </div>
        
        <div className="mt-4 md:mt-0 flex space-x-3">
          <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as DocumentType)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="excel">Excel</SelectItem>
            </SelectContent>
          </Select>
          
          <Button onClick={handleExport} disabled={exporting}>
            <FileDown className="mr-2 h-4 w-4" />
            {exporting ? "Exporting…" : "Export Report"}
          </Button>
        </div>
      </div>
      
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ReportTab)} className="mb-6">
        <TabsList className="mb-4">
          <TabsTrigger value="inventory" className="flex items-center">
            <FileText className="mr-2 h-4 w-4" />
            Inventory Report
          </TabsTrigger>
          <TabsTrigger value="low-stock" className="flex items-center">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Low Stock Report
          </TabsTrigger>
          <TabsTrigger value="value" className="flex items-center">
            <BarChart2 className="mr-2 h-4 w-4" />
            Value Report
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="inventory" className="mt-0">
          {/* Filter component for inventory tab */}
          <ReportFilters 
            filter={filter} 
            setFilter={handleFilterChange} 
            categories={safeCategories} 
            warehouses={safeWarehouses}
            reportType="inventory"
          />
          
          <Card>
            <CardHeader>
              <CardTitle>Inventory Report</CardTitle>
              <CardDescription>
                A complete overview of all items in your inventory
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md">
                <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-white">
                      Report Preview
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Generated on {format(new Date(), "MMMM d, yyyy")}
                    </p>
                  </div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-300">
                    {stats?.totalItems || 0} items • 
                    Total Value: {formatCurrency(stats?.inventoryValue || 0)}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                    <thead className="bg-neutral-50 dark:bg-neutral-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Item</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">SKU</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Quantity</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Price</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Value</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-neutral-900 divide-y divide-neutral-200 dark:divide-neutral-700">
                      {itemsLoading ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                            Loading inventory data...
                          </td>
                        </tr>
                      ) : safeInventoryItems.length > 0 ? (
                        safeInventoryItems.slice(0, 5).map((item) => (
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
                              {formatCurrency(item.price)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                              {formatCurrency(item.price * item.quantity)}
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
                      {safeInventoryItems.length > 5 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400 italic">
                            ... and {safeInventoryItems.length - 5} more items
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
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          {formatCurrency(calculateTotalValue(safeInventoryItems))}
                        </th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </CardContent>
            <CardFooter className="bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 flex justify-between">
              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                The complete report will include all {stats?.totalItems || 0} inventory items.
              </div>
            </CardFooter>
          </Card>
        </TabsContent>
        
        <TabsContent value="low-stock" className="mt-0">
          {/* Filter component for low-stock tab */}
          <ReportFilters 
            filter={filter} 
            setFilter={handleFilterChange} 
            categories={safeCategories} 
            warehouses={safeWarehouses}
            reportType="low-stock"
          />
          
          <Card>
            <CardHeader>
              <CardTitle>Low Stock Items Report</CardTitle>
              <CardDescription>
                Overview of items that are running low and need reordering
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md">
                <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-white">
                      Report Preview
                    </h3>
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
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Item</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">SKU</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Current Quantity</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Threshold</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Status</th>
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
        
        <TabsContent value="value" className="mt-0">
          {/* Filter component for value report tab */}
          <ReportFilters 
            filter={filter} 
            setFilter={handleFilterChange} 
            categories={safeCategories}
            reportType="value"
          />
          
          <Card>
            <CardHeader>
              <CardTitle>Inventory Value Report</CardTitle>
              <CardDescription>
                Financial overview of your inventory value by category
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md">
                <div className="bg-neutral-50 dark:bg-neutral-800 px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
                  <div>
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-white">
                      Report Preview
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Generated on {format(new Date(), "MMMM d, yyyy")}
                    </p>
                  </div>
                  <div className="text-sm text-neutral-600 dark:text-neutral-300">
                    Total Value: {formatCurrency(stats?.inventoryValue || 0)}
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-center mb-6">
                    <h3 className="text-lg font-medium">Inventory Value by Category</h3>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      Breakdown of inventory value distribution
                    </p>
                  </div>
                  <div className="w-full h-64 bg-neutral-50 dark:bg-neutral-800 rounded-lg flex items-center justify-center">
                    <div className="text-neutral-500 dark:text-neutral-400">
                      Chart preview - Export to see complete data visualization
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
                          <span className="text-2xl font-semibold mt-1">{formatCurrency(stats?.inventoryValue || 0)}</span>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 flex flex-col items-center justify-center">
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">Avg. Item Value</span>
                          <span className="text-2xl font-semibold mt-1">
                            {stats?.totalItems && stats.totalItems > 0
                              ? formatCurrency((stats?.inventoryValue || 0) / stats.totalItems)
                              : formatCurrency(0)}
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
      </Tabs>
    </div>
  );
}
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
import { requestJson } from "@/lib/queryClient";
import { downloadFile, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { DocumentType } from "@shared/schema";
import { type ReportFilter, type Category, type InventoryItem, type InventoryStats, type Warehouse, type Supplier } from "@shared/schema";
import { ReportFilters } from "@/components/reports/report-filters";
import { QueryState } from "@/components/ui/query-state";

type ReportTab =
  | "inventory"
  | "low-stock"
  | "value"
  | "purchase-orders"
  | "purchase-requisitions"
  | "suppliers"
  | "reorder-requests";

function getExportReportType(reportTab: ReportTab): string {
  switch (reportTab) {
    case "purchase-orders":
      return "purchase_orders";
    case "purchase-requisitions":
      return "purchase_requisitions";
    case "reorder-requests":
      return "reorder_requests";
    case "inventory":
    case "low-stock":
    case "value":
      return "inventory";
    default:
      return reportTab;
  }
}

export default function Reports() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReportTab>("inventory");
  const [exportFormat, setExportFormat] = useState<DocumentType>("pdf");
  const [pdfTemplate, setPdfTemplate] = useState<"standard" | "compact" | "custom">("standard");
  const [customTemplateFile, setCustomTemplateFile] = useState<File | null>(null);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [filter, setFilter] = useState<ReportFilter>({});
  const [exporting, setExporting] = useState(false);

  // Fetch inventory items (primary query for page-level loading/error; normalize to array)
  const {
    data: inventoryItems,
    isLoading: itemsLoading,
    isError: itemsError,
    error: itemsErrorDetail,
    refetch: refetchInventory,
  } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const raw = await requestJson<InventoryItem[] | { data: InventoryItem[] }>("GET", "/api/inventory");
      return Array.isArray(raw) ? raw : (raw as { data?: InventoryItem[] })?.data ?? [];
    },
  });

  // Fetch low stock items
  const { data: lowStockItems, isLoading: lowStockLoading } = useQuery({
    queryKey: ["/api/inventory/low-stock"],
    queryFn: async () => {
      const raw = await requestJson<InventoryItem[]>("GET", "/api/inventory/low-stock");
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Fetch categories (normalize to array)
  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const raw = await requestJson<Category[]>("GET", "/api/categories");
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Fetch inventory stats
  const { data: stats } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: async () => {
      const rawStats = await requestJson<Partial<InventoryStats>>("GET", "/api/inventory/stats");
      return {
        totalItems: Number(rawStats?.totalItems ?? 0),
        lowStockItems: Number(rawStats?.lowStockItems ?? 0),
        outOfStockItems: Number(rawStats?.outOfStockItems ?? 0),
        inventoryValue: Number(rawStats?.inventoryValue ?? 0),
      } as InventoryStats;
    },
  });

  // Fetch warehouses for filtering (normalize to array)
  const { data: warehouses } = useQuery({
    queryKey: ["/api/warehouses"],
    queryFn: async () => {
      const raw = await requestJson<Warehouse[]>("GET", "/api/warehouses");
      return Array.isArray(raw) ? raw : [];
    },
  });

  // Fetch suppliers for filtering (normalize to array)
  const { data: suppliers } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const raw = await requestJson<Supplier[]>("GET", "/api/suppliers");
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
      let url = `/api/export/${getExportReportType(activeTab)}/${exportFormat}`;
      
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
      if (activeTab === "low-stock") {
        queryParams.set("status", "low_stock");
      }
      
      if (filter.tags && filter.tags.length > 0) {
        queryParams.append('tags', filter.tags.join(','));
      }
      
      // PDF template (standard = default uniform layout, compact = tighter layout, custom = uploaded template)
      if (exportFormat === "pdf") {
        queryParams.set("template", pdfTemplate);
      }
      // Append query parameters to URL
      if (queryParams.toString()) {
        url += `?${queryParams.toString()}`;
      }
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      const fileExtension = exportFormat === "excel" ? "xlsx" : exportFormat;
      const filenameSuffix =
        exportFormat === "pdf"
          ? "report"
          : exportFormat === "docx"
            ? "word-report"
          : exportFormat === "csv"
            ? "raw-data"
            : "analysis";
      downloadFile(objectUrl, `${activeTab}-${filenameSuffix}.${fileExtension}`);
      
      URL.revokeObjectURL(objectUrl);
      
      toast({
        title: "Export Successful",
        description: `${getReportTitle(activeTab)} has been exported as ${exportFormat === "excel" ? "XLSX" : exportFormat === "docx" ? "DOCX" : exportFormat.toUpperCase()}`,
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
    <QueryState
      isLoading={itemsLoading}
      isError={itemsError}
      error={itemsErrorDetail instanceof Error ? itemsErrorDetail : null}
      refetch={refetchInventory}
    >
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Reports</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            Generate and export inventory reports in multiple formats
          </p>
        </div>
        
        <div className="mt-4 md:mt-0 flex flex-wrap items-center gap-3">
          <Select value={exportFormat} onValueChange={(value) => setExportFormat(value as DocumentType)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">PDF Report</SelectItem>
              <SelectItem value="docx">Word Document</SelectItem>
              <SelectItem value="csv">Raw CSV</SelectItem>
              <SelectItem value="excel">Excel Analysis</SelectItem>
            </SelectContent>
          </Select>
          {exportFormat === "pdf" && (
            <div className="flex flex-col gap-2">
              <Select value={pdfTemplate} onValueChange={(v) => setPdfTemplate(v as "standard" | "compact" | "custom")}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="PDF template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (uniform layout)</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="custom">Custom (uploaded template)</SelectItem>
                </SelectContent>
              </Select>
              {pdfTemplate === "custom" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Upload custom PDF template (cover/header pages; report data follows)
                  </label>
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    className="text-sm file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingTemplate(true);
                      try {
                        const formData = new FormData();
                        formData.append("template", file);
                        const res = await fetch("/api/settings/pdf-template", {
                          method: "POST",
                          body: formData,
                          credentials: "include",
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => ({}));
                          throw new Error((err as { message?: string }).message || "Upload failed");
                        }
                        setCustomTemplateFile(file);
                        toast({ title: "Template uploaded", description: "Use Export to generate PDF with your template." });
                      } catch (err) {
                        toast({
                          title: "Upload failed",
                          description: err instanceof Error ? err.message : "Could not upload template",
                          variant: "destructive",
                        });
                      } finally {
                        setUploadingTemplate(false);
                        e.target.value = "";
                      }
                    }}
                    disabled={uploadingTemplate}
                  />
                  {customTemplateFile ? (
                    <p className="text-xs text-muted-foreground">
                      Using: {customTemplateFile.name}
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      Upload a PDF to use as cover/header, or export will use the standard layout.
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                All PDFs use a consistent InvTrack layout. Custom template pages are prepended to the report.
              </p>
            </div>
          )}
          <Button onClick={handleExport} disabled={exporting}>
            <FileDown className="mr-2 h-4 w-4" />
            {exporting ? "Exporting…" : "Export Report"}
          </Button>
          <p className="w-full text-xs text-muted-foreground md:w-auto">
            {exportFormat === "pdf"
              ? "PDF Report: structured, branded document for sharing."
              : exportFormat === "docx"
                ? "Word Document: polished narrative layout with aligned tables."
              : exportFormat === "csv"
                ? "Raw CSV: source table data for external processing."
                : "Excel Analysis: workbook optimized for filtering and pivot analysis."}
          </p>
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
                    {`${safeInventoryItems.length} items • Total Value: ${formatCurrency(calculateTotalValue(safeInventoryItems))}`}
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
                              {formatCurrency(Number(item.price) || 0)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-600 dark:text-neutral-300">
                              {formatCurrency((Number(item.price) || 0) * (Number(item.quantity) || 0))}
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
                The complete report includes all {safeInventoryItems.length} inventory items from the current inventory feed.
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
    </QueryState>
  );
}
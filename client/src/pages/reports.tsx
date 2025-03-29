import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDown, BarChart2, FileText, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { downloadFile, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { type Category, type InventoryItem, type InventoryStats, DocumentType, ReportType } from "@shared/schema";

export default function Reports() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ReportType>("inventory");
  const [exportFormat, setExportFormat] = useState<DocumentType>("pdf");

  // Fetch inventory items
  const { data: inventoryItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["/api/inventory"],
    queryFn: async () => {
      const response = await fetch("/api/inventory");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory items");
      }
      return response.json() as Promise<InventoryItem[]>;
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
      return response.json() as Promise<InventoryItem[]>;
    },
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const response = await fetch("/api/categories");
      if (!response.ok) {
        throw new Error("Failed to fetch categories");
      }
      return response.json() as Promise<Category[]>;
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

  // Handle export
  const handleExport = async () => {
    try {
      const url = `/api/export/${activeTab}/${exportFormat}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to export ${exportFormat} report`);
      }
      
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      downloadFile(objectUrl, `${activeTab}-report.${exportFormat}`);
      
      URL.revokeObjectURL(objectUrl);
      
      toast({
        title: "Export Successful",
        description: `${getReportTitle(activeTab)} has been exported as ${exportFormat.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export report",
        variant: "destructive",
      });
    }
  };

  // Helper function to get report title
  const getReportTitle = (reportType: ReportType): string => {
    switch (reportType) {
      case "inventory":
        return "Inventory Report";
      case "low-stock":
        return "Low Stock Items Report";
      case "value":
        return "Inventory Value Report";
      default:
        return "Report";
    }
  };

  // Helper function to get category name
  const getCategoryName = (categoryId: number | null | undefined): string => {
    if (!categoryId) return "Uncategorized";
    const category = categories?.find(c => c.id === categoryId);
    return category?.name || "Uncategorized";
  };

  // Calculate total value
  const calculateTotalValue = (items: InventoryItem[] = []): number => {
    return items.reduce((total, item) => total + item.price * item.quantity, 0);
  };

  return (
    <div className="max-w-7xl mx-auto">
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
          
          <Button onClick={handleExport}>
            <FileDown className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>
      
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ReportType)} className="mb-6">
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
                      ) : inventoryItems && inventoryItems.length > 0 ? (
                        inventoryItems.slice(0, 5).map((item) => (
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
                      {inventoryItems && inventoryItems.length > 5 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400 italic">
                            ... and {inventoryItems.length - 5} more items
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
                          {inventoryItems?.reduce((sum, item) => sum + item.quantity, 0) || 0}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400">
                          {formatCurrency(calculateTotalValue(inventoryItems))}
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
                    {lowStockItems?.length || 0} items below threshold
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                    <thead className="bg-neutral-50 dark:bg-neutral-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Item</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">SKU</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Current Stock</th>
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
                      ) : lowStockItems && lowStockItems.length > 0 ? (
                        lowStockItems.slice(0, 5).map((item) => (
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
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-warning/10 text-warning">
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
                      {lowStockItems && lowStockItems.length > 5 && (
                        <tr>
                          <td colSpan={6} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400 italic">
                            ... and {lowStockItems.length - 5} more items
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
                {lowStockItems && lowStockItems.length > 0 
                  ? `${lowStockItems.length} items require attention.`
                  : "All items are well stocked."}
              </div>
            </CardFooter>
          </Card>
        </TabsContent>
        
        <TabsContent value="value" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Value Report</CardTitle>
              <CardDescription>
                Financial overview of your inventory assets
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
                
                {/* Category Value Breakdown */}
                <div className="p-4 border-b border-neutral-200 dark:border-neutral-700">
                  <h3 className="text-sm font-medium mb-4">Value by Category</h3>
                  <div className="space-y-4">
                    {categories && inventoryItems ? (
                      categories.map(category => {
                        const categoryItems = inventoryItems.filter(item => item.categoryId === category.id);
                        const categoryValue = categoryItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                        const percentage = stats?.inventoryValue ? (categoryValue / stats.inventoryValue) * 100 : 0;
                        
                        return (
                          <div key={category.id}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm font-medium">{category.name}</span>
                              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                                {formatCurrency(categoryValue)} ({percentage.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2.5">
                              <div 
                                className="bg-primary h-2.5 rounded-full" 
                                style={{ width: `${percentage}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center text-sm text-neutral-500 dark:text-neutral-400 py-4">
                        Loading category data...
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Top Value Items */}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-700">
                    <thead className="bg-neutral-50 dark:bg-neutral-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Top Items by Value</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Quantity</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Unit Price</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Total Value</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-neutral-900 divide-y divide-neutral-200 dark:divide-neutral-700">
                      {itemsLoading ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                            Loading inventory data...
                          </td>
                        </tr>
                      ) : inventoryItems && inventoryItems.length > 0 ? (
                        [...inventoryItems]
                          .sort((a, b) => (b.price * b.quantity) - (a.price * a.quantity))
                          .slice(0, 5)
                          .map((item) => (
                            <tr key={item.id}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-white">
                                {item.name}
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
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-white">
                                {formatCurrency(item.price * item.quantity)}
                              </td>
                            </tr>
                          ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="px-6 py-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
                            No inventory items found.
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
                Complete report will include detailed valuation of all {stats?.totalItems || 0} items.
              </div>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

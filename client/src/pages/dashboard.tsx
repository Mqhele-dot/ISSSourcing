import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Archive, AlertTriangle, ShoppingCart, DollarSign, Plus, FileDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsCard } from "@/components/inventory/stats-card";
import StockAlerts from "@/components/inventory/stock-alerts";
import RecentActivity from "@/components/inventory/recent-activity";
import ItemForm from "@/components/inventory/item-form";
import { DataTable } from "@/components/ui/data-table";
import { formatCurrency, getItemStatus, getStatusColor } from "@/lib/utils";
import { downloadFile } from "@/lib/utils";
import { type InventoryItem, type InventoryStats, type Category, type DocumentType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [showItemForm, setShowItemForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const { toast } = useToast();

  // Fetch inventory stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch inventory stats");
      }
      return response.json() as Promise<InventoryStats>;
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

  // Fetch inventory items
  const { data: inventoryItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["/api/inventory", selectedCategory],
    queryFn: async () => {
      const endpoint = selectedCategory !== "all" 
        ? `/api/inventory?categoryId=${selectedCategory}`
        : "/api/inventory";
      
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error("Failed to fetch inventory items");
      }
      return response.json() as Promise<InventoryItem[]>;
    },
  });

  // Export report handler
  const handleExport = async (format: DocumentType) => {
    try {
      const url = `/api/export/inventory/${format}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to export ${format} report`);
      }
      
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      downloadFile(objectUrl, `inventory-report.${format}`);
      
      URL.revokeObjectURL(objectUrl);
      
      toast({
        title: "Export Successful",
        description: `Inventory report has been exported as ${format.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export report",
        variant: "destructive",
      });
    }
  };

  // Define columns for the inventory table
  const columns = [
    {
      accessorKey: "name",
      header: "Item",
      cell: ({ row }: any) => {
        const item = row.original as InventoryItem;
        return (
          <div className="flex items-center">
            <div className="flex-shrink-0 h-10 w-10 bg-neutral-200 dark:bg-neutral-700 rounded flex items-center justify-center">
              <Archive className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
            </div>
            <div className="ml-4">
              <div className="text-sm font-medium text-neutral-900 dark:text-white">
                {item.name}
              </div>
              <div className="text-sm text-neutral-500 dark:text-neutral-400">
                SKU: {item.sku}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "categoryId",
      header: "Category",
      cell: ({ row }: any) => {
        const categoryId = row.getValue("categoryId");
        const category = categories?.find(c => c.id === categoryId);
        return (
          <div className="text-sm text-neutral-900 dark:text-white">
            {category?.name || "Uncategorized"}
          </div>
        );
      },
    },
    {
      accessorKey: "quantity",
      header: "Stock",
      cell: ({ row }: any) => (
        <div className="text-sm text-neutral-900 dark:text-white">
          {row.getValue("quantity")}
        </div>
      ),
    },
    {
      accessorKey: "price",
      header: "Price",
      cell: ({ row }: any) => (
        <div className="text-sm text-neutral-900 dark:text-white">
          {formatCurrency(row.getValue("price"))}
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const item = row.original as InventoryItem;
        const status = getItemStatus(item);
        const statusStyle = getStatusColor(status);
        
        return (
          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusStyle.bg} ${statusStyle.text} ${statusStyle.pulse ? "animate-pulse" : ""}`}>
            {status}
          </span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }: any) => {
        const item = row.original as InventoryItem;
        return (
          <div className="text-right">
            <Button variant="link" size="sm" className="text-primary hover:text-primary/80 mr-3">
              Edit
            </Button>
            <Button variant="link" size="sm" className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300">
              View
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Dashboard</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            An overview of your inventory and operations
          </p>
        </div>
        
        <div className="mt-4 md:mt-0 flex space-x-3">
          <Button onClick={() => setShowItemForm(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <FileDown className="mr-2 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport("pdf")}>
                Export as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("csv")}>
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("excel")}>
                Export as Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {/* Stats Overview Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatsCard
          title="Total Items"
          value={stats?.totalItems ?? 0}
          icon={<Archive className="h-5 w-5" />}
          iconClassName="bg-primary/10 dark:bg-primary/20 text-primary"
          link={{ href: "/inventory", label: "View all items" }}
          loading={statsLoading}
        />
        
        <StatsCard
          title="Low Stock Items"
          value={stats?.lowStockItems ?? 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          iconClassName="bg-warning/10 dark:bg-warning/20 text-warning"
          link={{ href: "/inventory?filter=low-stock", label: "View alerts" }}
          loading={statsLoading}
        />
        
        <StatsCard
          title="Out of Stock Items"
          value={stats?.outOfStockItems ?? 0}
          icon={<ShoppingCart className="h-5 w-5" />}
          iconClassName="bg-secondary/10 dark:bg-secondary/20 text-secondary"
          link={{ href: "/inventory?filter=out-of-stock", label: "View items" }}
          loading={statsLoading}
        />
        
        <StatsCard
          title="Inventory Value"
          value={formatCurrency(stats?.inventoryValue ?? 0)}
          icon={<DollarSign className="h-5 w-5" />}
          iconClassName="bg-success/10 dark:bg-success/20 text-success"
          link={{ href: "/reports?type=value", label: "Financial reports" }}
          loading={statsLoading}
        />
      </div>
      
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Inventory Overview Section */}
        <div className="lg:col-span-2">
          <Card>
            <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
              <h3 className="text-lg font-medium text-neutral-900 dark:text-white">
                Inventory Overview
              </h3>
              
              <div className="flex space-x-2">
                <div className="relative">
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories?.map((category) => (
                        <SelectItem key={category.id} value={String(category.id)}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <Button variant="outline" size="icon">
                  <Filter className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            <div className="p-0">
              <DataTable
                columns={columns}
                data={inventoryItems || []}
                searchable
                searchPlaceholder="Search items..."
                searchColumn="name"
              />
            </div>
          </Card>
        </div>
        
        {/* Stock Alerts & Recent Activity */}
        <div className="space-y-6">
          <StockAlerts />
          <RecentActivity />
        </div>
      </div>

      {/* Add/Edit Item Form Dialog */}
      <ItemForm open={showItemForm} setOpen={setShowItemForm} />
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { apiRequest, normalizeApiList, requestJson } from "@/lib/queryClient";
import { fetchInventory, type InventoryListItem } from "@/api/client";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Archive, AlertTriangle, ShoppingCart, DollarSign, Plus, FileDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatsCard } from "@/components/inventory/stats-card";
import StockAlerts from "@/components/inventory/stock-alerts";
import RecentActivity from "@/components/inventory/recent-activity";
import ItemForm from "@/components/inventory/item-form";
import ViewItemDialog from "@/components/inventory/view-item-dialog";
import { DataTable } from "@/components/ui/data-table";
import { QueryState } from "@/components/ui/query-state";
import { formatCurrency, getItemStatus, getStatusColor } from "@/lib/utils";
import { downloadFile } from "@/lib/utils";
import { type InventoryItem, type InventoryStats, type Category, type DocumentType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import TutorialButton from "@/components/ui/tutorial-button";
import { TopItems } from "@/components/analytics/top-items";
import { InventoryValue } from "@/components/analytics/inventory-value";
import { StockUseChart } from "@/components/analytics/stock-use-chart";
import { ValueByCategoryChart } from "@/components/analytics/value-by-category-chart";
import { RealTimeInventory } from "@/components/inventory/real-time-inventory";
import { RecentOrders } from "@/components/dashboard/recent-orders";
import { CustomGraphBuilder } from "@/components/dashboard/custom-graph-builder";
import { useDashboardHashScroll } from "@/pages/dashboard/use-dashboard-hash-scroll";

export default function Dashboard() {
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  useDashboardHashScroll(location);

  // Fetch inventory stats (primary query for page-level loading/error)
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    error: statsErrorDetail,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["/api/inventory/stats"],
    queryFn: () => requestJson<InventoryStats>("GET", "/api/inventory/stats"),
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ["/api/categories"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/categories");
      return normalizeApiList<Category>(raw);
    },
  });

  // Fetch inventory items
  const { data: inventoryItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["/api/inventory", "dashboard", selectedCategory],
    queryFn: () =>
      fetchInventory(
        selectedCategory !== "all" ? { categoryId: selectedCategory } : undefined,
      ),
  });
  const { data: controlTower } = useQuery({
    queryKey: ["/api/control-tower/overview"],
    queryFn: () => requestJson<{
      kpis?: {
        lateShipments?: number;
        posAwaitingAction?: number;
        lowStockSkus?: number;
        exceptionsBySeverity?: Record<string, number>;
        openExceptionsTotal?: number;
        pendingRequisitions?: number;
        inTransitShipments?: number;
        overdueInvoices?: number;
      };
    }>("GET", "/api/control-tower/overview"),
  });

  const openOperationalExceptions = useMemo(() => {
    const total = controlTower?.kpis?.openExceptionsTotal;
    if (typeof total === "number" && Number.isFinite(total)) return total;
    const bySev = controlTower?.kpis?.exceptionsBySeverity ?? {};
    return Object.values(bySev).reduce((a, n) => a + Number(n ?? 0), 0);
  }, [controlTower?.kpis?.exceptionsBySeverity, controlTower?.kpis?.openExceptionsTotal]);

  // Export report handler
  const handleExport = async (format: DocumentType) => {
    try {
      const url = `/api/export/inventory/${format}`;
      const response = await apiRequest("GET", url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      // Use .xlsx extension for Excel files
      const fileExtension = format === 'excel' ? 'xlsx' : format;
      downloadFile(objectUrl, `inventory-report.${fileExtension}`);
      
      URL.revokeObjectURL(objectUrl);
      
      toast({
        title: "Export Successful",
        description: `Inventory report has been exported as ${format === 'excel' ? 'XLSX' : format.toUpperCase()}`,
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
        const category = categories?.find((c: Category) => c.id === categoryId);
        return (
          <div className="text-sm text-neutral-900 dark:text-white">
            {category?.name || "Uncategorized"}
          </div>
        );
      },
    },
    {
      id: "stockOps",
      header: "On hand / avail.",
      cell: ({ row }: any) => {
        const item = row.original as InventoryListItem;
        const oh = item.onHand ?? item.quantity ?? 0;
        const av = item.available ?? oh - (item.allocated ?? 0);
        return (
          <div className="text-sm text-neutral-900 dark:text-white">
            <span className="font-medium">{oh}</span>
            <span className="text-neutral-500 dark:text-neutral-400"> / {av} avail.</span>
            {(item.allocated ?? 0) > 0 ? (
              <div className="text-xs text-muted-foreground">{item.allocated} allocated</div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "expiryCol",
      header: "Expiry / Mfg",
      cell: ({ row }: any) => {
        const item = row.original as InventoryListItem;
        const exp = item.expiryDate
          ? new Date(item.expiryDate).toLocaleDateString()
          : "—";
        const mfg = item.manufacturingDate
          ? new Date(item.manufacturingDate).toLocaleDateString()
          : "—";
        return (
          <div className="text-xs text-neutral-700 dark:text-neutral-300">
            <div>Exp: {exp}</div>
            <div className="text-muted-foreground">Mfg: {mfg}</div>
          </div>
        );
      },
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
        const item = row.original as InventoryListItem;
        const q = item.available ?? item.quantity ?? item.onHand ?? 0;
        const status = getItemStatus({
          quantity: q,
          lowStockThreshold: item.lowStockThreshold,
        });
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
        const item = row.original as InventoryListItem;
        return (
          <div className="text-right">
            <Button
              variant="link"
              size="sm"
              className="text-primary hover:text-primary/80 mr-3"
              data-help-title="Edit item"
              data-help-description="Open the item form to change name, SKU, category, quantity, or price."
              onClick={(e) => {
                e.stopPropagation();
                setEditingItem(item as unknown as InventoryItem);
                setShowItemForm(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="link"
              size="sm"
              className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
              data-help-title="View item"
              data-help-description="Open a read-only view of this item; you can then click Edit to change it."
              onClick={(e) => {
                e.stopPropagation();
                setViewingItem(item as unknown as InventoryItem);
              }}
            >
              View
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <QueryState
      isLoading={statsLoading}
      isError={statsError}
      error={statsErrorDetail ?? null}
      refetch={refetchStats}
    >
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Dashboard</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            An overview of your inventory and operations
          </p>
        </div>
        
        <div id="dashboard-actions" className="mt-4 md:mt-0 flex space-x-3 scroll-mt-6">
          <TutorialButton pageName="dashboard" className="mr-2" />
          
          <Button
            onClick={() => setShowItemForm(true)}
            className="add-item-button"
            data-help-title="Add Item"
            data-help-description="Opens a form to add a new inventory item (name, SKU, category, quantity, price)."
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                data-help-title="Export"
                data-help-description="Download the inventory overview as PDF, CSV, or Excel."
              >
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
      <div id="dashboard-stats" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-6 dashboard-stats scroll-mt-6">
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

      <Card className="mb-6">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="text-lg font-medium text-neutral-900 dark:text-white">Control Tower</h3>
          <p className="text-sm text-muted-foreground">Monitor critical workflow exceptions and jump to deep-dive modules.</p>
        </div>
        <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Open approvals</div>
            <div className="text-2xl font-semibold">{controlTower?.kpis?.posAwaitingAction ?? 0}</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/purchase/requisitions")}>
              View approvals
            </Button>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Late shipments</div>
            <div className="text-2xl font-semibold">{controlTower?.kpis?.lateShipments ?? 0}</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/logistics")}>
              View logistics
            </Button>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Low-stock SKUs</div>
            <div className="text-2xl font-semibold">{controlTower?.kpis?.lowStockSkus ?? 0}</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/inventory?filter=low-stock")}>
              View inventory
            </Button>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Open operational exceptions</div>
            <div className="text-2xl font-semibold">{openOperationalExceptions}</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/exceptions")}>
              View exceptions
            </Button>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Pending requisitions</div>
            <div className="text-2xl font-semibold">{controlTower?.kpis?.pendingRequisitions ?? 0}</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/requisitions")}>
              Requisitions
            </Button>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">In-transit shipments</div>
            <div className="text-2xl font-semibold">{controlTower?.kpis?.inTransitShipments ?? 0}</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/logistics")}>
              Logistics
            </Button>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Overdue invoices</div>
            <div className="text-2xl font-semibold">{controlTower?.kpis?.overdueInvoices ?? 0}</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/invoices")}>
              Invoices
            </Button>
          </div>
          <div className="rounded border p-3">
            <div className="text-sm text-muted-foreground">Control tower</div>
            <div className="text-2xl font-semibold">→</div>
            <Button variant="link" className="p-0 h-auto" onClick={() => setLocation("/control-tower")}>
              Full overview
            </Button>
          </div>
        </div>
      </Card>
      
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Inventory Overview Section */}
        <div className="lg:col-span-2 inventory-table-section">
          <Card>
            <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-700 flex justify-between items-center">
              <h3 className="text-lg font-medium text-neutral-900 dark:text-white">
                Inventory Overview
              </h3>
              
              <div className="flex space-x-2">
                <div
                className="relative category-filter"
                data-help-title="Category filter"
                data-help-description="Show only items from the selected category in the table below."
              >
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {categories?.map((category: Category) => (
                        <SelectItem key={category.id} value={String(category.id)}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <Button
                  variant="outline"
                  size="icon"
                  className="filter-button"
                  data-help-title="Filter"
                  data-help-description="Apply additional filters to the inventory table (used with category)."
                >
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
          <div className="low-stock-section">
            <StockAlerts />
          </div>
          <div id="dashboard-activity" className="activity-log-section scroll-mt-6">
            <RecentActivity />
          </div>
        </div>
      </div>

      {/* Real-time Inventory Section */}
      <div className="mt-8 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-neutral-900 dark:text-white">
          Real-Time Inventory Sync
        </h3>
        <div className="mb-6">
          <RealTimeInventory />
        </div>
      </div>

      {/* Stock use & value charts – analytics section start (sidebar "Analytics" scrolls here) */}
      <div id="analytics" className="mt-8 mb-6 scroll-mt-6">
        <h3 className="text-xl font-semibold mb-4 text-neutral-900 dark:text-white">
          Stock Use & Value
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <StockUseChart />
          <ValueByCategoryChart />
        </div>
      </div>

      {/* Custom graphs */}
      <div className="mt-8 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-neutral-900 dark:text-white">
          Custom Graphs
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Build a custom chart from current data: choose a data source and chart type below.
        </p>
        <CustomGraphBuilder />
      </div>

      {/* Analytics & Insights */}
      <div className="mt-8 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-neutral-900 dark:text-white">
          Analytics & Insights
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <TopItems />
          <InventoryValue />
        </div>
      </div>

      {/* Recent Orders & quick access */}
      <div className="mt-8 mb-6">
        <h3 className="text-xl font-semibold mb-4 text-neutral-900 dark:text-white">
          Orders & Inventory
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RecentOrders />
          </div>
          <Card>
            <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-700">
              <h4 className="font-medium text-neutral-900 dark:text-white">Quick actions</h4>
            </div>
            <div className="p-4 space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                data-help-title="Add inventory item"
                data-help-description="Opens the form to add a new item to inventory."
                onClick={() => { setEditingItem(null); setShowItemForm(true); }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add inventory item
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                data-help-title="View all orders"
                data-help-description="Go to the Purchase Orders page to see and manage all orders."
                onClick={() => setLocation("/orders")}
              >
                View all orders
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start"
                data-help-title="Browse inventory"
                data-help-description="Go to the full Inventory page to search and manage all items."
                onClick={() => setLocation("/inventory")}
              >
                Browse inventory
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Add/Edit Item Form Dialog */}
      <ItemForm
        open={showItemForm}
        setOpen={(open) => {
          setShowItemForm(open);
          if (!open) setEditingItem(null);
        }}
        initialData={editingItem ?? undefined}
      />
      <ViewItemDialog
        open={!!viewingItem}
        onOpenChange={(open) => !open && setViewingItem(null)}
        item={viewingItem}
        categories={categories}
        onEdit={() => { if (viewingItem) { setViewingItem(null); setEditingItem(viewingItem); setShowItemForm(true); } }}
      />
    </div>
    </QueryState>
  );
}

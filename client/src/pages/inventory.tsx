import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, FileDown, Filter, Trash2, BarChart3, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, getItemStatus, getStatusColor, downloadFile } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import ItemForm from "@/components/inventory/item-form";
import { StockMovementsList } from "@/components/inventory/stock-movements-list";
import { apiRequest } from "@/lib/queryClient";
import { type InventoryItem, type Category, type DocumentType } from "@shared/schema";
import TutorialButton from "@/components/ui/tutorial-button";

export default function Inventory() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  
  // State management
  const [showItemForm, setShowItemForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState(urlParams.get('search') || '');
  const [selectedCategory, setSelectedCategory] = useState<string>(urlParams.get('categoryId') || "all");
  const [currentTab, setCurrentTab] = useState(urlParams.get('filter') || 'all');

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (selectedCategory !== 'all') params.set('categoryId', selectedCategory);
    if (currentTab !== 'all') params.set('filter', currentTab);
    
    const newUrl = params.toString() ? `/inventory?${params.toString()}` : '/inventory';
    if (location !== newUrl) {
      setLocation(newUrl);
    }
  }, [searchQuery, selectedCategory, currentTab, location, setLocation]);

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

  // Construct API endpoint based on filters
  const getApiEndpoint = () => {
    let endpoint = "/api/inventory";
    const params = new URLSearchParams();
    
    if (searchQuery) {
      params.set('search', searchQuery);
    }
    
    if (selectedCategory !== 'all') {
      params.set('categoryId', selectedCategory);
    }
    
    return `${endpoint}${params.toString() ? `?${params.toString()}` : ''}`;
  };

  // Fetch inventory items
  const { data: allInventoryItems, isLoading: itemsLoading } = useQuery({
    queryKey: [getApiEndpoint()],
    queryFn: async () => {
      const response = await fetch(getApiEndpoint());
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

  // Fetch out of stock items
  const { data: outOfStockItems, isLoading: outOfStockLoading } = useQuery({
    queryKey: ["/api/inventory/out-of-stock"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/out-of-stock");
      if (!response.ok) {
        throw new Error("Failed to fetch out of stock items");
      }
      return response.json() as Promise<InventoryItem[]>;
    },
  });

  // Delete item mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/inventory/${id}`);
    },
    onSuccess: async () => {
      // Invalidate and refetch inventory queries
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory/out-of-stock"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory/stats"] });
      
      toast({
        title: "Item Deleted",
        description: "The inventory item has been deleted successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete item",
        variant: "destructive",
      });
    },
  });
  
  // Reorder item mutation
  const reorderMutation = useMutation({
    mutationFn: async (data: { 
      itemId: number; 
      quantity: number; 
      warehouseId?: number | null;
      supplierId?: number | null;
      notes?: string | null;
    }) => {
      // Clean up the data to match the expected schema
      const validData = {
        itemId: data.itemId,
        quantity: data.quantity,
        // Only include these if they're not null
        ...(data.warehouseId ? { warehouseId: data.warehouseId } : {}),
        ...(data.supplierId ? { supplierId: data.supplierId } : {}),
        ...(data.notes ? { notes: data.notes } : {})
      };
      
      const response = await apiRequest("POST", "/api/reorder-requests", validData);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create reorder request");
      }
      
      return response;
    },
    onSuccess: async () => {
      // Invalidate and refetch reorder requests
      await queryClient.invalidateQueries({ queryKey: ["/api/reorder-requests"] });
      
      toast({
        title: "Reorder Request Created",
        description: "A reorder request has been created successfully.",
      });
    },
    onError: (error: any) => {
      console.error("Reorder error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create reorder request",
        variant: "destructive",
      });
    },
  });

  // Handle item deletion
  const handleDeleteItem = async () => {
    if (itemToDelete) {
      await deleteMutation.mutateAsync(itemToDelete.id);
      setItemToDelete(null);
      setDeleteDialogOpen(false);
    }
  };

  // Handle edit item
  const handleEditItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setShowItemForm(true);
  };

  // Handle form close
  const handleFormClose = () => {
    setSelectedItem(null);
    setShowItemForm(false);
  };
  
  // States for reorder dialog
  const [reorderDialogOpen, setReorderDialogOpen] = useState(false);
  const [reorderItem, setReorderItem] = useState<InventoryItem | null>(null);
  const [reorderQuantity, setReorderQuantity] = useState<number>(0);
  const [reorderWarehouseId, setReorderWarehouseId] = useState<number | null>(null);
  const [reorderNotes, setReorderNotes] = useState<string>("");
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(false);
  
  // Fetch warehouses
  useEffect(() => {
    if (reorderDialogOpen && reorderItem) {
      const fetchWarehouses = async () => {
        setLoadingWarehouses(true);
        try {
          const response = await fetch("/api/warehouses");
          if (response.ok) {
            const data = await response.json();
            setWarehouses(data);
            // Set default warehouse if available
            if (data.length > 0) {
              setReorderWarehouseId(data[0].id);
            }
          }
        } catch (error) {
          console.error("Failed to fetch warehouses:", error);
        } finally {
          setLoadingWarehouses(false);
        }
      };
      
      fetchWarehouses();
    }
  }, [reorderDialogOpen, reorderItem]);

  // Open reorder dialog
  const handleReorderItem = (item: InventoryItem) => {
    setReorderItem(item);
    setReorderQuantity(item.lowStockThreshold || 10);
    setReorderNotes(`Manual reorder request for item: ${item.name} (${item.sku})`);
    setReorderDialogOpen(true);
  };
  
  // Submit reorder request
  const submitReorderRequest = async () => {
    if (!reorderItem) return;
    
    try {
      await reorderMutation.mutateAsync({
        itemId: reorderItem.id,
        quantity: reorderQuantity,
        supplierId: reorderItem.supplierId,
        warehouseId: reorderWarehouseId,
        notes: reorderNotes
      });
      
      // Close dialog on success
      setReorderDialogOpen(false);
      
      // Reset states
      setReorderItem(null);
      setReorderQuantity(0);
      setReorderWarehouseId(null);
      setReorderNotes("");
    } catch (error) {
      console.error("Failed to create reorder request:", error);
    }
  };

  // Export report handler
  const handleExport = async (format: DocumentType) => {
    try {
      const reportType = currentTab === 'low-stock' ? 'low-stock' : currentTab === 'out-of-stock' ? 'value' : 'inventory';
      const url = `/api/export/${reportType}/${format}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to export ${format} report`);
      }
      
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      downloadFile(objectUrl, `${reportType}-report.${format}`);
      
      URL.revokeObjectURL(objectUrl);
      
      toast({
        title: "Export Successful",
        description: `${reportType} report has been exported as ${format.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export report",
        variant: "destructive",
      });
    }
  };

  // Handle search submission
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentTab('all'); // Reset to all tab when searching
  };

  // Get inventory items based on active tab
  const getInventoryItems = () => {
    switch (currentTab) {
      case 'low-stock':
        return lowStockItems || [];
      case 'out-of-stock':
        return outOfStockItems || [];
      default:
        return allInventoryItems || [];
    }
  };

  // Check if data is loading based on active tab
  const isDataLoading = () => {
    switch (currentTab) {
      case 'low-stock':
        return lowStockLoading;
      case 'out-of-stock':
        return outOfStockLoading;
      default:
        return itemsLoading;
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
          <div 
            className="flex items-center cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-md p-1" 
            onClick={() => setLocation(`/inventory/${item.id}`)}
          >
            <div className="flex-shrink-0 h-10 w-10 bg-neutral-200 dark:bg-neutral-700 rounded flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
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
            <Button 
              variant="link" 
              size="sm" 
              className="text-primary hover:text-primary/80 mr-3"
              onClick={() => handleEditItem(item)}
            >
              Edit
            </Button>
            <Button 
              variant="link" 
              size="sm" 
              className="text-warning hover:text-warning/80 mr-3 reorder-button"
              onClick={() => handleReorderItem(item)}
              disabled={reorderMutation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-1 inline-block" />
              Reorder
            </Button>
            <Button 
              variant="link" 
              size="sm" 
              className="text-error hover:text-error/80"
              onClick={() => {
                setItemToDelete(item);
                setDeleteDialogOpen(true);
              }}
            >
              Delete
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
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Inventory</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            Manage and track your inventory items
          </p>
        </div>
        
        <div className="mt-4 md:mt-0 flex space-x-3">
          <TutorialButton pageName="inventory" className="mr-2" />
          
          <Button 
            onClick={() => {
              setSelectedItem(null);
              setShowItemForm(true);
            }}
            className="add-item-button"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Item
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="export-button">
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
      
      <Card className="inventory-table-card">
        <CardHeader className="pb-2 pt-4 px-6">
          <CardTitle className="text-lg">Inventory Items</CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0 mb-4">
            <Tabs 
              value={currentTab} 
              onValueChange={setCurrentTab}
              className="w-full md:w-auto inventory-tabs"
            >
              <TabsList>
                <TabsTrigger value="all" className="all-items-tab">All Items</TabsTrigger>
                <TabsTrigger value="low-stock" className="low-stock-tab">
                  Low Stock
                  {lowStockItems && lowStockItems.length > 0 && (
                    <span className="ml-2 bg-warning/20 text-warning text-xs px-2 py-0.5 rounded-full">
                      {lowStockItems.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="out-of-stock" className="out-of-stock-tab">
                  Out of Stock
                  {outOfStockItems && outOfStockItems.length > 0 && (
                    <span className="ml-2 bg-error/20 text-error text-xs px-2 py-0.5 rounded-full">
                      {outOfStockItems.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            
            <div className="flex space-x-2 inventory-filters">
              <form onSubmit={handleSearch} className="relative search-form">
                <Input
                  type="search"
                  placeholder="Search inventory..."
                  className="md:w-60 search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </form>
              
              <div className="category-filter">
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
              
              <Button variant="outline" size="icon" className="filter-button">
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          <div className="inventory-data-table">
            <DataTable
              columns={columns}
              data={getInventoryItems()}
              searchable={false}
            />
          </div>
        </CardContent>
      </Card>
      
      {/* Stock Movements Section */}
      <div className="mt-8">
        <StockMovementsList limit={5} />
      </div>

      {/* Add/Edit Item Form Dialog */}
      <ItemForm 
        open={showItemForm} 
        setOpen={handleFormClose} 
        initialData={selectedItem}
      />
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the item 
              <span className="font-medium text-neutral-900 dark:text-white">
                {" "}{itemToDelete?.name}{" "}
              </span>
              from your inventory. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteItem}
              disabled={deleteMutation.isPending}
              className="bg-error hover:bg-error/90 text-white"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reorder Item Dialog */}
      <Dialog open={reorderDialogOpen} onOpenChange={setReorderDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Reorder Request</DialogTitle>
            <DialogDescription>
              Create a reorder request for this item.
            </DialogDescription>
          </DialogHeader>
          
          {reorderItem && (
            <div className="py-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Item Details</Label>
                  <div className="flex justify-between bg-gray-50 p-3 rounded-md">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{reorderItem.name}</p>
                      <p className="text-xs text-gray-500">SKU: {reorderItem.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">Current Stock: {reorderItem.quantity}</p>
                      <p className="text-xs text-gray-500">
                        Low Stock Threshold: {reorderItem.lowStockThreshold || 'Not set'}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity to Order</Label>
                  <Input 
                    id="quantity" 
                    type="number" 
                    min="1"
                    value={reorderQuantity}
                    onChange={(e) => setReorderQuantity(Number(e.target.value))}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="warehouse">Warehouse</Label>
                  {loadingWarehouses ? (
                    <div className="flex items-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Loading warehouses...</span>
                    </div>
                  ) : (
                    <Select 
                      value={reorderWarehouseId?.toString() || ""} 
                      onValueChange={(value) => setReorderWarehouseId(value ? Number(value) : null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        {warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={warehouse.id.toString()}>
                            {warehouse.name} {warehouse.isDefault ? "(Default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea 
                    id="notes" 
                    placeholder="Add any additional notes here..." 
                    value={reorderNotes}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReorderNotes(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter className="sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setReorderDialogOpen(false)}
              disabled={reorderMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              onClick={submitReorderRequest}
              disabled={reorderMutation.isPending || !reorderWarehouseId || reorderQuantity <= 0}
            >
              {reorderMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Request...
                </>
              ) : "Create Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Edit, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getItemStatus, getStatusColor, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { StockMovementsList } from "@/components/inventory/stock-movements-list";
import ItemForm from "@/components/inventory/item-form";
import { DemandForecast } from "@/components/analytics/demand-forecast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { type InventoryItem, type Category } from "@shared/schema";

export default function InventoryItemDetail() {
  const [_, params] = useRoute<{ id: string }>("/inventory/:id");
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const itemId = params ? parseInt(params.id, 10) : 0;
  
  // State
  const [activeTab, setActiveTab] = useState("overview");
  const [showEditForm, setShowEditForm] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  
  // Redirect to inventory if no valid ID
  useEffect(() => {
    if (!params || isNaN(itemId)) {
      setLocation("/inventory");
    }
  }, [params, itemId, setLocation]);
  
  // Fetch item details
  const { data: item, isLoading: itemLoading } = useQuery({
    queryKey: ["/api/inventory", itemId],
    queryFn: async () => {
      const response = await fetch(`/api/inventory/${itemId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch inventory item");
      }
      return response.json() as Promise<InventoryItem>;
    },
    enabled: !!itemId && !isNaN(itemId),
  });
  
  // Fetch category data
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
  
  // Handle delete item
  const handleDeleteItem = async () => {
    try {
      await apiRequest(
        "DELETE",
        `/api/inventory/${itemId}`
      );
      
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      
      toast({
        title: "Item Deleted",
        description: "The inventory item has been deleted successfully.",
      });
      
      // Redirect back to inventory
      setLocation("/inventory");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete item",
        variant: "destructive",
      });
    }
  };
  
  // Handle reorder
  const handleReorderItem = async () => {
    try {
      const quantity = item?.lowStockThreshold || 10;
      
      await apiRequest(
        "POST",
        "/api/reorder-requests",
        {
          itemId: itemId,
          quantity: quantity
        }
      );
      
      toast({
        title: "Reorder Request Created",
        description: "A reorder request has been created successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create reorder request",
        variant: "destructive",
      });
    }
  };
  
  // Get category name
  const getCategoryName = (categoryId: number | null) => {
    if (!categoryId) return "Uncategorized";
    const category = categories?.find(c => c.id === categoryId);
    return category?.name || "Uncategorized";
  };
  
  // If loading, show skeleton
  if (itemLoading) {
    return (
      <div className="max-w-7xl mx-auto p-4">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            className="mb-4"
            onClick={() => setLocation("/inventory")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Inventory
          </Button>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        
        <Skeleton className="h-96" />
      </div>
    );
  }
  
  // If item not found
  if (!item) {
    return (
      <div className="max-w-7xl mx-auto p-4">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            className="mb-4"
            onClick={() => setLocation("/inventory")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Inventory
          </Button>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Item Not Found</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            The inventory item you are looking for does not exist or has been deleted.
          </p>
        </div>
        
        <Button onClick={() => setLocation("/inventory")}>
          Return to Inventory
        </Button>
      </div>
    );
  }
  
  // Get item status and style
  const status = getItemStatus(item);
  const statusStyle = getStatusColor(status);
  
  return (
    <div className="max-w-7xl mx-auto p-4">
      <div className="mb-6">
        <Button 
          variant="ghost" 
          className="mb-4"
          onClick={() => setLocation("/inventory")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Inventory
        </Button>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">{item.name}</h2>
            <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
              SKU: {item.sku}
            </p>
          </div>
          <div className="mt-4 md:mt-0 space-x-2">
            <Button 
              variant="outline" 
              className="text-warning hover:text-warning/80"
              onClick={handleReorderItem}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Reorder
            </Button>
            <Button 
              variant="outline" 
              className="text-primary hover:text-primary/80"
              onClick={() => setShowEditForm(true)}
            >
              <Edit className="h-4 w-4 mr-1" />
              Edit
            </Button>
            <Button 
              variant="outline" 
              className="text-error hover:text-error/80"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={`${statusStyle.bg} ${statusStyle.text} ${statusStyle.pulse ? "animate-pulse" : ""} px-3 py-1 text-sm`}>
              {status}
            </Badge>
            <div className="mt-2 text-2xl font-bold">{item.quantity}</div>
            <CardDescription>Current Stock</CardDescription>
            
            {item.lowStockThreshold !== null && (
              <div className="mt-4 text-sm">
                <span className="text-neutral-500 dark:text-neutral-400">Low Stock Threshold: </span>
                <span className="font-medium">{item.lowStockThreshold}</span>
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(item.price)}</div>
            <CardDescription>Selling Price</CardDescription>
            
            {item.cost !== null && (
              <div className="mt-4">
                <div className="text-sm">
                  <span className="text-neutral-500 dark:text-neutral-400">Cost: </span>
                  <span className="font-medium">{formatCurrency(item.cost)}</span>
                </div>
                
                {item.cost > 0 && (
                  <div className="text-sm">
                    <span className="text-neutral-500 dark:text-neutral-400">Margin: </span>
                    <span className="font-medium">
                      {Math.round(((item.price - item.cost) / item.price) * 100)}%
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-neutral-500 dark:text-neutral-400">Category: </span>
                <span className="font-medium">{getCategoryName(item.categoryId)}</span>
              </div>
              
              {item.location && (
                <div>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">Location: </span>
                  <span className="font-medium">{item.location}</span>
                </div>
              )}
              
              {item.supplierId && (
                <div>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">Supplier ID: </span>
                  <span className="font-medium">{item.supplierId}</span>
                </div>
              )}
              
              {item.barcode && (
                <div>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">Barcode: </span>
                  <span className="font-medium">{item.barcode}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <Tabs defaultValue={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="movements">Stock Movements</TabsTrigger>
              <TabsTrigger value="warehouses">Warehouse Inventory</TabsTrigger>
              <TabsTrigger value="forecast">Demand Forecast</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <TabsContent value="overview" className="p-0 mt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">Description</h3>
                <p className="text-neutral-700 dark:text-neutral-300">
                  {item.description || "No description available."}
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold mb-2">Additional Details</h3>
                {item.dimensions && (
                  <div className="mb-2">
                    <span className="text-sm font-medium">Dimensions: </span>
                    <span>{item.dimensions}</span>
                  </div>
                )}
                
                {item.weight && (
                  <div className="mb-2">
                    <span className="text-sm font-medium">Weight: </span>
                    <span>{item.weight}</span>
                  </div>
                )}
                
                {/* Add more details as needed */}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="movements" className="p-0 mt-0">
            <StockMovementsList itemId={itemId} />
          </TabsContent>
          
          <TabsContent value="warehouses" className="p-0 mt-0">
            {/* This would be warehouse inventory component - not implemented yet */}
            <div className="text-center py-8 text-neutral-500">
              Warehouse inventory details will be shown here.
            </div>
          </TabsContent>
          
          <TabsContent value="forecast" className="p-0 mt-0">
            <DemandForecast itemId={itemId} itemName={item.name} />
          </TabsContent>
        </CardContent>
      </Card>
      
      {/* Edit Item Form */}
      <ItemForm 
        open={showEditForm} 
        setOpen={setShowEditForm} 
        initialData={item}
      />
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the item 
              <span className="font-medium text-neutral-900 dark:text-white">
                {" "}{item.name}{" "}
              </span>
              from your inventory. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteItem}
              className="bg-error hover:bg-error/90 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { type InventoryItem } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function StockAlerts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: lowStockItems, isLoading } = useQuery({
    queryKey: ["/api/inventory/low-stock"],
    queryFn: async () => {
      const response = await fetch("/api/inventory/low-stock");
      if (!response.ok) {
        throw new Error("Failed to fetch low stock items");
      }
      return response.json() as Promise<InventoryItem[]>;
    },
  });

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
  
  // Reorder item mutation
  const reorderMutation = useMutation({
    mutationFn: async (data: { itemId: number; quantity: number }) => {
      return apiRequest("POST", "/api/reorder-requests", data);
    },
    onSuccess: async () => {
      // Invalidate and refetch reorder requests
      await queryClient.invalidateQueries({ queryKey: ["/api/reorder-requests"] });
      
      toast({
        title: "Reorder Request Created",
        description: "A reorder request has been created successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create reorder request",
        variant: "destructive",
      });
    },
  });

  if (isLoading || outOfStockLoading) {
    return <StockAlertsSkeletons />;
  }

  // Combine and take top 3 most critical items
  const criticalItems = [
    ...(outOfStockItems || []),
    ...(lowStockItems || []),
  ].slice(0, 3);

  if (criticalItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-success/10 dark:bg-success/20 mb-4">
              <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-neutral-900 dark:text-white">All Items In Stock</h3>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              No stock alerts at this time
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Alerts</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {criticalItems.map((item) => (
          <div key={item.id} className="px-0 py-4 first:pt-0 last:pb-0">
            <div className="flex items-start">
              <div className={cn(
                "flex-shrink-0 rounded-md p-2",
                item.quantity === 0 
                  ? "bg-error/10 dark:bg-error/20" 
                  : "bg-warning/10 dark:bg-warning/20"
              )}>
                <AlertTriangle className={cn(
                  "h-4 w-4",
                  item.quantity === 0 ? "text-error" : "text-warning"
                )} />
              </div>
              <div className="ml-3 w-0 flex-1">
                <div className="text-sm font-medium text-neutral-900 dark:text-white">{item.name}</div>
                <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  {item.quantity === 0 ? (
                    <span className="font-semibold text-error">Out of stock:</span>
                  ) : (
                    <span className="font-semibold text-warning">Low stock:</span>
                  )}{" "}
                  {item.quantity} remaining
                </div>
              </div>
              <div className="ml-4 flex-shrink-0">
                <Button 
                  size="sm" 
                  className="h-8 reorder-alert-button"
                  onClick={() => {
                    const defaultQuantity = item.lowStockThreshold || 10;
                    reorderMutation.mutate({
                      itemId: item.id,
                      quantity: defaultQuantity
                    });
                  }}
                  disabled={reorderMutation.isPending}
                >
                  {reorderMutation.isPending ? (
                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  Reorder
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="bg-neutral-50 dark:bg-neutral-700 px-5 py-3 rounded-b-lg">
        <Link href="/inventory?filter=low-stock">
          <a className="text-sm font-medium text-primary hover:text-primary/80 flex items-center">
            View all alerts
            <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </Link>
      </CardFooter>
    </Card>
  );
}

function StockAlertsSkeletons() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock Alerts</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-neutral-200 dark:divide-neutral-700">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-0 py-4 first:pt-0 last:pb-0">
            <div className="flex items-start">
              <Skeleton className="h-10 w-10 rounded-md" />
              <div className="ml-3 space-y-2 flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-8 w-16 ml-4" />
            </div>
          </div>
        ))}
      </CardContent>
      <CardFooter className="bg-neutral-50 dark:bg-neutral-700 px-5 py-3 rounded-b-lg">
        <Skeleton className="h-4 w-24" />
      </CardFooter>
    </Card>
  );
}

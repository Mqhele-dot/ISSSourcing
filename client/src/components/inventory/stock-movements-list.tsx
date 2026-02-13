import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, ArrowUpDown, ArrowRight, Download, FileDown, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StockMovementForm } from "./stock-movement-form";

type StockMovement = {
  id: number;
  itemId: number;
  warehouseId: number | null;
  sourceWarehouseId: number | null;
  destinationWarehouseId: number | null;
  type: string;
  quantity: number;
  notes: string | null;
  userId: number | null;
  unitCost: number | null;
  timestamp: string;
  item: {
    id: number;
    name: string;
    sku: string;
  };
  sourceWarehouse?: {
    id: number;
    name: string;
  } | null;
  destinationWarehouse?: {
    id: number;
    name: string;
  } | null;
  warehouse?: {
    id: number;
    name: string;
  } | null;
  user?: {
    id: number;
    name: string;
  } | null;
};

type Warehouse = {
  id: number;
  name: string;
};

type StockMovementsListProps = {
  itemId?: number;
  warehouseId?: number;
  limit?: number;
};

export function StockMovementsList({ itemId, warehouseId, limit }: StockMovementsListProps) {
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [showIssueForm, setShowIssueForm] = useState(false);
  
  // Determine API endpoint based on props
  let apiUrl = "/api/stock-movements";
  if (itemId) {
    apiUrl = `/api/stock-movements/item/${itemId}`;
  } else if (warehouseId) {
    apiUrl = `/api/stock-movements/warehouse/${warehouseId}`;
  }
  
  // If limit is provided, add limit parameter
  if (limit) {
    apiUrl += `?limit=${limit}`;
  }
  
  // Fetch stock movements
  const { data: movements, isLoading } = useQuery({
    queryKey: [apiUrl],
    queryFn: async () => {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch stock movements");
      }
      return response.json() as Promise<StockMovement[]>;
    },
  });
  
  // Get movement type badge color
  const getMovementTypeColor = (type: string) => {
    switch (type) {
      case "RECEIPT":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "ISSUE":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      case "TRANSFER":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "ADJUSTMENT":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "RECOUNT":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "PURCHASE":
        return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300";
      case "SALE":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300";
      case "RETURN":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "DAMAGE":
        return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300";
      case "EXPIRE":
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
    }
  };
  
  // Get movement type icon
  const getMovementTypeIcon = (type: string) => {
    switch (type) {
      case "RECEIPT":
        return <FileDown className="h-4 w-4 mr-1" />;
      case "ISSUE":
        return <FileUp className="h-4 w-4 mr-1" />;
      case "TRANSFER":
        return <ArrowRight className="h-4 w-4 mr-1" />;
      case "ADJUSTMENT":
        return <ArrowUpDown className="h-4 w-4 mr-1" />;
      default:
        return null;
    }
  };
  
  // Format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, "MMM d, yyyy h:mm a");
  };
  
  // Handle movement type display
  const getMovementDisplay = (movement: StockMovement) => {
    switch (movement.type) {
      case "TRANSFER":
        return (
          <span className="flex items-center">
            {movement.sourceWarehouse?.name || "Unknown"} 
            <ArrowRight className="mx-1 h-4 w-4" /> 
            {movement.destinationWarehouse?.name || "Unknown"}
          </span>
        );
      case "RECEIPT":
      case "ISSUE":
        return movement.warehouse?.name || "General Warehouse";
      default:
        return "—";
    }
  };
  
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Stock Movements</CardTitle>
          <CardDescription>
            Track inventory receipts, issues, and transfers
          </CardDescription>
        </div>
        
        <div className="space-x-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="text-green-600 border-green-600 hover:bg-green-50 dark:hover:bg-green-950"
            onClick={() => setShowReceiptForm(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Receipt
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            className="text-red-600 border-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => setShowIssueForm(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Issue
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                {!itemId && <TableHead>Item</TableHead>}
                <TableHead>Type</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements && movements.length > 0 ? (
                movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="font-medium">
                      {formatDate(movement.timestamp)}
                    </TableCell>
                    {!itemId && (
                      <TableCell>
                        {movement.item?.name || "Unknown Item"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge className={`flex items-center ${getMovementTypeColor(movement.type)}`}>
                        {getMovementTypeIcon(movement.type)}
                        {movement.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getMovementDisplay(movement)}
                    </TableCell>
                    <TableCell className={movement.quantity > 0 ? "text-green-600" : "text-red-600"}>
                      {movement.quantity > 0 ? "+" : ""}{movement.quantity}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {movement.notes || "—"}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={itemId ? 5 : 6} className="text-center py-8 text-muted-foreground">
                    No stock movements found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        
        {limit && movements && movements.length >= limit && (
          <div className="mt-4 text-center">
            <Button variant="outline" size="sm">
              View All Movements
            </Button>
          </div>
        )}
      </CardContent>
      
      {/* Receipt Form Dialog */}
      <StockMovementForm
        open={showReceiptForm}
        onClose={() => setShowReceiptForm(false)}
        type="RECEIPT"
        itemId={itemId}
        warehouseId={warehouseId}
      />
      
      {/* Issue Form Dialog */}
      <StockMovementForm
        open={showIssueForm}
        onClose={() => setShowIssueForm(false)}
        type="ISSUE"
        itemId={itemId}
        warehouseId={warehouseId}
      />
    </Card>
  );
}
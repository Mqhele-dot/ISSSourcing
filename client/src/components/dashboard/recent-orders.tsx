import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchPurchaseOrdersEnvelope } from "@/api/client";
import { StatusBadge } from "@/components/ui/status-badge";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { FileText } from "lucide-react";

export function RecentOrders() {
  const [, setLocation] = useLocation();

  const { data: orders, isLoading, error } = useQuery({
    queryKey: ["/api/procurement/purchase-orders", "dashboard-recent"],
    queryFn: async () => {
      const envelope = await fetchPurchaseOrdersEnvelope({});
      return envelope.data ?? [];
    },
  });

  const recent = Array.isArray(orders) ? orders.slice(0, 5) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Recent Orders</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation(APP_ROUTES.procurement.orders)}
          className="text-primary"
        >
          View all
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Orders are available from the Orders page when the operations service is running.
          </p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((order) => (
                  <TableRow
                    key={order.poNumber}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(APP_ROUTES.procurement.order(order.poNumber))}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        {order.poNumber}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate">
                      {order.supplierName ?? `#${order.supplierId}`}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-right">{order.receivedProgress}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setLocation(APP_ROUTES.procurement.orders)}
              >
                View and manage orders
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

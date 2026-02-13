import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardEdit, File, FileCheck, FilePlus, FileText, Search, ShoppingCart } from "lucide-react";
import { type PurchaseRequisition, type PurchaseOrder, PurchaseRequisitionStatus, PurchaseOrderStatus, PaymentStatus } from "@shared/schema";
import { formatDate } from "@/lib/utils";
import TutorialStep from "@/components/ui/tutorial-button";
import { useToast } from "@/hooks/use-toast";

export default function OrdersPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("requisitions");
  
  // Get requisitions
  const { 
    data: requisitions, 
    isLoading: requisitionsLoading 
  } = useQuery({
    queryKey: ['/api/purchase-requisitions'],
    retry: 1,
  });
  
  // Get purchase orders
  const { 
    data: purchaseOrders, 
    isLoading: ordersLoading 
  } = useQuery({
    queryKey: ['/api/purchase-orders'],
    retry: 1,
  });
  
  // Status badge colors for requisitions
  const getRequisitionStatusColor = (status: string) => {
    switch (status) {
      case PurchaseRequisitionStatus.DRAFT:
        return "bg-gray-500";
      case PurchaseRequisitionStatus.PENDING:
        return "bg-yellow-500";
      case PurchaseRequisitionStatus.APPROVED:
        return "bg-green-500";
      case PurchaseRequisitionStatus.REJECTED:
        return "bg-red-500";
      case PurchaseRequisitionStatus.CONVERTED:
        return "bg-blue-500";
      default:
        return "bg-gray-500";
    }
  };
  
  // Status badge colors for purchase orders
  const getOrderStatusColor = (status: string) => {
    switch (status) {
      case PurchaseOrderStatus.DRAFT:
        return "bg-gray-500";
      case PurchaseOrderStatus.SENT:
        return "bg-blue-500";
      case PurchaseOrderStatus.ACKNOWLEDGED:
        return "bg-indigo-500";
      case PurchaseOrderStatus.PARTIALLY_RECEIVED:
        return "bg-amber-500";
      case PurchaseOrderStatus.RECEIVED:
        return "bg-green-500";
      case PurchaseOrderStatus.CANCELLED:
        return "bg-red-500";
      case PurchaseOrderStatus.COMPLETED:
        return "bg-emerald-600";
      default:
        return "bg-gray-500";
    }
  };
  
  // Payment status badge colors
  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case PaymentStatus.UNPAID:
        return "bg-red-500";
      case PaymentStatus.PARTIALLY_PAID:
        return "bg-yellow-500";
      case PaymentStatus.PAID:
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };
  
  // Handle view requisition details
  const handleViewRequisition = (requisition: PurchaseRequisition) => {
    toast({
      title: "Feature coming soon",
      description: `View details for requisition ${requisition.requisitionNumber}`,
    });
  };
  
  // Handle view order details
  const handleViewOrder = (order: PurchaseOrder) => {
    toast({
      title: "Feature coming soon",
      description: `View details for purchase order ${order.orderNumber}`,
    });
  };
  
  // Create a new requisition
  const handleCreateRequisition = () => {
    toast({
      title: "Feature coming soon",
      description: "Create a new purchase requisition",
    });
  };
  
  // Create a new purchase order
  const handleCreateOrder = () => {
    toast({
      title: "Feature coming soon",
      description: "Create a new purchase order",
    });
  };
  
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Orders Management</h1>
          <p className="text-muted-foreground">
            Manage purchase requisitions and orders
          </p>
        </div>
        <TutorialStep page="orders" />
      </div>
      
      <Tabs 
        defaultValue="requisitions" 
        className="space-y-6"
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <div className="flex justify-between items-center">
          <TabsList className="grid w-[400px] grid-cols-2">
            <TabsTrigger value="requisitions">Purchase Requisitions</TabsTrigger>
            <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          </TabsList>
          
          <Button 
            onClick={activeTab === "requisitions" ? handleCreateRequisition : handleCreateOrder}
          >
            {activeTab === "requisitions" ? (
              <>
                <FilePlus className="mr-2 h-4 w-4" />
                New Requisition
              </>
            ) : (
              <>
                <ShoppingCart className="mr-2 h-4 w-4" />
                New Purchase Order
              </>
            )}
          </Button>
        </div>
        
        {/* Purchase Requisitions Tab */}
        <TabsContent value="requisitions">
          <Card>
            <CardHeader>
              <CardTitle>Purchase Requisitions</CardTitle>
              <CardDescription>
                View and manage your purchase requisitions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {requisitionsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex space-x-4 items-center p-4 border rounded-md">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-8 w-24" />
                    </div>
                  ))}
                </div>
              ) : requisitions && requisitions.length > 0 ? (
                <ScrollArea className="h-[550px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Requisition #</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requisitions.map((req: PurchaseRequisition) => (
                        <TableRow key={req.id}>
                          <TableCell className="font-medium">{req.requisitionNumber}</TableCell>
                          <TableCell>
                            {req.supplierId ? (
                              <span>{req.supplier?.name || `Supplier #${req.supplierId}`}</span>
                            ) : (
                              <span className="text-muted-foreground">Not specified</span>
                            )}
                          </TableCell>
                          <TableCell>{formatDate(new Date(req.createdAt))}</TableCell>
                          <TableCell>
                            <Badge className={getRequisitionStatusColor(req.status)}>
                              {req.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">${req.totalAmount.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleViewRequisition(req)}
                            >
                              <Search className="h-4 w-4" />
                            </Button>
                            {req.status === PurchaseRequisitionStatus.DRAFT && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toast({
                                  title: "Feature coming soon",
                                  description: "Edit requisition",
                                })}
                              >
                                <ClipboardEdit className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toast({
                                title: "Feature coming soon",
                                description: "Generate PDF for this requisition",
                              })}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <div className="text-center py-8">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-3 opacity-50" />
                  <h3 className="font-medium text-lg mb-2">No Requisitions Found</h3>
                  <p className="text-muted-foreground mb-4">
                    You haven't created any purchase requisitions yet.
                  </p>
                  <Button onClick={handleCreateRequisition}>
                    <FilePlus className="mr-2 h-4 w-4" />
                    Create Your First Requisition
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Purchase Orders Tab */}
        <TabsContent value="orders">
          <Card>
            <CardHeader>
              <CardTitle>Purchase Orders</CardTitle>
              <CardDescription>
                View and manage your purchase orders
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex space-x-4 items-center p-4 border rounded-md">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-8 w-24" />
                    </div>
                  ))}
                </div>
              ) : purchaseOrders && purchaseOrders.length > 0 ? (
                <ScrollArea className="h-[550px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order #</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {purchaseOrders.map((order: PurchaseOrder) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">{order.orderNumber}</TableCell>
                          <TableCell>
                            {order.supplierId ? (
                              <span>{order.supplier?.name || `Supplier #${order.supplierId}`}</span>
                            ) : (
                              <span className="text-muted-foreground">Not specified</span>
                            )}
                          </TableCell>
                          <TableCell>{formatDate(new Date(order.createdAt))}</TableCell>
                          <TableCell>
                            <Badge className={getOrderStatusColor(order.status)}>
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {order.paymentStatus && (
                              <Badge className={getPaymentStatusColor(order.paymentStatus)}>
                                {order.paymentStatus}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">${order.totalAmount.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleViewOrder(order)}
                            >
                              <Search className="h-4 w-4" />
                            </Button>
                            {order.status === PurchaseOrderStatus.DRAFT && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toast({
                                  title: "Feature coming soon",
                                  description: "Edit purchase order",
                                })}
                              >
                                <ClipboardEdit className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => toast({
                                title: "Feature coming soon", 
                                description: "Generate PDF for this purchase order",
                              })}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <div className="text-center py-8">
                  <File className="mx-auto h-12 w-12 text-muted-foreground mb-3 opacity-50" />
                  <h3 className="font-medium text-lg mb-2">No Purchase Orders Found</h3>
                  <p className="text-muted-foreground mb-4">
                    You haven't created any purchase orders yet.
                  </p>
                  <Button onClick={handleCreateOrder}>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    Create Your First Purchase Order
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { 
  FileDown, 
  CheckCircle, 
  XCircle, 
  ArrowUpRight, 
  Loader2, 
  ShoppingCart,
  Clock, 
  AlertTriangle
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type ReorderRequest, ReorderRequestStatus } from "@shared/schema";

export default function ReorderRequestsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedTab, setSelectedTab] = useState<string>("pending");
  const [selectedRequest, setSelectedRequest] = useState<ReorderRequest | null>(null);
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [rejectionDialogOpen, setRejectionDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
  
  // Fetch all reorder requests
  const { data: reorderRequests, isLoading: requestsLoading } = useQuery({
    queryKey: ["/api/reorder-requests"],
    queryFn: async () => {
      const response = await fetch("/api/reorder-requests");
      if (!response.ok) {
        throw new Error("Failed to fetch reorder requests");
      }
      return response.json() as Promise<ReorderRequest[]>;
    },
  });
  
  // Approve request mutation
  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/reorder-requests/${id}/approve`, {
        approverId: 1 // Using default admin user
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reorder-requests"] });
      toast({
        title: "Request Approved",
        description: "The reorder request has been approved successfully",
      });
      setApprovalDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to approve request",
        variant: "destructive",
      });
    }
  });
  
  // Reject request mutation
  const rejectMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/reorder-requests/${id}/reject`, {
        approverId: 1, // Using default admin user
        reason: rejectionReason
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reorder-requests"] });
      toast({
        title: "Request Rejected",
        description: "The reorder request has been rejected",
      });
      setRejectionDialogOpen(false);
      setRejectionReason("");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reject request",
        variant: "destructive",
      });
    }
  });
  
  // Convert request to requisition mutation
  const convertMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/reorder-requests/${id}/convert`, {});
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reorder-requests"] });
      // Also invalidate requisitions since we created a new one
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      
      toast({
        title: "Converted to Requisition",
        description: `A new purchase requisition (${data.requisitionNumber}) has been created`,
      });
      setConversionDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to convert to requisition",
        variant: "destructive",
      });
    }
  });
  
  // Filter requests based on selected tab
  const filteredRequests = reorderRequests?.filter(request => {
    switch (selectedTab) {
      case "pending":
        return request.status === ReorderRequestStatus.PENDING;
      case "approved":
        return request.status === ReorderRequestStatus.APPROVED;
      case "rejected":
        return request.status === ReorderRequestStatus.REJECTED;
      case "converted":
        return request.status === ReorderRequestStatus.CONVERTED;
      default:
        return true;
    }
  });
  
  const getBadgeStyle = (status: string) => {
    switch (status) {
      case ReorderRequestStatus.PENDING:
        return "bg-yellow-100 hover:bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case ReorderRequestStatus.APPROVED:
        return "bg-green-100 hover:bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case ReorderRequestStatus.REJECTED:
        return "bg-red-100 hover:bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
      case ReorderRequestStatus.CONVERTED:
        return "bg-blue-100 hover:bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      default:
        return "";
    }
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case ReorderRequestStatus.PENDING:
        return <Clock className="h-4 w-4 mr-1" />;
      case ReorderRequestStatus.APPROVED:
        return <CheckCircle className="h-4 w-4 mr-1" />;
      case ReorderRequestStatus.REJECTED:
        return <XCircle className="h-4 w-4 mr-1" />;
      case ReorderRequestStatus.CONVERTED:
        return <ArrowUpRight className="h-4 w-4 mr-1" />;
      default:
        return null;
    }
  };
  
  const exportReport = async (format: string) => {
    try {
      const response = await fetch(`/api/export/reorder-requests/${format}`);
      if (!response.ok) throw new Error(`Failed to export ${format}`);
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      // Create temporary anchor element to trigger download
      const a = document.createElement('a');
      a.href = url;
      
      // Use .xlsx extension for Excel files
      const fileExtension = format === 'excel' ? 'xlsx' : format;
      a.download = `reorder-requests.${fileExtension}`;
      
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Export Successful",
        description: `Reorder requests have been exported as ${format === 'excel' ? 'XLSX' : format.toUpperCase()}`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: error instanceof Error ? error.message : "Failed to export report",
        variant: "destructive",
      });
    }
  };
  
  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white">Reorder Requests</h2>
          <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
            Manage requests for reordering low or out of stock inventory items
          </p>
        </div>
        <div className="mt-4 md:mt-0 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportReport("pdf")}>
            <FileDown className="mr-2 h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="outline" onClick={() => exportReport("excel")}>
            <FileDown className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
          <Button variant="outline" onClick={() => exportReport("csv")}>
            <FileDown className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>
      
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Reorder Requests</CardTitle>
          <CardDescription>
            View and manage all reorder requests initiated for inventory items
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="pending" value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="pending" className="flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                Pending
              </TabsTrigger>
              <TabsTrigger value="approved" className="flex items-center">
                <CheckCircle className="mr-2 h-4 w-4" />
                Approved
              </TabsTrigger>
              <TabsTrigger value="rejected" className="flex items-center">
                <XCircle className="mr-2 h-4 w-4" />
                Rejected
              </TabsTrigger>
              <TabsTrigger value="converted" className="flex items-center">
                <ArrowUpRight className="mr-2 h-4 w-4" />
                Converted
              </TabsTrigger>
              <TabsTrigger value="all" className="flex items-center">
                All Requests
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value={selectedTab} className="m-0">
              {requestsLoading ? (
                <div className="flex justify-center items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="ml-2">Loading reorder requests...</span>
                </div>
              ) : filteredRequests && filteredRequests.length > 0 ? (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Request #</TableHead>
                        <TableHead>Item ID</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Warehouse</TableHead>
                        <TableHead>Auto-Gen</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRequests.map((request) => (
                        <TableRow key={request.id}>
                          <TableCell className="font-medium">{request.requestNumber}</TableCell>
                          <TableCell>{request.itemId}</TableCell>
                          <TableCell>{request.quantity}</TableCell>
                          <TableCell>{request.warehouseId ? `#${request.warehouseId}` : '-'}</TableCell>
                          <TableCell>
                            {request.isAutoGenerated ? 
                              <Badge variant="secondary" className="bg-blue-100 hover:bg-blue-100 text-blue-800">Auto</Badge> : 
                              <Badge variant="outline" className="bg-gray-100 hover:bg-gray-100 text-gray-800">Manual</Badge>
                            }
                          </TableCell>
                          <TableCell>
                            <Badge className={getBadgeStyle(request.status)} variant="outline">
                              {getStatusIcon(request.status)}
                              {request.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{format(new Date(request.createdAt), "MMM d, yyyy")}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {request.status === ReorderRequestStatus.PENDING && (
                                <>
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="h-8"
                                    onClick={() => {
                                      setSelectedRequest(request);
                                      setApprovalDialogOpen(true);
                                    }}
                                  >
                                    <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                    Approve
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="h-8"
                                    onClick={() => {
                                      setSelectedRequest(request);
                                      setRejectionDialogOpen(true);
                                    }}
                                  >
                                    <XCircle className="h-3.5 w-3.5 mr-1" />
                                    Reject
                                  </Button>
                                </>
                              )}
                              {request.status === ReorderRequestStatus.APPROVED && !request.convertedToRequisition && (
                                <Button 
                                  size="sm" 
                                  className="h-8"
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    setConversionDialogOpen(true);
                                  }}
                                >
                                  <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                                  Convert to Requisition
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 border rounded-md">
                  <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500" />
                  <h3 className="mt-2 text-lg font-medium">No requests found</h3>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    There are no reorder requests with the selected status.
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Approval Dialog */}
      <Dialog open={approvalDialogOpen} onOpenChange={setApprovalDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Reorder Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to approve this reorder request?
            </DialogDescription>
          </DialogHeader>
          
          {selectedRequest && (
            <div className="py-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Request Number:</span>
                  <span className="text-sm">{selectedRequest.requestNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Item ID:</span>
                  <span className="text-sm">{selectedRequest.itemId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Quantity:</span>
                  <span className="text-sm">{selectedRequest.quantity}</span>
                </div>
                {selectedRequest.warehouseId && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Warehouse:</span>
                    <span className="text-sm">#{selectedRequest.warehouseId}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Auto Generated:</span>
                  <span className="text-sm">
                    {selectedRequest.isAutoGenerated ? 
                      <Badge variant="secondary" className="bg-blue-100 hover:bg-blue-100 text-blue-800">Yes</Badge> : 
                      <Badge variant="outline" className="bg-gray-100 hover:bg-gray-100 text-gray-800">No</Badge>
                    }
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Created:</span>
                  <span className="text-sm">{format(new Date(selectedRequest.createdAt), "MMM d, yyyy")}</span>
                </div>
                {selectedRequest.notes && (
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-sm font-medium">Notes:</span>
                    <p className="text-sm bg-gray-50 p-2 rounded">{selectedRequest.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          <DialogFooter className="sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setApprovalDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => selectedRequest && approveMutation.mutate(selectedRequest.id)}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Approve Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejection Dialog */}
      <Dialog open={rejectionDialogOpen} onOpenChange={setRejectionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Reorder Request</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this request.
            </DialogDescription>
          </DialogHeader>
          
          {selectedRequest && (
            <div className="py-4">
              <div className="space-y-2 mb-4">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Request Number:</span>
                  <span className="text-sm">{selectedRequest.requestNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Item ID:</span>
                  <span className="text-sm">{selectedRequest.itemId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Quantity:</span>
                  <span className="text-sm">{selectedRequest.quantity}</span>
                </div>
                {selectedRequest.warehouseId && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Warehouse:</span>
                    <span className="text-sm">#{selectedRequest.warehouseId}</span>
                  </div>
                )}
                {selectedRequest.isAutoGenerated && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Auto Generated:</span>
                    <Badge variant="secondary" className="bg-blue-100 hover:bg-blue-100 text-blue-800">Yes</Badge>
                  </div>
                )}
                {selectedRequest.notes && (
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-sm font-medium">Notes:</span>
                    <p className="text-sm bg-gray-50 p-2 rounded">{selectedRequest.notes}</p>
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Rejection Reason</label>
                <Textarea
                  placeholder="Enter reason for rejection"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="min-h-[100px]"
                />
              </div>
            </div>
          )}
          
          <DialogFooter className="sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setRejectionDialogOpen(false);
                setRejectionReason("");
              }}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => selectedRequest && rejectMutation.mutate(selectedRequest.id)}
              disabled={rejectMutation.isPending || !rejectionReason.trim()}
            >
              {rejectMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversion Dialog */}
      <Dialog open={conversionDialogOpen} onOpenChange={setConversionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convert to Purchase Requisition</DialogTitle>
            <DialogDescription>
              This will create a new purchase requisition based on this reorder request.
            </DialogDescription>
          </DialogHeader>
          
          {selectedRequest && (
            <div className="py-4">
              <Alert className="mb-4">
                <AlertTitle>This action cannot be undone</AlertTitle>
                <AlertDescription>
                  Converting this request will generate a purchase requisition for the specified item and quantity.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Request Number:</span>
                  <span className="text-sm">{selectedRequest.requestNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Item ID:</span>
                  <span className="text-sm">{selectedRequest.itemId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Quantity:</span>
                  <span className="text-sm">{selectedRequest.quantity}</span>
                </div>
                {selectedRequest.warehouseId && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Warehouse:</span>
                    <span className="text-sm">#{selectedRequest.warehouseId}</span>
                  </div>
                )}
                {selectedRequest.supplierId && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Supplier ID:</span>
                    <span className="text-sm">#{selectedRequest.supplierId}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Status:</span>
                  <Badge className={getBadgeStyle(selectedRequest.status)} variant="outline">
                    {getStatusIcon(selectedRequest.status)}
                    {selectedRequest.status}
                  </Badge>
                </div>
                {selectedRequest.isAutoGenerated && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Auto Generated:</span>
                    <Badge variant="secondary" className="bg-blue-100 hover:bg-blue-100 text-blue-800">Yes</Badge>
                  </div>
                )}
                {selectedRequest.notes && (
                  <div className="flex flex-col gap-1 mt-2">
                    <span className="text-sm font-medium">Notes:</span>
                    <p className="text-sm bg-gray-50 p-2 rounded">{selectedRequest.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          <DialogFooter className="sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setConversionDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => selectedRequest && convertMutation.mutate(selectedRequest.id)}
              disabled={convertMutation.isPending}
            >
              {convertMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Convert to Requisition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Plus,
  Pencil,
  CheckCircle2,
  XCircle,
  FileText,
  Share2,
  Loader2,
  ChevronRight,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, User, Supplier, InventoryItem } from "@shared/schema";
import { Can } from "@/components/auth/can";

function formatDate(value: string | Date | null) {
  if (value == null) return "-";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface RequisitionsPageProps {
  embedded?: boolean;
  /** When embedded (e.g. under Purchase tab), use this base for new/edit links (e.g. /purchase/requisitions) */
  basePath?: string;
}

export default function RequisitionsPage({ embedded, basePath = "/requisitions" }: RequisitionsPageProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<PurchaseRequisition | null>(null);
  const [shareUserIds, setShareUserIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [rejectDialogReq, setRejectDialogReq] = useState<PurchaseRequisition | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [historyDialogReq, setHistoryDialogReq] = useState<PurchaseRequisition | null>(null);

  const { data: approvalHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ["/api/approval-history", historyDialogReq?.id],
    enabled: !!historyDialogReq,
    queryFn: () =>
      requestJson<
        Array<{
          id: number;
          action: string;
          level: number;
          performedBy: number;
          comment: string | null;
          previousStatus: string | null;
          newStatus: string | null;
          performedAt: string;
        }>
      >("GET", `/api/approval-history/requisition/${historyDialogReq?.id}`),
  });

  const { data: requisitionsRaw, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/purchase-requisitions"],
    queryFn: async () => {
      const raw = await requestJson<PurchaseRequisition[] | { data?: PurchaseRequisition[] }>("GET", "/api/purchase-requisitions");
      return Array.isArray(raw) ? raw : (raw as { data?: PurchaseRequisition[] })?.data ?? [];
    },
  });
  const requisitions = Array.isArray(requisitionsRaw) ? requisitionsRaw : [];

  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: () => requestJson<User[]>("GET", "/api/users"),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
  });

  const filtered = requisitions.filter(
    (r) =>
      !search ||
      r.requisitionNumber?.toLowerCase().includes(search.toLowerCase()) ||
      String(r.id).includes(search)
  );

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/purchase-requisitions/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition approved", variant: "default" });
    },
    onError: (e, id) => {
      toast({
        title: "Approve failed",
        description: getErrorMessage(e),
        variant: "destructive",
        action: (
          <ToastAction altText="Retry" onClick={() => id != null && approveMutation.mutate(id)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiRequest("POST", `/api/purchase-requisitions/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition rejected", variant: "default" });
    },
    onError: (e, vars) => {
      toast({
        title: "Reject failed",
        description: getErrorMessage(e),
        variant: "destructive",
        action: vars && (
          <ToastAction altText="Retry" onClick={() => rejectMutation.mutate(vars)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/purchase-requisitions/${id}/convert`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Converted to Purchase Order", variant: "default" });
    },
    onError: (e, id) => {
      toast({
        title: "Convert failed",
        description: getErrorMessage(e),
        variant: "destructive",
        action: (
          <ToastAction altText="Retry" onClick={() => id != null && convertMutation.mutate(id)}>
            Retry
          </ToastAction>
        ),
      });
    },
  });

  const shareMutation = useMutation({
    mutationFn: ({ id, userIds }: { id: number; userIds: number[] }) =>
      apiRequest("POST", `/api/purchase-requisitions/${id}/share`, { userIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition shared", variant: "default" });
      setShareOpen(false);
    },
    onError: (e) => {
      toast({ title: "Share failed", description: getErrorMessage(e), variant: "destructive" });
    },
  });

  const openShareDialog = (req: PurchaseRequisition) => {
    setSelectedReq(req);
    setShareUserIds((req as { sharedWithUserIds?: number[] }).sharedWithUserIds ?? []);
    setShareOpen(true);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {!embedded && (
        <PageHeader
          title="Purchase Requisitions"
          subtitle="Create, edit, and approve purchase requisitions"
          breadcrumb={<span>Purchase / Requisitions</span>}
        />
      )}

      <Toolbar
        sticky
        left={
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search requisition number..."
            className="w-[260px]"
          />
        }
        right={
          <>
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to create requisitions">
              <Button asChild variant="default" size="sm">
                <Link href={basePath + "/new"}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Requisition
                </Link>
              </Button>
            </Can>
            <Button variant="outline" onClick={() => refetch()}>
              Refresh
            </Button>
          </>
        }
      />

      <DataState
        loading={isLoading}
        error={isError ? (error instanceof Error ? error : new Error(String(error))) : null}
        data={filtered}
        isEmpty={(d) => (Array.isArray(d) ? d : []).length === 0}
        emptyTitle="No requisitions found"
        emptyDescription="Create a new requisition to get started."
        emptyAction={
          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to create requisitions">
            <Button asChild variant="default" size="sm">
              <Link href={basePath + "/new"}>
                <Plus className="mr-2 h-4 w-4" />
                New Requisition
              </Link>
            </Button>
          </Can>
        }
        onRetry={refetch}
      >
        {(data) => (
          <Table className="requisitions-table">
            <TableHeader>
              <TableRow>
                <TableHead>Req #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(Array.isArray(data) ? data : []).map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="font-medium">{req.requisitionNumber}</TableCell>
                  <TableCell>
                    <StatusBadge status={req.status} />
                  </TableCell>
                  <TableCell>
                    {suppliers.find((s) => s.id === req.supplierId)?.name ?? (req.supplierId ? "Supplier #" + req.supplierId : "-")}
                  </TableCell>
                  <TableCell>${Number(req.totalAmount || 0).toFixed(2)}</TableCell>
                  <TableCell>{formatDate(req.requiredDate)}</TableCell>
                  <TableCell>{formatDate(req.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit">
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={basePath + "/" + req.id}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                      </Can>
                      {req.status === "PENDING" && (
                        <>
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to approve">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => approveMutation.mutate(req.id)}
                              disabled={approveMutation.isPending}
                            >
                              {approveMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              )}
                            </Button>
                          </Can>
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to reject">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setRejectDialogReq(req)}
                              disabled={rejectMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          </Can>
                        </>
                      )}
                      {req.status === "APPROVED" && (
                        <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to convert to PO">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => convertMutation.mutate(req.id)}
                            disabled={convertMutation.isPending}
                            title="Convert to PO"
                          >
                            {convertMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <FileText className="h-4 w-4" />
                            )}
                          </Button>
                        </Can>
                      )}
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to share">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openShareDialog(req)}
                          title="Share"
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                      </Can>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setHistoryDialogReq(req)}
                        title="Approval history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataState>

      {/* Share requisition with team members */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Requisition</DialogTitle>
            <DialogDescription>
              Share {selectedReq?.requisitionNumber} with team members. Selected users will have access to view this requisition.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Share with users</Label>
              <Select
                value=""
                onValueChange={(v) => {
                  const id = Number(v);
                  if (id && !shareUserIds.includes(id)) {
                    setShareUserIds([...shareUserIds, id]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select user to add..." />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((u) => !shareUserIds.includes(u.id))
                    .map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.fullName || u.username}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {shareUserIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {shareUserIds.map((uid) => {
                    const u = users.find((x) => x.id === uid);
                    return (
                      <Badge
                        key={uid}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => setShareUserIds(shareUserIds.filter((id) => id !== uid))}
                      >
                        {(u?.fullName || u?.username || "User #" + uid) + " ×"}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedReq) return;
                shareMutation.mutate({ id: selectedReq.id, userIds: shareUserIds });
              }}
              disabled={shareMutation.isPending || shareUserIds.length === 0}
            >
              {shareMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject requisition — reason (optional) */}
      <Dialog
        open={rejectDialogReq !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectDialogReq(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject requisition</DialogTitle>
            <DialogDescription>
              {rejectDialogReq
                ? "Reject " + rejectDialogReq.requisitionNumber + "? You can optionally provide a reason."
                : "Provide an optional reason for rejection."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="reject-reason">Reason (optional)</Label>
              <Input
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Budget hold"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialogReq(null); setRejectReason(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (rejectDialogReq) {
                  rejectMutation.mutate(
                    { id: rejectDialogReq.id, reason: rejectReason },
                    { onSettled: () => { setRejectDialogReq(null); setRejectReason(""); } }
                  );
                }
              }}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval history */}
      <Dialog
        open={historyDialogReq !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryDialogReq(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approval history</DialogTitle>
            <DialogDescription>
              {historyDialogReq
                ? `History for ${historyDialogReq.requisitionNumber}`
                : "Approval history"}
            </DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="text-sm text-muted-foreground">Loading history...</div>
          ) : approvalHistory.length === 0 ? (
            <div className="text-sm text-muted-foreground">No approval history found for this requisition.</div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {approvalHistory.map((entry) => (
                <div key={entry.id} className="rounded border p-2 text-sm">
                  <div className="font-medium">
                    {entry.action.toUpperCase()} (Level {entry.level})
                  </div>
                  <div className="text-muted-foreground">
                    By user #{entry.performedBy} on {formatDate(entry.performedAt)}
                  </div>
                  <div className="text-muted-foreground">
                    {entry.previousStatus ?? "-"} {"->"} {entry.newStatus ?? "-"}
                  </div>
                  {entry.comment ? <div className="mt-1">{entry.comment}</div> : null}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryDialogReq(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

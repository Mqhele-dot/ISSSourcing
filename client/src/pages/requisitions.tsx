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
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { RequisitionsDialogs } from "@/pages/requisitions/requisitions-dialogs";
import { formatRequisitionDate, getRequisitionErrorMessage } from "@/pages/requisitions/requisitions-helpers";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { apiRequest, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, User, Supplier, InventoryItem } from "@shared/schema";
import { Can } from "@/components/auth/can";
import { fetchApprovalSuggestions } from "@/api/client";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";
import { APP_ROUTES } from "@/lib/routes/app-routes";

interface RequisitionsPageProps {
  embedded?: boolean;
  /** When embedded (e.g. under Purchase tab), use this base for new/edit links (e.g. /purchase/requisitions) */
  basePath?: string;
}

export default function RequisitionsPage({ embedded, basePath = "/requisitions" }: RequisitionsPageProps = {}) {
  const productSetupComplete = useProductSetupComplete();
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
  const [approverHelpAmount, setApproverHelpAmount] = useState<number | null>(null);

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
      const raw = await requestJson<unknown>("GET", "/api/purchase-requisitions");
      if (Array.isArray(raw)) return raw as PurchaseRequisition[];
      if (raw && typeof raw === "object" && "data" in raw && Array.isArray((raw as { data: unknown }).data)) {
        return (raw as { data: PurchaseRequisition[] }).data;
      }
      if (raw && typeof raw === "object" && "ok" in raw && (raw as { ok?: boolean }).ok === false) {
        throw new Error("Requisitions request failed");
      }
      if (raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) {
        throw new Error("Unexpected requisitions response shape");
      }
      return [];
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

  const { data: reqApproverHints, isLoading: approverHintsLoading } = useQuery({
    queryKey: ["/api/approval-suggestions", "requisition", approverHelpAmount],
    enabled: approverHelpAmount !== null,
    queryFn: () =>
      fetchApprovalSuggestions({
        entityType: "requisition",
        amount: Number(approverHelpAmount),
      }),
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
        description: getRequisitionErrorMessage(e),
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
        description: getRequisitionErrorMessage(e),
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
        description: getRequisitionErrorMessage(e),
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
      toast({ title: "Share failed", description: getRequisitionErrorMessage(e), variant: "destructive" });
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
            className="w-full sm:w-[260px]"
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
        emptyDescription={
          productSetupComplete
            ? "Create a new requisition to get started."
            : "Finish product setup first, then create your first requisition."
        }
        emptyAction={
          productSetupComplete ? (
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to create requisitions">
              <Button asChild variant="default" size="sm">
                <Link href={basePath + "/new"}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Requisition
                </Link>
              </Button>
            </Can>
          ) : (
            <Button asChild variant="default" size="sm">
              <Link href={APP_ROUTES.setup.product}>Continue product setup</Link>
            </Button>
          )
        }
        onRetry={refetch}
      >
        {(data) => (
          <div className="overflow-x-auto">
          <Table className="requisitions-table min-w-[52rem]">
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
                  <TableCell>{formatRequisitionDate(req.requiredDate)}</TableCell>
                  <TableCell>{formatRequisitionDate(req.createdAt)}</TableCell>
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
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Suggested approvers"
                              onClick={() => setApproverHelpAmount(Number(req.totalAmount ?? 0))}
                            >
                              <Users className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </Can>
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
          </div>
        )}
      </DataState>

      <RequisitionsDialogs
        shareOpen={shareOpen}
        setShareOpen={setShareOpen}
        selectedReq={selectedReq}
        users={users}
        shareUserIds={shareUserIds}
        setShareUserIds={setShareUserIds}
        shareMutation={shareMutation}
        rejectDialogReq={rejectDialogReq}
        setRejectDialogReq={setRejectDialogReq}
        rejectReason={rejectReason}
        setRejectReason={setRejectReason}
        rejectMutation={rejectMutation}
        approverHelpAmount={approverHelpAmount}
        setApproverHelpAmount={setApproverHelpAmount}
        reqApproverHints={reqApproverHints}
        approverHintsLoading={approverHintsLoading}
        historyDialogReq={historyDialogReq}
        setHistoryDialogReq={setHistoryDialogReq}
        approvalHistory={approvalHistory}
        historyLoading={historyLoading}
      />
    </div>
  );
}

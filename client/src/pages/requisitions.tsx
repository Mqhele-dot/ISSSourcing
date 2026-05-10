import { useMemo, useState } from "react";
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
  Eye,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PanelInlineError } from "@/components/panel-inline-error";
import { fetchApprovalSuggestions } from "@/api/client";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { useQueryState } from "@/hooks/use-query-state";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RequisitionsPageProps {
  embedded?: boolean;
  /** When embedded (e.g. under Purchase tab), use this base for new/edit links (e.g. /purchase/requisitions) */
  basePath?: string;
}

export default function RequisitionsPage({ embedded, basePath = "/requisitions" }: RequisitionsPageProps = {}) {
  const productSetupComplete = useProductSetupComplete();
  const { formatMoney } = useReportingMoney();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<PurchaseRequisition | null>(null);
  const [shareUserIds, setShareUserIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const { queryState, setQueryState } = useQueryState({ status: "" });
  const [previewReq, setPreviewReq] = useState<PurchaseRequisition | null>(null);
  const [rejectDialogReq, setRejectDialogReq] = useState<PurchaseRequisition | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [historyDialogReq, setHistoryDialogReq] = useState<PurchaseRequisition | null>(null);
  const [approverHelpAmount, setApproverHelpAmount] = useState<number | null>(null);

  const {
    data: approvalHistory = [],
    isLoading: historyLoading,
    isError: historyError,
    refetch: refetchApprovalHistory,
  } = useQuery({
    queryKey: ["/api/approval-history", historyDialogReq?.id],
    enabled: !!historyDialogReq,
    throwOnError: false,
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

  const {
    data: users = [],
    isError: usersError,
    error: usersErr,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ["/api/users"],
    queryFn: () => requestJson<User[]>("GET", "/api/users"),
    throwOnError: false,
  });

  const {
    data: suppliers = [],
    isError: suppliersError,
    error: suppliersErr,
    refetch: refetchSuppliers,
  } = useQuery({
    queryKey: ["/api/suppliers"],
    queryFn: () => requestJson<Supplier[]>("GET", "/api/suppliers"),
    throwOnError: false,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["/api/departments"],
    queryFn: () => requestJson<Array<{ id: number; code?: string | null; name?: string | null }>>("GET", "/api/departments"),
    throwOnError: false,
  });

  const {
    data: reqApproverHints,
    isLoading: approverHintsLoading,
    isError: approverHintsError,
    error: approverHintsErr,
  } = useQuery({
    queryKey: ["/api/approval-suggestions", "requisition", approverHelpAmount],
    enabled: approverHelpAmount !== null,
    queryFn: () =>
      fetchApprovalSuggestions({
        entityType: "requisition",
        amount: Number(approverHelpAmount),
      }),
    throwOnError: false,
  });

  const statusFilter = String(queryState.status || "").trim().toUpperCase();
  const searchFilter = search.trim();
  const filtered = requisitions.filter((r) => {
    if (statusFilter && String(r.status || "").toUpperCase() !== statusFilter) return false;
    return (
      !searchFilter ||
      r.requisitionNumber?.toLowerCase().includes(searchFilter.toLowerCase()) ||
      String(r.id).includes(searchFilter)
    );
  });
  const requisitionKpis = useMemo(() => {
    const norm = (value: unknown) => String(value || "").toUpperCase();
    return {
      total: requisitions.length,
      draft: requisitions.filter((r) => norm(r.status) === "DRAFT").length,
      pending: requisitions.filter((r) => norm(r.status) === "PENDING").length,
      approved: requisitions.filter((r) => norm(r.status) === "APPROVED").length,
      rejected: requisitions.filter((r) => norm(r.status) === "REJECTED").length,
      converted: requisitions.filter((r) => norm(r.status) === "CONVERTED").length,
    };
  }, [requisitions]);
  const hasActiveFilters = Boolean(searchFilter || statusFilter);
  const supplierNameFor = (req: PurchaseRequisition) =>
    suppliers.find((s) => s.id === req.supplierId)?.name ?? (req.supplierId ? "Supplier #" + req.supplierId : "-");
  const requesterNameFor = (req: PurchaseRequisition) => {
    const requestorId = Number((req as { requestorId?: unknown }).requestorId);
    if (!Number.isFinite(requestorId) || requestorId <= 0) return "—";
    const user = users.find((candidate) => candidate.id === requestorId);
    return user?.username ?? user?.email ?? `User #${requestorId}`;
  };
  const departmentNameFor = (req: PurchaseRequisition) => {
    const departmentId = Number((req as { departmentId?: unknown }).departmentId);
    if (!Number.isFinite(departmentId) || departmentId <= 0) return "—";
    const department = departments.find((candidate) => candidate.id === departmentId);
    return department ? `${department.code ? `${department.code} - ` : ""}${department.name ?? `Department #${departmentId}`}` : `Department #${departmentId}`;
  };
  const lineCountFor = (req: PurchaseRequisition) => {
    const items = (req as { items?: unknown }).items;
    // TODO: list API does not consistently include requisition line counts; prefer a lineCount field when added server-side.
    if (Array.isArray(items)) return String(items.length);
    const lineCount = Number((req as { lineCount?: unknown; linesCount?: unknown }).lineCount ?? (req as { linesCount?: unknown }).linesCount);
    return Number.isFinite(lineCount) && lineCount >= 0 ? String(lineCount) : "—";
  };
  const linkedPoFor = (req: PurchaseRequisition) => {
    const linked = (req as { purchaseOrderNumber?: unknown; poNumber?: unknown; linkedPoNumber?: unknown; convertedPurchaseOrderNumber?: unknown }).purchaseOrderNumber
      ?? (req as { poNumber?: unknown }).poNumber
      ?? (req as { linkedPoNumber?: unknown }).linkedPoNumber
      ?? (req as { convertedPurchaseOrderNumber?: unknown }).convertedPurchaseOrderNumber;
    if (linked) return String(linked);
    return String(req.status || "").toUpperCase() === "CONVERTED" ? "Converted" : "—";
  };
  const clearFilter = (key: "search" | "status") => {
    if (key === "search") setSearch("");
    if (key === "status") setQueryState({ status: "" });
  };

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
    <div className="mx-auto max-w-7xl space-y-4" data-testid="requisitions-page">
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
          <>
            <Input
              data-testid="requisition-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search requisition number..."
              className="w-full sm:w-[260px]"
            />
            <Select
              value={String(queryState.status || "") || "all"}
              onValueChange={(value) => setQueryState({ status: value === "all" ? "" : value })}
            >
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="requisition-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="CONVERTED">Converted</SelectItem>
              </SelectContent>
            </Select>
          </>
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Card data-testid="requisition-kpi-total">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">All requisitions</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{requisitionKpis.total}</CardContent>
        </Card>
        <Card data-testid="requisition-kpi-draft">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Draft</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{requisitionKpis.draft}</CardContent>
        </Card>
        <Card data-testid="requisition-kpi-pending">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{requisitionKpis.pending}</CardContent>
        </Card>
        <Card data-testid="requisition-kpi-approved">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Approved</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{requisitionKpis.approved}</CardContent>
        </Card>
        <Card data-testid="requisition-kpi-rejected">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Rejected</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{requisitionKpis.rejected}</CardContent>
        </Card>
        <Card data-testid="requisition-kpi-converted">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Converted</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{requisitionKpis.converted}</CardContent>
        </Card>
      </div>

      {hasActiveFilters ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="requisition-active-filters">
          <span className="text-muted-foreground">Active filters:</span>
          {searchFilter ? (
            <Button variant="secondary" size="sm" className="gap-1" data-testid="requisition-filter-chip-search" onClick={() => clearFilter("search")}>
              Search: {searchFilter}
              <X className="h-3 w-3" />
            </Button>
          ) : null}
          {statusFilter ? (
            <Button variant="secondary" size="sm" className="gap-1" data-testid="requisition-filter-chip-status" onClick={() => clearFilter("status")}>
              Status: {statusFilter}
              <X className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground" data-testid="requisition-results-count">
        Showing {filtered.length} of {requisitions.length} requisitions
      </p>

      {usersError || suppliersError ? (
        <PanelInlineError
          title="Directory data partially unavailable"
          description={
            usersError && suppliersError
              ? `Users: ${usersErr instanceof Error ? usersErr.message : String(usersErr)} · Suppliers: ${suppliersErr instanceof Error ? suppliersErr.message : String(suppliersErr)}`
              : usersError
                ? usersErr instanceof Error
                  ? usersErr.message
                  : String(usersErr)
                : suppliersErr instanceof Error
                  ? suppliersErr.message
                  : String(suppliersErr)
          }
          onRetry={() => {
            if (usersError) void refetchUsers();
            if (suppliersError) void refetchSuppliers();
          }}
        />
      ) : null}

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
          <Table className="requisitions-table min-w-[78rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Req #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Department / cost center</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Linked PO</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(Array.isArray(data) ? data : []).map((req) => (
                <TableRow key={req.id} data-testid={`requisition-row-${req.requisitionNumber ?? req.id}`} className="cursor-pointer" onClick={() => setPreviewReq(req)}>
                  <TableCell className="font-medium">{req.requisitionNumber}</TableCell>
                  <TableCell>
                    <StatusBadge status={req.status} />
                  </TableCell>
                  <TableCell>{requesterNameFor(req)}</TableCell>
                  <TableCell>
                    {supplierNameFor(req)}
                  </TableCell>
                  <TableCell>{departmentNameFor(req)}</TableCell>
                  <TableCell>{lineCountFor(req)}</TableCell>
                  <TableCell>{linkedPoFor(req)}</TableCell>
                  <TableCell>{formatMoney(Number(req.totalAmount || 0))}</TableCell>
                  <TableCell>{formatRequisitionDate(req.requiredDate)}</TableCell>
                  <TableCell>{formatRequisitionDate(req.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to edit">
                        <Button variant="ghost" size="icon" asChild onClick={(event) => event.stopPropagation()}>
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
                              onClick={(event) => {
                                event.stopPropagation();
                                setApproverHelpAmount(Number(req.totalAmount ?? 0));
                              }}
                            >
                              <Users className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </Can>
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to approve">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(event) => {
                                event.stopPropagation();
                                approveMutation.mutate(req.id);
                              }}
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
                              onClick={(event) => {
                                event.stopPropagation();
                                setRejectDialogReq(req);
                              }}
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
                            onClick={(event) => {
                              event.stopPropagation();
                              convertMutation.mutate(req.id);
                            }}
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
                          onClick={(event) => {
                            event.stopPropagation();
                            openShareDialog(req);
                          }}
                          title="Share"
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                      </Can>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          event.stopPropagation();
                          setHistoryDialogReq(req);
                        }}
                        title="Approval history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`requisition-row-preview-${req.requisitionNumber ?? req.id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewReq(req);
                        }}
                        title="Preview requisition"
                      >
                        <Eye className="h-4 w-4" />
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
        usersDirectoryError={usersError}
        onRetryUsers={() => void refetchUsers()}
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
        approverHintsError={approverHintsError}
        approverHintsErrorMessage={
          approverHintsErr instanceof Error ? approverHintsErr.message : approverHintsErr ? String(approverHintsErr) : ""
        }
        historyDialogReq={historyDialogReq}
        setHistoryDialogReq={setHistoryDialogReq}
        approvalHistory={approvalHistory}
        historyLoading={historyLoading}
        historyError={historyError}
        onRetryHistory={() => void refetchApprovalHistory()}
      />
      <Dialog open={Boolean(previewReq)} onOpenChange={(open) => !open && setPreviewReq(null)}>
        <DialogContent data-testid="requisition-preview-panel" className="sm:max-w-2xl">
          {previewReq ? (
            <>
              <DialogHeader>
                <DialogTitle data-testid="requisition-preview-title">
                  {previewReq.requisitionNumber ?? `Requisition #${previewReq.id}`}
                </DialogTitle>
                <DialogDescription>{supplierNameFor(previewReq)}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div data-testid="requisition-preview-status"><StatusBadge status={previewReq.status} /></div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-xl font-semibold tabular-nums">{formatMoney(Number(previewReq.totalAmount || 0))}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Required date</div>
                  <div className="font-medium">{formatRequisitionDate(previewReq.requiredDate)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Created</div>
                  <div className="font-medium">{formatRequisitionDate(previewReq.createdAt)}</div>
                </div>
                <div className="rounded-md border p-3 sm:col-span-2">
                  <div className="text-xs text-muted-foreground">Justification / notes</div>
                  <p className="text-sm">{(previewReq as { justification?: string | null }).justification || previewReq.notes || "No justification recorded."}</p>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPreviewReq(null)}>
                  Close
                </Button>
                <Button type="button" asChild>
                  <Link href={basePath + "/" + previewReq.id}>Open full requisition</Link>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

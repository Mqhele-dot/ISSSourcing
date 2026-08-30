import { useEffect, useMemo, useState } from "react";
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
  Send,
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
import type { PurchaseRequisition, PurchaseRequisitionItem, PurchaseRequisitionListEntry, User, Supplier, InventoryItem } from "@shared/schema";
import { Can } from "@/components/auth/can";
import { PanelInlineError } from "@/components/panel-inline-error";
import { fetchApprovalSuggestions } from "@/api/client";
import { useProductSetupComplete } from "@/hooks/use-product-setup-complete";
import { useReportingMoney } from "@/hooks/use-reporting-money";
import { useQueryState } from "@/hooks/use-query-state";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { invalidatePurchaseOrderDomain, invalidateRequisitionDomain } from "@/lib/domain-invalidation";
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

type ReportingRequisitionListEntry = PurchaseRequisitionListEntry & {
  currencyCode?: string | null;
  reportingCurrencyCode?: string | null;
  reportingExchangeRate?: number | null;
  reportingTotal?: number | null;
};

const EMPTY_REQUISITIONS: ReportingRequisitionListEntry[] = [];

export default function RequisitionsPage({ embedded, basePath = "/requisitions" }: RequisitionsPageProps = {}) {
  const productSetupComplete = useProductSetupComplete();
  const { formatMoney } = useReportingMoney();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [selectedReq, setSelectedReq] = useState<PurchaseRequisition | null>(null);
  const [shareUserIds, setShareUserIds] = useState<number[]>([]);
  const { queryState, setQueryState } = useQueryState({ status: "", q: "", page: "1", pageSize: "25" });
  const [search, setSearch] = useState(String(queryState.q || ""));
  useEffect(() => {
    const timer = window.setTimeout(() => { if (String(queryState.q || "") !== search) setQueryState({ q: search, page: "1" }); }, 300);
    return () => window.clearTimeout(timer);
  }, [queryState.q, search, setQueryState]);
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

  const page = Math.max(1, Number(queryState.page) || 1);
  const pageSize = [25, 50, 100].includes(Number(queryState.pageSize)) ? Number(queryState.pageSize) : 25;
  const { data: requisitionPage, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["/api/v2/procurement/requisitions", queryState.status, queryState.q, page, pageSize],
    queryFn: () => requestJson<{ items: ReportingRequisitionListEntry[]; total: number; page: number; pageSize: number; hasNext: boolean; summary?: { totalAmount: number; reportingCurrencyCode: string; missingFxCount: number; byStatus: Record<string, number> } }>("GET", `/api/v2/procurement/requisitions?page=${page}&pageSize=${pageSize}&status=${encodeURIComponent(String(queryState.status || ""))}&q=${encodeURIComponent(String(queryState.q || ""))}`),
  });
  const requisitions = requisitionPage?.items ?? EMPTY_REQUISITIONS;

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
  const filtered = requisitions;
  const requisitionKpis = useMemo(() => {
    const norm = (value: unknown) => String(value || "").toUpperCase();
    return {
      total: requisitionPage?.total ?? 0,
      draft: Number(requisitionPage?.summary?.byStatus.DRAFT ?? 0),
      pending: Number(requisitionPage?.summary?.byStatus.PENDING ?? 0) + Number(requisitionPage?.summary?.byStatus.PENDING_APPROVAL ?? 0) + Number(requisitionPage?.summary?.byStatus.SUBMITTED ?? 0),
      approved: Number(requisitionPage?.summary?.byStatus.APPROVED ?? 0),
      rejected: Number(requisitionPage?.summary?.byStatus.REJECTED ?? 0),
      converted: Number(requisitionPage?.summary?.byStatus.CONVERTED ?? 0) + Number(requisitionPage?.summary?.byStatus.CONVERTED_TO_RFQ ?? 0) + Number(requisitionPage?.summary?.byStatus.CONVERTED_TO_PO ?? 0),
    };
  }, [requisitionPage]);
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
  const lineCountFor = (req: PurchaseRequisitionListEntry) => {
    const lineCount = Number(req.lineCount);
    return Number.isFinite(lineCount) && lineCount >= 0 ? String(lineCount) : "—";
  };
  const linkedPoFor = (req: PurchaseRequisition) => {
    const linked = (req as { purchaseOrderNumber?: unknown; poNumber?: unknown; linkedPoNumber?: unknown; convertedPurchaseOrderNumber?: unknown }).purchaseOrderNumber
      ?? (req as { poNumber?: unknown }).poNumber
      ?? (req as { linkedPoNumber?: unknown }).linkedPoNumber
      ?? (req as { convertedPurchaseOrderNumber?: unknown }).convertedPurchaseOrderNumber;
    if (linked) return String(linked);
    return ["CONVERTED", "CONVERTED_TO_RFQ", "CONVERTED_TO_PO"].includes(String(req.status || "").toUpperCase()) ? "Converted" : "—";
  };
  const clearFilter = (key: "search" | "status") => {
    if (key === "search") setSearch("");
    if (key === "status") setQueryState({ status: "", page: "1" });
  };

  const approveMutation = useMutation({
    mutationFn: (id: number) =>
      requestJson("POST", `/api/v2/procurement/requisitions/${id}/approve`, {}),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      await invalidateRequisitionDomain(queryClient);
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

  const submitMutation = useMutation({
    mutationFn: (id: number) => requestJson("POST", `/api/v2/procurement/requisitions/${id}/submit`, {}),
    onSuccess: async () => {
      await invalidateRequisitionDomain(queryClient);
      toast({ title: "Requisition submitted for approval" });
    },
    onError: (error: Error) => toast({ title: "Submit failed", description: error.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      requestJson("POST", `/api/v2/procurement/requisitions/${id}/reject`, { reason }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      await invalidateRequisitionDomain(queryClient);
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
      requestJson("POST", `/api/purchase-requisitions/${id}/convert`, {}, {
        headers: { "Idempotency-Key": `requisition-convert-${id}` },
      }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      await invalidateRequisitionDomain(queryClient);
      await invalidatePurchaseOrderDomain(queryClient);
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
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      await invalidateRequisitionDomain(queryClient);
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
      {embedded ? <h1 className="sr-only">Purchase Requisitions</h1> : null}

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
              onValueChange={(value) => setQueryState({ status: value === "all" ? "" : value, page: "1" })}
            >
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="requisition-status-filter">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active (draft or pending)</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PENDING_APPROVAL">Pending approval</SelectItem>
                <SelectItem value="NEEDS_INFO">Needs information</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="CONVERTED">Converted (legacy)</SelectItem>
                <SelectItem value="CONVERTED_TO_RFQ">Converted to RFQ</SelectItem>
                <SelectItem value="CONVERTED_TO_PO">Converted to PO</SelectItem>
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
        {requisitionPage?.total ? `${(page - 1) * pageSize + 1}–${Math.min(requisitionPage.total, page * pageSize)} of ${requisitionPage.total}` : "0 of 0"} requisitions
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
                  <TableCell>
                    <div>{req.currencyCode ?? "—"} {Number(req.totalAmount || 0).toFixed(2)}</div>
                    {req.reportingTotal != null ? (
                      <div className="text-xs text-muted-foreground">{formatMoney(req.reportingTotal)}</div>
                    ) : req.currencyCode ? (
                      <div className="text-xs text-amber-700">FX rate unavailable</div>
                    ) : null}
                  </TableCell>
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
                      {["DRAFT", "NEEDS_INFO"].includes(String(req.status).toUpperCase()) ? (
                        <Can roles={["manager", "planner", "admin"]} reason="Requires procurement create access">
                          <Button variant="ghost" size="icon" title="Submit for approval" onClick={(event) => { event.stopPropagation(); submitMutation.mutate(req.id); }} disabled={submitMutation.isPending}>
                            {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 text-primary" />}
                          </Button>
                        </Can>
                      ) : null}
                      {["PENDING", "PENDING_APPROVAL", "SUBMITTED"].includes(String(req.status).toUpperCase()) && (
                        <>
                          <Can roles={["manager", "admin"]} reason="Requires Manager or Admin">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Suggested approvers"
                              onClick={(event) => {
                                event.stopPropagation();
                                setApproverHelpAmount(Number(req.reportingTotal ?? req.totalAmount ?? 0));
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
          {requisitionPage ? <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
            <span className="text-muted-foreground">{requisitionPage.total === 0 ? "0 results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, requisitionPage.total)} of ${requisitionPage.total}`}</span>
            <div className="flex items-center gap-2">
              <Select value={String(pageSize)} onValueChange={(value) => setQueryState({ pageSize: value, page: "1" })}><SelectTrigger className="w-24"><SelectValue /></SelectTrigger><SelectContent>{[25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} rows</SelectItem>)}</SelectContent></Select>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setQueryState({ page: "1" })}>First</Button><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setQueryState({ page: String(page - 1) })}>Previous</Button><Button variant="outline" size="sm" disabled={!requisitionPage.hasNext} onClick={() => setQueryState({ page: String(page + 1) })}>Next</Button><Button variant="outline" size="sm" disabled={!requisitionPage.hasNext} onClick={() => setQueryState({ page: String(Math.max(1, Math.ceil(requisitionPage.total / pageSize))) })}>Last</Button>
            </div>
          </div> : null}
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
                  <div className="text-xl font-semibold tabular-nums">
                    {(previewReq as ReportingRequisitionListEntry).currencyCode ?? "—"} {Number(previewReq.totalAmount || 0).toFixed(2)}
                  </div>
                  {(previewReq as ReportingRequisitionListEntry).reportingTotal != null ? (
                    <div className="text-sm text-muted-foreground">
                      Reporting value: {formatMoney(Number((previewReq as ReportingRequisitionListEntry).reportingTotal))}
                    </div>
                  ) : null}
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

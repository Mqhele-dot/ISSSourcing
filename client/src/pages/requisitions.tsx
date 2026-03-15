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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { DataState } from "@/components/ui/data-state";
import { StatusBadge } from "@/components/status-badge";
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
import { apiRequest, requestJson } from "@/lib/queryClient";
import type { PurchaseRequisition, PurchaseRequisitionItem, User, Supplier, InventoryItem } from "@shared/schema";

function formatDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
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

  const { data: requisitionsRaw, isLoading, error, refetch } = useQuery({
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
    onError: (e) => {
      toast({ title: "Approve failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiRequest("POST", `/api/purchase-requisitions/${id}/reject", { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Requisition rejected", variant: "default" });
    },
    onError: (e) => {
      toast({ title: "Reject failed", description: (e as Error).message, variant: "destructive" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/purchase-requisitions/${id}/convert`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-requisitions"] });
      toast({ title: "Converted to Purchase Order", variant: "default" });
    },
    onError: (e) => {
      toast({ title: "Convert failed", description: (e as Error).message, variant: "destructive" });
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
      toast({ title: "Share failed", description: (e as Error).message, variant: "destructive" });
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
            <Button asChild variant="default" size="sm">
              <Link href={`${basePath}/new`}>
                <Plus className="mr-2 h-4 w-4" />
                New Requisition
              </Link>
            </Button>
            <Button variant="outline" onClick={() => refetch()}>
              Refresh
            </Button>
          </>
        }
      />

      <DataState
        loading={isLoading}
        error={error}
        data={filtered}
        isEmpty={(d) => (Array.isArray(d) ? d : []).length === 0}
        emptyTitle="No requisitions found"
        emptyDescription="Create a new requisition to get started."
        emptyAction={
          <Button asChild variant="default" size="sm">
            <Link href={`${basePath}/new`}>
              <Plus className="mr-2 h-4 w-4" />
              New Requisition
            </Link>
          </Button>
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
                    {suppliers.find((s) => s.id === req.supplierId)?.name ?? (req.supplierId ? `Supplier #${req.supplierId}` : "-")}
                  </TableCell>
                  <TableCell>${Number(req.totalAmount || 0).toFixed(2)}</TableCell>
                  <TableCell>{formatDate(req.requiredDate)}</TableCell>
                  <TableCell>{formatDate(req.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`${basePath}/${req.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      {req.status === "PENDING" && (
                        <>
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
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              const reason = window.prompt("Rejection reason (optional):");
                              if (reason !== null) rejectMutation.mutate({ id: req.id, reason });
                            }}
                            disabled={rejectMutation.isPending}
                          >
                            <XCircle className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      )}
                      {req.status === "APPROVED" && (
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
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openShareDialog(req)}
                        title="Share"
                      >
                        <Share2 className="h-4 w-4" />
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
                        {u?.fullName || u?.username || `User #${uid}`} ×
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
    </div>
  );
}

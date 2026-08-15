import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchApprovalSuggestions } from "@/api/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAuth } from "@/hooks/use-auth";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { formatMutationError, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import type { ApprovalPolicy } from "@shared/schema";
import type { RoleCatalogResponse } from "@shared/rbac-contracts";
import type { ApprovalWorkflowCatalogResponse, GovernedApprovalEntityType } from "@shared/authority-catalogs";

function rangesOverlap(
  aMin: number,
  aMax: number | null,
  bMin: number,
  bMax: number | null,
): boolean {
  const aHi = aMax == null ? Number.POSITIVE_INFINITY : aMax;
  const bHi = bMax == null ? Number.POSITIVE_INFINITY : bMax;
  return Math.max(aMin, bMin) <= Math.min(aHi, bHi);
}

type UserOpt = { id: number; username: string; fullName?: string | null };
type PolicyPage = {
  items: ApprovalPolicy[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
};

const emptyForm = {
  name: "",
  entityType: "requisition",
  amountMin: "0",
  amountMax: "",
  approvalLevel: "1",
  approverRole: "none",
  approverUserId: "none",
  isActive: true,
};

async function fetchApprovalWorkflowCatalog(): Promise<ApprovalWorkflowCatalogResponse> {
  const raw = await requestJson<unknown>("GET", "/api/approval-workflows/catalog");
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { items?: unknown }).items)) {
    throw new Error("The server returned an invalid governed-workflow catalog. Restart the local server and retry.");
  }
  const items = (raw as { items: unknown[] }).items.filter(
    (item): item is ApprovalWorkflowCatalogResponse["items"][number] =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as { entityType?: unknown }).entityType === "string" &&
          typeof (item as { label?: unknown }).label === "string" &&
          typeof (item as { amountBased?: unknown }).amountBased === "boolean" &&
          (item as { active?: unknown }).active === true,
      ),
  );
  if (items.length === 0) throw new Error("No active governed workflows were returned by the server.");
  return { items };
}

export default function ApprovalPoliciesPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const workflowCatalogQuery = useQuery<ApprovalWorkflowCatalogResponse>({
    queryKey: ["/api/approval-workflows/catalog"],
    queryFn: fetchApprovalWorkflowCatalog,
  });
  const entityTypes = useMemo(() => workflowCatalogQuery.data?.items ?? [], [workflowCatalogQuery.data?.items]);
  const canManagePolicies = ["admin", "manager"].includes(String(user?.role ?? "").toLowerCase());
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingVersion, setEditingVersion] = useState(1);
  const [stalePolicy, setStalePolicy] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [conflictingPolicies, setConflictingPolicies] = useState<Array<{ id: number; name: string; amountMin: number; amountMax: number | null; approvalLevel: number }>>([]);
  const [previewEntity, setPreviewEntity] = useState<GovernedApprovalEntityType>("requisition");
  const [previewAmount, setPreviewAmount] = useState("5000");
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [overlapOnly, setOverlapOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const {
    data: policyPage,
    isLoading,
    isError: isPolicyListError,
    error: policyListError,
    refetch: refetchPolicies,
  } = useQuery<PolicyPage>({
    queryKey: ["/api/approval-policies", { search, entityFilter, statusFilter, overlapOnly, page, pageSize }],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status: statusFilter,
      });
      if (search.trim()) params.set("q", search.trim());
      if (entityFilter !== "all") params.set("entityType", entityFilter);
      if (overlapOnly) params.set("overlapOnly", "true");
      const raw = await requestJson<unknown>("GET", `/api/approval-policies?${params.toString()}`);
      if (raw && typeof raw === "object" && Array.isArray((raw as PolicyPage).items)) return raw as PolicyPage;
      const items = normalizeApiList<ApprovalPolicy>(raw);
      return { items, total: items.length, page: 1, pageSize, hasNext: false };
    },
  });
  const policies = useMemo(() => policyPage?.items ?? [], [policyPage]);
  const totalPolicies = policyPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalPolicies / pageSize));

  useEffect(() => {
    setPage(1);
  }, [search, entityFilter, statusFilter, overlapOnly]);

  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/users");
      return normalizeApiList<UserOpt>(raw);
    },
  });
  const { data: roleCatalog } = useQuery<RoleCatalogResponse>({
    queryKey: ["/api/rbac/roles/catalog"],
    queryFn: () => requestJson<RoleCatalogResponse>("GET", "/api/rbac/roles/catalog"),
  });
  const approverRoles = useMemo(
    () => (roleCatalog?.roles ?? []).filter((role) => role.active),
    [roleCatalog?.roles],
  );

  const sortedPolicies = useMemo(
    () =>
      [...policies].sort((a, b) => {
        const et = String(a.entityType).localeCompare(String(b.entityType));
        if (et !== 0) return et;
        return Number(b.approvalLevel ?? 0) - Number(a.approvalLevel ?? 0);
      }),
    [policies],
  );

  const overlappingPolicyIds = useMemo(() => {
    const ids = new Set<number>();
    const active = policies.filter((p) => p.isActive);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (String(a.entityType) !== String(b.entityType)) continue;
        if (Number(a.approvalLevel) !== Number(b.approvalLevel)) continue;
        const aMin = Number(a.amountMin ?? 0);
        const bMin = Number(b.amountMin ?? 0);
        const aMax = a.amountMax == null ? null : Number(a.amountMax);
        const bMax = b.amountMax == null ? null : Number(b.amountMax);
        if (rangesOverlap(aMin, aMax, bMin, bMax)) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }, [policies]);

  const policiesByEntityChain = useMemo(() => {
    const map = new Map<string, ApprovalPolicy[]>();
    for (const t of entityTypes) {
      map.set(t.entityType, []);
    }
    for (const p of policies.filter((x) => x.isActive)) {
      const key = String(p.entityType);
      const list = map.get(key);
      if (list) list.push(p);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.approvalLevel ?? 0) - Number(b.approvalLevel ?? 0));
    }
    return map;
  }, [entityTypes, policies]);

  const previewMutation = useMutation({
    mutationFn: () => {
      const amt = Number(previewAmount);
      if (!Number.isFinite(amt) || amt < 0) throw new Error("Enter a valid non-negative amount");
      return fetchApprovalSuggestions({ entityType: previewEntity, amount: amt });
    },
    onError: (e) => {
      toast({
        title: "Preview failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Policy name is required");
      const amountMin = Number(form.amountMin);
      if (!Number.isFinite(amountMin) || amountMin < 0) throw new Error("Minimum amount must be ≥ 0");
      const amountMaxRaw = form.amountMax.trim();
      const amountMax = amountMaxRaw === "" ? null : Number(amountMaxRaw);
      if (amountMaxRaw !== "" && (!Number.isFinite(amountMax) || (amountMax as number) < amountMin)) {
        throw new Error("Maximum amount must be empty or ≥ minimum");
      }
      const level = Number(form.approvalLevel);
      if (!Number.isFinite(level) || level < 1) throw new Error("Approval level must be ≥ 1");

      const body = {
        name: form.name.trim(),
        entityType: form.entityType,
        amountMin,
        amountMax: amountMaxRaw === "" ? null : amountMax,
        approvalLevel: level,
        approverRole:
          form.approverRole === "none" || !form.approverRole ? null : form.approverRole,
        approverUserId:
          form.approverUserId === "none" || !form.approverUserId ? null : Number(form.approverUserId),
        isActive: form.isActive,
      };

      if (editingId != null) {
        return requestJson<ApprovalPolicy>("PATCH", `/api/approval-policies/${editingId}`, {
          ...body,
          expectedVersion: editingVersion,
          changeReason,
        });
      }
      return requestJson<ApprovalPolicy>("POST", "/api/approval-policies", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approval-suggestions"], exact: false });
      toast({ title: editingId != null ? "Policy updated" : "Policy created" });
      setForm(emptyForm);
      setEditingId(null);
      setChangeReason("");
      setConflictingPolicies([]);
      setStalePolicy(false);
    },
    onError: (e) => {
      const apiError = e as Error & { code?: string; details?: { conflicts?: Array<{ id: number; name: string; amountMin: number; amountMax: number | null; approvalLevel: number }> } };
      if (apiError.code === "APPROVAL_POLICY_OVERLAP") {
        setConflictingPolicies(apiError.details?.conflicts ?? []);
      }
      if (apiError.code === "APPROVAL_POLICY_STALE") {
        setStalePolicy(true);
      }
      toast({
        title: "Save failed",
        description: formatMutationError(
          "Save approval policy",
          editingId != null ? "PATCH" : "POST",
          "/api/approval-policies",
          e,
        ),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => requestJson("DELETE", `/api/approval-policies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approval-suggestions"], exact: false });
      toast({ title: "Policy deleted" });
      if (editingId != null) {
        setEditingId(null);
        setForm(emptyForm);
      }
    },
    onError: (e) => {
      toast({
        title: "Delete failed",
        description: formatMutationError("Delete approval policy", "DELETE", "/api/approval-policies/:id", e),
        variant: "destructive",
      });
    },
  });

  const [, setLocation] = useLocation();
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  useEffect(() => {
    if (!isLgUp) setLocation("/m/home");
  }, [isLgUp, setLocation]);

  const startEdit = (p: ApprovalPolicy) => {
    setEditingId(p.id);
    setEditingVersion(Number(p.version ?? 1));
    setChangeReason("");
    setConflictingPolicies([]);
    setStalePolicy(false);
    setForm({
      name: p.name ?? "",
      entityType: p.entityType ?? "requisition",
      amountMin: String(p.amountMin ?? 0),
      amountMax: p.amountMax == null ? "" : String(p.amountMax),
      approvalLevel: String(p.approvalLevel ?? 1),
      approverRole: p.approverRole ? String(p.approverRole) : "none",
      approverUserId: p.approverUserId != null ? String(p.approverUserId) : "none",
      isActive: Boolean(p.isActive ?? true),
    });
  };

  const reloadEditedPolicy = async () => {
    if (editingId == null) return;
    const result = await refetchPolicies();
    const latest = result.data?.items.find((policy) => policy.id === editingId);
    if (latest) {
      startEdit(latest);
      toast({ title: "Latest policy loaded", description: `Now editing version ${Number(latest.version ?? 1)}.` });
    }
  };

  if (!isLgUp) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">
        Approval policies are available on large screens (1024px and wider). Use a desktop browser or resize the
        window. Sending you to the mobile hub…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6" data-testid="approval-policies-page">
      <PageHeader
        title="Approval policies"
        subtitle="Configure sequential approval levels, amount bands, and independent approvers for every governed workflow."
        breadcrumb={
          <Link href={APP_ROUTES.procurement.requisitions} className="text-sm text-muted-foreground hover:text-foreground">
            ← Requisitions
          </Link>
        }
      />
      {workflowCatalogQuery.isLoading ? (
        <Alert><AlertTitle>Loading governed workflows</AlertTitle><AlertDescription>Policy editing will become available when the authoritative catalog is ready.</AlertDescription></Alert>
      ) : workflowCatalogQuery.isError ? (
        <Alert variant="destructive"><AlertTitle>Workflow catalog unavailable</AlertTitle><AlertDescription className="flex items-center justify-between gap-3">Policy editing is disabled to prevent an incomplete configuration. <Button size="sm" variant="outline" onClick={() => void workflowCatalogQuery.refetch()}>Retry</Button></AlertDescription></Alert>
      ) : null}

      <Sheet
        open={editingId != null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
            setChangeReason("");
            setConflictingPolicies([]);
            setStalePolicy(false);
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="approval-policy-edit-sheet">
          <SheetHeader>
            <SheetTitle>Edit approval policy</SheetTitle>
            <SheetDescription>Version {editingVersion}. Routing changes require a reason and are checked against active policies before saving.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-6">
            <div className="space-y-2"><Label htmlFor="edit-ap-name">Name</Label><Input id="edit-ap-name" value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} disabled={!canManagePolicies} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2"><Label>Governed workflow</Label><Select value={form.entityType} onValueChange={(value) => setForm((current) => ({ ...current, entityType: value }))} disabled={!canManagePolicies || !workflowCatalogQuery.isSuccess}><SelectTrigger className="w-full"><SelectValue placeholder="Select governed workflow" /></SelectTrigger><SelectContent>{entityTypes.map((type) => <SelectItem key={type.entityType} value={type.entityType}>{type.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="edit-ap-level">Approval level</Label><Input id="edit-ap-level" type="number" min={1} value={form.approvalLevel} onChange={(event) => setForm((current) => ({ ...current, approvalLevel: event.target.value }))} disabled={!canManagePolicies} /></div>
              <div className="space-y-2"><Label htmlFor="edit-ap-min">Amount min</Label><Input id="edit-ap-min" type="number" min={0} value={form.amountMin} onChange={(event) => setForm((current) => ({ ...current, amountMin: event.target.value }))} disabled={!canManagePolicies} /></div>
              <div className="space-y-2"><Label htmlFor="edit-ap-max">Amount max</Label><Input id="edit-ap-max" type="number" min={0} value={form.amountMax} onChange={(event) => setForm((current) => ({ ...current, amountMax: event.target.value }))} disabled={!canManagePolicies} placeholder="No cap" /></div>
              <div className="space-y-2"><Label>Required role</Label><Select value={form.approverRole} onValueChange={(value) => setForm((current) => ({ ...current, approverRole: value }))} disabled={!canManagePolicies}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Any role</SelectItem>{approverRoles.map((role) => { const value = role.ref.kind === "custom" ? `custom:${role.ref.id}` : role.ref.key; return <SelectItem key={value} value={value}>{role.name}{role.ref.kind === "custom" ? " (custom)" : ""}</SelectItem>; })}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Specific approver</Label><Select value={form.approverUserId} onValueChange={(value) => setForm((current) => ({ ...current, approverUserId: value }))} disabled={!canManagePolicies}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{users.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.fullName || candidate.username}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="flex items-center gap-2"><Switch id="edit-ap-active" checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} disabled={!canManagePolicies} /><Label htmlFor="edit-ap-active">Active</Label></div>
            <div className="space-y-2"><Label htmlFor="edit-ap-reason">Change reason</Label><Textarea id="edit-ap-reason" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="Why is this approval control changing?" disabled={!canManagePolicies} data-testid="approval-policy-change-reason" /></div>
            {stalePolicy ? (
              <Alert variant="destructive" data-testid="approval-policy-stale-guidance">
                <AlertTitle>This policy changed while you were editing</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>Reload the latest version before applying another change. Your unsaved values will be replaced.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void reloadEditedPolicy()}
                    data-testid="approval-policy-reload-latest"
                  >
                    Reload latest policy
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {conflictingPolicies.length > 0 ? <Alert className="border-amber-300 bg-amber-50"><AlertTitle>Conflicting active policies</AlertTitle><AlertDescription><ul className="mt-2 space-y-2">{conflictingPolicies.map((policy) => <li key={policy.id} className="flex items-center justify-between gap-3"><span>{policy.name} (L{policy.approvalLevel}, {policy.amountMin.toLocaleString()} to {policy.amountMax == null ? "no cap" : policy.amountMax.toLocaleString()})</span><Button type="button" size="sm" variant="outline" onClick={() => { setSearch(policy.name); setEditingId(null); }}>Find policy</Button></li>)}</ul><p className="mt-3">You can still deactivate this policy or correct its name/approver without changing the overlapping band.</p></AlertDescription></Alert> : null}
          </div>
          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
            <Button type="button" onClick={() => saveMutation.mutate()} disabled={!canManagePolicies || !workflowCatalogQuery.isSuccess || saveMutation.isPending || stalePolicy} data-testid="approval-policy-edit-save">{saveMutation.isPending ? "Saving..." : "Save policy"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Card>
        <CardHeader>
          <CardTitle>New policy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {!canManagePolicies ? (
            <Alert variant="destructive" className="md:col-span-2 lg:col-span-3" data-testid="approval-policies-denied">
              <AlertTitle>Read-only approval controls</AlertTitle>
              <AlertDescription>
                You can review policies, but only admins and managers can change approval routing.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2 md:col-span-2 lg:col-span-3">
            <Label htmlFor="ap-name">Name</Label>
            <Input
              id="ap-name"
              data-testid="approval-policy-name"
              value={form.name}
              disabled={!canManagePolicies}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Requisitions $10k+ — manager"
            />
          </div>
          <div className="min-w-0 space-y-2">
            <Label>Governed workflow</Label>
            <Select
              value={form.entityType}
              disabled={!canManagePolicies || !workflowCatalogQuery.isSuccess}
              onValueChange={(v) => setForm((f) => ({ ...f, entityType: v }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select governed workflow" />
              </SelectTrigger>
              <SelectContent>
                {entityTypes.map((t) => (
                  <SelectItem key={t.entityType} value={t.entityType}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ap-min">Amount min</Label>
            <Input
              id="ap-min"
              type="number"
              data-testid="approval-policy-min"
              min={0}
              step="0.01"
              value={form.amountMin}
              disabled={!canManagePolicies}
              onChange={(e) => setForm((f) => ({ ...f, amountMin: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ap-max">Amount max (empty = no cap)</Label>
            <Input
              id="ap-max"
              type="number"
              data-testid="approval-policy-max"
              min={0}
              step="0.01"
              value={form.amountMax}
              disabled={!canManagePolicies}
              onChange={(e) => setForm((f) => ({ ...f, amountMax: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ap-level">Approval level</Label>
            <Input
              id="ap-level"
              type="number"
              min={1}
              data-testid="approval-policy-level"
              value={form.approvalLevel}
              disabled={!canManagePolicies}
              onChange={(e) => setForm((f) => ({ ...f, approvalLevel: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Required role (optional)</Label>
            <Select
              value={form.approverRole}
              disabled={!canManagePolicies}
              onValueChange={(v) => setForm((f) => ({ ...f, approverRole: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any role</SelectItem>
                {approverRoles.map((role) => {
                  const value = role.ref.kind === "custom" ? `custom:${role.ref.id}` : role.ref.key;
                  return <SelectItem key={value} value={value}>
                    {role.name}{role.ref.kind === "custom" ? " (custom)" : ""}
                  </SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Specific approver (optional)</Label>
            <Select
              value={form.approverUserId}
              disabled={!canManagePolicies}
              onValueChange={(v) => setForm((f) => ({ ...f, approverUserId: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.fullName || u.username} (#{u.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch
              id="ap-active"
              checked={form.isActive}
              disabled={!canManagePolicies}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="ap-active">Active</Label>
          </div>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-3">
            <Button
              data-testid="approval-policy-save"
              onClick={() => saveMutation.mutate()}
              disabled={!canManagePolicies || !workflowCatalogQuery.isSuccess || !entityTypes.some((type) => type.entityType === form.entityType) || saveMutation.isPending}
            >
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visible policy chain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Policies on the current filtered page, grouped by entity and approval level. Only overlapping active bands
            at the same level are conflicts; intentional multi-level approval chains remain valid.
          </p>
          {entityTypes.map((t) => {
            const chain = policiesByEntityChain.get(t.entityType) ?? [];
            return (
              <div key={t.entityType} className="rounded-md border p-3">
                <div className="mb-2 font-medium">{t.label}</div>
                {chain.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active policies.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {chain.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">L{p.approvalLevel}</span>
                        <span>{p.name}</span>
                        <span className="text-muted-foreground">
                          {Number(p.amountMin ?? 0).toLocaleString()} —{" "}
                          {p.amountMax == null ? "∞" : Number(p.amountMax).toLocaleString()}
                        </span>
                        {overlappingPolicyIds.has(p.id) ? (
                          <Badge variant="destructive" className="text-xs">
                            Overlap risk
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview routing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Dry-run: see which active policies apply and suggested approvers for a chosen amount (no data is written).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Governed workflow</Label>
              <Select
                value={previewEntity}
                onValueChange={(value) => setPreviewEntity(value as GovernedApprovalEntityType)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select governed workflow" />
                </SelectTrigger>
                <SelectContent>
                  {entityTypes.map((t) => (
                    <SelectItem key={t.entityType} value={t.entityType}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="preview-amt">Amount</Label>
              <Input
                id="preview-amt"
                type="number"
                min={0}
                step="0.01"
                className="w-40"
                value={previewAmount}
                onChange={(e) => setPreviewAmount(e.target.value)}
              />
            </div>
            <Button type="button" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
              {previewMutation.isPending ? "Running…" : "Run preview"}
            </Button>
          </div>
          {previewMutation.data ? (
            <div className="space-y-3 rounded-md border p-3 text-sm">
              <div>
                <div className="font-medium">Applicable policies</div>
                {previewMutation.data.applicablePolicies.length === 0 ? (
                  <p className="text-muted-foreground">None for this amount.</p>
                ) : (
                  <ul className="mt-1 list-disc pl-4">
                    {previewMutation.data.applicablePolicies.map((ap) => (
                      <li key={ap.id}>
                        {ap.name} (level {ap.approvalLevel},{" "}
                        {Number(ap.amountMin).toLocaleString()} —{" "}
                        {ap.amountMax == null ? "∞" : Number(ap.amountMax).toLocaleString()})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="font-medium">Suggested approvers</div>
                {previewMutation.data.suggestedApprovers.length === 0 ? (
                  <p className="text-muted-foreground">No users matched policy role/user rules.</p>
                ) : (
                  <ul className="mt-1 list-disc pl-4">
                    {previewMutation.data.suggestedApprovers.map((s) => (
                      <li key={s.userId}>
                        {s.fullName || s.username} (#{s.userId}) — {s.matchedPolicyName}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Configured policies</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{totalPolicies.toLocaleString()} matching policies</p>
            </div>
            <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(16rem,1fr)_12rem_10rem_auto]">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search policy name or entity"
                aria-label="Search approval policies"
              />
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger aria-label="Filter by entity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All entities</SelectItem>
                  {entityTypes.map((type) => (
                    <SelectItem key={type.entityType} value={type.entityType}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant={overlapOnly ? "default" : "outline"} onClick={() => setOverlapOnly((value) => !value)} data-testid="approval-policy-overlap-filter">
                Overlaps only
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {overlappingPolicyIds.size > 0 ? (
            <Alert variant="default" className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" data-testid="approval-policy-overlap-warning">
              <AlertTitle>Overlapping amount bands</AlertTitle>
              <AlertDescription>
                Multiple active policies share overlapping amount ranges on the same entity type (see highlighted rows).
                Review levels and min/max so approval routing stays clear.
              </AlertDescription>
            </Alert>
          ) : null}
          {isLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="approval-policies-loading">Loading…</p>
          ) : isPolicyListError ? (
            <Alert variant="destructive" data-testid="approval-policies-error">
              <AlertTitle>Approval policies could not be loaded</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{policyListError instanceof Error ? policyListError.message : "Retry the request or review System Diagnostics."}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void refetchPolicies()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : sortedPolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="approval-policies-empty">No policies yet. Add one to gate approvals by amount.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Amount range</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Role / user</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPolicies.map((p) => (
                  <TableRow
                    key={p.id}
                    className={overlappingPolicyIds.has(p.id) ? "bg-amber-50/80 dark:bg-amber-950/20" : undefined}
                    data-testid={`approval-policy-row-${p.id}`}
                  >
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-xs">{p.entityType}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {Number(p.amountMin ?? 0).toLocaleString()}
                      {" — "}
                      {p.amountMax == null ? "∞" : Number(p.amountMax).toLocaleString()}
                    </TableCell>
                    <TableCell>{p.approvalLevel}</TableCell>
                    <TableCell className="text-xs">
                      {p.approverRole ?? "—"}
                      {p.approverUserId != null ? ` / user #${p.approverUserId}` : ""}
                    </TableCell>
                    <TableCell>{p.isActive ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(p)} disabled={!canManagePolicies} data-testid={`approval-policy-edit-${p.id}`}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteMutation.mutate(p.id)}
                        disabled={!canManagePolicies || deleteMutation.isPending}
                        data-testid={`approval-policy-delete-${p.id}`}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} data-testid="approval-policy-previous-page">
                  Previous
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={!policyPage?.hasNext} onClick={() => setPage((value) => value + 1)} data-testid="approval-policy-next-page">
                  Next
                </Button>
              </div>
            </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

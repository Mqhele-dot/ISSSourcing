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
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { formatMutationError, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import type { ApprovalPolicy } from "@shared/schema";

const ENTITY_TYPES = [
  { value: "requisition", label: "Purchase requisition" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "invoice", label: "Invoice approval" },
  { value: "payment_batch", label: "Payment batch approval" },
] as const;

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

const APPROVER_ROLES = [
  "admin",
  "manager",
  "warehouse_staff",
  "sales",
  "auditor",
  "supplier",
  "custom",
  "viewer",
] as const;

type UserOpt = { id: number; username: string; fullName?: string | null };

const emptyForm = {
  name: "",
  entityType: "requisition" as (typeof ENTITY_TYPES)[number]["value"],
  amountMin: "0",
  amountMax: "",
  approvalLevel: "1",
  approverRole: "none",
  approverUserId: "none",
  isActive: true,
};

export default function ApprovalPoliciesPage() {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [previewEntity, setPreviewEntity] = useState<(typeof ENTITY_TYPES)[number]["value"]>("requisition");
  const [previewAmount, setPreviewAmount] = useState("5000");

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["/api/approval-policies"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/approval-policies");
      return normalizeApiList<ApprovalPolicy>(raw);
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const raw = await requestJson<unknown>("GET", "/api/users");
      return normalizeApiList<UserOpt>(raw);
    },
  });

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
    for (const t of ENTITY_TYPES) {
      map.set(t.value, []);
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
  }, [policies]);

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
        name: form.name.trim() || "Unnamed policy",
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
        return requestJson<ApprovalPolicy>("PATCH", `/api/approval-policies/${editingId}`, body);
      }
      return requestJson<ApprovalPolicy>("POST", "/api/approval-policies", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approval-suggestions"], exact: false });
      toast({ title: editingId != null ? "Policy updated" : "Policy created" });
      setForm(emptyForm);
      setEditingId(null);
    },
    onError: (e) => {
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
    setForm({
      name: p.name ?? "",
      entityType: (p.entityType as (typeof ENTITY_TYPES)[number]["value"]) ?? "requisition",
      amountMin: String(p.amountMin ?? 0),
      amountMax: p.amountMax == null ? "" : String(p.amountMax),
      approvalLevel: String(p.approvalLevel ?? 1),
      approverRole: p.approverRole ? String(p.approverRole) : "none",
      approverUserId: p.approverUserId != null ? String(p.approverUserId) : "none",
      isActive: Boolean(p.isActive ?? true),
    });
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
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-6">
      <PageHeader
        title="Approval policies"
        subtitle="Configure amount bands, approval levels, and required roles or users. Requisition approve/reject routes enforce active policies."
        breadcrumb={
          <Link href={APP_ROUTES.procurement.requisitions} className="text-sm text-muted-foreground hover:text-foreground">
            ← Requisitions
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{editingId != null ? `Edit policy #${editingId}` : "New policy"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2 md:col-span-2 lg:col-span-3">
            <Label htmlFor="ap-name">Name</Label>
            <Input
              id="ap-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Requisitions $10k+ — manager"
            />
          </div>
          <div className="space-y-2">
            <Label>Entity</Label>
            <Select
              value={form.entityType}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, entityType: v as (typeof ENTITY_TYPES)[number]["value"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
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
              min={0}
              step="0.01"
              value={form.amountMin}
              onChange={(e) => setForm((f) => ({ ...f, amountMin: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ap-max">Amount max (empty = no cap)</Label>
            <Input
              id="ap-max"
              type="number"
              min={0}
              step="0.01"
              value={form.amountMax}
              onChange={(e) => setForm((f) => ({ ...f, amountMax: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ap-level">Approval level</Label>
            <Input
              id="ap-level"
              type="number"
              min={1}
              value={form.approvalLevel}
              onChange={(e) => setForm((f) => ({ ...f, approvalLevel: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Required role (optional)</Label>
            <Select
              value={form.approverRole}
              onValueChange={(v) => setForm((f) => ({ ...f, approverRole: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Any role</SelectItem>
                {APPROVER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Specific approver (optional)</Label>
            <Select
              value={form.approverUserId}
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
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="ap-active">Active</Label>
          </div>
          <div className="flex flex-wrap items-end gap-2 md:col-span-2 lg:col-span-3">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {editingId != null ? "Update" : "Create"}
            </Button>
            {editingId != null ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                }}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Policy chain (active only)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Policies grouped by entity, sorted by approval level (ascending). Rows flagged when two active policies on
            the same entity have overlapping amount bands.
          </p>
          {ENTITY_TYPES.map((t) => {
            const chain = policiesByEntityChain.get(t.value) ?? [];
            return (
              <div key={t.value} className="rounded-md border p-3">
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
            Dry-run: see which active policies apply and suggested approvers for a sample amount (no data is written).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Entity</Label>
              <Select
                value={previewEntity}
                onValueChange={(v) => setPreviewEntity(v as (typeof ENTITY_TYPES)[number]["value"])}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
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
          <CardTitle>Configured policies</CardTitle>
        </CardHeader>
        <CardContent>
          {overlappingPolicyIds.size > 0 ? (
            <Alert variant="default" className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
              <AlertTitle>Overlapping amount bands</AlertTitle>
              <AlertDescription>
                Multiple active policies share overlapping amount ranges on the same entity type (see highlighted rows).
                Review levels and min/max so approval routing stays clear.
              </AlertDescription>
            </Alert>
          ) : null}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sortedPolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies yet. Add one to gate approvals by amount.</p>
          ) : (
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
                      <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteMutation.mutate(p.id)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import { formatMutationError, normalizeApiList, queryClient, requestJson } from "@/lib/queryClient";
import type { ApprovalPolicy } from "@shared/schema";

const ENTITY_TYPES = [
  { value: "requisition", label: "Purchase requisition" },
  { value: "purchase_order", label: "Purchase order" },
] as const;

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Approval policies"
        subtitle="Configure amount bands, approval levels, and required roles or users. Requisition approve/reject routes enforce active policies."
        breadcrumb={
          <Link href="/purchase/requisitions" className="text-sm text-muted-foreground hover:text-foreground">
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
          <CardTitle>Configured policies</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <TableRow key={p.id}>
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

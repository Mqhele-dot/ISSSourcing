import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { FileClock, Search, ShieldCheck, UserCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { requestJson, apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { EffectiveAccessResponse, NavigationCatalogResponse, RoleCatalogResponse } from "@shared/rbac-contracts";
import type { ApprovalWorkflowCatalogResponse } from "@shared/authority-catalogs";

type Employee = {
  id: number;
  username: string;
  fullName: string | null;
  email: string;
  role: string | null;
  warehouseId?: number | null;
  supplierId?: number | null;
  approverAmountLimit?: number | null;
  phone?: string | null;
  workPersona?: string | null;
  active?: boolean | null;
  lastLogin?: string | null;
  preferences?: { customRoleId?: number | null; allowedNavPaths?: string[] } | null;
};

type WarehouseOption = {
  id: number;
  name: string;
};

type SupplierOption = {
  id: number;
  name: string;
};

type ApprovalLimit = { entityType: string; amountLimit: number | null; currencyCode: string; updatedAt?: string | null };
type ApprovalLimitsResponse = { userId: number; limits: ApprovalLimit[] };
type GovernanceEvent = {
  id: number; createdAt: string; eventKind: "change" | "approval"; action: string;
  entityType: string; entityId: number | null; actorName: string; reason: string | null;
  approvalLevel: number | null; before: unknown; after: unknown; requestId: string | null; integrityHash: string | null;
};
type GovernancePage = { items: GovernanceEvent[]; total: number; page: number; pageSize: number; hasNext: boolean };

/** Supply-chain persona labels (informational; DB role remains the permission source). */
const WORK_PERSONA_OPTIONS = [
  { value: "none", label: "Not set" },
  { value: "Requester", label: "Requester" },
  { value: "Buyer", label: "Buyer" },
  { value: "Approver", label: "Approver" },
  { value: "Inventory", label: "Inventory" },
  { value: "Logistics", label: "Logistics" },
  { value: "Finance", label: "Finance" },
];

export default function EmployeeProfilesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  useEffect(() => {
    if (!isLgUp) setLocation("/m/home");
  }, [isLgUp, setLocation]);
  const [search, setSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Employee>>({});
  const [profileChangeReason, setProfileChangeReason] = useState("");
  const [approvalLimitDraft, setApprovalLimitDraft] = useState<Record<string, string>>({});
  const [approvalLimitReason, setApprovalLimitReason] = useState("");

  const effectiveRole = String(user?.role ?? "").toLowerCase();
  const canManageEmployees = effectiveRole === "admin" || effectiveRole === "manager";
  const canEditEmployees = effectiveRole === "admin";

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["/api/users", "employee-profiles"],
    enabled: canManageEmployees,
    queryFn: () => requestJson<Employee[]>("GET", "/api/users"),
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ["/api/warehouses", "employee-profiles"],
    enabled: canManageEmployees,
    queryFn: () => requestJson<WarehouseOption[]>("GET", "/api/warehouses"),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["/api/suppliers", "employee-profiles"],
    enabled: canManageEmployees,
    queryFn: () => requestJson<SupplierOption[]>("GET", "/api/suppliers"),
  });

  const { data: roleCatalog } = useQuery<RoleCatalogResponse>({
    queryKey: ["/api/rbac/roles/catalog"],
    enabled: canManageEmployees,
    queryFn: () => requestJson<RoleCatalogResponse>("GET", "/api/rbac/roles/catalog"),
  });

  const navigationCatalogQuery = useQuery<NavigationCatalogResponse>({
    queryKey: ["/api/rbac/navigation-catalog"],
    enabled: canManageEmployees,
    queryFn: () => requestJson<NavigationCatalogResponse>("GET", "/api/rbac/navigation-catalog"),
  });
  const approvalWorkflowCatalogQuery = useQuery<ApprovalWorkflowCatalogResponse>({
    queryKey: ["/api/approval-workflows/catalog"],
    enabled: canManageEmployees,
    queryFn: () => requestJson<ApprovalWorkflowCatalogResponse>("GET", "/api/approval-workflows/catalog"),
  });
  const profileTabOptions = useMemo(
    () => (navigationCatalogQuery.data?.groups ?? []).flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))),
    [navigationCatalogQuery.data?.groups],
  );
  const approvalWorkflows = approvalWorkflowCatalogQuery.data?.items ?? [];

  const { data: effectiveAccess } = useQuery<EffectiveAccessResponse>({
    queryKey: ["/api/rbac/users", selectedEmployeeId, "effective-access"],
    enabled: canManageEmployees && selectedEmployeeId !== null,
    queryFn: () => requestJson<EffectiveAccessResponse>("GET", `/api/rbac/users/${selectedEmployeeId}/effective-access`),
  });

  const { data: approvalLimits, isError: approvalLimitsError, refetch: refetchApprovalLimits } = useQuery<ApprovalLimitsResponse>({
    queryKey: ["/api/rbac/users", selectedEmployeeId, "approval-limits"],
    enabled: canManageEmployees && selectedEmployeeId !== null,
    queryFn: () => requestJson<ApprovalLimitsResponse>("GET", `/api/rbac/users/${selectedEmployeeId}/approval-limits`),
  });

  const { data: governanceEvents, isLoading: governanceLoading, isError: governanceError, refetch: refetchGovernance } = useQuery<GovernancePage>({
    queryKey: ["/api/rbac/users", selectedEmployeeId, "governance-events"],
    enabled: canManageEmployees && selectedEmployeeId !== null,
    queryFn: () => requestJson<GovernancePage>("GET", `/api/rbac/users/${selectedEmployeeId}/governance-events?page=1&pageSize=10`),
  });

  useEffect(() => {
    if (!approvalLimits) return;
    setApprovalLimitDraft(Object.fromEntries(approvalLimits.limits.map((entry) => [
      entry.entityType,
      entry.amountLimit == null ? "" : String(entry.amountLimit),
    ])));
    setApprovalLimitReason("");
  }, [approvalLimits]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) =>
      [employee.username, employee.fullName ?? "", employee.email, employee.role ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [employees, search]);

  const employeePageSize = 25;
  const employeePageCount = Math.max(1, Math.ceil(filteredEmployees.length / employeePageSize));
  const visibleEmployees = filteredEmployees.slice(
    (employeePage - 1) * employeePageSize,
    employeePage * employeePageSize,
  );

  useEffect(() => {
    setEmployeePage(1);
  }, [search]);

  const selectedEmployee = useMemo(() => {
    return employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  }, [employees, selectedEmployeeId]);

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: number; data: Partial<Employee> & { reason?: string } }) => {
      const response = await apiRequest("PUT", `/api/users/${payload.id}`, payload.data);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/users", "employee-profiles"] });
      toast({
        title: "Employee profile updated",
        description: "Changes were saved successfully.",
      });
      setProfileChangeReason("");
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Could not update employee profile.",
        variant: "destructive",
      });
    },
  });

  const approvalLimitsMutation = useMutation({
    mutationFn: async () => requestJson<ApprovalLimitsResponse>("PUT", `/api/rbac/users/${selectedEmployeeId}/approval-limits`, {
      limits: approvalWorkflows.map((workflow) => ({
        entityType: workflow.entityType,
        amountLimit: approvalLimitDraft[workflow.entityType]?.trim() === "" ? null : Number(approvalLimitDraft[workflow.entityType]),
        currencyCode: approvalLimits?.limits.find((entry) => entry.entityType === workflow.entityType)?.currencyCode ?? "ZAR",
      })),
      reason: approvalLimitReason,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/rbac/users", selectedEmployeeId, "approval-limits"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/rbac/users", selectedEmployeeId, "governance-events"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/users", "employee-profiles"] }),
      ]);
      toast({ title: "Approval authority updated", description: "Limits and the stated reason were written to the immutable audit trail." });
    },
    onError: (error) => toast({ title: "Approval limits not saved", description: error instanceof Error ? error.message : "The authority update failed.", variant: "destructive" }),
  });

  if (!canManageEmployees) {
    return (
      <div className="mx-auto max-w-4xl py-6">
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            Employee profile management is available to Manager and Admin roles only.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!isLgUp) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center text-sm text-muted-foreground">
        Employee profiles are available on large screens (1024px and wider). Use a desktop browser or resize the
        window. Sending you to the mobile hub…
      </div>
    );
  }

  const roleSelection = draft.role === "custom" && Number(draft.preferences?.customRoleId) > 0
    ? `custom:${Number(draft.preferences?.customRoleId)}`
    : `system:${String(draft.role ?? selectedEmployee?.role ?? "viewer")}`;
  const selectedRoleCatalogEntry = roleCatalog?.roles.find((entry) =>
    entry.ref.kind === "custom"
      ? roleSelection === `custom:${entry.ref.id}`
      : roleSelection === `system:${entry.ref.key}`,
  );
  const permissionPreview = selectedRoleCatalogEntry?.permissions ?? effectiveAccess?.permissions ?? [];
  const permissionGroups = Array.from(
    permissionPreview.reduce((groups, permission) => {
      const resource = permission.resource.replaceAll("_", " ");
      const values = groups.get(resource) ?? [];
      values.push(permission.permissionType);
      groups.set(resource, values);
      return groups;
    }, new Map<string, string[]>()),
  );
  const highRiskPermissions = permissionPreview.filter((permission) =>
    ["approve", "delete", "execute", "admin", "configure", "restrict"].includes(permission.permissionType),
  );
  const selectedWarehouseName =
    warehouses.find((warehouse) => warehouse.id === Number(draft.warehouseId ?? selectedEmployee?.warehouseId ?? 0))?.name ?? "Unassigned";
  const selectedNavigationPaths = draft.preferences?.allowedNavPaths ?? selectedEmployee?.preferences?.allowedNavPaths ?? profileTabOptions.map((item) => item.path);
  const legacyNavigationPaths = selectedNavigationPaths.filter((path) => !profileTabOptions.some((item) => item.path === path));

  return (
    <div className="mx-auto max-w-7xl space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Employee Profiles</h1>
        <p className="text-muted-foreground">
          {canEditEmployees
            ? "Manage role assignments, profile details, permissions, and user activity."
            : "View employee profiles, permissions, and recent activity. Access changes require an administrator."}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">Employees</CardTitle>
            <CardDescription>Search and select a profile</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-8"
                placeholder="Search name, email, role"
              />
            </div>
            <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading employee profiles...</p>
              ) : filteredEmployees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching employees.</p>
              ) : (
                visibleEmployees.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left transition hover:border-primary ${
                      selectedEmployeeId === employee.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => {
                      setSelectedEmployeeId(employee.id);
                      setProfileChangeReason("");
                      setDraft({
                        fullName: employee.fullName ?? "",
                        email: employee.email,
                        role: employee.role ?? "viewer",
                        warehouseId: employee.warehouseId ?? null,
                        supplierId: employee.supplierId ?? null,
                        approverAmountLimit: employee.approverAmountLimit ?? null,
                        phone: employee.phone ?? "",
                        workPersona: employee.workPersona ?? "",
                        active: employee.active ?? true,
                        preferences: employee.preferences ?? null,
                      });
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{employee.fullName || employee.username}</p>
                      <Badge variant="outline">{employee.role || "viewer"}</Badge>
                    </div>
                    <p className="break-all text-xs text-muted-foreground">{employee.email}</p>
                  </button>
                ))
              )}
            </div>
            {filteredEmployees.length > employeePageSize ? (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {(employeePage - 1) * employeePageSize + 1}–{Math.min(employeePage * employeePageSize, filteredEmployees.length)} of {filteredEmployees.length}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={employeePage <= 1} onClick={() => setEmployeePage((value) => value - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={employeePage >= employeePageCount} onClick={() => setEmployeePage((value) => value + 1)}>Next</Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {selectedEmployee ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserCircle2 className="h-5 w-5" />
                    Profile Details
                  </CardTitle>
                  <CardDescription>
                    Employee ID #{selectedEmployee.id} · username: {selectedEmployee.username}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="employee-full-name">Full name</Label>
                    <Input
                      id="employee-full-name"
                      disabled={!canEditEmployees}
                      value={String(draft.fullName ?? "")}
                      onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-email">Email</Label>
                    <Input
                      id="employee-email"
                      type="email"
                      disabled={!canEditEmployees}
                      value={String(draft.email ?? "")}
                      onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-phone">Phone (SMS / alerts)</Label>
                    <Input
                      id="employee-phone"
                      type="tel"
                      disabled={!canEditEmployees}
                      placeholder="E.164 or local"
                      value={String(draft.phone ?? "")}
                      onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-persona">Work persona</Label>
                    <p className="text-xs text-muted-foreground">
                      Optional label for org charts and training; permissions still follow <strong>Role</strong> above.
                    </p>
                    <Select
                      disabled={!canEditEmployees}
                      value={draft.workPersona?.trim() ? String(draft.workPersona) : "none"}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          workPersona: value === "none" ? null : value,
                        }))
                      }
                    >
                      <SelectTrigger id="employee-persona">
                        <SelectValue placeholder="Select persona" />
                      </SelectTrigger>
                      <SelectContent>
                        {WORK_PERSONA_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-role">Role</Label>
                    <Select
                      disabled={!canEditEmployees}
                      value={roleSelection}
                      onValueChange={(value) => setDraft((current) => {
                        if (value.startsWith("custom:")) {
                          return {
                            ...current,
                            role: "custom",
                            preferences: {
                              ...(current.preferences ?? selectedEmployee.preferences ?? {}),
                              customRoleId: Number(value.slice("custom:".length)),
                            },
                          };
                        }
                        return {
                          ...current,
                          role: value.slice("system:".length),
                          preferences: {
                            ...(current.preferences ?? selectedEmployee.preferences ?? {}),
                            customRoleId: null,
                          },
                        };
                      })}
                    >
                      <SelectTrigger id="employee-role">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {(roleCatalog?.roles ?? []).filter((role) => role.active).map((role) => {
                          const value = role.ref.kind === "custom" ? `custom:${role.ref.id}` : `system:${role.ref.key}`;
                          return <SelectItem key={value} value={value}>
                            {role.name}{role.ref.kind === "custom" ? " (custom)" : ""}
                          </SelectItem>
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-warehouse">Warehouse</Label>
                    <Select
                      disabled={!canEditEmployees}
                      value={String(draft.warehouseId ?? "none")}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, warehouseId: value === "none" ? null : Number(value) }))
                      }
                    >
                      <SelectTrigger id="employee-warehouse">
                        <SelectValue placeholder="Select warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {warehouses.map((warehouse) => (
                          <SelectItem key={warehouse.id} value={String(warehouse.id)}>
                            {warehouse.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-supplier">Supplier portal link</Label>
                    <p className="text-xs text-muted-foreground">
                      For users with role <strong>supplier</strong>, selects which supplier account the portal APIs use.
                    </p>
                    <Select
                      disabled={!canEditEmployees}
                      value={String(draft.supplierId ?? "none")}
                      onValueChange={(value) =>
                        setDraft((current) => ({ ...current, supplierId: value === "none" ? null : Number(value) }))
                      }
                    >
                      <SelectTrigger id="employee-supplier">
                        <SelectValue placeholder="No supplier mapping" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={String(supplier.id)}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Active account</p>
                      <p className="text-xs text-muted-foreground">
                        Disable to prevent this employee from signing in.
                      </p>
                    </div>
                    <Button
                      disabled={!canEditEmployees}
                      variant={draft.active === false ? "outline" : "default"}
                      onClick={() => setDraft((current) => ({ ...current, active: !(current.active ?? true) }))}
                    >
                      {draft.active === false ? "Set Active" : "Set Inactive"}
                    </Button>
                  </div>
                  <div className="md:col-span-2 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="employee-change-reason">Reason for profile change</Label>
                      <Input
                        id="employee-change-reason"
                        disabled={!canEditEmployees}
                        value={profileChangeReason}
                        onChange={(event) => setProfileChangeReason(event.target.value)}
                        placeholder="Required: explain why this employee profile is changing"
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        disabled={!canEditEmployees}
                        onClick={() => {
                          setProfileChangeReason("");
                          setDraft({
                          fullName: selectedEmployee.fullName ?? "",
                          email: selectedEmployee.email,
                          role: selectedEmployee.role ?? "viewer",
                          warehouseId: selectedEmployee.warehouseId ?? null,
                          supplierId: selectedEmployee.supplierId ?? null,
                          approverAmountLimit: selectedEmployee.approverAmountLimit ?? null,
                          phone: selectedEmployee.phone ?? "",
                          workPersona: selectedEmployee.workPersona ?? "",
                          active: selectedEmployee.active ?? true,
                          preferences: selectedEmployee.preferences ?? null,
                          });
                        }}
                      >
                        Reset
                      </Button>
                      <Button
                        disabled={!canEditEmployees || !navigationCatalogQuery.isSuccess || legacyNavigationPaths.length > 0 || profileChangeReason.trim().length < 5 || updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                          id: selectedEmployee.id,
                          data: {
                            fullName: draft.fullName ?? selectedEmployee.fullName,
                            email: draft.email ?? selectedEmployee.email,
                            role: draft.role ?? selectedEmployee.role,
                            warehouseId: draft.warehouseId ?? selectedEmployee.warehouseId ?? null,
                            supplierId: draft.supplierId ?? selectedEmployee.supplierId ?? null,
                            approverAmountLimit:
                              draft.approverAmountLimit ?? selectedEmployee.approverAmountLimit ?? null,
                            phone:
                              String(draft.phone ?? "").trim() === ""
                                ? null
                                : String(draft.phone ?? "").trim(),
                            workPersona:
                              String(draft.workPersona ?? "").trim() === ""
                                ? null
                                : String(draft.workPersona ?? "").trim(),
                            active: draft.active ?? selectedEmployee.active ?? true,
                            preferences: draft.preferences ?? selectedEmployee.preferences ?? null,
                            reason: profileChangeReason.trim(),
                          },
                          })
                        }
                      >
                        Save Profile
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <details>
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4" />
                    Approval authority
                  </CardTitle>
                  <CardDescription>
                    Set this employee's maximum approval amount for each governed workflow. Blank means the policy has no additional employee-specific monetary cap.
                    <span className="mt-1 block font-medium text-foreground">Select to review or edit all workflow limits.</span>
                  </CardDescription>
                </CardHeader>
                </summary>
                <CardContent className="space-y-4">
                  {approvalLimitsError ? (
                    <Alert variant="destructive">
                      <AlertTitle>Approval limits unavailable</AlertTitle>
                      <AlertDescription className="flex items-center justify-between gap-3">
                        The employee's authority could not be loaded.
                        <Button size="sm" variant="outline" onClick={() => refetchApprovalLimits()}>Retry</Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {approvalWorkflowCatalogQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading governed workflows…</p> : null}
                      {approvalWorkflowCatalogQuery.isError ? (
                        <Alert variant="destructive" className="sm:col-span-2 lg:col-span-3">
                          <AlertTitle>Workflow catalog unavailable</AlertTitle>
                          <AlertDescription className="flex items-center justify-between gap-3">Approval limits cannot be edited safely. <Button size="sm" variant="outline" onClick={() => void approvalWorkflowCatalogQuery.refetch()}>Retry</Button></AlertDescription>
                        </Alert>
                      ) : null}
                      {approvalWorkflows.map(({ entityType, label, amountBased }) => {
                        const currency = approvalLimits?.limits.find((entry) => entry.entityType === entityType)?.currencyCode ?? "ZAR";
                        return (
                          <div key={entityType} className="space-y-1 rounded-md border p-3">
                            <Label htmlFor={`approval-limit-${entityType}`}>{label}</Label>
                            {!amountBased ? <p className="text-xs text-muted-foreground">This workflow records authority without an amount threshold.</p> : null}
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">{currency}</span>
                              <Input
                                id={`approval-limit-${entityType}`}
                                type="number"
                                min={0}
                                step="0.01"
                                disabled={!canEditEmployees || !approvalLimits}
                                placeholder="Unlimited"
                                value={approvalLimitDraft[entityType] ?? ""}
                                onChange={(event) => setApprovalLimitDraft((current) => ({ ...current, [entityType]: event.target.value }))}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="approval-limit-reason">Reason for authority change</Label>
                    <Input
                      id="approval-limit-reason"
                      disabled={!canEditEmployees}
                      value={approvalLimitReason}
                      onChange={(event) => setApprovalLimitReason(event.target.value)}
                      placeholder="Required: explain why these limits are appropriate"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      disabled={!canEditEmployees || !approvalLimits || !approvalWorkflowCatalogQuery.isSuccess || approvalLimitReason.trim().length < 5 || approvalLimitsMutation.isPending}
                      onClick={() => approvalLimitsMutation.mutate()}
                    >
                      {approvalLimitsMutation.isPending ? "Saving authority…" : "Save approval limits"}
                    </Button>
                  </div>
                </CardContent>
                </details>
              </Card>

              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShieldCheck className="h-4 w-4" />
                      Permission Preview
                    </CardTitle>
                    <CardDescription>
                      Effective permissions based on role:{" "}
                      <span className="font-medium">{String(draft.role ?? selectedEmployee.role ?? "viewer")}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {permissionPreview.length === 0 ? (
                      <p className="text-muted-foreground">No effective permissions assigned.</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="min-w-0 rounded-md border p-3">
                            <p className="text-xs text-muted-foreground">Permissions</p>
                            <p className="mt-1 text-lg font-semibold">{permissionPreview.length}</p>
                          </div>
                          <div className="min-w-0 rounded-md border p-3">
                            <p className="text-xs text-muted-foreground">Resources</p>
                            <p className="mt-1 text-lg font-semibold">{permissionGroups.length}</p>
                          </div>
                          <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 rounded-md border p-3">
                            <p className="text-xs text-muted-foreground">High-risk grants</p>
                            <p className="shrink-0 text-lg font-semibold">{highRiskPermissions.length}</p>
                          </div>
                        </div>
                        <details className="rounded-md border">
                          <summary className="cursor-pointer px-3 py-2 font-medium">Review permission details</summary>
                          <div className="max-h-80 space-y-2 overflow-auto border-t p-3 overscroll-contain">
                            {permissionGroups.map(([resource, permissions]) => (
                              <div key={resource} className="min-w-0 space-y-1">
                                <span className="block break-words font-medium capitalize">{resource}</span>
                                <div className="flex min-w-0 flex-wrap gap-1">
                                  {permissions.map((permission) => <Badge key={permission} variant="outline">{permission}</Badge>)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      </>
                    )}
                    <p className="pt-2 text-xs text-muted-foreground">
                      Location scope: {selectedWarehouseName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Visible tabs: {effectiveAccess?.navigationPaths == null ? "role defaults" : effectiveAccess.navigationPaths.length}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Visible tabs</CardTitle>
                    <CardDescription>Choose the navigation areas shown to this profile. API permissions remain authoritative even when a tab is visible.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    {navigationCatalogQuery.isLoading ? <p className="text-sm text-muted-foreground sm:col-span-2">Loading navigation catalog…</p> : null}
                    {navigationCatalogQuery.isError ? (
                      <Alert variant="destructive" className="sm:col-span-2">
                        <AlertTitle>Navigation catalog unavailable</AlertTitle>
                        <AlertDescription className="flex items-center justify-between gap-3">Tab access cannot be edited safely. <Button size="sm" variant="outline" onClick={() => void navigationCatalogQuery.refetch()}>Retry</Button></AlertDescription>
                      </Alert>
                    ) : null}
                    {profileTabOptions.map((tab) => {
                      const selectedPaths = selectedNavigationPaths;
                      const checked = selectedPaths.includes(tab.path);
                      return <Label key={tab.path} className="flex min-h-14 min-w-0 items-center gap-2 rounded-md border p-3 font-normal leading-tight">
                        <Checkbox
                          className="shrink-0"
                          checked={checked}
                          disabled={!canEditEmployees}
                          onCheckedChange={(value) => {
                            const next = value === true
                              ? Array.from(new Set([...selectedPaths, tab.path]))
                              : selectedPaths.filter((path) => path !== tab.path);
                            setDraft((current) => ({ ...current, preferences: { ...(current.preferences ?? selectedEmployee.preferences ?? {}), allowedNavPaths: next } }));
                          }}
                        />
                        <span className="min-w-0 break-words">{tab.label}</span>
                      </Label>;
                    })}
                    {legacyNavigationPaths.map((path) => (
                      <Label key={path} className="flex min-h-14 min-w-0 items-center gap-2 rounded-md border border-amber-300 bg-amber-50/40 p-3 font-normal dark:bg-amber-950/10">
                        <Checkbox
                          checked
                          disabled={!canEditEmployees}
                          onCheckedChange={() => setDraft((current) => ({ ...current, preferences: { ...(current.preferences ?? selectedEmployee?.preferences ?? {}), allowedNavPaths: selectedNavigationPaths.filter((candidate) => candidate !== path) } }))}
                        />
                        <span className="min-w-0 break-all"><span className="block font-medium">Legacy or unavailable tab</span><span className="text-xs text-muted-foreground">{path} — clear before saving.</span></span>
                      </Label>
                    ))}
                  </CardContent>
                </Card>

                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileClock className="h-4 w-4" />
                      Governance and approval tracker
                    </CardTitle>
                    <CardDescription>
                      Immutable edits and approval decisions made by this employee, including why, what changed, workflow level, request evidence, and integrity proof. Showing the latest 10 of {governanceEvents?.total ?? 0}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {governanceLoading ? (
                      <p className="text-sm text-muted-foreground" role="status">Loading governance evidence…</p>
                    ) : governanceError ? (
                      <Alert variant="destructive">
                        <AlertTitle>Governance evidence unavailable</AlertTitle>
                        <AlertDescription className="flex items-center justify-between gap-3">
                          The employee audit trail could not be loaded.
                          <Button size="sm" variant="outline" onClick={() => refetchGovernance()}>Retry</Button>
                        </AlertDescription>
                      </Alert>
                    ) : !governanceEvents?.items.length ? (
                      <p className="text-sm text-muted-foreground">No governed edits or approval decisions have been recorded for this employee.</p>
                    ) : (
                      <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1 overscroll-contain">
                      {governanceEvents.items.map((event) => (
                        <div key={`${event.eventKind}-${event.id}`} className="space-y-2 rounded-md border p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{event.action.replaceAll("_", " ")}</p>
                              <p className="text-xs text-muted-foreground">
                                {event.entityType.replaceAll("_", " ")}{event.entityId ? ` #${event.entityId}` : ""}
                                {event.approvalLevel ? ` · approval level ${event.approvalLevel}` : ""}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant={event.eventKind === "approval" ? "default" : "outline"}>{event.eventKind}</Badge>
                              {event.integrityHash ? <Badge variant="outline">Hash chained</Badge> : null}
                            </div>
                          </div>
                          <p className="text-sm"><span className="font-medium">Why:</span> {event.reason || "Policy-controlled action; no additional comment was supplied."}</p>
                          {(event.before != null || event.after != null) ? (
                            <details className="text-xs text-muted-foreground">
                              <summary className="cursor-pointer font-medium text-foreground">View before and after evidence</summary>
                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                <pre className="max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">{JSON.stringify(event.before, null, 2)}</pre>
                                <pre className="max-h-48 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">{JSON.stringify(event.after, null, 2)}</pre>
                              </div>
                            </details>
                          ) : null}
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(event.createdAt).toLocaleString()}
                            {event.requestId ? ` · Request ${event.requestId}` : ""}
                          </p>
                        </div>
                      ))}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button variant="outline" onClick={() => setLocation(APP_ROUTES.admin.auditLogs)}>Open organization audit log</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-14 text-center text-muted-foreground">
                Select an employee to view profile details and permissions.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Search, ShieldCheck, UserCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { requestJson, apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useMediaQuery } from "@/hooks/use-media-query";

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
};

type WarehouseOption = {
  id: number;
  name: string;
};

type SupplierOption = {
  id: number;
  name: string;
};

type ActivityLogRow = {
  id: number;
  action: string;
  description: string | null;
  userId?: number | null;
  referenceType?: string | null;
  referenceId?: number | null;
  timestamp?: string;
  createdAt?: string;
};

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  admin: [
    "Create/Approve purchase documents",
    "Manage users, settings, and security",
    "Manage inventory, warehouses, suppliers",
    "View and export finance/compliance data",
  ],
  manager: [
    "Approve/reject requisitions and POs",
    "Manage suppliers and purchase orders",
    "View inventory and logistics operations",
    "View reports and analytics",
  ],
  warehouse_manager: [
    "Manage warehouse stock and cycle counts",
    "Process receipts and stock movements",
    "View logistics shipment states",
  ],
  procurement_officer: [
    "Create requisitions and purchase orders",
    "Manage supplier records and contracts",
    "Track PO and invoice workflows",
  ],
  inventory_clerk: [
    "Create/update inventory records",
    "Post stock movements and adjustments",
    "View inventory reports",
  ],
  supplier: [
    "View assigned supplier orders",
    "Confirm POs and update delivery ETA",
    "Submit supplier invoices",
  ],
  viewer: [
    "Read-only access to operational modules",
    "View dashboards and reports",
  ],
};

const ROLE_OPTIONS = [
  "admin",
  "manager",
  "warehouse_manager",
  "procurement_officer",
  "inventory_clerk",
  "supplier",
  "viewer",
];

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
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Employee>>({});

  const canManageEmployees = String(user?.role ?? "").toLowerCase() === "admin" || String(user?.role ?? "").toLowerCase() === "manager";

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

  const { data: activityLogs = [] } = useQuery({
    queryKey: ["/api/activity-logs", "employee-profiles"],
    enabled: canManageEmployees,
    queryFn: () => requestJson<ActivityLogRow[]>("GET", "/api/activity-logs?limit=300"),
  });

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

  const selectedEmployee = useMemo(() => {
    return filteredEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  }, [filteredEmployees, selectedEmployeeId]);

  const selectedRecentActivity = useMemo(() => {
    if (!selectedEmployee) return [];
    return activityLogs
      .filter((row) => {
        if (Number(row.userId ?? 0) === selectedEmployee.id) return true;
        if (String(row.referenceType ?? "").toLowerCase() === "user" && Number(row.referenceId ?? 0) === selectedEmployee.id) return true;
        return false;
      })
      .slice(0, 10);
  }, [activityLogs, selectedEmployee]);

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: number; data: Partial<Employee> }) => {
      const response = await apiRequest("PUT", `/api/users/${payload.id}`, payload.data);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/users", "employee-profiles"] });
      toast({
        title: "Employee profile updated",
        description: "Changes were saved successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Could not update employee profile.",
        variant: "destructive",
      });
    },
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

  const roleKey = String((draft.role ?? selectedEmployee?.role ?? "viewer")).toLowerCase();
  const permissionPreview = ROLE_PERMISSION_MAP[roleKey] ?? ROLE_PERMISSION_MAP.viewer;
  const selectedWarehouseName =
    warehouses.find((warehouse) => warehouse.id === Number(draft.warehouseId ?? selectedEmployee?.warehouseId ?? 0))?.name ?? "Unassigned";

  return (
    <div className="mx-auto max-w-7xl space-y-6 py-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Employee Profiles</h1>
        <p className="text-muted-foreground">
          Manage role assignments, profile details, permissions, and user activity.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card>
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
                filteredEmployees.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left transition hover:border-primary ${
                      selectedEmployeeId === employee.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => {
                      setSelectedEmployeeId(employee.id);
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
                      });
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{employee.fullName || employee.username}</p>
                      <Badge variant="outline">{employee.role || "viewer"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{employee.email}</p>
                  </button>
                ))
              )}
            </div>
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
                      value={String(draft.fullName ?? "")}
                      onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-email">Email</Label>
                    <Input
                      id="employee-email"
                      type="email"
                      value={String(draft.email ?? "")}
                      onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-phone">Phone (SMS / alerts)</Label>
                    <Input
                      id="employee-phone"
                      type="tel"
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
                      value={String(draft.role ?? "viewer")}
                      onValueChange={(value) => setDraft((current) => ({ ...current, role: value }))}
                    >
                      <SelectTrigger id="employee-role">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee-warehouse">Warehouse</Label>
                    <Select
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
                  <div className="space-y-2">
                    <Label htmlFor="employee-approver-cap">Requisition approver limit (optional)</Label>
                    <p className="text-xs text-muted-foreground">
                      Maximum requisition total this user may approve (same currency as requisition). Leave empty for no cap
                      beyond approval policies.
                    </p>
                    <Input
                      id="employee-approver-cap"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="e.g. 50000"
                      value={draft.approverAmountLimit != null ? String(draft.approverAmountLimit) : ""}
                      onChange={(event) => {
                        const raw = event.target.value.trim();
                        setDraft((current) => ({
                          ...current,
                          approverAmountLimit: raw === "" ? null : Number(raw),
                        }));
                      }}
                    />
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">Active account</p>
                      <p className="text-xs text-muted-foreground">
                        Disable to prevent this employee from signing in.
                      </p>
                    </div>
                    <Button
                      variant={draft.active === false ? "outline" : "default"}
                      onClick={() => setDraft((current) => ({ ...current, active: !(current.active ?? true) }))}
                    >
                      {draft.active === false ? "Set Active" : "Set Inactive"}
                    </Button>
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
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
                        })
                      }
                    >
                      Reset
                    </Button>
                    <Button
                      disabled={updateMutation.isPending}
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
                          },
                        })
                      }
                    >
                      Save Profile
                    </Button>
                  </div>
                </CardContent>
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
                  <CardContent className="space-y-2 text-sm">
                    {permissionPreview.map((permission) => (
                      <p key={permission}>✓ {permission}</p>
                    ))}
                    <p className="pt-2 text-xs text-muted-foreground">
                      Location scope: {selectedWarehouseName}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent Activity</CardTitle>
                    <CardDescription>
                      Latest actions and audit events for this employee
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedRecentActivity.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No activity logs recorded yet.</p>
                    ) : (
                      selectedRecentActivity.map((row) => (
                        <div key={row.id} className="rounded-md border p-2">
                          <p className="text-sm font-medium">{row.action}</p>
                          <p className="text-xs text-muted-foreground">{row.description || "No description"}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {row.timestamp || row.createdAt
                              ? new Date(row.timestamp || row.createdAt || "").toLocaleString()
                              : "Unknown timestamp"}
                          </p>
                        </div>
                      ))
                    )}
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


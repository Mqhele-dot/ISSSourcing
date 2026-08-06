import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, X, Plus, ChevronDown, Eye, PanelsTopLeft, Power, Trash2 } from "lucide-react";
import { apiRequest, queryClient, requestJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { APP_NAV_SECTIONS, SIDEBAR_ADMIN_SECONDARY_GROUPS } from "@/lib/routes/section-metadata";

// Role and permission types
type UserRole = {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean | null;
  createdBy: number;
  isSystemRole: boolean | null;
};

type UserProfile = {
  id: number;
  username: string;
  fullName?: string | null;
  email?: string | null;
  role?: string | null;
  workPersona?: string | null;
  organizationRole?: string | null;
  active?: boolean | null;
  preferences?: { customRoleId?: number | string | null; allowedNavPaths?: string[] } | null;
};

type Permission = {
  id: number;
  role: string;
  resource: string;
  permissionType: string;
};

type PermissionCatalogCategory = { id: string; label: string; resources: string[] };
type PermissionCatalogType = { value: string; label: string };
type PermissionCatalogResponse = {
  categories: PermissionCatalogCategory[];
  permissionTypes: PermissionCatalogType[];
};

/** Mirrors `server/rbac/permission-catalog.ts` when the API is unavailable. */
const FALLBACK_PERMISSION_CATALOG_CATEGORIES: PermissionCatalogCategory[] = [
  {
    id: "inventory",
    label: "Inventory & logistics",
    resources: ["inventory", "categories", "warehouses", "stock_movements"],
  },
  {
    id: "procurement",
    label: "Purchasing",
    resources: ["purchases", "suppliers", "reorder_requests"],
  },
  {
    id: "finance_data",
    label: "Finance data",
    resources: ["invoices", "billing", "taxes", "payments"],
  },
  {
    id: "people_access",
    label: "Users & access",
    resources: ["users", "custom_roles"],
  },
  {
    id: "insights",
    label: "Reporting & analytics",
    resources: ["reports", "analytics", "dashboards", "activity_logs", "audit_logs"],
  },
  {
    id: "system",
    label: "System",
    resources: ["settings", "system", "import_export", "documents", "notifications"],
  },
];

const FALLBACK_PERMISSION_TYPES: PermissionCatalogType[] = [
  { value: "read", label: "Read" },
  { value: "create", label: "Create" },
  { value: "update", label: "Update" },
  { value: "delete", label: "Delete" },
  { value: "approve", label: "Approve" },
  { value: "export", label: "Export" },
  { value: "import", label: "Import" },
  { value: "assign", label: "Assign" },
  { value: "execute", label: "Execute" },
  { value: "manage", label: "Manage" },
  { value: "admin", label: "Admin" },
];

// Create custom role form schema
const createRoleSchema = z.object({
  name: z.string().min(3, "Name must be at least 3 characters"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

const PROFILE_NAV_ITEMS = Array.from(
  new Map(
    [
      ...APP_NAV_SECTIONS.flatMap((section) => section.items.map((item) => ({ ...item, section: section.label }))),
      ...SIDEBAR_ADMIN_SECONDARY_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, section: group.heading.replace("Admin - ", "") }))),
    ].map((item) => [item.path, item]),
  ).values(),
);

export function RoleManager() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const [selectedTab, setSelectedTab] = useState("custom-roles");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedCustomRole, setSelectedCustomRole] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [navigationProfile, setNavigationProfile] = useState<UserProfile | null>(null);
  const [accessProfile, setAccessProfile] = useState<UserProfile | null>(null);
  const [allowedNavPaths, setAllowedNavPaths] = useState<string[]>([]);
  const [deleteRoleOpen, setDeleteRoleOpen] = useState(false);

  const { data: permissionCatalog } = useQuery<PermissionCatalogResponse>({
    queryKey: ["/api/rbac/permission-catalog"],
  });

  const catalogCategories = useMemo(
    () =>
      permissionCatalog?.categories?.length
        ? permissionCatalog.categories
        : FALLBACK_PERMISSION_CATALOG_CATEGORIES,
    [permissionCatalog?.categories],
  );

  const catalogPermissionTypes = useMemo(
    () =>
      permissionCatalog?.permissionTypes?.length
        ? permissionCatalog.permissionTypes
        : FALLBACK_PERMISSION_TYPES,
    [permissionCatalog?.permissionTypes],
  );

  const filteredMatrixCategories = useMemo(() => {
    const q = permissionSearch.trim().toLowerCase();
    return catalogCategories
      .map((c) => ({
        ...c,
        resources: q
          ? c.resources.filter(
              (r) => r.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
            )
          : c.resources,
      }))
      .filter((c) => c.resources.length > 0);
  }, [catalogCategories, permissionSearch]);
  
  // Fetch system roles (predefined roles)
  const { data: systemRoles } = useQuery<string[]>({
    queryKey: ["/api/roles"],
  });

  // Fetch custom roles
  const { data: customRoles } = useQuery<UserRole[]>({
    queryKey: ["/api/custom-roles"],
  });

  const { data: users = [] } = useQuery<UserProfile[]>({
    queryKey: ["/api/users", "role-manager"],
  });
  const visibleUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    return users
      .filter((profile) => !term || [profile.fullName, profile.username, profile.email, profile.role, profile.workPersona]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term))
      .slice(0, 25);
  }, [userSearch, users]);

  // Fetch permissions for selected role
  const { data: selectedRolePermissions, isLoading: permissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/roles", selectedRole, "permissions"],
    enabled: !!selectedRole,
    queryFn: () => requestJson<Permission[]>("GET", `/api/roles/${selectedRole}/permissions`),
  });

  // Fetch permissions for selected custom role
  const { data: selectedCustomRolePermissions, isLoading: customPermissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/custom-roles", selectedCustomRole, "permissions"],
    enabled: !!selectedCustomRole,
    queryFn: () => requestJson<Permission[]>("GET", `/api/custom-roles/${selectedCustomRole}/permissions`),
  });

  const accessProfileCustomRoleId = Number(accessProfile?.preferences?.customRoleId);
  const accessProfileUsesCustomRole = accessProfile?.role === "custom" && Number.isFinite(accessProfileCustomRoleId) && accessProfileCustomRoleId > 0;
  const accessProfilePermissionUrl = accessProfileUsesCustomRole
    ? `/api/custom-roles/${accessProfileCustomRoleId}/permissions`
    : accessProfile?.role
      ? `/api/roles/${accessProfile.role}/permissions`
      : null;
  const accessProfilePermissions = useQuery<Permission[]>({
    queryKey: ["role-manager-profile-permissions", accessProfile?.id, accessProfilePermissionUrl],
    enabled: Boolean(accessProfile && accessProfilePermissionUrl && accessProfile.role !== "admin"),
    queryFn: () => requestJson<Permission[]>("GET", accessProfilePermissionUrl!),
  });
  
  // Get permissions based on selected tab and role
  const currentPermissions = selectedTab === "system-roles"
    ? selectedRolePermissions || []
    : selectedCustomRolePermissions || [];
  
  // Form for creating new custom role
  const createRoleForm = useForm<z.infer<typeof createRoleSchema>>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      name: "",
      description: "",
      isActive: true,
    },
  });

  // Mutation for creating a new custom role
  const createRoleMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createRoleSchema>) => {
      const res = await apiRequest("POST", "/api/custom-roles", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-roles"] });
      setCreateRoleOpen(false);
      createRoleForm.reset();
      toast({
        title: "Custom role created",
        description: "The custom role has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create custom role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCustomRoleMutation = useMutation({
    mutationFn: async ({ roleId, isActive }: { roleId: number; isActive: boolean }) => {
      const res = await apiRequest("PUT", `/api/custom-roles/${roleId}`, {
        isActive,
        reason: isActive ? "Administrator reactivated custom role" : "Administrator deactivated custom role",
      });
      return await res.json();
    },
    onSuccess: async (role: UserRole) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/custom-roles"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/permissions/me"] });
      toast({
        title: role.isActive === false ? "Custom role deactivated" : "Custom role activated",
        description: role.isActive === false
          ? "Assigned profiles immediately lose this role's permissions until it is reactivated."
          : "The custom role is available for assignments again.",
      });
    },
    onError: (error: Error) => toast({ title: "Could not update custom role", description: error.message, variant: "destructive" }),
  });

  const deleteCustomRoleMutation = useMutation({
    mutationFn: async (roleId: number) => {
      await apiRequest("DELETE", `/api/custom-roles/${roleId}`, {
        reason: "Administrator permanently deleted inactive custom role",
      });
      return roleId;
    },
    onSuccess: async (roleId) => {
      setDeleteRoleOpen(false);
      setSelectedCustomRole(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/custom-roles"] });
      queryClient.removeQueries({ queryKey: ["/api/custom-roles", roleId, "permissions"] });
      toast({ title: "Custom role deleted", description: "The inactive, unassigned custom role was permanently removed." });
    },
    onError: (error: Error) => toast({ title: "Could not delete custom role", description: error.message, variant: "destructive" }),
  });

  // Mutation for adding a permission to a custom role
  const addPermissionMutation = useMutation({
    mutationFn: async ({ roleId, resource, permissionType }: { roleId: number, resource: string, permissionType: string }) => {
      const res = await apiRequest("POST", `/api/custom-roles/${roleId}/permissions`, { resource, permissionType });
      return await res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-roles", variables.roleId, "permissions"] });
      toast({
        title: "Permission added",
        description: `Added ${variables.permissionType} permission for ${variables.resource}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add permission",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation for removing a permission from a custom role
  const removePermissionMutation = useMutation({
    mutationFn: async ({ roleId, permissionId }: { roleId: number, permissionId: number }) => {
      const res = await apiRequest("DELETE", `/api/custom-roles/${roleId}/permissions/${permissionId}`);
      return await res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-roles", variables.roleId, "permissions"] });
      toast({
        title: "Permission removed",
        description: "The permission has been removed from the role.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove permission",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const assignCustomRoleMutation = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: number; roleId: number | null }) => {
      const profile = users.find((candidate) => candidate.id === userId);
      const res = await apiRequest("PUT", `/api/users/${userId}`, {
        role: roleId ? "custom" : "viewer",
        preferences: { ...(profile?.preferences ?? {}), customRoleId: roleId },
      });
      return await res.json();
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/users", "role-manager"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/users", variables.userId] });
      toast({
        title: "Profile access updated",
        description: "The selected profile now uses this custom role.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to assign custom role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateNavigationMutation = useMutation({
    mutationFn: async ({ profile, paths }: { profile: UserProfile; paths: string[] }) => {
      const res = await apiRequest("PUT", `/api/users/${profile.id}`, {
        preferences: { ...(profile.preferences ?? {}), allowedNavPaths: paths },
        reason: "Administrator updated profile tab access",
      });
      return await res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/users", "role-manager"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setNavigationProfile(null);
      toast({ title: "Profile tabs updated", description: "Navigation and direct route access now use the selected tab list." });
    },
    onError: (error: Error) => toast({ title: "Could not update profile tabs", description: error.message, variant: "destructive" }),
  });

  const openNavigationAccess = (profile: UserProfile) => {
    setNavigationProfile(profile);
    setAllowedNavPaths(profile.preferences?.allowedNavPaths ?? PROFILE_NAV_ITEMS.map((item) => item.path));
  };

  const currentCustomRole = customRoles?.find((role) => role.id === selectedCustomRole) ?? null;
  const selectedRoleAssignments = selectedCustomRole
    ? users.filter((profile) => Number(profile.preferences?.customRoleId) === selectedCustomRole)
    : [];

  // Handle form submission for creating a new role
  const onCreateRoleSubmit = (data: z.infer<typeof createRoleSchema>) => {
    createRoleMutation.mutate(data);
  };

  // Check if a permission exists in the current role
  const hasPermission = (resource: string, permissionType: string): boolean => {
    return currentPermissions.some(
      (p) => p.resource === resource && p.permissionType === permissionType
    );
  };

  // Toggle permission for custom role
  const togglePermission = (resource: string, permissionType: string) => {
    if (!selectedCustomRole) return;
    
    const existingPermission = currentPermissions.find(
      (p) => p.resource === resource && p.permissionType === permissionType
    );
    
    if (existingPermission) {
      removePermissionMutation.mutate({
        roleId: selectedCustomRole,
        permissionId: existingPermission.id,
      });
    } else {
      addPermissionMutation.mutate({
        roleId: selectedCustomRole,
        resource,
        permissionType,
      });
    }
  };

  // Reset selections when changing tabs
  useEffect(() => {
    setSelectedRole(null);
    setSelectedCustomRole(null);
  }, [selectedTab]);

  useEffect(() => {
    if (selectedTab !== "custom-roles" || selectedCustomRole || !customRoles?.length) return;
    setSelectedCustomRole(customRoles[0].id);
  }, [customRoles, selectedCustomRole, selectedTab]);

  return (
    <Card className="w-full" data-testid="role-manager-card">
      <CardHeader>
        <CardTitle>Role & Permission Management</CardTitle>
        <CardDescription>
          Manage system roles and custom roles with their associated permissions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Card className="mb-4" data-testid="role-manager-users-card">
          <CardHeader>
            <CardTitle className="text-base">User access assignments</CardTitle>
            <CardDescription>
              Real user, role, persona, organization membership, and active-state data from the backend.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <Input
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Search users, roles, or personas"
                aria-label="Search user access assignments"
                className="max-w-sm"
              />
              <span className="text-xs text-muted-foreground">
                Showing {visibleUsers.length} of {users.length} users
              </span>
            </div>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users are available for this organization.</p>
            ) : visibleUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No users match this search.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>System role</TableHead>
                      <TableHead>Work persona</TableHead>
                      <TableHead>Organization role</TableHead>
                      <TableHead>Custom access</TableHead>
                      <TableHead>Access controls</TableHead>
                      <TableHead>Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleUsers.map((profile) => (
                      <TableRow key={profile.id} data-testid={`role-user-row-${profile.username}`}>
                        <TableCell>
                          <div className="font-medium">{profile.fullName || profile.username}</div>
                          <div className="text-xs text-muted-foreground">{profile.email || profile.username}</div>
                        </TableCell>
                        <TableCell>{profile.role || "viewer"}</TableCell>
                        <TableCell>{profile.workPersona || "-"}</TableCell>
                        <TableCell>{profile.organizationRole || "member"}</TableCell>
                        <TableCell>
                          <Select
                            value={profile.preferences?.customRoleId ? String(profile.preferences.customRoleId) : "none"}
                            disabled={profile.id === currentUser?.id || assignCustomRoleMutation.isPending}
                            onValueChange={(value) => {
                              assignCustomRoleMutation.mutate({ userId: profile.id, roleId: value === "none" ? null : Number(value) });
                            }}
                          >
                            <SelectTrigger className="min-w-44" aria-label={`Choose custom access for ${profile.fullName || profile.username}`}>
                              <SelectValue placeholder="Choose custom access" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No custom role</SelectItem>
                              {(customRoles ?? []).filter((role) => role.isActive !== false).map((role) => (
                                <SelectItem key={role.id} value={String(role.id)}>{role.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {profile.id === currentUser?.id ? (
                            <p className="mt-1 text-xs text-muted-foreground">Current administrator is protected from self-demotion.</p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => setAccessProfile(profile)}>
                              <Eye className="h-4 w-4" />
                              View access
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => openNavigationAccess(profile)}>
                              <PanelsTopLeft className="h-4 w-4" />
                              Choose tabs
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>{profile.active === false ? "Inactive" : "Active"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Dialog open={Boolean(accessProfile)} onOpenChange={(open) => !open && setAccessProfile(null)}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{accessProfile?.fullName || accessProfile?.username || "Profile"} access</DialogTitle>
              <DialogDescription>
                Review the effective role, custom access assignment, visible workspaces, and configured permissions.
              </DialogDescription>
            </DialogHeader>
            {accessProfile ? (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">System role</div><div className="mt-1 font-medium capitalize">{accessProfile.role || "viewer"}</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Custom role</div><div className="mt-1 font-medium">{customRoles?.find((role) => role.id === accessProfileCustomRoleId)?.name || "None"}</div></div>
                  <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Account</div><div className="mt-1 font-medium">{accessProfile.active === false ? "Inactive" : "Active"}</div></div>
                </div>
                <section>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-medium">Visible tabs</h3>
                    <span className="text-xs text-muted-foreground">
                      {Array.isArray(accessProfile.preferences?.allowedNavPaths)
                        ? `${accessProfile.preferences.allowedNavPaths.length} selected`
                        : "All role-allowed tabs"}
                    </span>
                  </div>
                  <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border p-3">
                    {(accessProfile.preferences?.allowedNavPaths ?? PROFILE_NAV_ITEMS.map((item) => item.path)).map((path) => (
                      <Badge key={path} variant="outline">{PROFILE_NAV_ITEMS.find((item) => item.path === path)?.label || path}</Badge>
                    ))}
                    {accessProfile.preferences?.allowedNavPaths?.length === 0 ? <span className="text-sm text-muted-foreground">No operational tabs selected.</span> : null}
                  </div>
                </section>
                <section>
                  <h3 className="font-medium">Permissions</h3>
                  {accessProfile.role === "admin" ? (
                    <div className="mt-2 rounded-md border bg-muted/20 p-3 text-sm">Full administrator access across all resources.</div>
                  ) : accessProfilePermissions.isLoading ? (
                    <div className="mt-2 rounded-md border p-3 text-sm text-muted-foreground">Loading permissions…</div>
                  ) : accessProfilePermissions.isError ? (
                    <div className="mt-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive">Permissions could not be loaded.</div>
                  ) : (accessProfilePermissions.data?.length ?? 0) === 0 ? (
                    <div className="mt-2 rounded-md border p-3 text-sm text-muted-foreground">No explicit permissions are configured for this role.</div>
                  ) : (
                    <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                      {Object.entries((accessProfilePermissions.data ?? []).reduce<Record<string, Permission[]>>((groups, permission) => {
                        (groups[permission.resource] ??= []).push(permission);
                        return groups;
                      }, {})).map(([resource, permissions]) => (
                        <div key={resource} className="rounded-md border p-3">
                          <div className="font-medium capitalize">{resource.replaceAll("_", " ")}</div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {permissions.map((permission) => <Badge key={permission.id} variant="secondary">{permission.permissionType}</Badge>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAccessProfile(null)}>Close</Button>
              <Button type="button" onClick={() => { const profile = accessProfile; setAccessProfile(null); if (profile) openNavigationAccess(profile); }}>Edit visible tabs</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={Boolean(navigationProfile)} onOpenChange={(open) => !open && setNavigationProfile(null)}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Profile tab access</DialogTitle>
              <DialogDescription>
                Choose the navigation tabs that {navigationProfile?.fullName || navigationProfile?.username || "this profile"} can open. API permissions still apply inside each tab.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setAllowedNavPaths(PROFILE_NAV_ITEMS.map((item) => item.path))}>Select all</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setAllowedNavPaths([])}>Clear all</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROFILE_NAV_ITEMS.map((item) => {
                const checked = allowedNavPaths.includes(item.path);
                return (
                  <label key={item.path} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => setAllowedNavPaths((current) => next ? [...new Set([...current, item.path])] : current.filter((path) => path !== item.path))}
                      aria-label={`Allow ${item.label}`}
                    />
                    <span><span className="block text-sm font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.section}</span></span>
                  </label>
                );
              })}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNavigationProfile(null)}>Cancel</Button>
              <Button
                type="button"
                disabled={!navigationProfile || updateNavigationMutation.isPending}
                onClick={() => navigationProfile && updateNavigationMutation.mutate({ profile: navigationProfile, paths: allowedNavPaths })}
              >
                {updateNavigationMutation.isPending ? "Saving..." : `Save ${allowedNavPaths.length} tabs`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="system-roles">System Roles</TabsTrigger>
            <TabsTrigger value="custom-roles">Custom Roles</TabsTrigger>
          </TabsList>
          
          <TabsContent value="system-roles">
            <div className="flex flex-col space-y-4">
              <div className="flex space-x-4">
                <div className="w-1/4">
                  <Label>Select Role</Label>
                  <Select
                    value={selectedRole || ""}
                    onValueChange={(value) => setSelectedRole(value)}
                  >
                    <SelectTrigger aria-label="Select system role">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {systemRoles?.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {selectedRole && (
                <div className="mt-4">
                  <h3 className="text-lg font-semibold mb-2">Permissions</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    System role permissions cannot be modified. They are pre-defined in the system.
                  </p>
                  
                  {permissionsLoading ? (
                    <div>Loading permissions...</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="max-w-md space-y-1">
                        <Label htmlFor="permission-search-system">Filter resources</Label>
                        <Input
                          id="permission-search-system"
                          placeholder="Search by resource or category…"
                          value={permissionSearch}
                          onChange={(event) => setPermissionSearch(event.target.value)}
                        />
                      </div>
                      {filteredMatrixCategories.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No resources match your search.</p>
                      ) : (
                        filteredMatrixCategories.map((category) => (
                          <Collapsible key={category.id} defaultOpen>
                            <div className="overflow-hidden rounded-md border">
                              <CollapsibleTrigger className="flex w-full items-center gap-2 bg-muted/40 px-4 py-3 text-left text-sm font-semibold hover:bg-muted/60">
                                <ChevronDown className="h-4 w-4 shrink-0" />
                                {category.label}
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="bg-muted p-4 pt-2">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Resource</TableHead>
                                        {catalogPermissionTypes.map((type) => (
                                          <TableHead key={type.value}>{type.label}</TableHead>
                                        ))}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {category.resources.map((resource) => (
                                        <TableRow key={resource}>
                                          <TableCell className="font-medium">
                                            {resource.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                          </TableCell>
                                          {catalogPermissionTypes.map((type) => (
                                            <TableCell key={type.value}>
                                              {hasPermission(resource, type.value) ? (
                                                <Check className="text-green-500" size={16} />
                                              ) : (
                                                <X className="text-muted-foreground" size={16} />
                                              )}
                                            </TableCell>
                                          ))}
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
          
          <TabsContent value="custom-roles">
            <div className="flex flex-col space-y-4">
              <div className="flex justify-between items-center">
                <div className="w-1/4">
                  <Label>Select Custom Role</Label>
                  <Select
                    value={selectedCustomRole ? String(selectedCustomRole) : ""}
                    onValueChange={(value) => setSelectedCustomRole(Number(value))}
                  >
                    <SelectTrigger aria-label="Select custom role">
                      <SelectValue placeholder="Select a custom role" />
                    </SelectTrigger>
                    <SelectContent>
                      {customRoles?.map((role) => (
                        <SelectItem key={role.id} value={String(role.id)}>
                          {role.name}{role.isActive === false ? " (inactive)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <Dialog open={createRoleOpen} onOpenChange={setCreateRoleOpen}>
                  <DialogTrigger asChild>
                    <Button variant="default">
                      <Plus className="mr-2" size={16} />
                      Create Custom Role
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Custom Role</DialogTitle>
                      <DialogDescription>
                        Define a new custom role with specific permissions for your organization.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <Form {...createRoleForm}>
                      <form onSubmit={createRoleForm.handleSubmit(onCreateRoleSubmit)} className="space-y-4">
                        <FormField
                          control={createRoleForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Role Name</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g., Warehouse Manager" {...field} />
                              </FormControl>
                              <FormDescription>
                                A unique name for this custom role
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={createRoleForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Description</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="e.g., Manages warehouse operations"
                                  {...field}
                                  value={field.value || ""}
                                />
                              </FormControl>
                              <FormDescription>
                                Optional description of this role's responsibilities
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={createRoleForm.control}
                          name="isActive"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                              <div className="space-y-0.5">
                                <FormLabel>Active</FormLabel>
                                <FormDescription>
                                  Enable or disable this role
                                </FormDescription>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        
                        <DialogFooter>
                          <Button type="submit" disabled={createRoleMutation.isPending}>
                            {createRoleMutation.isPending ? "Creating..." : "Create Role"}
                          </Button>
                        </DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
              
              {selectedCustomRole && (
                <div className="mt-4">
                  {currentCustomRole ? (
                    <Card className="mb-4" data-testid="custom-role-lifecycle-card">
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="text-base">{currentCustomRole.name}</CardTitle>
                              <Badge variant={currentCustomRole.isActive === false ? "secondary" : "default"}>
                                {currentCustomRole.isActive === false ? "Inactive" : "Active"}
                              </Badge>
                            </div>
                            <CardDescription className="mt-1">
                              {currentCustomRole.description || "No role description."} · {selectedRoleAssignments.length} assigned profile{selectedRoleAssignments.length === 1 ? "" : "s"}
                            </CardDescription>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="gap-2"
                              disabled={Boolean(currentCustomRole.isSystemRole) || updateCustomRoleMutation.isPending}
                              onClick={() => updateCustomRoleMutation.mutate({
                                roleId: currentCustomRole.id,
                                isActive: currentCustomRole.isActive === false,
                              })}
                            >
                              <Power className="h-4 w-4" />
                              {currentCustomRole.isActive === false ? "Activate role" : "Deactivate role"}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              className="gap-2"
                              disabled={Boolean(currentCustomRole.isSystemRole) || currentCustomRole.isActive !== false || selectedRoleAssignments.length > 0}
                              onClick={() => setDeleteRoleOpen(true)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete role
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          Deactivation immediately suspends this role's permissions. Permanent deletion is available only after the role is inactive and no profiles are assigned.
                        </p>
                      </CardContent>
                    </Card>
                  ) : null}
                  <Card className="mb-4">
                    <CardHeader>
                      <CardTitle className="text-base">Assign this access to a profile</CardTitle>
                      <CardDescription>
                        Select an employee profile and apply this custom access set directly.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
                      <div className="w-full md:max-w-sm">
                        <Label>Employee profile</Label>
                        <Select
                          value={selectedUserId ? String(selectedUserId) : ""}
                          onValueChange={(value) => setSelectedUserId(Number(value))}
                        >
                          <SelectTrigger aria-label="Select permission profile">
                            <SelectValue placeholder="Select a profile" />
                          </SelectTrigger>
                          <SelectContent>
                            {users.map((profile) => (
                              <SelectItem key={profile.id} value={String(profile.id)}>
                                {profile.fullName || profile.username}
                                {profile.email ? ` - ${profile.email}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        data-testid="role-manager-assign-custom-access"
                        disabled={
                          !selectedUserId
                          || selectedUserId === currentUser?.id
                          || currentCustomRole?.isActive === false
                          || assignCustomRoleMutation.isPending
                        }
                        onClick={() => {
                          if (!selectedUserId || !selectedCustomRole) return;
                          assignCustomRoleMutation.mutate({
                            userId: selectedUserId,
                            roleId: selectedCustomRole,
                          });
                        }}
                      >
                        {assignCustomRoleMutation.isPending ? "Assigning..." : "Assign custom access"}
                      </Button>
                      {selectedUserId === currentUser?.id ? (
                        <p className="text-xs text-muted-foreground">You cannot replace your own administrator access.</p>
                      ) : null}
                    </CardContent>
                  </Card>
                  <h3 className="text-lg font-semibold mb-2">
                    Permissions for {customRoles?.find(r => r.id === selectedCustomRole)?.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Click on any permission to toggle it for this custom role.
                  </p>
                  
                  {customPermissionsLoading ? (
                    <div>Loading permissions...</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="max-w-md space-y-1">
                        <Label htmlFor="permission-search-custom">Filter resources</Label>
                        <Input
                          id="permission-search-custom"
                          placeholder="Search by resource or category…"
                          value={permissionSearch}
                          onChange={(event) => setPermissionSearch(event.target.value)}
                        />
                      </div>
                      {filteredMatrixCategories.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No resources match your search.</p>
                      ) : (
                        filteredMatrixCategories.map((category) => (
                          <Collapsible key={category.id} defaultOpen>
                            <div className="overflow-hidden rounded-md border">
                              <CollapsibleTrigger className="flex w-full items-center gap-2 bg-muted/40 px-4 py-3 text-left text-sm font-semibold hover:bg-muted/60">
                                <ChevronDown className="h-4 w-4 shrink-0" />
                                {category.label}
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="bg-muted p-4 pt-2">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Resource</TableHead>
                                        {catalogPermissionTypes.map((type) => (
                                          <TableHead key={type.value}>{type.label}</TableHead>
                                        ))}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {category.resources.map((resource) => (
                                        <TableRow key={resource}>
                                          <TableCell className="font-medium">
                                            {resource.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                          </TableCell>
                                          {catalogPermissionTypes.map((type) => (
                                            <TableCell key={type.value} className="p-0">
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-full w-full"
                                                type="button"
                                                onClick={() => togglePermission(resource, type.value)}
                                              >
                                                {hasPermission(resource, type.value) ? (
                                                  <Check className="text-green-500" size={16} />
                                                ) : (
                                                  <X className="text-muted-foreground" size={16} />
                                                )}
                                              </Button>
                                            </TableCell>
                                          ))}
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </CollapsibleContent>
                            </div>
                          </Collapsible>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
        <AlertDialog open={deleteRoleOpen} onOpenChange={setDeleteRoleOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {currentCustomRole?.name || "custom role"}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the role and its permission configuration. This action is available only for inactive roles with no assigned profiles.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!currentCustomRole || deleteCustomRoleMutation.isPending}
                onClick={() => currentCustomRole && deleteCustomRoleMutation.mutate(currentCustomRole.id)}
              >
                {deleteCustomRoleMutation.isPending ? "Deleting..." : "Delete role permanently"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// Role assignment component for user management
export function UserRoleAssignment({ userId, currentRole }: { userId: number, currentRole: string }) {
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState(currentRole);
  const [customRoleId, setCustomRoleId] = useState<number | null>(null);
  
  // Fetch system roles
  const { data: systemRoles } = useQuery<string[]>({
    queryKey: ["/api/roles"],
  });

  // Fetch custom roles
  const { data: customRoles } = useQuery<UserRole[]>({
    queryKey: ["/api/custom-roles"],
  });

  // Mutation for updating user role
  const updateRoleMutation = useMutation({
    mutationFn: async ({ role, customRoleId }: { role: string, customRoleId?: number }) => {
      const res = await apiRequest("PUT", `/api/users/${userId}`, { 
        role,
        // If assigning custom role, include custom role ID in preferences
        preferences: role === 'custom' && customRoleId ? { customRoleId } : undefined
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", userId] });
      toast({
        title: "Role updated",
        description: "The user's role has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle role assignment
  const assignRole = () => {
    if (selectedRole === 'custom' && !customRoleId) {
      toast({
        title: "Custom role required",
        description: "Please select a specific custom role to assign.",
        variant: "destructive",
      });
      return;
    }
    
    updateRoleMutation.mutate({
      role: selectedRole,
      customRoleId: selectedRole === 'custom' ? (customRoleId ?? undefined) : undefined
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col space-y-2">
        <Label>System Role</Label>
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="w-full" aria-label="Assign system role">
            <SelectValue placeholder="Select role" />
          </SelectTrigger>
          <SelectContent>
            {systemRoles?.map((role) => (
              <SelectItem key={role} value={role}>
                {role.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {selectedRole === 'custom' && (
        <div className="flex flex-col space-y-2">
          <Label>Custom Role</Label>
          <Select 
            value={customRoleId ? String(customRoleId) : ""} 
            onValueChange={(value) => setCustomRoleId(Number(value))}
          >
            <SelectTrigger className="w-full" aria-label="Assign custom role">
              <SelectValue placeholder="Select custom role" />
            </SelectTrigger>
            <SelectContent>
              {customRoles?.map((role) => (
                <SelectItem key={role.id} value={String(role.id)}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      
      <Button 
        onClick={assignRole} 
        disabled={updateRoleMutation.isPending}
        className="w-full"
      >
        {updateRoleMutation.isPending ? "Updating..." : "Assign Role"}
      </Button>
    </div>
  );
}

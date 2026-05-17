import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, X, Plus, ChevronDown } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
import { apiRequest } from "@/lib/queryClient";

// Role and permission types
type UserRole = {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean | null;
  createdBy: number;
  isSystemRole: boolean | null;
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

export function RoleManager() {
  const { toast } = useToast();
  const [selectedTab, setSelectedTab] = useState("system-roles");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedCustomRole, setSelectedCustomRole] = useState<number | null>(null);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState("");

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

  // Fetch permissions for selected role
  const { data: selectedRolePermissions, isLoading: permissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/roles", selectedRole, "permissions"],
    enabled: !!selectedRole,
  });

  // Fetch permissions for selected custom role
  const { data: selectedCustomRolePermissions, isLoading: customPermissionsLoading } = useQuery<Permission[]>({
    queryKey: ["/api/custom-roles", selectedCustomRole, "permissions"],
    enabled: !!selectedCustomRole,
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

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Role & Permission Management</CardTitle>
        <CardDescription>
          Manage system roles and custom roles with their associated permissions
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                    <SelectTrigger>
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
                    <SelectTrigger>
                      <SelectValue placeholder="Select a custom role" />
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
          <SelectTrigger className="w-full">
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
            <SelectTrigger className="w-full">
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
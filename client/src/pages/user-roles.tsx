import { RoleManager } from "@/components/user/role-manager";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert, Info } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

export default function UserRolesPage() {
  const { hasPermission, isLoading, error } = usePermissions();
  const { toast } = useToast();
  
  useEffect(() => {
    if (error) {
      toast({
        title: "Error loading permissions",
        description: "There was a problem loading role information. Some features may be restricted.",
        variant: "destructive",
      });
    }
  }, [error, toast]);
  
  const canManageRoles = hasPermission('custom_roles', 'admin') || hasPermission('custom_roles', 'manage');
  
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <Breadcrumb>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Dashboard</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink>User Roles & Permissions</BreadcrumbLink>
          </BreadcrumbItem>
        </Breadcrumb>
      </div>
      
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">User Roles & Permissions</h1>
        <p className="text-muted-foreground mt-2">
          Manage system roles and custom roles with specific permissions
        </p>
      </div>
      
      {isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
            </div>
          </CardContent>
        </Card>
      ) : !canManageRoles ? (
        <Alert variant="destructive" className="mb-8">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You don't have permission to manage roles and permissions. 
            Please contact an administrator if you need access.
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="role-manager" className="space-y-4">
          <TabsList>
            <TabsTrigger value="role-manager">Role Manager</TabsTrigger>
            <TabsTrigger value="permissions-overview">Permissions Overview</TabsTrigger>
          </TabsList>
          
          <TabsContent value="role-manager" className="space-y-4">
            <RoleManager />
          </TabsContent>
          
          <TabsContent value="permissions-overview">
            <Card>
              <CardHeader>
                <CardTitle>Permissions Documentation</CardTitle>
                <CardDescription>
                  Learn about the permissions system and how to assign roles and permissions effectively
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted p-4 rounded-lg space-y-4">
                  <h3 className="font-medium text-lg">System Roles</h3>
                  <p>These predefined roles have fixed permissions that cannot be modified:</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold">Admin</h4>
                      <p className="text-sm text-muted-foreground">Full access to all system features and resources</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold">Manager</h4>
                      <p className="text-sm text-muted-foreground">Can manage all resources except system-level operations</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold">Warehouse Manager</h4>
                      <p className="text-sm text-muted-foreground">Manages inventory, warehouses, and stock movements</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold">Procurement Officer</h4>
                      <p className="text-sm text-muted-foreground">Manages suppliers, purchases, and reorder requests</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold">Inventory Clerk</h4>
                      <p className="text-sm text-muted-foreground">Can view, create, and update inventory items</p>
                    </div>
                    
                    <div className="border rounded-lg p-4">
                      <h4 className="font-semibold">Viewer</h4>
                      <p className="text-sm text-muted-foreground">Read-only access to all resources</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-muted p-4 rounded-lg space-y-4">
                  <h3 className="font-medium text-lg">Custom Roles</h3>
                  <p>Create custom roles with specific permissions tailored to your organization's needs:</p>
                  
                  <Alert className="bg-primary/10 border-primary/20">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Custom Role Permissions</AlertTitle>
                    <AlertDescription>
                      Custom roles can have any combination of permissions across different resources. 
                      This allows for granular access control based on your specific requirements.
                    </AlertDescription>
                  </Alert>
                  
                  <div className="space-y-2">
                    <h4 className="font-semibold">Permission Types</h4>
                    <ul className="list-disc pl-6 space-y-1">
                      <li><span className="font-medium">read</span> - View data but cannot make changes</li>
                      <li><span className="font-medium">create</span> - Add new items to the system</li>
                      <li><span className="font-medium">update</span> - Modify existing items</li>
                      <li><span className="font-medium">delete</span> - Remove items from the system</li>
                      <li><span className="font-medium">approve</span> - Approve requests or submissions</li>
                      <li><span className="font-medium">export</span> - Export data to external formats</li>
                      <li><span className="font-medium">import</span> - Import data from external sources</li>
                      <li><span className="font-medium">manage</span> - Full management capabilities for a resource</li>
                      <li><span className="font-medium">admin</span> - Administrative access to a resource</li>
                    </ul>
                  </div>
                </div>
                
                <div className="bg-muted p-4 rounded-lg space-y-4">
                  <h3 className="font-medium text-lg">Best Practices</h3>
                  <ul className="list-disc pl-6 space-y-2">
                    <li>Follow the principle of least privilege - give users only the permissions they need for their role</li>
                    <li>Regularly review and audit user roles and permissions</li>
                    <li>Create custom roles for specific job functions rather than giving everyone administrator access</li>
                    <li>Use descriptive names for custom roles that clearly indicate their purpose</li>
                    <li>Document the permissions assigned to each custom role for future reference</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
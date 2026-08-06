import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { RoleManager } from "@/components/user/role-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Card, CardContent } from "@/components/ui/card";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { APP_ROUTES } from "@/lib/routes/app-routes";

export default function UserRolesPage() {
  const { hasPermission, isLoading, error } = usePermissions();
  const { toast } = useToast();

  useEffect(() => {
    if (!error) return;
    toast({
      title: "Error loading permissions",
      description: "Role information could not be loaded. No access changes should be made until it recovers.",
      variant: "destructive",
    });
  }, [error, toast]);

  const canManageRoles = hasPermission("custom_roles", "admin") || hasPermission("custom_roles", "manage");

  return (
    <div className="container mx-auto py-6" data-testid="user-roles-page">
      <Breadcrumb className="mb-6">
        <BreadcrumbItem><BreadcrumbLink href={APP_ROUTES.home}>Dashboard</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href={APP_ROUTES.admin.settings}>Settings</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink>User Roles & Permissions</BreadcrumbLink></BreadcrumbItem>
      </Breadcrumb>

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">User Roles & Permissions</h1>
        <p className="mt-2 text-muted-foreground">
          Review real access assignments and manage the permissions that are active in this organization.
        </p>
      </div>

      {isLoading ? (
        <Card><CardContent className="flex h-64 items-center justify-center pt-6"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></CardContent></Card>
      ) : error ? (
        <Alert variant="destructive" data-testid="user-roles-error">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Unable to load permissions</AlertTitle>
          <AlertDescription>Refresh the page before making access-control changes.</AlertDescription>
        </Alert>
      ) : !canManageRoles ? (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>You do not have permission to manage roles and permissions.</AlertDescription>
        </Alert>
      ) : (
        <RoleManager />
      )}
    </div>
  );
}

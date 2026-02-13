import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type Permission = {
  id: number;
  role: string;
  resource: string;
  permissionType: string;
};

type PermissionsByResource = Record<
  string,
  {
    resource: string;
    permissions: string[];
  }
>;

export function usePermissions() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [permissionsByResource, setPermissionsByResource] = useState<PermissionsByResource>({});

  // Fetch permissions for the current user's role
  const { data: permissions, isLoading, error } = useQuery<Permission[]>({
    queryKey: user ? ["/api/roles", user.role, "permissions"] : null,
    enabled: !!user,
  });

  // For custom roles, fetch the custom role permissions
  const { data: customRolePermissions } = useQuery<Permission[]>({
    queryKey: user && user.role === "custom" ? ["/api/custom-roles", "permissions"] : null,
    enabled: !!user && user.role === "custom",
  });
  
  // Organize permissions by resource for easier checking
  useEffect(() => {
    if (!permissions && !customRolePermissions) return;
    
    const allPermissions = [...(permissions || []), ...(customRolePermissions || [])];
    const byResource: PermissionsByResource = {};
    
    allPermissions.forEach((perm) => {
      if (!byResource[perm.resource]) {
        byResource[perm.resource] = {
          resource: perm.resource,
          permissions: [],
        };
      }
      
      byResource[perm.resource].permissions.push(perm.permissionType);
    });
    
    setPermissionsByResource(byResource);
  }, [permissions, customRolePermissions]);

  // Check if user has access to a specific resource and permission type
  const hasPermission = (resource: string, permissionType: string): boolean => {
    // Admins always have all permissions
    if (user?.role === "admin") return true;
    
    // Check if the user has the specific permission
    return (
      !!permissionsByResource[resource]?.permissions.includes(permissionType)
    );
  };

  // Check if user has a role that matches any of the provided roles
  const hasRole = (roles: string | string[]): boolean => {
    if (!user) return false;
    
    const roleList = Array.isArray(roles) ? roles : [roles];
    return roleList.includes(user.role);
  };

  // Refresh permissions
  const refreshPermissions = () => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ["/api/roles", user.role, "permissions"] });
      if (user.role === "custom") {
        queryClient.invalidateQueries({ queryKey: ["/api/custom-roles", "permissions"] });
      }
    }
  };

  // Handle any errors
  useEffect(() => {
    if (error) {
      toast({
        title: "Error loading permissions",
        description: "There was a problem loading your permissions. Some features may be restricted.",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  return {
    permissions,
    permissionsByResource,
    hasPermission,
    hasRole,
    refreshPermissions,
    isLoading,
    error,
  };
}

// Higher-Order Component to conditionally render based on permissions
export function withPermission(
  WrappedComponent: React.ComponentType<any>,
  resource: string,
  permissionType: string
) {
  return function WithPermissionComponent(props: any) {
    const { hasPermission } = usePermissions();
    
    if (!hasPermission(resource, permissionType)) {
      return null;
    }
    
    return <WrappedComponent {...props} />;
  };
}

// Permission-based button that is disabled or hidden when user lacks permission
interface PermissionButtonProps {
  resource: string;
  permissionType: string;
  fallback?: React.ReactNode;
  showAlways?: boolean;
  children: React.ReactNode;
  [key: string]: any; // For other button props
}

export function PermissionButton({
  resource,
  permissionType,
  fallback = null,
  showAlways = false,
  children,
  ...props
}: PermissionButtonProps) {
  const { hasPermission } = usePermissions();
  const allowed = hasPermission(resource, permissionType);
  
  if (!allowed && !showAlways) {
    return fallback;
  }
  
  return (
    <button {...props} disabled={!allowed}>
      {children}
    </button>
  );
}
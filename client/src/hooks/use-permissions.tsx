import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";

type Permission = {
  resource: string;
  permissionType: string;
};

type CurrentUserPermissionsResponse = {
  role: string;
  permissions: Permission[];
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

  const { data, isLoading, error } = useQuery<CurrentUserPermissionsResponse>({
    queryKey: ["/api/user/permissions"],
    enabled: !!user,
    queryFn: () => requestJson<CurrentUserPermissionsResponse>("GET", "/api/user/permissions"),
  });

  const permissions = data?.permissions ?? [];
  const permissionsByResource = useMemo(() => {
    const byResource: PermissionsByResource = {};

    permissions.forEach((perm) => {
      if (!byResource[perm.resource]) {
        byResource[perm.resource] = {
          resource: perm.resource,
          permissions: [],
        };
      }
      
      byResource[perm.resource].permissions.push(perm.permissionType);
    });

    return byResource;
  }, [permissions]);

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
    return typeof user.role === "string" ? roleList.includes(user.role) : false;
  };

  // Refresh permissions
  const refreshPermissions = () => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ["/api/user/permissions"] });
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

import { cloneElement, type MouseEvent, type ReactElement } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type CanProps = {
  roles?: string[];
  resource?: string;
  permissionType?: string;
  reason?: string;
  children: ReactElement;
};

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function expandRoleAliases(roles: string[]): string[] {
  const expanded = new Set<string>();

  for (const role of roles.map(normalizeRole)) {
    expanded.add(role);
    if (role === "planner") {
      expanded.add("manager");
    }
  }

  return Array.from(expanded);
}

export function Can({
  roles = [],
  resource,
  permissionType,
  reason = "Requires Planner/Admin",
  children,
}: CanProps) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const role = normalizeRole(user?.role ?? "");
  const allowedRoles = expandRoleAliases(roles);
  const allowedByPermission = resource && permissionType ? hasPermission(resource, permissionType) : false;
  const allowedByRole = roles.length > 0 && role.length > 0 && allowedRoles.includes(role);
  const allowed = allowedByPermission || allowedByRole;

  if (allowed) {
    return children;
  }

  const disabledChild = cloneElement(children, {
    disabled: true,
    "aria-disabled": true,
    onClick: (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{disabledChild}</span>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

import type { Express, Request, RequestHandler, Response } from "express";
import { storage } from "../../storage";
import type { UserRole, Resource, PermissionType } from "@shared/schema";
import { getPermissionCatalogPayload } from "../../rbac/permission-catalog";
import { sendError, sendOk } from "../../api-response";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permission: string) => RequestHandler;
};

/**
 * System roles, custom roles, and permission checks — extracted from `routes.ts` orchestrator.
 */
export function registerRbacRoutes(app: Express, auth: AuthBundle): void {
  app.get("/api/permissions/me", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
      }

      const catalog = getPermissionCatalogPayload();
      const resources = catalog.categories.flatMap((category) => category.resources);
      const permissionTypes = catalog.permissionTypes.map((permission) => permission.value);
      const permissions: Record<string, Record<string, boolean>> = {};
      let customRoleId: number | undefined;

      if (user.role === "custom") {
        customRoleId = await storage.getUserCustomRoleId(user.id);
      }

      for (const resource of resources) {
        permissions[resource] = {};
        for (const permissionType of permissionTypes) {
          const hasSystemPermission =
            user.role === "admin" ||
            (await storage.checkPermission(user.role as string, resource, permissionType));
          const hasCustomPermission =
            !hasSystemPermission && customRoleId
              ? await storage.checkCustomRolePermission(
                  customRoleId,
                  resource as Resource,
                  permissionType as PermissionType,
                )
              : false;
          permissions[resource][permissionType] = Boolean(hasSystemPermission || hasCustomPermission);
        }
      }

      return sendOk(res, {
        userId: user.id,
        role: user.role,
        customRoleId: customRoleId ?? null,
        permissions,
      });
    } catch (error) {
      console.error("Error fetching current user permissions:", error);
      return sendError(res, 500, "PERMISSIONS_ME_FAILED", "Failed to load current user permissions", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/rbac/permission-catalog", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      res.json(getPermissionCatalogPayload());
    } catch (error) {
      console.error("Error fetching permission catalog:", error);
      res.status(500).json({ message: "Error fetching permission catalog" });
    }
  });

  app.get("/api/roles", async (_req: Request, res: Response) => {
    try {
      const roles = await storage.getSystemRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching system roles:", error);
      res.status(500).json({ message: "Error fetching system roles" });
    }
  });

  app.get("/api/roles/:role/permissions", async (req: Request, res: Response) => {
    try {
      const role = req.params.role as UserRole;

      const validRoles = await storage.getSystemRoles();
      if (!validRoles.includes(role)) {
        return res.status(404).json({ message: "Role not found" });
      }

      const permissions = await storage.getRolePermissions(role);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching role permissions:", error);
      res.status(500).json({ message: "Error fetching role permissions" });
    }
  });

  app.get("/api/custom-roles", auth.ensureAuthenticated, async (_req: Request, res: Response) => {
    try {
      const roles = await storage.getCustomRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching custom roles:", error);
      res.status(500).json({ message: "Error fetching custom roles" });
    }
  });

  app.get("/api/custom-roles/:id", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }

      const role = await storage.getCustomRole(roleId);
      if (!role) {
        return res.status(404).json({ message: "Custom role not found" });
      }

      res.json(role);
    } catch (error) {
      console.error("Error fetching custom role:", error);
      res.status(500).json({ message: "Error fetching custom role" });
    }
  });

  app.post("/api/custom-roles", auth.ensurePermission("custom_roles", "create"), async (req: Request, res: Response) => {
    try {
      const { name, description, isActive } = req.body;

      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }

      const existingRole = await storage.getCustomRoleByName(name);
      if (existingRole) {
        return res.status(400).json({ message: "A role with this name already exists" });
      }

      const newRole = await storage.createCustomRole({
        name,
        description,
        isActive,
        createdBy: req.user!.id,
        isSystemRole: false,
      });

      res.status(201).json(newRole);
    } catch (error) {
      console.error("Error creating custom role:", error);
      res.status(500).json({ message: "Error creating custom role" });
    }
  });

  app.put("/api/custom-roles/:id", auth.ensurePermission("custom_roles", "update"), async (req: Request, res: Response) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }

      const { name, description, isActive } = req.body;

      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }

      if (name && name !== existingRole.name) {
        const duplicateRole = await storage.getCustomRoleByName(name);
        if (duplicateRole && duplicateRole.id !== roleId) {
          return res.status(400).json({ message: "A role with this name already exists" });
        }
      }

      const updatedRole = await storage.updateCustomRole(roleId, {
        name,
        description,
        isActive,
      });

      res.json(updatedRole);
    } catch (error) {
      console.error("Error updating custom role:", error);
      res.status(500).json({ message: "Error updating custom role" });
    }
  });

  app.delete("/api/custom-roles/:id", auth.ensurePermission("custom_roles", "delete"), async (req: Request, res: Response) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }

      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }

      const deleted = await storage.deleteCustomRole(roleId);
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete custom role" });
      }

      res.status(204).end();
    } catch (error) {
      console.error("Error deleting custom role:", error);
      res.status(500).json({ message: "Error deleting custom role" });
    }
  });

  app.get("/api/custom-roles/:id/permissions", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }

      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }

      const permissions = await storage.getCustomRolePermissions(roleId);
      res.json(permissions);
    } catch (error) {
      console.error("Error fetching custom role permissions:", error);
      res.status(500).json({ message: "Error fetching custom role permissions" });
    }
  });

  app.post("/api/custom-roles/:id/permissions", auth.ensurePermission("custom_roles", "update"), async (req: Request, res: Response) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }

      const { resource, permissionType } = req.body;

      if (!resource || !permissionType) {
        return res.status(400).json({ message: "Resource and permissionType are required" });
      }

      const validResources = [
        "inventory",
        "purchases",
        "suppliers",
        "categories",
        "warehouses",
        "reports",
        "users",
        "settings",
        "reorder_requests",
        "stock_movements",
        "analytics",
        "dashboards",
        "notifications",
        "audit_logs",
        "user_profiles",
        "documents",
        "custom_roles",
        "activity_logs",
        "import_export",
        "system",
        "invoices",
        "billing",
        "taxes",
        "payments",
      ];

      const validPermissionTypes = [
        "create",
        "read",
        "update",
        "delete",
        "approve",
        "export",
        "import",
        "assign",
        "manage",
        "execute",
        "transfer",
        "print",
        "scan",
        "view_reports",
        "admin",
        "configure",
        "restrict",
        "download",
        "upload",
        "audit",
        "verify",
      ];

      if (!validResources.includes(resource)) {
        return res.status(400).json({ message: "Invalid resource" });
      }

      if (!validPermissionTypes.includes(permissionType)) {
        return res.status(400).json({ message: "Invalid permission type" });
      }

      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }

      const newPermission = await storage.addCustomRolePermission(roleId, resource, permissionType);
      res.status(201).json(newPermission);
    } catch (error) {
      console.error("Error adding permission to custom role:", error);
      res.status(500).json({ message: "Error adding permission to custom role" });
    }
  });

  app.delete(
    "/api/custom-roles/:roleId/permissions/:permissionId",
    auth.ensurePermission("custom_roles", "update"),
    async (req: Request, res: Response) => {
      try {
        const roleId = parseInt(req.params.roleId);
        const permissionId = parseInt(req.params.permissionId);

        if (isNaN(roleId) || isNaN(permissionId)) {
          return res.status(400).json({ message: "Invalid role ID or permission ID" });
        }

        const existingRole = await storage.getCustomRole(roleId);
        if (!existingRole) {
          return res.status(404).json({ message: "Custom role not found" });
        }

        const removed = await storage.removeCustomRolePermission(roleId, permissionId);
        if (!removed) {
          return res.status(404).json({ message: "Permission not found or already removed" });
        }

        res.status(204).end();
      } catch (error) {
        console.error("Error removing permission from custom role:", error);
        res.status(500).json({ message: "Error removing permission from custom role" });
      }
    },
  );

  app.get("/api/check-permission", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const { resource, permissionType } = req.query;

      if (!resource || !permissionType) {
        return res.status(400).json({ message: "Resource and permissionType are required" });
      }

      const user = req.user!;
      let hasPermission = false;

      if (user.role === "admin") {
        hasPermission = true;
      } else if (user.role === "custom") {
        const customRoleId = await storage.getUserCustomRoleId(user.id);
        if (customRoleId) {
          hasPermission = await storage.checkCustomRolePermission(
            customRoleId,
            resource as Resource,
            permissionType as PermissionType,
          );
        }
      } else {
        hasPermission = await storage.checkPermission(
          user.role as string,
          resource as string,
          permissionType as string,
        );
      }

      res.json({ hasPermission });
    } catch (error) {
      console.error("Error checking permission:", error);
      res.status(500).json({ message: "Error checking permission" });
    }
  });
}

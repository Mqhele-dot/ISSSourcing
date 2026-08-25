import type { Express, Request, RequestHandler, Response } from "express";
import { storage } from "../../storage";
import type { UserRole, Resource, PermissionType } from "@shared/schema";
import { getPermissionCatalogPayload } from "../../rbac/permission-catalog";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId, getOptionalTenantContext } from "../../organization-context";
import { appendAuditEvent, appendAuditEventWithClient } from "../../services/audit-chain-service";
import { db, pool } from "../../db";
import { approvalPolicies, organizationMembers, userApprovalLimits, users } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { EffectiveAccessResponse, EffectivePermission, RoleCatalogEntry } from "@shared/rbac-contracts";
import { governedApprovalEntityTypes, isGovernedApprovalEntityType } from "../../services/approval-workflow-service";
import { approvalWorkflowCatalog, navigationAccessCatalog, workflowBlueprintCatalog } from "@shared/authority-catalogs";

type AuthBundle = {
  ensureAuthenticated: RequestHandler;
  ensurePermission: (resource: string, permission: string) => RequestHandler;
  ensureTwoFactorAuthenticated: RequestHandler;
};

/**
 * System roles, custom roles, and permission checks — extracted from `routes.ts` orchestrator.
 */
export function registerRbacRoutes(app: Express, auth: AuthBundle): void {
  app.get(
    "/api/rbac/navigation-catalog",
    auth.ensureAuthenticated,
    auth.ensurePermission("users", "read"),
    (_req: Request, res: Response) => sendOk(res, { groups: navigationAccessCatalog }),
  );

  app.get(
    "/api/approval-workflows/catalog",
    auth.ensureAuthenticated,
    (_req: Request, res: Response) => sendOk(res, { items: approvalWorkflowCatalog }),
  );

  app.get(
    "/api/workflows/governance/summary",
    auth.ensureAuthenticated,
    auth.ensurePermission("users", "read"),
    async (_req: Request, res: Response) => {
      const organizationId = getActiveOrganizationId();
      const [policyResult, pendingResult, recentResult] = await Promise.all([
        pool.query(
          `SELECT count(*) FILTER (WHERE is_active)::int AS active_rules,
                  count(DISTINCT entity_type) FILTER (WHERE is_active)::int AS configured_workflows,
                  count(*) FILTER (WHERE is_active AND (approval_level > 1 OR amount_min >= 50000))::int AS high_risk_rules,
                  max(updated_at) AS last_rule_change,
                  coalesce((
                    SELECT jsonb_object_agg(grouped.entity_type, grouped.rule_count)
                    FROM (
                      SELECT entity_type, count(*)::int AS rule_count
                      FROM approval_policies
                      WHERE organization_id = $1 AND is_active
                      GROUP BY entity_type
                    ) grouped
                  ), '{}'::jsonb) AS rules_by_entity
           FROM approval_policies WHERE organization_id = $1`,
          [organizationId],
        ),
        pool.query(
          `WITH latest AS (
             SELECT DISTINCT ON (entity_type, entity_id)
                    entity_type, entity_id, action, new_status, performed_at, level
             FROM approval_history
             WHERE organization_id = $1
             ORDER BY entity_type, entity_id, performed_at DESC, id DESC
           )
           SELECT entity_type, entity_id, action, new_status, performed_at, level,
                  count(*) OVER()::int AS total,
                  count(*) FILTER (WHERE performed_at < now() - interval '48 hours') OVER()::int AS overdue
           FROM latest
           WHERE action = 'submitted' OR new_status IN ('submitted', 'pending_approval')
           ORDER BY performed_at ASC
           LIMIT 25`,
          [organizationId],
        ),
        pool.query(
          `SELECT ah.id, ah.entity_type, ah.entity_id, ah.action, ah.level, ah.comment,
                  ah.previous_status, ah.new_status, ah.performed_at,
                  coalesce(u.full_name, u.username, 'System') AS actor_name
           FROM approval_history ah
           LEFT JOIN users u ON u.id = ah.performed_by
           WHERE ah.organization_id = $1
           ORDER BY ah.performed_at DESC, ah.id DESC
           LIMIT 20`,
          [organizationId],
        ),
      ]);
      const policy = policyResult.rows[0] ?? {};
      const pendingRows = pendingResult.rows;
      return sendOk(res, {
        blueprints: workflowBlueprintCatalog,
        approvalCatalog: approvalWorkflowCatalog,
        metrics: {
          activeRules: Number(policy.active_rules ?? 0),
          configuredWorkflows: Number(policy.configured_workflows ?? 0),
          governedWorkflows: approvalWorkflowCatalog.filter((item) => item.active).length,
          pendingApprovals: Number(pendingRows[0]?.total ?? 0),
          overdueApprovals: Number(pendingRows[0]?.overdue ?? 0),
          highRiskRules: Number(policy.high_risk_rules ?? 0),
          lastRuleChange: policy.last_rule_change ?? null,
        },
        rulesByEntity: policy.rules_by_entity ?? {},
        pending: pendingRows.map((row) => ({
          entityType: row.entity_type, entityId: Number(row.entity_id), action: row.action,
          status: row.new_status, level: Number(row.level ?? 1), submittedAt: row.performed_at,
          overdue: new Date(row.performed_at).getTime() < Date.now() - 48 * 60 * 60 * 1000,
        })),
        recentActions: recentResult.rows.map((row) => ({
          id: Number(row.id), entityType: row.entity_type, entityId: Number(row.entity_id),
          action: row.action, level: Number(row.level ?? 1), comment: row.comment,
          previousStatus: row.previous_status, newStatus: row.new_status,
          performedAt: row.performed_at, actorName: row.actor_name,
        })),
      });
    },
  );

  const systemRoleDescriptions: Record<string, string> = {
    admin: "Full organization administration and operational access",
    manager: "Operational management, approvals, reporting, and supplier oversight",
    planner: "Procurement planning and purchase-order execution",
    warehouse_staff: "Warehouse, receiving, counting, and stock movement execution",
    sales: "Commercial read access and order-oriented workflows",
    auditor: "Read-only operational, audit, and reporting access",
    supplier: "Assigned supplier portal and purchase-order access",
    viewer: "Read-only access to permitted operational areas",
  };

  const permissionShape = (rows: Array<{ resource: unknown; permissionType: unknown }>): EffectivePermission[] =>
    rows.map((row) => ({ resource: String(row.resource), permissionType: String(row.permissionType) }));

  async function organizationUsers() {
    const orgId = getActiveOrganizationId();
    return db
      .select({
        id: users.id,
        role: users.role,
        preferences: users.preferences,
      })
      .from(users)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, users.id),
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.active, true),
        ),
      );
  }

  async function buildRoleCatalog(): Promise<RoleCatalogEntry[]> {
    const [systemRoles, customRoleRows, members] = await Promise.all([
      storage.getSystemRoles(),
      storage.getCustomRoles(),
      organizationUsers(),
    ]);
    const systemEntries = await Promise.all(
      systemRoles.map(async (key): Promise<RoleCatalogEntry> => ({
        ref: { kind: "system", key },
        name: key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        description: systemRoleDescriptions[key] ?? "System-defined application role",
        active: true,
        assignedUserCount: members.filter((member) => String(member.role) === key).length,
        permissions: permissionShape(await storage.getRolePermissions(key as UserRole)),
        navigationPaths: null,
      })),
    );
    const customEntries = await Promise.all(
      customRoleRows.map(async (role): Promise<RoleCatalogEntry> => ({
        ref: { kind: "custom", id: role.id },
        name: role.name,
        description: role.description ?? "Organization-defined custom role",
        active: role.isActive !== false,
        assignedUserCount: members.filter((member) => {
          const preferences = member.preferences && typeof member.preferences === "object"
            ? member.preferences as { customRoleId?: unknown }
            : null;
          return String(member.role) === "custom" && Number(preferences?.customRoleId) === role.id;
        }).length,
        permissions: permissionShape(await storage.getCustomRolePermissions(role.id)),
        navigationPaths: null,
      })),
    );
    return [...systemEntries, ...customEntries];
  }

  app.get(
    "/api/rbac/roles/catalog",
    auth.ensureAuthenticated,
    auth.ensurePermission("users", "read"),
    async (_req: Request, res: Response) => {
      try {
        return sendOk(res, { roles: await buildRoleCatalog() });
      } catch (error) {
        return sendError(res, 500, "ROLE_CATALOG_FAILED", "Failed to load the authoritative role catalog", {
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  app.get(
    "/api/rbac/users/:id/effective-access",
    auth.ensureAuthenticated,
    auth.ensurePermission("users", "read"),
    async (req: Request, res: Response) => {
      try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
          return sendError(res, 400, "INVALID_USER_ID", "User ID must be a positive integer");
        }
        const member = (await organizationUsers()).find((candidate) => candidate.id === userId);
        if (!member) return sendError(res, 404, "USER_NOT_FOUND", "User is not available in this organization");
        const catalog = await buildRoleCatalog();
        const preferences = member.preferences && typeof member.preferences === "object"
          ? member.preferences as { customRoleId?: unknown; allowedNavPaths?: unknown }
          : null;
        const customRoleId = Number(preferences?.customRoleId);
        const role = String(member.role) === "custom" && Number.isInteger(customRoleId) && customRoleId > 0
          ? catalog.find((entry) => entry.ref.kind === "custom" && entry.ref.id === customRoleId) ?? null
          : catalog.find((entry) => entry.ref.kind === "system" && entry.ref.key === String(member.role)) ?? null;
        const navigationPaths = Array.isArray(preferences?.allowedNavPaths)
          ? preferences.allowedNavPaths.filter((path): path is string => typeof path === "string")
          : null;
        const payload: EffectiveAccessResponse = {
          userId,
          role,
          permissions: role?.permissions ?? [],
          navigationPaths,
        };
        return sendOk(res, payload);
      } catch (error) {
        return sendError(res, 500, "EFFECTIVE_ACCESS_FAILED", "Failed to load effective user access", {
          details: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  app.get(
    "/api/rbac/users/:id/approval-limits",
    auth.ensureAuthenticated,
    auth.ensurePermission("users", "read"),
    async (req: Request, res: Response) => {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId <= 0) return sendError(res, 400, "INVALID_USER_ID", "User ID must be a positive integer");
      const member = (await organizationUsers()).find((candidate) => candidate.id === userId);
      if (!member) return sendError(res, 404, "USER_NOT_FOUND", "User is not available in this organization");
      const rows = await db.select().from(userApprovalLimits).where(and(
        eq(userApprovalLimits.organizationId, getActiveOrganizationId()),
        eq(userApprovalLimits.userId, userId),
      ));
      const byEntity = new Map(rows.map((row) => [row.entityType, row]));
      return sendOk(res, {
        userId,
        limits: governedApprovalEntityTypes.map((entityType) => {
          const row = byEntity.get(entityType);
          return {
            entityType,
            amountLimit: row?.amountLimit == null ? null : Number(row.amountLimit),
            currencyCode: row?.currencyCode ?? "ZAR",
            updatedAt: row?.updatedAt ?? null,
          };
        }),
      });
    },
  );

  app.put(
    "/api/rbac/users/:id/approval-limits",
    auth.ensureAuthenticated,
    auth.ensureTwoFactorAuthenticated,
    auth.ensurePermission("users", "update"),
    async (req: Request, res: Response) => {
      const userId = Number(req.params.id);
      const actorUserId = Number(req.user?.id);
      if (!Number.isInteger(userId) || userId <= 0) return sendError(res, 400, "INVALID_USER_ID", "User ID must be a positive integer");
      const member = (await organizationUsers()).find((candidate) => candidate.id === userId);
      if (!member) return sendError(res, 404, "USER_NOT_FOUND", "User is not available in this organization");
      const supplied = Array.isArray(req.body?.limits) ? req.body.limits : null;
      const reason = String(req.body?.reason ?? "").trim();
      if (!supplied) return sendError(res, 400, "APPROVAL_LIMITS_REQUIRED", "Provide an approval limits array");
      if (reason.length < 5) return sendError(res, 400, "CHANGE_REASON_REQUIRED", "Explain why the approval authority is changing (at least 5 characters)");
      const normalized: Array<{ entityType: string; amountLimit: number | null; currencyCode: string }> = supplied.map((entry: any) => ({
        entityType: String(entry?.entityType ?? ""),
        amountLimit: entry?.amountLimit == null || entry?.amountLimit === "" ? null : Number(entry.amountLimit),
        currencyCode: String(entry?.currencyCode ?? "ZAR").trim().toUpperCase(),
      }));
      if (normalized.some((entry) => !isGovernedApprovalEntityType(entry.entityType))) {
        return sendError(res, 400, "APPROVAL_ENTITY_INVALID", "One or more approval workflow types are invalid");
      }
      if (new Set(normalized.map((entry) => entry.entityType)).size !== normalized.length) {
        return sendError(res, 400, "APPROVAL_ENTITY_DUPLICATE", "Each approval workflow may appear only once");
      }
      if (normalized.some((entry) => entry.amountLimit != null && (!Number.isFinite(entry.amountLimit) || entry.amountLimit < 0))) {
        return sendError(res, 400, "APPROVAL_LIMIT_INVALID", "Approval limits must be non-negative numbers or blank for unlimited");
      }
      if (normalized.some((entry) => !/^[A-Z]{3}$/.test(entry.currencyCode))) {
        return sendError(res, 400, "APPROVAL_CURRENCY_INVALID", "Approval-limit currency codes must be three-letter ISO codes");
      }
      const organizationId = getActiveOrganizationId();
      const before = await db.select().from(userApprovalLimits).where(and(
        eq(userApprovalLimits.organizationId, organizationId),
        eq(userApprovalLimits.userId, userId),
      ));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const entry of normalized) {
          await client.query(
            `INSERT INTO user_approval_limits (organization_id, user_id, entity_type, amount_limit, currency_code, updated_by, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (organization_id, user_id, entity_type)
             DO UPDATE SET amount_limit = EXCLUDED.amount_limit, currency_code = EXCLUDED.currency_code,
                           updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [organizationId, userId, entry.entityType, entry.amountLimit, entry.currencyCode, actorUserId],
          );
        }
        const requisitionLimit = normalized.find((entry) => entry.entityType === "requisition");
        if (requisitionLimit) {
          await client.query("UPDATE users SET approver_amount_limit = $1, updated_at = NOW() WHERE id = $2", [requisitionLimit.amountLimit, userId]);
        }
        await appendAuditEventWithClient(client, {
          organizationId,
          actor: { userId: actorUserId },
          action: "USER_APPROVAL_LIMITS_UPDATED",
          resourceType: "user_approval_authority",
          resourceId: userId,
          before: before.map((row) => ({ entityType: row.entityType, amountLimit: row.amountLimit, currencyCode: row.currencyCode })),
          after: normalized,
          reason,
          requestId: String(res.locals.requestId ?? "unknown-request-id"),
          ipAddress: req.ip,
          userAgent: req.get("user-agent") ?? null,
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return sendOk(res, { userId, limits: normalized });
    },
  );

  app.get(
    "/api/rbac/users/:id/governance-events",
    auth.ensureAuthenticated,
    auth.ensurePermission("users", "read"),
    async (req: Request, res: Response) => {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId <= 0) return sendError(res, 400, "INVALID_USER_ID", "User ID must be a positive integer");
      const member = (await organizationUsers()).find((candidate) => candidate.id === userId);
      if (!member) return sendError(res, 404, "USER_NOT_FOUND", "User is not available in this organization");
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = [10, 25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
      const organizationId = getActiveOrganizationId();
      const result = await pool.query(
        `WITH governed AS (
           SELECT al.id, al.created_at, 'change'::text AS event_kind, al.action,
                  al.resource_type AS entity_type, al.resource_id::text AS entity_id,
                  al.user_id, u.full_name, u.username, al.reason,
                  CASE WHEN COALESCE(al.details->>'approvalLevel', '') ~ '^[0-9]+$'
                       THEN (al.details->>'approvalLevel')::integer ELSE NULL END AS approval_level,
                  al.details->'before' AS before_state, al.details->'after' AS after_state,
                  al.request_id, al.event_hash
           FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
           WHERE al.organization_id = $1 AND (
             al.user_id = $2
             OR (al.resource_type = 'user_approval_authority' AND al.resource_id::text = $2::text)
             OR COALESCE(al.details->'before'->>'userId', al.details->'after'->>'userId') = $2::text
           )
           UNION ALL
           SELECT ah.id, ah.performed_at, 'approval'::text, ah.action,
                  ah.entity_type, ah.entity_id::text, ah.performed_by, u.full_name, u.username,
                  ah.comment, ah.level, jsonb_build_object('status', ah.previous_status),
                  jsonb_build_object('status', ah.new_status), NULL::text, NULL::text
           FROM approval_history ah LEFT JOIN users u ON u.id = ah.performed_by
           WHERE ah.organization_id = $1 AND ah.performed_by = $2
         )
         SELECT *, count(*) OVER()::int AS total
         FROM governed
         ORDER BY created_at DESC, id DESC
         LIMIT $3 OFFSET $4`,
        [organizationId, userId, pageSize, (page - 1) * pageSize],
      );
      const total = Number(result.rows[0]?.total ?? 0);
      return sendOk(res, {
        items: result.rows.map((row) => ({
          id: Number(row.id), createdAt: row.created_at, eventKind: row.event_kind, action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id != null && /^\d+$/.test(String(row.entity_id)) ? Number(row.entity_id) : null,
          actorUserId: Number(row.user_id), actorName: row.full_name ?? row.username ?? `User #${row.user_id}`,
          reason: row.reason, approvalLevel: row.approval_level == null ? null : Number(row.approval_level),
          before: row.before_state, after: row.after_state, requestId: row.request_id,
          integrityHash: row.event_hash,
        })),
        total, page, pageSize, hasNext: page * pageSize < total,
      });
    },
  );
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

      const activeRole = getOptionalTenantContext()?.userRole ?? user.role;
      if (activeRole === "custom") {
        customRoleId = (await storage.getUserCustomRoleId(user.id)) ?? undefined;
      }

      for (const resource of resources) {
        permissions[resource] = {};
        for (const permissionType of permissionTypes) {
          const hasSystemPermission =
            activeRole === "admin" ||
            (await storage.checkPermission(activeRole as string, resource, permissionType));
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
        role: activeRole,
        customRoleId: customRoleId ?? null,
        permissions,
        navigationPaths:
          user.preferences && typeof user.preferences === "object" && Array.isArray((user.preferences as { allowedNavPaths?: unknown }).allowedNavPaths)
            ? (user.preferences as { allowedNavPaths: unknown[] }).allowedNavPaths.filter((path): path is string => typeof path === "string")
            : null,
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

  app.get("/api/roles", auth.ensureAuthenticated, auth.ensurePermission("custom_roles", "read"), async (_req: Request, res: Response) => {
    try {
      const roles = await storage.getSystemRoles();
      res.json(roles);
    } catch (error) {
      console.error("Error fetching system roles:", error);
      res.status(500).json({ message: "Error fetching system roles" });
    }
  });

  app.get("/api/roles/:role/permissions", auth.ensureAuthenticated, auth.ensurePermission("custom_roles", "read"), async (req: Request, res: Response) => {
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

  app.post("/api/custom-roles", auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("custom_roles", "create"), async (req: Request, res: Response) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const description = typeof req.body?.description === "string" ? req.body.description.trim() || null : null;
      const isActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : true;

      if (name.length < 3) {
        return sendError(res, 400, "CUSTOM_ROLE_NAME_INVALID", "Role name must contain at least three characters.");
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

      await appendAuditEvent({
        organizationId: getActiveOrganizationId(),
        actor: { userId: req.user!.id },
        action: "CUSTOM_ROLE_CREATED",
        resourceType: "custom_role",
        resourceId: newRole.id,
        after: newRole,
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });

      res.status(201).json(newRole);
    } catch (error) {
      console.error("Error creating custom role:", error);
      res.status(500).json({ message: "Error creating custom role" });
    }
  });

  app.put("/api/custom-roles/:id", auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("custom_roles", "update"), async (req: Request, res: Response) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }

      const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
      const description = typeof req.body?.description === "string" ? req.body.description.trim() || null : undefined;
      const isActive = typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined;

      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      if (existingRole.isSystemRole) {
        return sendError(res, 400, "SYSTEM_ROLE_IMMUTABLE", "System roles cannot be modified through custom-role controls.");
      }
      if (name !== undefined && name.length < 3) {
        return sendError(res, 400, "CUSTOM_ROLE_NAME_INVALID", "Role name must contain at least three characters.");
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

      await appendAuditEvent({
        organizationId: getActiveOrganizationId(),
        actor: { userId: req.user!.id },
        action: "CUSTOM_ROLE_UPDATED",
        resourceType: "custom_role",
        resourceId: roleId,
        before: existingRole,
        after: updatedRole,
        reason: typeof req.body?.reason === "string" ? req.body.reason : null,
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });

      res.json(updatedRole);
    } catch (error) {
      console.error("Error updating custom role:", error);
      res.status(500).json({ message: "Error updating custom role" });
    }
  });

  app.delete("/api/custom-roles/:id", auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("custom_roles", "delete"), async (req: Request, res: Response) => {
    try {
      const roleId = parseInt(req.params.id);
      if (isNaN(roleId)) {
        return res.status(400).json({ message: "Invalid role ID" });
      }

      const existingRole = await storage.getCustomRole(roleId);
      if (!existingRole) {
        return res.status(404).json({ message: "Custom role not found" });
      }
      if (existingRole.isSystemRole) {
        return sendError(res, 400, "SYSTEM_ROLE_IMMUTABLE", "System roles cannot be deleted.");
      }
      if (existingRole.isActive !== false) {
        return sendError(res, 409, "CUSTOM_ROLE_ACTIVE", "Deactivate this custom role before deleting it.");
      }
      const assignedUsers = (await storage.getAllUsers()).filter((user) => {
        const preferences = user.preferences && typeof user.preferences === "object"
          ? user.preferences as { customRoleId?: unknown }
          : null;
        return Number(preferences?.customRoleId) === roleId;
      });
      if (assignedUsers.length > 0) {
        return sendError(res, 409, "CUSTOM_ROLE_ASSIGNED", "Remove this role from every profile before deleting it.", {
          details: { assignedProfiles: assignedUsers.length },
        });
      }
      const referencedPolicies = await db
        .select({ id: approvalPolicies.id })
        .from(approvalPolicies)
        .where(
          and(
            eq(approvalPolicies.organizationId, getActiveOrganizationId()),
            eq(approvalPolicies.approverRole, `custom:${roleId}`),
          ),
        );
      if (referencedPolicies.length > 0) {
        return sendError(res, 409, "CUSTOM_ROLE_REFERENCED", "Reassign approval policies before deleting this role.", {
          details: { approvalPolicies: referencedPolicies.length },
        });
      }

      const deleted = await storage.deleteCustomRole(roleId);
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete custom role" });
      }

      await appendAuditEvent({
        organizationId: getActiveOrganizationId(),
        actor: { userId: req.user!.id },
        action: "CUSTOM_ROLE_DELETED",
        resourceType: "custom_role",
        resourceId: roleId,
        before: existingRole,
        reason: typeof req.body?.reason === "string" ? req.body.reason : null,
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
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

  app.post("/api/custom-roles/:id/permissions", auth.ensureAuthenticated, auth.ensureTwoFactorAuthenticated, auth.ensurePermission("custom_roles", "update"), async (req: Request, res: Response) => {
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
      await appendAuditEvent({
        organizationId: getActiveOrganizationId(),
        actor: { userId: req.user!.id },
        action: "CUSTOM_ROLE_PERMISSION_ADDED",
        resourceType: "custom_role",
        resourceId: roleId,
        after: { resource, permissionType, permissionId: newPermission.id },
        requestId: String(res.locals.requestId ?? "unknown-request-id"),
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
      res.status(201).json(newPermission);
    } catch (error) {
      console.error("Error adding permission to custom role:", error);
      res.status(500).json({ message: "Error adding permission to custom role" });
    }
  });

  app.delete(
    "/api/custom-roles/:roleId/permissions/:permissionId",
    auth.ensureAuthenticated,
    auth.ensureTwoFactorAuthenticated,
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
          return res.status(200).json({
            ok: true,
            data: {
              roleId,
              permissionId,
              removed: false,
              alreadyRemoved: true,
            },
          });
        }

        res.status(200).json({
          ok: true,
          data: {
            roleId,
            permissionId,
            removed: true,
            alreadyRemoved: false,
          },
        });
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

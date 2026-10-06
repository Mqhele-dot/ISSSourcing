import type { Express, Request, Response } from "express";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { sendEmail } from "../../services/email-service";
import { notifications, notificationPreferences, organizationMembers, users } from "@shared/schema";
import type { AuthBundle } from "../procurement/types";
import { z } from "zod";
import { storage } from "../../storage";

const notificationPreferencesPatch = z.object({
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  lowStock: z.boolean().optional(),
  approvalRequest: z.boolean().optional(),
  contractExpiry: z.boolean().optional(),
  shipmentDelay: z.boolean().optional(),
  dailyDigestEnabled: z.boolean().optional(),
  reminderEnabled: z.boolean().optional(),
}).strict();

/** User notifications, preferences, and admin send. */
export function registerNotificationRoutes(app: Express, auth: AuthBundle): void {
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];
  const allowedEntityTypes = async (organizationId: number, userId: number): Promise<string[] | null> => {
    const [member] = await db.select({ role: organizationMembers.applicationRole }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId), eq(organizationMembers.active, true))).limit(1);
    if (!member) return [];
    const role = String(member.role).toLowerCase();
    if (role === "admin") return null;
    const customRoleId = role === "custom" ? await storage.getUserCustomRoleId(userId) : null;
    const has = async (resource: string, permission = "read") => await storage.checkPermission(role, resource, permission)
      || Boolean(customRoleId && await storage.checkCustomRolePermission(customRoleId, resource as never, permission as never));
    return [
      ...((await has("purchases")) || (await has("purchases", "approve")) ? ["requisition", "purchase_order", "contract", "receipt"] : []),
      ...((await has("invoices")) || (await has("invoices", "approve")) ? ["invoice", "capture", "payment_batch", "match_result"] : []),
      ...(await has("inventory") ? ["inventory", "inventory_item", "stock", "shipment", "gas_asset_profile"] : []),
      ...(await has("suppliers") ? ["supplier"] : []),
    ];
  };

  app.get("/api/v2/action-inbox", ...masterRead, async (req: Request, res: Response) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 25);
    const state = String(req.query.state ?? "active");
    if (!Number.isSafeInteger(page) || page < 1 || ![25, 50, 100].includes(pageSize) || !["active", "history", "all"].includes(state))
      return sendError(res, 400, "ACTION_INBOX_QUERY_INVALID", "Choose a valid page, size, and view.");
    const org = getActiveOrganizationId();
    const userId = Number(req.user?.id);
    try {
      const entityTypes = await allowedEntityTypes(org, userId);
      const canReadInventory = entityTypes === null || entityTypes.includes("inventory");
      const base = `WITH inbox AS (SELECT ('notification:'||n.id) AS id,n.title,n.body,n.type,n.entity_type AS "entityType",n.entity_id AS "entityId",
        n.target_path AS "targetPath",n.priority,n.due_at AS "dueAt",n.read_at AS "readAt",n.archived_at AS "archivedAt",
        n.last_occurred_at AS "lastOccurredAt",n.occurrence_count AS "occurrenceCount",
        CASE WHEN n.entity_type IN ('purchase_requisition','inventory_item') AND n.entity_id IS NULL THEN 'information'
          WHEN n.type='approval_request' AND n.title ILIKE '%approved%' THEN 'information'
          WHEN n.entity_type='requisition' AND r.id IS NOT NULL AND upper(r.status) NOT IN ('PENDING','PENDING_APPROVAL','SUBMITTED') THEN 'completed'
          WHEN n.entity_type='purchase_order' AND po.id IS NOT NULL AND upper(po.approval_status) NOT IN ('PENDING','PENDING_APPROVAL','SUBMITTED') AND lower(n.type) LIKE '%approval%' THEN 'completed'
          WHEN n.entity_type='invoice' AND inv.id IS NOT NULL AND lower(n.type) LIKE '%pending_approval%' AND upper(inv.status::text)<>'PENDING_APPROVAL' THEN 'completed'
          WHEN n.entity_type IN ('inventory','inventory_item','stock') AND item.id IS NOT NULL AND lower(n.type) LIKE '%low_stock%'
            AND item.quantity>coalesce(item.low_stock_threshold,0) THEN 'completed'
          WHEN lower(n.type) LIKE '%approved%' OR lower(n.type) LIKE '%rejected%' THEN 'information'
          WHEN n.archived_at IS NOT NULL AND n.entity_type IS NULL THEN 'cleared'
          ELSE 'open' END AS state
        FROM notifications n
        LEFT JOIN purchase_requisitions r ON n.entity_type='requisition' AND r.organization_id=n.organization_id AND r.id=n.entity_id
        LEFT JOIN purchase_orders po ON n.entity_type='purchase_order' AND po.organization_id=n.organization_id AND po.id=n.entity_id
        LEFT JOIN invoices inv ON n.entity_type='invoice' AND inv.organization_id=n.organization_id AND inv.id=n.entity_id
        LEFT JOIN inventory_items item ON n.entity_type IN ('inventory','inventory_item','stock') AND item.organization_id=n.organization_id AND item.id=n.entity_id
        WHERE n.organization_id=$1 AND n.user_id=$2 AND ($3::text[] IS NULL OR n.entity_type IS NULL OR n.entity_type=ANY($3::text[]))
        UNION ALL
        SELECT ('putaway:'||t.id),('Put-away '||t.task_number),
          ('Place '||t.quantity::text||' '||i.name||' in '||w.name),'assigned_putaway',
          'inventory',t.item_id,'/inventory/put-away',lower(t.priority),t.due_at,
          NULL::timestamp,NULL::timestamp,t.updated_at,1,
          CASE WHEN t.status IN ('COMPLETED','CANCELLED') THEN 'completed' ELSE 'open' END
        FROM inventory_putaway_tasks t
        JOIN inventory_items i ON i.id=t.item_id AND i.organization_id=t.organization_id
        JOIN warehouses w ON w.id=t.warehouse_id AND w.organization_id=t.organization_id
        WHERE t.organization_id=$1 AND t.assigned_user_id=$2 AND $4::boolean)`;
      const filter = state === "all" ? "" : ` WHERE state ${state === "active" ? "=" : "<>"} 'open'`;
      const params = [org, userId, entityTypes, canReadInventory];
      const count = await pool.query(`${base} SELECT count(*)::int AS total FROM inbox${filter}`, params);
      const items = await pool.query(`${base} SELECT * FROM inbox${filter} ORDER BY "dueAt" ASC NULLS LAST,"lastOccurredAt" DESC,id DESC LIMIT $5 OFFSET $6`, [...params, pageSize, (page - 1) * pageSize]);
      const total = Number(count.rows[0]?.total ?? 0);
      return sendOk(res, { items: items.rows, total, page, pageSize, hasNext: page * pageSize < total });
    } catch (error) {
      console.error("Action inbox failed:", error);
      return sendError(res, 500, "ACTION_INBOX_FAILED", "Could not load your action inbox. Please retry.");
    }
  });

  app.get("/api/notifications", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return sendError(res, 401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
      const organizationId = getActiveOrganizationId();
      const entityTypes = await allowedEntityTypes(organizationId, userId);
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
      const offset = (page - 1) * pageSize;
      const [preferences] = await db.select({ inAppEnabled: notificationPreferences.inAppEnabled })
        .from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
      if (preferences?.inAppEnabled === false) {
        return sendOk(res, { items: [], total: 0, unreadCount: 0, page, pageSize, hasNext: false });
      }
      const counts = await pool.query(
        `SELECT count(*)::integer AS total,
                count(*) FILTER (WHERE read_at IS NULL)::integer AS "unreadCount"
         FROM notifications
         WHERE organization_id = $1 AND user_id = $2 AND archived_at IS NULL
           AND ($3::text[] IS NULL OR entity_type IS NULL OR entity_type=ANY($3::text[]))`,
        [organizationId, userId, entityTypes],
      );
      const result = await pool.query(
        `
          SELECT
            id,
            type,
            title,
            body,
            entity_type AS "entityType",
            entity_id AS "entityId",
            occurrence_count AS "occurrenceCount",
            last_occurred_at AS "lastOccurredAt",
            read_at AS "readAt",
            created_at AS "createdAt",
            archived_at AS "archivedAt"
            ,target_path AS "targetPath", finding_code AS "findingCode", due_at AS "dueAt", priority
          FROM notifications
          WHERE organization_id = $1 AND user_id = $2 AND archived_at IS NULL
            AND ($5::text[] IS NULL OR entity_type IS NULL OR entity_type=ANY($5::text[]))
          ORDER BY last_occurred_at DESC, id DESC
          LIMIT $3 OFFSET $4
        `,
        [organizationId, userId, pageSize, offset, entityTypes],
      );
      const total = Number(counts.rows[0]?.total ?? 0);
      const unreadCount = Number(counts.rows[0]?.unreadCount ?? 0);
      return sendOk(res, {
        items: result.rows,
        total,
        unreadCount,
        page,
        pageSize,
        hasNext: offset + result.rows.length < total,
      });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      return sendError(res, 500, "NOTIFICATION_LIST_FAILED", "Failed to fetch notifications.");
    }
  });

  app.post("/api/notifications/:id/read", ...masterRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return sendError(res, 401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
      if (isNaN(id)) return sendError(res, 400, "NOTIFICATION_ID_INVALID", "Invalid notification ID.");
      const updatedRows = (await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.userId, userId),
            eq(notifications.organizationId, getActiveOrganizationId()),
            isNull(notifications.archivedAt),
          ),
        )
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return sendError(res, 404, "NOTIFICATION_NOT_FOUND", "Notification not found.");
      return sendOk(res, updated);
    } catch (error) {
      console.error("Error marking notification read:", error);
      return sendError(res, 500, "NOTIFICATION_UPDATE_FAILED", "Failed to update notification.");
    }
  });

  app.post("/api/notifications/mark-all-read", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return sendError(res, 401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
      const updated = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.organizationId, getActiveOrganizationId()),
            isNull(notifications.archivedAt),
          ),
        )
        .returning({ id: notifications.id });
      return sendOk(res, { updated: updated.length });
    } catch (error) {
      console.error("Error marking notifications read:", error);
      return sendError(res, 500, "NOTIFICATIONS_MARK_ALL_FAILED", "Failed to mark notifications as read.");
    }
  });

  app.post("/api/notifications/:id/archive", ...masterRead, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const userId = (req as Request & { user?: { id: number } }).user?.id;
    if (!userId) return sendError(res, 401, "AUTHENTICATION_REQUIRED", "Please sign in to manage notifications.");
    if (!Number.isSafeInteger(id) || id <= 0) return sendError(res, 400, "NOTIFICATION_ID_INVALID", "Select a valid notification.");
    try {
      const archived = await db.update(notifications)
        .set({ archivedAt: new Date(), readAt: new Date() })
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId), eq(notifications.organizationId, getActiveOrganizationId()), isNull(notifications.archivedAt)))
        .returning({ id: notifications.id });
      if (!archived[0]) return sendError(res, 404, "NOTIFICATION_NOT_FOUND", "This notification is no longer in your inbox.");
      return sendOk(res, { archived: true });
    } catch (error) {
      console.error("Error archiving notification:", error);
      return sendError(res, 500, "NOTIFICATION_ARCHIVE_FAILED", "Could not clear this notification. Please try again.");
    }
  });

  app.post("/api/notifications/archive-read", ...masterRead, async (req: Request, res: Response) => {
    const userId = (req as Request & { user?: { id: number } }).user?.id;
    if (!userId) return sendError(res, 401, "AUTHENTICATION_REQUIRED", "Please sign in to manage notifications.");
    try {
      const archived = await db.update(notifications)
        .set({ archivedAt: new Date() })
        .where(and(eq(notifications.userId, userId), eq(notifications.organizationId, getActiveOrganizationId()), isNull(notifications.archivedAt), isNotNull(notifications.readAt)))
        .returning({ id: notifications.id });
      return sendOk(res, { archived: archived.length });
    } catch (error) {
      console.error("Error clearing read notifications:", error);
      return sendError(res, 500, "NOTIFICATION_ARCHIVE_FAILED", "Could not clear read notifications. Please try again.");
    }
  });

  app.get("/api/notification-preferences", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const prefRows = (await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId))) as any[];
      const prefs = prefRows[0];
      if (!prefs) {
        const createdRows = (await db
          .insert(notificationPreferences)
          .values({ userId } as any)
          .returning()) as any[];
        const created = createdRows[0];
        return res.json(created);
      }
      res.json(prefs);
    } catch (error) {
      console.error("Error fetching notification preferences:", error);
      res.status(500).json({ message: "Failed to fetch notification preferences" });
    }
  });

  app.patch("/api/notification-preferences", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const parsed = notificationPreferencesPatch.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, "NOTIFICATION_PREFERENCES_INVALID", "Choose valid notification settings and try again.");
      const existingRows = (await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId))) as any[];
      const existing = existingRows[0];
      if (!existing) {
        const createdRows = (await db
          .insert(notificationPreferences)
          .values({ userId, ...parsed.data } as any)
          .returning()) as any[];
        const created = createdRows[0];
        return res.json(created);
      }
      const updatedRows = (await db
        .update(notificationPreferences)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(notificationPreferences.userId, userId))
        .returning()) as any[];
      const updated = updatedRows[0];
      res.json(updated);
    } catch (error) {
      console.error("Error updating notification preferences:", error);
      res.status(500).json({ message: "Failed to update notification preferences" });
    }
  });

  app.post("/api/notifications/send", ...masterWrite, async (req: Request, res: Response) => {
    try {
      const payload = req.body as {
        userId: number;
        type: string;
        title: string;
        body?: string;
        entityType?: string;
        entityId?: number;
      };
      if (!payload?.userId || !payload?.type || !payload?.title) {
        return sendError(res, 400, "NOTIFICATION_INPUT_INVALID", "userId, type and title are required.");
      }
      const targetMembership = await db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, getActiveOrganizationId()),
            eq(organizationMembers.userId, payload.userId),
            eq(organizationMembers.active, true),
          ),
        )
        .limit(1);
      if (!targetMembership[0]) {
        return sendError(
          res,
          404,
          "NOTIFICATION_RECIPIENT_NOT_FOUND",
          "The notification recipient is not an active member of this organization.",
        );
      }
      const createdRows = (await db
        .insert(notifications)
        .values({
          organizationId: getActiveOrganizationId(),
          userId: payload.userId,
          type: payload.type,
          title: payload.title,
          body: payload.body ?? null,
          entityType: payload.entityType ?? null,
          entityId: payload.entityId ?? null,
        } as any)
        .returning()) as any[];
      const created = createdRows[0];

      const prefRows = (await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, payload.userId))) as any[];
      const prefs = prefRows[0];
      const userRows = (await db.select().from(users).where(eq(users.id, payload.userId))) as any[];
      const user = userRows[0];

      if (user?.email && prefs?.emailEnabled !== false) {
        await sendEmail({
          to: user.email,
          subject: payload.title,
          html: `<p>${payload.body ?? ""}</p>`,
          text: payload.body ?? payload.title,
        }).catch(() => {});
      }
      if (prefs?.smsEnabled === true) {
        console.log("[sms-hook]", "send", { userId: payload.userId, title: payload.title });
      }

      res.status(201).json(created);
    } catch (error) {
      console.error("Error sending notification:", error);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });
}

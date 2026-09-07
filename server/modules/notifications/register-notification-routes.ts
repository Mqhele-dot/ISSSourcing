import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { sendEmail } from "../../services/email-service";
import { notifications, notificationPreferences, organizationMembers, users } from "@shared/schema";
import type { AuthBundle } from "../procurement/types";

/** User notifications, preferences, and admin send. */
export function registerNotificationRoutes(app: Express, auth: AuthBundle): void {
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/notifications", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return sendError(res, 401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
      const organizationId = getActiveOrganizationId();
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
      const offset = (page - 1) * pageSize;
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
            COUNT(*) OVER()::integer AS "total",
            COUNT(*) FILTER (WHERE read_at IS NULL) OVER()::integer AS "unreadCount"
          FROM notifications
          WHERE organization_id = $1 AND user_id = $2
          ORDER BY last_occurred_at DESC, id DESC
          LIMIT $3 OFFSET $4
        `,
        [organizationId, userId, pageSize, offset],
      );
      const total = Number(result.rows[0]?.total ?? 0);
      const unreadCount = Number(result.rows[0]?.unreadCount ?? 0);
      return sendOk(res, {
        items: result.rows.map(({ total: _total, unreadCount: _unreadCount, ...row }) => row),
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
          ),
        )
        .returning({ id: notifications.id });
      return sendOk(res, { updated: updated.length });
    } catch (error) {
      console.error("Error marking notifications read:", error);
      return sendError(res, 500, "NOTIFICATIONS_MARK_ALL_FAILED", "Failed to mark notifications as read.");
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
      const existingRows = (await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId))) as any[];
      const existing = existingRows[0];
      if (!existing) {
        const createdRows = (await db
          .insert(notificationPreferences)
          .values({ userId, ...(req.body || {}) } as any)
          .returning()) as any[];
        const created = createdRows[0];
        return res.json(created);
      }
      const updatedRows = (await db
        .update(notificationPreferences)
        .set(req.body || {})
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

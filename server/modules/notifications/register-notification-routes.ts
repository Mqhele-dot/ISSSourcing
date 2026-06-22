import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import { sendEmail } from "../../services/email-service";
import { notifications, notificationPreferences, users } from "@shared/schema";
import type { AuthBundle } from "../procurement/types";

/** User notifications, preferences, and admin send. */
export function registerNotificationRoutes(app: Express, auth: AuthBundle): void {
  const masterRead = [auth.ensureAuthenticated];
  const masterWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/notifications", ...masterRead, async (req: Request, res: Response) => {
    try {
      const userId = (req as Request & { user?: { id: number } }).user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.post("/api/notifications/:id/read", ...masterRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid notification ID" });
      const updatedRows = (await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, id))
        .returning()) as any[];
      const updated = updatedRows[0];
      if (!updated) return res.status(404).json({ message: "Notification not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error marking notification read:", error);
      res.status(500).json({ message: "Failed to update notification" });
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
        return res.status(400).json({ message: "userId, type and title are required" });
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

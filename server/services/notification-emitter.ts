import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { getActiveOrganizationId } from "../organization-context";
import { notifications, users } from "@shared/schema";
import { sendEmail, buildISSSourcingNotificationEmailHtml } from "./email-service";
import { maybeSendSms } from "./sms-service";

export type EmitNotificationPayload = {
  userId: number;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: number;
};

async function upsertInAppNotification(payload: EmitNotificationPayload): Promise<{ created: boolean }> {
  const organizationId = getActiveOrganizationId();
  const bodyCondition = payload.body == null ? isNull(notifications.body) : eq(notifications.body, payload.body);
  const entityTypeCondition =
    payload.entityType == null ? isNull(notifications.entityType) : eq(notifications.entityType, payload.entityType);
  const entityIdCondition =
    payload.entityId == null ? isNull(notifications.entityId) : eq(notifications.entityId, payload.entityId);
  const existing = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.userId, payload.userId),
        eq(notifications.type, payload.type),
        eq(notifications.title, payload.title),
        bodyCondition,
        entityTypeCondition,
        entityIdCondition,
      ),
    )
    .orderBy(desc(notifications.lastOccurredAt))
    .limit(1);

  if (existing[0]) {
    await db
      .update(notifications)
      .set({
        body: payload.body ?? null,
        entityType: payload.entityType ?? null,
        entityId: payload.entityId ?? null,
        occurrenceCount: sql`${notifications.occurrenceCount} + 1`,
        lastOccurredAt: new Date(),
        readAt: null,
      })
      .where(
        and(
          eq(notifications.id, existing[0].id),
          eq(notifications.organizationId, organizationId),
          eq(notifications.userId, payload.userId),
        ),
      );
    return { created: false };
  }

  await db.insert(notifications).values({
    organizationId,
    userId: payload.userId,
    type: payload.type,
    title: payload.title,
    body: payload.body ?? null,
    entityType: payload.entityType ?? null,
    entityId: payload.entityId ?? null,
    occurrenceCount: 1,
    lastOccurredAt: new Date(),
  } as typeof notifications.$inferInsert);
  return { created: true };
}

export async function emitNotification(payload: EmitNotificationPayload): Promise<void> {
  const result = await upsertInAppNotification(payload);

  if (result.created && process.env.DISABLE_NOTIFICATION_EMAIL !== "true") {
    try {
      const rows = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);
      const to = rows[0]?.email;
      if (to) {
        const textBody = payload.body ?? "";
        await sendEmail({
          to,
          subject: payload.title,
          html: buildISSSourcingNotificationEmailHtml(payload.title, textBody),
          text: textBody,
        });
      }
    } catch (emailErr) {
      console.warn("[emitNotification] optional email mirror failed:", emailErr);
    }
  }

  if (result.created && process.env.DISABLE_NOTIFICATION_SMS !== "true") {
    try {
      const u = await storage.getUser(payload.userId);
      const phone = u?.phone?.trim();
      if (phone) {
        await maybeSendSms(phone, `${payload.title}\n${payload.body ?? ""}`.trim().slice(0, 320));
      }
    } catch (smsErr) {
      console.warn("[emitNotification] optional SMS mirror failed:", smsErr);
    }
  }
}

export async function emitNotificationToRoles(
  roles: string[],
  payload: Omit<EmitNotificationPayload, "userId">,
): Promise<void> {
  const roleUsers = (await db.select().from(users)) as { id?: number; role?: string }[];
  const targets = roleUsers.filter((user) =>
    roles.some((role) => String(user.role ?? "").toLowerCase() === role.toLowerCase()),
  );
  for (const user of targets) {
    if (!user.id) continue;
    await emitNotification({ userId: Number(user.id), ...payload });
  }
}

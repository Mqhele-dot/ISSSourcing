import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { getActiveOrganizationId } from "../organization-context";
import { notificationPreferences, notifications, organizationMembers, users } from "@shared/schema";
import { sendEmail, buildISSSourcingNotificationEmailHtml } from "./email-service";
import { maybeSendSms } from "./sms-service";

export type EmitNotificationPayload = {
  userId: number;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: number;
  targetPath?: string;
  findingCode?: string;
  dueAt?: Date;
  priority?: "low" | "normal" | "high" | "urgent";
};

/** Match the workspace a recipient must be able to open; custom roles can receive role broadcasts too. */
export function requiredNotificationAccess(payload: Omit<EmitNotificationPayload, "userId">): { resource: string; permission: string } | null {
  const entity = String(payload.entityType ?? "").toLowerCase();
  const type = payload.type.toLowerCase();
  if (["invoice", "capture", "match_result", "payment_batch"].includes(entity) || type.startsWith("ap_")) {
    return { resource: "invoices", permission: type.includes("approval") ? "approve" : "read" };
  }
  if (entity === "contract") return { resource: "purchases", permission: "read" };
  if (entity === "supplier" || type.startsWith("supplier_")) return { resource: "suppliers", permission: "read" };
  if (["inventory", "inventory_item", "stock", "gas_asset_profile"].includes(entity) || type.includes("stock")) return { resource: "inventory", permission: "read" };
  if (["purchase_order", "requisition", "receipt"].includes(entity)) return { resource: "purchases", permission: type.includes("approval") ? "approve" : "read" };
  if (entity === "shipment" || type.includes("shipment")) return { resource: "inventory", permission: "read" };
  return null;
}

function safeInternalTargetPath(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\") || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

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
        targetPath: safeInternalTargetPath(payload.targetPath),
        findingCode: payload.findingCode ?? null,
        dueAt: payload.dueAt ?? null,
        priority: payload.priority ?? "normal",
        occurrenceCount: sql`${notifications.occurrenceCount} + 1`,
        lastOccurredAt: new Date(),
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
    targetPath: safeInternalTargetPath(payload.targetPath),
    findingCode: payload.findingCode ?? null,
    dueAt: payload.dueAt ?? null,
    priority: payload.priority ?? "normal",
    occurrenceCount: 1,
    lastOccurredAt: new Date(),
  } as typeof notifications.$inferInsert);
  return { created: true };
}

export async function emitNotification(payload: EmitNotificationPayload): Promise<void> {
  const organizationId = getActiveOrganizationId();
  const [member] = await db.select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, payload.userId), eq(organizationMembers.active, true), eq(organizationMembers.status, "active")))
    .limit(1);
  if (!member) return;
  const [prefs] = await db.select().from(notificationPreferences)
    .where(eq(notificationPreferences.userId, payload.userId)).limit(1);
  const kind = payload.type.toLowerCase();
  if ((kind.includes("low_stock") && prefs?.lowStock === false)
      || (kind.includes("approval") && prefs?.approvalRequest === false)
      || (kind.includes("contract_expiry") && prefs?.contractExpiry === false)
      || (kind.includes("shipment_delay") && prefs?.shipmentDelay === false)) return;
  const result = await upsertInAppNotification(payload);

  if (result.created && prefs?.emailEnabled !== false && process.env.DISABLE_NOTIFICATION_EMAIL !== "true"
      && process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
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

  if (result.created && prefs?.smsEnabled === true && process.env.DISABLE_NOTIFICATION_SMS !== "true") {
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
  const members = await db.select({ userId: organizationMembers.userId, role: organizationMembers.applicationRole })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, getActiveOrganizationId()), eq(organizationMembers.active, true), eq(organizationMembers.status, "active")));
  const allowedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const access = requiredNotificationAccess(payload);
  for (const member of members) {
    const role = member.role.toLowerCase();
    let hasAccess = role === "admin";
    if (!hasAccess && access) {
      hasAccess = await storage.checkPermission(role, access.resource, access.permission);
      if (!hasAccess && role === "custom") {
        const customRoleId = await storage.getUserCustomRoleId(member.userId);
        hasAccess = customRoleId ? await storage.checkCustomRolePermission(customRoleId, access.resource as any, access.permission as any) : false;
      }
    }
    if (!hasAccess && access) continue;
    if (!allowedRoles.has(role) && !(role === "custom" && hasAccess && access)) continue;
    await emitNotification({ userId: member.userId, ...payload });
  }
}

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db, pool } from "../db";
import { storage } from "../storage";
import { getActiveOrganizationId } from "../organization-context";
import { notificationPreferences, notifications, organizationMembers, users } from "@shared/schema";
import { sendEmail, buildISSSourcingNotificationEmailHtml } from "./email-service";
import { maybeSendSms } from "./sms-service";
import { queryCustomRolePermission, queryRolePermission, queryUserCustomRoleId } from "./permission-query-service";

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
  /** Stable event identity for retry-safe in-app delivery. */
  deliveryKey?: string;
};

export function notificationEmailOptedIn(type:string,prefs?:{emailEnabled?:boolean|null;dailyDigestEnabled?:boolean|null}|null):boolean {
  const kind=type.toLowerCase();
  if(!kind.startsWith("diagnostic_"))return prefs?.emailEnabled!==false;
  return prefs?.emailEnabled===true && (kind!=="diagnostic_daily_summary" || prefs.dailyDigestEnabled===true);
}

/** Match the workspace a recipient must be able to open; custom roles can receive role broadcasts too. */
export function requiredNotificationAccess(payload: Omit<EmitNotificationPayload, "userId">): { resource: string; permission: string } | null {
  const entity = String(payload.entityType ?? "").toLowerCase();
  const type = payload.type.toLowerCase();
  if (["invoice", "capture", "match_result", "payment_batch"].includes(entity) || type.startsWith("ap_")) {
    return { resource: "invoices", permission: type.includes("approval") ? "approve" : "read" };
  }
  if (entity === "contract") return { resource: "purchases", permission: "read" };
  if (entity === "supplier" || type.startsWith("supplier_")) return { resource: "suppliers", permission: "read" };
  if (["inventory", "inventory_item", "stock", "gas_asset_profile", "putaway_task"].includes(entity) || type.includes("stock")) return { resource: "inventory", permission: "read" };
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

/** An inbox row for a governed outcome commits with the transition, not before
 * or after it. No optional external delivery is run under a business lock. */
export async function recordRequisitionOutcomeNotification(client: PoolClient, organizationId: number, payload: EmitNotificationPayload) {
  const { rows: [recipient] } = await client.query(`SELECT m.application_role::text AS role
    FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active=true
    LEFT JOIN notification_preferences np ON np.user_id=u.id
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND m.status='active'
      AND np.approval_request IS DISTINCT FROM false AND np.in_app_enabled IS DISTINCT FROM false`, [organizationId,payload.userId]);
  if (!recipient) return;
  const custom = recipient.role === "custom" ? await queryUserCustomRoleId(client,organizationId,payload.userId) : null;
  if (!await queryRolePermission(client,recipient.role,"purchases","read") &&
      !(custom && await queryCustomRolePermission(client,organizationId,custom,"purchases","read"))) return;
  await client.query(`INSERT INTO notifications
    (organization_id,user_id,type,title,body,entity_type,entity_id,target_path,priority,occurrence_count,last_occurred_at)
    VALUES($1,$2,$3,$4,$5,'requisition',$6,$7,'normal',1,now())`,
  [organizationId,payload.userId,payload.type,payload.title,payload.body??null,payload.entityId??null,safeInternalTargetPath(payload.targetPath)]);
}

export async function recordRequisitionSubmittedNotification(client: PoolClient, organizationId: number, id: number, requester: number, reference: string) {
  await client.query(`INSERT INTO notifications
    (organization_id,user_id,type,title,body,entity_type,entity_id,target_path,priority,occurrence_count,last_occurred_at)
    SELECT m.organization_id,m.user_id,'requisition_pending_approval',$4,$5,'requisition',$2,$6,'normal',1,now()
    FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active
    LEFT JOIN notification_preferences np ON np.user_id=u.id
    WHERE m.organization_id=$1 AND m.user_id<>$3 AND m.active AND m.status='active'
      AND np.approval_request IS DISTINCT FROM false AND np.in_app_enabled IS DISTINCT FROM false
      AND (m.application_role='admin' OR
        (m.application_role IN ('manager','planner') AND EXISTS(
          SELECT 1 FROM permissions p WHERE p.role::text=m.application_role AND p.resource='purchases' AND p.permission_type='approve'))
        OR (m.application_role='custom' AND EXISTS(
          SELECT 1 FROM custom_roles r JOIN custom_role_permissions p ON p.role_id=r.id
          WHERE r.organization_id=m.organization_id AND r.is_active
            AND r.id::text=u.preferences->>'customRoleId' AND p.resource='purchases' AND p.permission_type='approve')))`,
  [organizationId,id,requester,`Requisition ${reference} ready for approval`,`Requisition ${reference} is awaiting approval.`,`/procurement/requisitions/${id}`]);
}

async function upsertInAppNotification(payload: EmitNotificationPayload): Promise<{ created: boolean }> {
  const organizationId = getActiveOrganizationId();
  if (payload.deliveryKey) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claim = await client.query(`INSERT INTO notification_delivery_keys(organization_id,user_id,delivery_key)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING delivery_key`, [organizationId,payload.userId,payload.deliveryKey]);
      if (!claim.rowCount) { await client.query("COMMIT"); return { created:false }; }
      const inserted = await client.query(`INSERT INTO notifications
        (organization_id,user_id,type,title,body,entity_type,entity_id,target_path,finding_code,due_at,priority,occurrence_count,last_occurred_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,now()
        WHERE EXISTS(SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2
          AND active=true AND status='active' AND ($12::boolean=false OR application_role='admin')) RETURNING id`,
      [organizationId,payload.userId,payload.type,payload.title,payload.body??null,payload.entityType??null,
        payload.entityId??null,safeInternalTargetPath(payload.targetPath),payload.findingCode??null,payload.dueAt??null,
        payload.priority??"normal",payload.type.startsWith("diagnostic_")]);
      if (!inserted.rowCount) { await client.query("ROLLBACK"); return {created:false}; }
      await client.query(`UPDATE notification_delivery_keys SET completed_at=now()
        WHERE organization_id=$1 AND user_id=$2 AND delivery_key=$3`,[organizationId,payload.userId,payload.deliveryKey]);
      await client.query("COMMIT");
      return {created:true};
    } catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
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

  if (result.created && notificationEmailOptedIn(kind,prefs) && process.env.DISABLE_NOTIFICATION_EMAIL !== "true"
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

  if (result.created && !kind.startsWith("diagnostic_") && prefs?.smsEnabled === true && process.env.DISABLE_NOTIFICATION_SMS !== "true") {
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
  options: { excludeUserIds?: number[] } = {},
): Promise<void> {
  const members = await db.select({ userId: organizationMembers.userId, role: organizationMembers.applicationRole })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, getActiveOrganizationId()), eq(organizationMembers.active, true), eq(organizationMembers.status, "active")));
  const allowedRoles = new Set(roles.map((role) => role.toLowerCase()));
  const access = requiredNotificationAccess(payload);
  for (const member of members) {
    if (options.excludeUserIds?.includes(member.userId)) continue;
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

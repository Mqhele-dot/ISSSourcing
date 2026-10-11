import { pool } from "../db";
import { runWithTenantContext } from "../organization-context";
import { emitNotification, emitNotificationToRoles, requiredNotificationAccess } from "./notification-emitter";
import { buildISSSourcingNotificationEmailHtml, sendEmail } from "./email-service";
import { storage } from "../storage";

function emailConfigured(): boolean {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.DISABLE_NOTIFICATION_EMAIL !== "true");
}

async function once(org: number, user: number, key: string, action: () => Promise<void>): Promise<void> {
  const claimed = await pool.query(`INSERT INTO notification_delivery_keys(organization_id,user_id,delivery_key,claimed_at)
    VALUES($1,$2,$3,now())
    ON CONFLICT (organization_id,user_id,delivery_key) DO UPDATE SET claimed_at=now()
      WHERE notification_delivery_keys.completed_at IS NULL
        AND notification_delivery_keys.claimed_at < now()-interval '15 minutes'
    RETURNING delivery_key`, [org,user,key]);
  if (!claimed.rowCount) return;
  try {
    await action();
    await pool.query(`UPDATE notification_delivery_keys SET completed_at=now()
      WHERE organization_id=$1 AND user_id=$2 AND delivery_key=$3 AND completed_at IS NULL`, [org,user,key]);
  }
  catch (error) {
    await pool.query("DELETE FROM notification_delivery_keys WHERE organization_id=$1 AND user_id=$2 AND delivery_key=$3 AND completed_at IS NULL", [org,user,key]);
    throw error;
  }
}

async function withSystemTenant<T>(org: number, purpose: string, action: () => Promise<T>): Promise<T> {
  return runWithTenantContext({ organizationId: org, membershipId: 0, userId: 0, userRole: "system",
    membershipRole: "system", effectivePermissions: ["notifications:create"],
    correlationId: `action-inbox-${org}-${Date.now()}`,
    systemActor: { id: "action-inbox-worker", purpose } }, action);
}

export async function runActionInboxDeliveryCycle(now = new Date()): Promise<void> {
  const due = await pool.query<{ id: number; organization_id: number; user_id: number; title: string; type: string; application_role: string; entity_type: string | null;
    entity_id: number | null; target_path: string | null; due_at: Date; reminder_enabled: boolean | null }>(`
    SELECT n.id,n.organization_id,n.user_id,n.title,n.type,m.application_role,n.entity_type,n.entity_id,n.target_path,n.due_at,p.reminder_enabled
    FROM notifications n JOIN organization_members m ON m.organization_id=n.organization_id AND m.user_id=n.user_id
      AND m.active=true AND m.status='active'
    LEFT JOIN notification_preferences p ON p.user_id=n.user_id
    LEFT JOIN purchase_requisitions r ON n.entity_type='requisition' AND r.organization_id=n.organization_id AND r.id=n.entity_id
    LEFT JOIN purchase_orders po ON n.entity_type='purchase_order' AND po.organization_id=n.organization_id AND po.id=n.entity_id
    LEFT JOIN supplier_contracts c ON n.entity_type='contract' AND c.organization_id=n.organization_id AND c.id=n.entity_id
    LEFT JOIN suppliers s ON n.entity_type='supplier' AND s.organization_id=n.organization_id AND s.id=n.entity_id
    WHERE n.due_at IS NOT NULL AND n.due_at <= $1::timestamp + interval '24 hours'
      AND (n.entity_type IS DISTINCT FROM 'requisition' OR r.id IS NULL OR upper(r.status) IN ('PENDING','PENDING_APPROVAL','SUBMITTED'))
      AND (n.entity_type IS DISTINCT FROM 'purchase_order' OR po.id IS NULL OR upper(po.approval_status) IN ('PENDING','PENDING_APPROVAL','SUBMITTED'))
      AND (n.entity_type IS DISTINCT FROM 'contract' OR (c.status='active' AND c.end_date=n.due_at))
      AND (n.entity_type IS DISTINCT FROM 'supplier' OR s.insurance_expiry=n.due_at)
    ORDER BY n.due_at,n.id LIMIT 500`, [now]);
  for (const item of due.rows) {
    const role = item.application_role.toLowerCase();
    const access = requiredNotificationAccess({ type: item.type, title: item.title, entityType: item.entity_type ?? undefined });
    if (role !== "admin") {
      const customRoleId = role === "custom" ? await storage.getUserCustomRoleId(item.user_id) : null;
      if (!access || !(await storage.checkPermission(role, access.resource, access.permission)
        || (customRoleId && await storage.checkCustomRolePermission(customRoleId, access.resource as never, access.permission as never)))) continue;
    }
    const dueAt = new Date(item.due_at);
    const base = { entityType: item.entity_type ?? undefined, entityId: item.entity_id ?? undefined,
      targetPath: item.target_path ?? undefined };
    if (dueAt > now && item.reminder_enabled !== false) {
      await once(item.organization_id,item.user_id,`due-reminder:${item.id}:${now.toISOString().slice(0,10)}`, async () =>
        withSystemTenant(item.organization_id,"due-date reminder", () => emitNotification({ userId: item.user_id,
          type: "due_reminder", title: `Due soon: ${item.title}`, body: `This work is due ${dueAt.toLocaleString()}. Open it to review the current state.`, ...base })));
    }
    if (dueAt.getTime() <= now.getTime()-24*60*60*1000) {
      await once(item.organization_id,item.user_id,`overdue-escalation:${item.id}`, async () =>
        withSystemTenant(item.organization_id,"overdue role escalation", () => emitNotificationToRoles(["manager","admin"], {
          type: "overdue_escalation", title: `Overdue action: ${item.title}`,
          body: `An assigned action passed its due date. Escalation provides visibility; it does not transfer approval authority.`,
          priority: "high", ...base })));
    }
  }

  const assignedPutAway = await pool.query<{ id: number; organization_id: number; assigned_user_id: number; task_number: string; due_at: Date; priority: string; reminder_enabled: boolean | null; application_role: string }>(`
    SELECT t.id,t.organization_id,t.assigned_user_id,t.task_number,t.due_at,t.priority,p.reminder_enabled,m.application_role
    FROM inventory_putaway_tasks t JOIN organization_members m ON m.organization_id=t.organization_id AND m.user_id=t.assigned_user_id
      AND m.active=true AND m.status='active'
    LEFT JOIN notification_preferences p ON p.user_id=t.assigned_user_id
    WHERE t.status IN ('ASSIGNED','IN_PROGRESS','EXCEPTION') AND t.due_at IS NOT NULL
      AND t.due_at <= $1::timestamp + interval '24 hours'
    ORDER BY t.due_at,t.id LIMIT 500`, [now]);
  for (const task of assignedPutAway.rows) {
    const role = task.application_role.toLowerCase();
    const customRoleId = role === "custom" ? await storage.getUserCustomRoleId(task.assigned_user_id) : null;
    if (role !== "admin" && !(await storage.checkPermission(role, "inventory", "read")
      || (customRoleId && await storage.checkCustomRolePermission(customRoleId, "inventory" as never, "read" as never)))) continue;
    const targetPath = `/inventory/put-away?q=${encodeURIComponent(task.task_number)}`;
    const dueAt = new Date(task.due_at);
    if (dueAt > now && task.reminder_enabled !== false) {
      await once(task.organization_id,task.assigned_user_id,`putaway-reminder:${task.id}:${now.toISOString().slice(0,10)}`, async () =>
        withSystemTenant(task.organization_id,"put-away due reminder", () => emitNotification({ userId: task.assigned_user_id,
          type: "putaway_reminder", title: `Put-away due: ${task.task_number}`, body: `This task is due ${dueAt.toLocaleString()}.`,
          entityType: "putaway_task", entityId: task.id, targetPath, dueAt, priority: "high" })));
    }
    if (dueAt.getTime() <= now.getTime()-24*60*60*1000) {
      await once(task.organization_id,task.assigned_user_id,`putaway-escalation:${task.id}`, async () =>
        withSystemTenant(task.organization_id,"overdue put-away escalation", () => emitNotificationToRoles(["manager","admin"], {
          type: "overdue_escalation", title: `Overdue put-away: ${task.task_number}`,
          body: "The assigned warehouse task is overdue. Escalation grants visibility, not stock-posting authority.",
          entityType: "putaway_task", entityId: task.id, targetPath, priority: "high" })));
    }
  }

  if (!emailConfigured()) return;
  const digestUsers = await pool.query<{ organization_id: number; user_id: number; email: string; timezone: string | null; application_role: string }>(`
    SELECT DISTINCT m.organization_id,m.user_id,u.email,o.timezone,m.application_role FROM organization_members m
    JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.organization_id
    JOIN notification_preferences p ON p.user_id=m.user_id
    WHERE m.active=true AND m.status='active' AND p.daily_digest_enabled=true AND p.email_enabled=true AND u.email IS NOT NULL`);
  for (const user of digestUsers.rows) {
    let localHour: string;
    let localDate: string;
    try {
      localHour = new Intl.DateTimeFormat("en-GB", { timeZone: user.timezone || "UTC", hour: "2-digit", hourCycle: "h23" }).format(now);
      localDate = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    } catch { continue; }
    if (localHour !== "08") continue;
    const items = await pool.query<{ title: string; type: string; entity_type: string | null }>(`SELECT title,type,entity_type FROM notifications
      WHERE organization_id=$1 AND user_id=$2 AND archived_at IS NULL
      ORDER BY last_occurred_at DESC,id DESC LIMIT 20`, [user.organization_id,user.user_id]);
    if (!items.rowCount) continue;
    const role = user.application_role.toLowerCase();
    const customRoleId = role === "custom" ? await storage.getUserCustomRoleId(user.user_id) : null;
    const permitted: Array<{ title: string; type: string; entity_type: string | null }> = [];
    for (const item of items.rows) {
      const access = requiredNotificationAccess({ type: item.type, title: item.title, entityType: item.entity_type ?? undefined });
      if (role === "admin" || (access && (await storage.checkPermission(role, access.resource, access.permission)
        || (customRoleId && await storage.checkCustomRolePermission(customRoleId, access.resource as never, access.permission as never))))) permitted.push(item);
    }
    if (permitted.length === 0) continue;
    await once(user.organization_id,user.user_id,`daily-digest:${localDate}`, async () => {
      const body = permitted.map((row,index) => `${index+1}. ${row.title}`).join("\n");
      const result = await sendEmail({ to: user.email, subject: "Your daily action summary",
        text: body, html: buildISSSourcingNotificationEmailHtml("Your daily action summary", body) });
      if (!result.success) throw result.error ?? new Error("Digest delivery failed");
    });
  }
}

export function startActionInboxWorker(): void {
  const run = () => void runActionInboxDeliveryCycle().catch((error) => console.warn("Action Inbox delivery failed:", error));
  run();
  setInterval(run, 30 * 60 * 1000).unref();
}

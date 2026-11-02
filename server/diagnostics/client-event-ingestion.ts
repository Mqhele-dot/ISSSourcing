import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { getActiveOrganizationId } from "../organization-context";
import { sendError, sendOk } from "../api-response";
import { diagnosticStorageReady, persistDiagnosticChecks } from "./persistent-findings";

const eventSchema = z.object({
  eventType: z.enum(["browser_error", "unhandled_rejection", "console_error"]),
  clientEventId: z.string().uuid(),
  route: z.string().min(1).max(200).refine((value) => value.startsWith("/") && !value.startsWith("//") && !/[?#\\\\\r\n]/.test(value)),
  buildId: z.string().trim().min(1).max(100).optional(),
  requestReference: z.string().trim().min(1).max(100).optional(),
}).strict();

const rateWindows = new Map<string, { startedAt: number; count: number }>();
function consumeRateLimit(key: string): boolean {
  const now = Date.now();
  for (const [entry, window] of rateWindows) if (now-window.startedAt>=60_000) rateWindows.delete(entry);
  if (!rateWindows.has(key) && rateWindows.size>=10_000) return false;
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count += 1;
  return true;
}

export async function ingestClientDiagnosticEvent(req: Request, res: Response) {
  const serializedSize = Buffer.byteLength(JSON.stringify(req.body ?? null), "utf8");
  if (serializedSize > 16 * 1024) return sendError(res, 413, "DIAGNOSTIC_EVENT_TOO_LARGE", "The browser incident was not accepted because it exceeded the safe size limit.");
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "DIAGNOSTIC_EVENT_INVALID", "The browser incident did not contain the required safe fields.");
  const organizationId = getActiveOrganizationId();
  const userId = Number(req.user?.id);
  if (!Number.isSafeInteger(userId) || userId < 1) return sendError(res, 401, "AUTHENTICATION_REQUIRED", "Sign in again before sending diagnostic evidence.");
  if (!consumeRateLimit(`${organizationId}:${userId}`)) {
    res.setHeader("Retry-After", "60");
    return sendError(res, 429, "DIAGNOSTIC_EVENT_RATE_LIMITED", "Too many browser incidents were reported. Wait one minute, then retry.");
  }

  const client = await pool.connect();
  try {
    const membership=await client.query("SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND active=true AND status='active'",[organizationId,userId]);
    if(!membership.rowCount)return sendError(res,403,"DIAGNOSTIC_ACCESS_DENIED","Your organization access has changed. Sign in again.");
    if (!await diagnosticStorageReady(client) || !(await client.query("SELECT to_regclass('public.diagnostic_client_events') IS NOT NULL AS ready")).rows[0]?.ready) {
      return sendError(res, 503, "DIAGNOSTIC_STORAGE_MISSING", "Browser incident storage is not installed. Ask an administrator to review pending migrations.");
    }
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'");
    const inserted = await client.query(`INSERT INTO diagnostic_client_events
      (organization_id,user_id,client_event_id,event_type,route,build_id,request_reference)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING client_event_id`,
    [organizationId,userId,parsed.data.clientEventId,parsed.data.eventType,parsed.data.route,parsed.data.buildId ?? null,parsed.data.requestReference ?? null]);
    if (inserted.rowCount) {
      const resourceKey = createHash("sha256").update(`${parsed.data.eventType}|${parsed.data.route}`).digest("hex");
      await persistDiagnosticChecks(client, organizationId, randomUUID(), [{
        id: `frontend:${resourceKey}`,
        category: "frontend",
        code: "BROWSER_INCIDENT",
        resourceKey,
        title: "A browser action failed",
        message: "A browser error was captured safely. Reproduce the action after the underlying issue is repaired to verify recovery.",
        severity: parsed.data.eventType === "browser_error" ? "critical" : "error",
        status: "failed",
        occurrences: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        evidenceState: "current",
        affectedRoute: parsed.data.route,
        targetRoute: "/admin/system-diagnostics?view=user-errors",
        requestId: parsed.data.requestReference,
        evidence: { eventType: parsed.data.eventType, route: parsed.data.route, buildId: parsed.data.buildId ?? null },
      }], 2, false);
    }
    await client.query("COMMIT");
    return sendOk(res, { accepted: true, duplicate: !inserted.rowCount }, inserted.rowCount ? 202 : 200);
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    return sendError(res, 503, "DIAGNOSTIC_EVENT_UNAVAILABLE", "The browser incident could not be recorded. Retry later; this capture attempt may be missing from history.");
  } finally {
    client.release();
  }
}

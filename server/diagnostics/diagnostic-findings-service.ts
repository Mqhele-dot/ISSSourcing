import { pool } from "../db";
import { getServerDiagnosticEvents, type ServerDiagnosticEvent } from "./server-diagnostics-store";
import {
  diagnosticCategories,
  diagnosticFindingStatuses,
  type DiagnosticCategory,
  type DiagnosticFinding,
  type DiagnosticFindingSeverity,
  type DiagnosticFindingStatus,
  type DiagnosticsSummary,
} from "@shared/diagnostics/findings";

const now = () => new Date().toISOString();

function finding(input: Omit<DiagnosticFinding, "id" | "occurrences" | "firstSeen" | "lastSeen" | "evidenceState"> & Partial<Pick<DiagnosticFinding, "id" | "occurrences" | "firstSeen" | "lastSeen" | "evidenceState">>): DiagnosticFinding {
  const timestamp = input.lastSeen ?? now();
  return {
    ...input,
    id: input.id ?? `${input.category}:${input.code}`,
    occurrences: input.occurrences ?? 1,
    firstSeen: input.firstSeen ?? timestamp,
    lastSeen: timestamp,
    evidenceState: input.evidenceState ?? "current",
  };
}

function eventCategory(event: ServerDiagnosticEvent): DiagnosticCategory {
  if (event.source === "security") return "security";
  if (event.source === "integration") return "integrations";
  if (event.source === "business-rule") return "business";
  if (event.source === "request" && Number(event.status ?? 0) >= 400) return "user-errors";
  return "backend";
}

function eventStatus(event: ServerDiagnosticEvent): DiagnosticFindingStatus {
  if (event.severity === "critical" || event.severity === "error") return "failed";
  if (event.severity === "warning") return "degraded";
  return "working";
}

function eventOrganizationId(event: ServerDiagnosticEvent): number | null {
  const details = event.details && typeof event.details === "object"
    ? event.details as Record<string, unknown>
    : null;
  const value = details?.organizationId;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serverEventFindings(organizationId: number): DiagnosticFinding[] {
  const grouped = new Map<string, ServerDiagnosticEvent[]>();
  for (const event of getServerDiagnosticEvents().slice(0, 500)) {
    const eventOrgId = eventOrganizationId(event);
    const globalInfrastructureEvent = ["startup", "database", "schema", "system", "security"].includes(event.source);
    if (eventOrgId !== organizationId && !(eventOrgId == null && globalInfrastructureEvent)) continue;
    const key = [eventCategory(event), event.source, event.title, event.route ?? "", event.status ?? ""].join("|");
    const rows = grouped.get(key) ?? [];
    rows.push(event);
    grouped.set(key, rows);
  }
  return Array.from(grouped.entries()).map(([key, rows]) => {
    const newest = rows[0];
    const oldest = rows[rows.length - 1];
    const requestId = newest.details && typeof newest.details === "object" ? (newest.details as Record<string, unknown>).requestId : undefined;
    return finding({
      id: `event:${key}`,
      category: eventCategory(newest),
      severity: newest.severity,
      status: eventStatus(newest),
      code: `OBSERVED_${newest.source.toUpperCase().replace(/-/g, "_")}`,
      title: newest.title,
      message: newest.message,
      evidence: {
        requestId:
          newest.details && typeof newest.details === "object"
            ? (newest.details as Record<string, unknown>).requestId
            : undefined,
        organizationScoped: eventOrganizationId(newest) != null,
      },
      occurrences: rows.length,
      firstSeen: oldest.timestamp,
      lastSeen: newest.timestamp,
      evidenceState: Date.now() - new Date(newest.timestamp).getTime() > 10 * 60_000 ? "historical" : "current",
      requestId: typeof requestId === "string" ? requestId : undefined,
      affectedRoute: newest.route,
      affectedAction: newest.method,
      remediation: "Use the request ID and affected route to reproduce the action, then review the associated server event.",
    });
  });
}

async function queryProbe<T>(input: {
  category: DiagnosticCategory;
  code: string;
  title: string;
  organizationId: number;
  sql: string;
  values?: unknown[];
  evaluate: (rows: T[]) => DiagnosticFinding;
}): Promise<DiagnosticFinding> {
  try {
    // Probes that are not tenant-scoped (for example `SELECT 1`) must not
    // receive an implicit bind value. Tenant-scoped probes pass their values
    // explicitly, which also makes accidental cross-tenant queries visible in
    // review.
    const result = await pool.query(input.sql, input.values ?? []);
    return input.evaluate(result.rows as T[]);
  } catch (error) {
    return finding({
      category: input.category,
      severity: "error",
      status: "failed",
      code: `${input.code}_PROBE_FAILED`,
      title: `${input.title} probe failed`,
      message: "The safe diagnostic query could not be completed.",
      evidence: { probeCode: input.code },
      remediation: "Check database readiness and schema migrations, then run the probe again.",
    });
  }
}

export async function collectDiagnosticFindings(organizationId: number): Promise<DiagnosticFinding[]> {
  const timestamp = now();
  const probes = await Promise.all([
    queryProbe<{ value: number }>({
      category: "backend",
      code: "DATABASE_READINESS",
      title: "Database readiness",
      organizationId,
      sql: "SELECT 1::integer AS value",
      evaluate: () => finding({ category: "backend", severity: "info", status: "working", code: "DATABASE_READINESS", title: "Database query", message: "The database accepted a read-only probe.", lastSeen: timestamp }),
    }),
    queryProbe<{ total: string }>({
      category: "business",
      code: "APPROVAL_POLICY_OVERLAP",
      title: "Approval policy overlap",
      organizationId,
      sql: `SELECT COUNT(*)::text AS total
            FROM approval_policies a
            JOIN approval_policies b ON a.organization_id = b.organization_id
              AND a.id < b.id
              AND a.entity_type = b.entity_type
              AND a.approval_level = b.approval_level
              AND COALESCE(a.is_active, true) = true
              AND COALESCE(b.is_active, true) = true
              AND a.amount_min <= COALESCE(b.amount_max, 'Infinity'::real)
              AND b.amount_min <= COALESCE(a.amount_max, 'Infinity'::real)
            WHERE a.organization_id = $1`,
      values: [organizationId],
      evaluate: (rows) => {
        const total = Number(rows[0]?.total ?? 0);
        return finding({ category: "business", severity: total ? "warning" : "info", status: total ? "degraded" : "working", code: "APPROVAL_POLICY_OVERLAP", title: "Approval policy overlap", message: total ? `${total} overlapping active policy pair(s) require review.` : "No conflicting active approval-policy bands were detected.", evidence: { total }, targetRoute: "/finance/approval-policies", remediation: total ? "Open Approval Policies, filter to overlaps, and deactivate or correct conflicting rules." : undefined });
      },
    }),
    queryProbe<{ total: string; latest: string | null }>({
      category: "integrations",
      code: "EXPORT_JOB_FAILURES",
      title: "Export service",
      organizationId,
      sql: `SELECT COUNT(*)::text AS total, MAX(updated_at)::text AS latest
            FROM export_jobs
            WHERE organization_id = $1 AND status = 'failed' AND updated_at > NOW() - INTERVAL '7 days'
              AND NOT EXISTS (SELECT 1 FROM export_jobs retry WHERE retry.retry_of_job_id = export_jobs.id)`,
      values: [organizationId],
      evaluate: (rows) => {
        const total = Number(rows[0]?.total ?? 0);
        return finding({ category: "integrations", severity: total ? "error" : "info", status: total ? "failed" : "working", code: "EXPORT_JOB_FAILURES", title: "Export service", message: total ? `${total} export job(s) failed in the last seven days.` : "No export job failures were recorded in the last seven days.", evidence: rows[0], targetRoute: "/analytics/export-center", remediation: total ? "Open Export Center, retry the job, and use its request ID in diagnostics." : undefined });
      },
    }),
    queryProbe<{ total: string }>({
      category: "consistency",
      code: "TEST_FIXTURE_POLLUTION",
      title: "Automated fixture pollution",
      organizationId,
      sql: `SELECT SUM(match_count)::text AS total FROM (
              SELECT COUNT(*) AS match_count FROM suppliers WHERE organization_id = $1 AND name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Supplier '
              UNION ALL SELECT COUNT(*) FROM inventory_items WHERE organization_id::text = $1::text AND (name ~ '^(Dependency|Workflow|Runtime|Propagation|Sourcing) Item ' OR sku ~ '^(DEP-ITEM-|WF-|RT-|PROP-|SOURCING-)')
              UNION ALL SELECT COUNT(*) FROM approval_policies WHERE organization_id = $1 AND name ~ '^(AP Workflow|AP Test|AP Invalid)'
            ) fixture_matches`,
      values: [organizationId],
      evaluate: (rows) => {
        const total = Number(rows[0]?.total ?? 0);
        return finding({ category: "consistency", severity: total ? "warning" : "info", status: total ? "degraded" : "working", code: "TEST_FIXTURE_POLLUTION", title: "Automated fixture pollution", message: total ? `${total} probable test fixture record(s) are present.` : "No known test-fixture naming patterns were detected.", evidence: { total }, targetRoute: "/admin/system-diagnostics?view=consistency", remediation: total ? "Run npm run data:fixture-audit. Review and back up the database before any explicit purge." : undefined });
      },
    }),
    queryProbe<{ unread: string; oldest: string | null }>({
      category: "notifications",
      code: "NOTIFICATION_BACKLOG",
      title: "Notification backlog",
      organizationId,
      sql: `SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::text AS unread,
                   MIN(created_at) FILTER (WHERE read_at IS NULL)::text AS oldest
            FROM notifications WHERE organization_id = $1`,
      values: [organizationId],
      evaluate: (rows) => {
        const unread = Number(rows[0]?.unread ?? 0);
        const degraded = unread > 100;
        return finding({ category: "notifications", severity: degraded ? "warning" : "info", status: degraded ? "degraded" : "working", code: "NOTIFICATION_BACKLOG", title: "Notification backlog", message: degraded ? `${unread} unread notifications are accumulating.` : `${unread} unread notification(s); backlog is within the operational threshold.`, evidence: rows[0], targetRoute: "/admin/system-diagnostics?view=notifications", remediation: degraded ? "Review duplicate event sources, mark resolved notifications read, and apply retention policy." : undefined });
      },
    }),
    queryProbe<{ total: string; latest: string | null }>({
      category: "audit",
      code: "AUDIT_TIMELINE",
      title: "Audit timeline",
      organizationId,
      sql: `SELECT COUNT(*)::text AS total, MAX(created_at)::text AS latest FROM audit_logs WHERE organization_id = $1`,
      values: [organizationId],
      evaluate: (rows) => {
        const total = Number(rows[0]?.total ?? 0);
        return finding({ category: "audit", severity: total ? "info" : "warning", status: total ? "working" : "not_exercised", code: "AUDIT_TIMELINE", title: "Audit timeline", message: total ? `${total} tenant-scoped audit event(s) are available.` : "No audit events have been recorded for this organization.", evidence: rows[0], targetRoute: "/admin/audit-logs", remediation: total ? undefined : "Exercise an audited administrative action and confirm the event appears here." });
      },
    }),
  ]);

  const configuration: DiagnosticFinding[] = [
    finding({ category: "integrations", severity: process.env.SMTP_HOST ? "info" : "warning", status: process.env.SMTP_HOST ? "working" : "disabled_by_configuration", evidenceState: process.env.SMTP_HOST ? "current" : "expected_configuration", code: "EMAIL_CONFIGURATION", title: "Email delivery", message: process.env.SMTP_HOST ? "Email delivery is configured." : "Email delivery is disabled because SMTP is not configured.", targetRoute: "/admin/integrations", remediation: process.env.SMTP_HOST ? undefined : "Configure SMTP variables in the hosting environment and restart the app." }),
    finding({ category: "integrations", severity: process.env.STRIPE_SECRET_KEY ? "info" : "warning", status: process.env.STRIPE_SECRET_KEY ? "working" : "disabled_by_configuration", evidenceState: process.env.STRIPE_SECRET_KEY ? "current" : "expected_configuration", code: "STRIPE_CONFIGURATION", title: "Stripe billing", message: process.env.STRIPE_SECRET_KEY ? "Stripe billing credentials are configured." : "Stripe billing is disabled by configuration.", targetRoute: "/admin/subscription", remediation: process.env.STRIPE_SECRET_KEY ? undefined : "Configure Stripe only when hosted SaaS billing is ready." }),
    finding({ category: "security", severity: "info", status: "not_exercised", code: "SECURITY_RELEASE_EVIDENCE", title: "Security release evidence", message: "Runtime diagnostics cannot infer that CI and supply-chain gates passed.", targetRoute: "/admin/system-diagnostics?view=security", remediation: "Run npm run verify:release:secure and attach immutable CI evidence before release." }),
  ];

  return [...serverEventFindings(organizationId), ...probes, ...configuration].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function summarizeDiagnosticFindings(findings: DiagnosticFinding[]): DiagnosticsSummary {
  const byCategory = Object.fromEntries(diagnosticCategories.map((category) => [category, 0])) as DiagnosticsSummary["byCategory"];
  const byStatus = Object.fromEntries(diagnosticFindingStatuses.map((status) => [status, 0])) as DiagnosticsSummary["byStatus"];
  const severities: DiagnosticFindingSeverity[] = ["info", "warning", "error", "critical"];
  const bySeverity = Object.fromEntries(severities.map((severity) => [severity, 0])) as DiagnosticsSummary["bySeverity"];
  for (const row of findings) {
    byCategory[row.category] += 1;
    byStatus[row.status] += 1;
    bySeverity[row.severity] += 1;
  }
  return {
    generatedAt: now(),
    total: findings.length,
    openCount: findings.filter((row) => row.evidenceState === "current" && (row.status === "failed" || row.status === "degraded")).length,
    byCategory,
    byStatus,
    bySeverity,
    affectedModules: Array.from(new Set(findings.filter((row) => row.affectedRoute).map((row) => row.affectedRoute!.split("/")[1] || "root"))).sort(),
  };
}

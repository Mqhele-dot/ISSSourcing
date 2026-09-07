import type { QueryResultRow } from "pg";
import type { MasterDataDomainSummary, MasterDataGovernanceOverview } from "../../../shared/master-data-governance-types";
import { pool } from "../../db";
import { getMdmControlCentreHealth } from "./mdm-control-centre";

type CountRow = QueryResultRow & { total: number; active: number; draft: number; blocked: number };

const domainDefinitions = [
  { key: "items", label: "Items", table: "inventory_items", state: "status", href: "/inventory", usedBy: ["Requisitions", "POs", "Receiving", "Inventory"] },
  { key: "suppliers", label: "Suppliers", table: "suppliers", state: "status", href: "/procurement/suppliers", usedBy: ["RFQs", "POs", "Logistics", "AP"] },
  { key: "warehouses", label: "Warehouses & locations", table: "warehouses", state: null, href: "/admin/master-data/warehouses", usedBy: ["Receiving", "Transfers", "Counts", "Logistics"] },
  { key: "units", label: "Units & measures", table: "units_of_measure", state: "active", href: "/admin/master-data/units", usedBy: ["Items", "POs", "Receiving", "Reports"] },
  { key: "currencies", label: "Currencies & tax", table: "currencies", state: "active", href: "/admin/master-data/currencies", usedBy: ["Suppliers", "POs", "AP", "Analytics"] },
  { key: "payment-terms", label: "Payment & delivery terms", table: "payment_terms", state: "active", href: "/admin/master-data/paymentTerms", usedBy: ["Suppliers", "POs", "AP aging", "Logistics"] },
  { key: "departments", label: "Categories & cost centres", table: "departments", state: "active", href: "/admin/master-data/departments", usedBy: ["Requisitions", "Approvals", "Budgets", "Reports"] },
  { key: "approval-rules", label: "Approval rules", table: "approval_policies", state: "is_active", href: "/finance/approval-policies", usedBy: ["Requisitions", "POs", "Invoices", "Payments"] },
  { key: "roles", label: "Users, roles & permissions", table: "custom_roles", state: "is_active", href: "/admin/user-roles", usedBy: ["Navigation", "Approvals", "Administration"] },
  { key: "documents", label: "Numbering & documents", table: "mdm_document_sequences", state: "active", href: "/admin/master-data", usedBy: ["Requisitions", "POs", "Invoices", "Exports"] },
] as const;

function safeName(value: string): string {
  if (!/^[a-z_]+$/.test(value)) throw new Error("Invalid Master Data catalog identifier");
  return value;
}

export async function getMasterDataGovernanceOverview(organizationId: number): Promise<MasterDataGovernanceOverview> {
  const started = Date.now();
  const partialFailures: MasterDataGovernanceOverview["meta"]["partialFailures"] = [];

  async function safeRows<T extends QueryResultRow>(area: string, sql: string, params: unknown[] = [organizationId]): Promise<T[]> {
    try {
      return (await pool.query<T>(sql, params)).rows;
    } catch (error) {
      partialFailures.push({ area, code: `${area.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_UNAVAILABLE`, message: error instanceof Error ? error.message : `Unable to read ${area}`, fallbackUsed: false });
      return [];
    }
  }

  const domainRows = await Promise.all(domainDefinitions.map(async (definition): Promise<MasterDataDomainSummary> => {
    const table = safeName(definition.table);
    const state = definition.state ? safeName(definition.state) : null;
    const sql = state === null
      ? `SELECT count(*)::int total, count(*)::int active, 0::int draft, 0::int blocked FROM ${table} WHERE organization_id=$1`
      : state === "status"
      ? `SELECT count(*)::int total, count(*) FILTER (WHERE lower(coalesce(${state}, 'active'))='active')::int active, count(*) FILTER (WHERE lower(coalesce(${state}, 'active'))='draft')::int draft, count(*) FILTER (WHERE lower(coalesce(${state}, 'active')) IN ('blocked','inactive','archived'))::int blocked FROM ${table} WHERE organization_id=$1`
      : `SELECT count(*)::int total, count(*) FILTER (WHERE coalesce(${state}, true)=true)::int active, 0::int draft, count(*) FILTER (WHERE coalesce(${state}, true)=false)::int blocked FROM ${table} WHERE organization_id=$1`;
    const count = (await safeRows<CountRow>(definition.key, sql))[0] ?? { total: 0, active: 0, draft: 0, blocked: 0 };
    return { key: definition.key, label: definition.label, total: Number(count.total), active: Number(count.active), draft: Number(count.draft), blocked: Number(count.blocked), href: definition.href, usedBy: [...definition.usedBy] };
  }));

  const [health, requestCounts, pendingChanges, duplicateCandidates, auditHighlights] = await Promise.all([
    getMdmControlCentreHealth(organizationId).catch((error) => {
      partialFailures.push({ area: "data-quality", code: "DATA_QUALITY_UNAVAILABLE", message: error instanceof Error ? error.message : "Unable to scan data quality", fallbackUsed: false });
      return null;
    }),
    safeRows<QueryResultRow & { draft: number; pending: number; high_risk: number }>("change-requests", `SELECT count(*) FILTER (WHERE status='draft')::int draft, count(*) FILTER (WHERE status IN ('submitted','validation_passed','pending_approval','approved'))::int pending, count(*) FILTER (WHERE risk_level IN ('high','critical') AND status IN ('submitted','validation_passed','pending_approval','approved'))::int high_risk FROM mdm_change_requests WHERE organization_id=$1`),
    safeRows("pending-changes", `SELECT request.id, request.domain, request.entity_id AS "entityId", request.action, request.risk_level AS "riskLevel", request.status, request.reason, request.created_at AS "createdAt", coalesce(actor.full_name, actor.username, 'System') AS "requestedBy" FROM mdm_change_requests request LEFT JOIN users actor ON actor.id=request.submitted_by WHERE request.organization_id=$1 AND request.status IN ('submitted','validation_passed','pending_approval','approved') ORDER BY CASE request.risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, request.created_at DESC LIMIT 12`),
    safeRows("duplicates", `SELECT id, domain, severity, issue_code AS "issueCode", title, message, affected_entity_type AS "affectedEntityType", affected_entity_id AS "affectedEntityId", recommended_action AS "recommendedAction" FROM mdm_data_quality_issues WHERE organization_id=$1 AND status='open' AND issue_code LIKE 'DUPLICATE_%' ORDER BY last_seen_at DESC LIMIT 20`),
    safeRows("audit", `SELECT audit.id, audit.domain, audit.record_id AS "recordId", audit.action, audit.summary, audit.before, audit.after, audit.created_at AS "changedAt", coalesce(actor.full_name, actor.username, 'System') AS "changedBy" FROM mdm_audit_logs audit LEFT JOIN users actor ON actor.id=audit.performed_by WHERE audit.organization_id=$1 ORDER BY audit.created_at DESC, audit.id DESC LIMIT 12`),
  ]);

  const requests = requestCounts[0] ?? { draft: 0, pending: 0, high_risk: 0 };
  const totals = domainRows.reduce((out, row) => ({ total: out.total + row.total, active: out.active + row.active, draft: out.draft + row.draft, blocked: out.blocked + row.blocked }), { total: 0, active: 0, draft: 0, blocked: 0 });
  const qualityIssues = health?.topIssues ?? [];
  const issueTotal = health ? health.issueCounts.error + health.issueCounts.warning + health.issueCounts.info : 0;
  return {
    generatedAt: new Date().toISOString(), meta: { queryMs: Date.now() - started, partialFailures },
    kpis: { totalRecords: totals.total, draftRecords: totals.draft + Number(requests.draft ?? 0), pendingApproval: Number(requests.pending ?? 0), activeRecords: totals.active, blockedRecords: totals.blocked, dataQualityIssues: issueTotal, highRiskChanges: Number(requests.high_risk ?? 0), duplicateCandidates: duplicateCandidates.length },
    domains: domainRows, qualityIssues, duplicateCandidates, pendingChanges, auditHighlights,
  };
}

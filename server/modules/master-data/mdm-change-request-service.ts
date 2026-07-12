import { pool } from "../../db";
import { getMdmDomainRegistryEntry, isHighRiskMdmField } from "./mdm-domain-registry";

export type MdmChangeRequestAction = "create" | "update" | "deactivate" | "archive";

export class MdmApprovalError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "MdmApprovalError";
    this.code = code;
    this.status = status;
  }
}

function toRiskLevel(domain: string, patch: Record<string, unknown>) {
  const registry = getMdmDomainRegistryEntry(domain);
  const hasHighRiskField = Object.keys(patch).some((field) => isHighRiskMdmField(domain, field));
  if (hasHighRiskField) return "critical";
  return registry?.riskLevel ?? "medium";
}

function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

export async function createMdmChangeRequest(input: {
  organizationId: number;
  domain: string;
  entityId?: number | null;
  action: MdmChangeRequestAction;
  proposedPatch: Record<string, unknown>;
  beforeState?: Record<string, unknown> | null;
  submittedBy?: number;
  reason?: string;
}) {
  const riskLevel = toRiskLevel(input.domain, input.proposedPatch);
  const status = riskLevel === "low" || riskLevel === "medium" ? "validation_passed" : "pending_approval";
  const result = await pool.query<Record<string, unknown>>(
    `
      INSERT INTO mdm_change_requests (
        organization_id, domain, entity_id, action, proposed_patch, before_state,
        risk_level, status, submitted_by, reason, target_version, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, NOW())
      RETURNING *
    `,
    [
      input.organizationId,
      input.domain,
      input.entityId ?? null,
      input.action,
      input.proposedPatch,
      input.beforeState ?? null,
      riskLevel,
      status,
      input.submittedBy ?? null,
      input.reason ?? null,
    ],
  );
  return rowToCamel(result.rows[0] ?? {});
}

export async function approveMdmChangeRequest(input: {
  organizationId: number;
  id: number;
  actorId: number;
  reason: string;
  allowAdminOverride?: boolean;
}) {
  const existing = await pool.query<Record<string, unknown>>(
    "SELECT * FROM mdm_change_requests WHERE organization_id = $1 AND id = $2",
    [input.organizationId, input.id],
  );
  const row = existing.rows[0];
  if (!row) return null;
  if (Number(row.submitted_by) === input.actorId && input.allowAdminOverride !== true) {
    throw new MdmApprovalError(
      "MDM_MAKER_CANNOT_APPROVE",
      "Maker-checker control blocked this approval because the submitter cannot approve their own high-risk change.",
    );
  }
  const result = await pool.query<Record<string, unknown>>(
    `
      UPDATE mdm_change_requests
      SET status = 'approved',
          approved_by = $3,
          reason = COALESCE($4, reason),
          decided_at = NOW()
      WHERE organization_id = $1 AND id = $2
      RETURNING *
    `,
    [input.organizationId, input.id, input.actorId, input.reason],
  );
  await pool.query(
    `
      INSERT INTO mdm_change_request_steps (organization_id, change_request_id, step, status, actor_id, reason, created_at)
      VALUES ($1, $2, 'approval', 'approved', $3, $4, NOW())
    `,
    [input.organizationId, input.id, input.actorId, input.reason],
  );
  return rowToCamel(result.rows[0] ?? {});
}

export async function listMdmChangeRequests(organizationId: number) {
  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT *
      FROM mdm_change_requests
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `,
    [organizationId],
  );
  return result.rows.map(rowToCamel);
}

import { pool } from "../../db";
import {
  createMdmDomainRecord,
  isMdmDomain,
  updateMdmDomainRecord,
} from "./mdm-control-centre";
import { getMdmDomainRegistryEntry, isHighRiskMdmField } from "./mdm-domain-registry";

export type MdmChangeRequestAction = "create" | "update" | "deactivate" | "archive";
export type MdmChangeRequestStatus =
  | "draft"
  | "submitted"
  | "validation_passed"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "applied"
  | "failed_to_apply";

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

async function findChangeRequest(organizationId: number, id: number) {
  const existing = await pool.query<Record<string, unknown>>(
    "SELECT * FROM mdm_change_requests WHERE organization_id = $1 AND id = $2",
    [organizationId, id],
  );
  return existing.rows[0] ?? null;
}

async function writeStep(input: {
  organizationId: number;
  changeRequestId: number;
  step: string;
  status: MdmChangeRequestStatus | "commented";
  actorId?: number | null;
  reason?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}) {
  await pool.query(
    `
      INSERT INTO mdm_change_request_steps (
        organization_id, change_request_id, step, status, actor_id, reason, before_state, after_state, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
    [
      input.organizationId,
      input.changeRequestId,
      input.step,
      input.status,
      input.actorId ?? null,
      input.reason ?? null,
      input.beforeState ?? null,
      input.afterState ?? null,
    ],
  );
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
  if (result.rows[0]?.id) {
    await writeStep({
      organizationId: input.organizationId,
      changeRequestId: Number(result.rows[0].id),
      step: "submission",
      status: status as MdmChangeRequestStatus,
      actorId: input.submittedBy ?? null,
      reason: input.reason ?? null,
      beforeState: input.beforeState ?? null,
      afterState: input.proposedPatch,
    });
  }
  return rowToCamel(result.rows[0] ?? {});
}

export async function approveMdmChangeRequest(input: {
  organizationId: number;
  id: number;
  actorId: number;
  reason: string;
  allowAdminOverride?: boolean;
}) {
  const row = await findChangeRequest(input.organizationId, input.id);
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
      WHERE organization_id = $1 AND id = $2 AND status IN ('submitted', 'validation_passed', 'pending_approval')
      RETURNING *
    `,
    [input.organizationId, input.id, input.actorId, input.reason],
  );
  if (result.rowCount === 0) {
    throw new MdmApprovalError(
      "MDM_CHANGE_REQUEST_NOT_APPROVABLE",
      "Only submitted, validation-passed, or pending-approval Master Data changes can be approved.",
      409,
    );
  }
  await writeStep({
    organizationId: input.organizationId,
    changeRequestId: input.id,
    step: input.allowAdminOverride ? "admin_override_approval" : "approval",
    status: "approved",
    actorId: input.actorId,
    reason: input.reason,
    beforeState: row,
    afterState: result.rows[0] ?? null,
  });
  return rowToCamel(result.rows[0] ?? {});
}

export async function rejectMdmChangeRequest(input: {
  organizationId: number;
  id: number;
  actorId: number;
  reason: string;
}) {
  const existing = await findChangeRequest(input.organizationId, input.id);
  if (!existing) return null;
  const result = await pool.query<Record<string, unknown>>(
    `
      UPDATE mdm_change_requests
      SET status = 'rejected',
          rejected_by = $3,
          reason = COALESCE($4, reason),
          decided_at = NOW()
      WHERE organization_id = $1
        AND id = $2
        AND status NOT IN ('applied', 'rejected')
      RETURNING *
    `,
    [input.organizationId, input.id, input.actorId, input.reason],
  );
  if (result.rowCount === 0) {
    throw new MdmApprovalError(
      "MDM_CHANGE_REQUEST_NOT_REJECTABLE",
      "Applied or already rejected Master Data changes cannot be rejected.",
      409,
    );
  }
  await writeStep({
    organizationId: input.organizationId,
    changeRequestId: input.id,
    step: "rejection",
    status: "rejected",
    actorId: input.actorId,
    reason: input.reason,
    beforeState: existing,
    afterState: result.rows[0] ?? null,
  });
  return rowToCamel(result.rows[0] ?? {});
}

export async function applyMdmChangeRequest(input: {
  organizationId: number;
  id: number;
  actorId: number;
  reason?: string;
  allowAdminOverride?: boolean;
}) {
  const row = await findChangeRequest(input.organizationId, input.id);
  if (!row) return null;
  if (String(row.status) === "applied") {
    throw new MdmApprovalError("MDM_CHANGE_ALREADY_APPLIED", "This Master Data change was already applied.", 409);
  }
  if (String(row.status) !== "approved" && input.allowAdminOverride !== true) {
    throw new MdmApprovalError(
      "MDM_CHANGE_NOT_APPROVED",
      "Only approved Master Data changes can be applied unless an explicit admin override is recorded.",
      409,
    );
  }

  const domain = String(row.domain ?? "");
  const action = String(row.action ?? "update") as MdmChangeRequestAction;
  const proposedPatch =
    row.proposed_patch && typeof row.proposed_patch === "object" ? (row.proposed_patch as Record<string, unknown>) : {};
  const beforeState =
    row.before_state && typeof row.before_state === "object" ? (row.before_state as Record<string, unknown>) : null;
  let afterState: Record<string, unknown> | null = null;

  try {
    if (!isMdmDomain(domain)) {
      throw new MdmApprovalError("MDM_DOMAIN_NOT_FOUND", `Unknown MDM domain: ${domain}`, 404);
    }
    if (action === "create") {
      afterState = (await createMdmDomainRecord(domain, input.organizationId, proposedPatch, input.actorId)) as Record<
        string,
        unknown
      >;
    } else {
      const entityId = Number(row.entity_id);
      if (!Number.isFinite(entityId)) {
        throw new MdmApprovalError("MDM_CHANGE_TARGET_REQUIRED", "A target record is required for this change.", 400);
      }
      const patch =
        action === "deactivate" || action === "archive"
          ? { ...proposedPatch, active: false }
          : proposedPatch;
      afterState = (await updateMdmDomainRecord(domain, input.organizationId, entityId, patch, input.actorId)) as
        | Record<string, unknown>
        | null;
      if (!afterState) throw new MdmApprovalError("MDM_CHANGE_TARGET_NOT_FOUND", "Target MDM record not found.", 404);
    }

    const result = await pool.query<Record<string, unknown>>(
      `
        UPDATE mdm_change_requests
        SET status = 'applied',
            reason = COALESCE($3, reason)
        WHERE organization_id = $1 AND id = $2 AND status <> 'applied'
        RETURNING *
      `,
      [input.organizationId, input.id, input.reason ?? null],
    );
    await writeStep({
      organizationId: input.organizationId,
      changeRequestId: input.id,
      step: input.allowAdminOverride ? "admin_override_apply" : "apply",
      status: "applied",
      actorId: input.actorId,
      reason: input.reason ?? null,
      beforeState,
      afterState,
    });
    return rowToCamel(result.rows[0] ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `
        UPDATE mdm_change_requests
        SET status = 'failed_to_apply',
            reason = COALESCE($3, reason)
        WHERE organization_id = $1 AND id = $2
      `,
      [input.organizationId, input.id, message],
    );
    await writeStep({
      organizationId: input.organizationId,
      changeRequestId: input.id,
      step: "apply",
      status: "failed_to_apply",
      actorId: input.actorId,
      reason: message,
      beforeState,
      afterState,
    });
    throw error;
  }
}

export async function addMdmChangeRequestComment(input: {
  organizationId: number;
  id: number;
  actorId: number;
  comment: string;
}) {
  const row = await findChangeRequest(input.organizationId, input.id);
  if (!row) return null;
  const result = await pool.query<Record<string, unknown>>(
    `
      INSERT INTO mdm_change_request_comments (organization_id, change_request_id, comment, created_by, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `,
    [input.organizationId, input.id, input.comment, input.actorId],
  );
  await writeStep({
    organizationId: input.organizationId,
    changeRequestId: input.id,
    step: "comment",
    status: "commented",
    actorId: input.actorId,
    reason: input.comment,
  });
  return rowToCamel(result.rows[0] ?? {});
}

export async function getMdmChangeRequest(organizationId: number, id: number) {
  const row = await findChangeRequest(organizationId, id);
  if (!row) return null;
  const [steps, comments] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `
        SELECT *
        FROM mdm_change_request_steps
        WHERE organization_id = $1 AND change_request_id = $2
        ORDER BY created_at ASC, id ASC
      `,
      [organizationId, id],
    ),
    pool.query<Record<string, unknown>>(
      `
        SELECT *
        FROM mdm_change_request_comments
        WHERE organization_id = $1 AND change_request_id = $2
        ORDER BY created_at ASC, id ASC
      `,
      [organizationId, id],
    ),
  ]);
  return {
    ...rowToCamel(row),
    steps: steps.rows.map(rowToCamel),
    comments: comments.rows.map(rowToCamel),
  };
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

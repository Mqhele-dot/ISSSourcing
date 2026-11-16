import { once } from "node:events";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../../db";
import { getTenantContext } from "../../organization-context";
import { appendAuditEventWithClient } from "../../services/audit-chain-service";
import { documentAccess } from "../documents/document-access";
import { documentColumnsSql, documentProofsSql, openDocument, type EvidenceRow } from "../documents/document-evidence";

type Input = { organizationId: number; id: number; actorId: number; reason?: string; allowAdminOverride?: boolean };
type RequestRow = { id: number; action: string; entity_id: number | null; proposed_patch: Record<string, unknown>; submitted_by: number | null; status: string };
type Target = { supplier_id: number; document_type: string; document_id: number; expiry_date: string | null; required_for_po: boolean | null };
type Frozen = { target: Target | null; supplierId: number; documentType: string; documentId: number; documentVersion: number; sha256: string; expiresAt: string | null; requiredForPo: boolean; withdrawn: boolean; priorId: string | null };
const fail = (code: string, message: string, status = 409) => Object.assign(new Error(message), { code, status });
const id = z.number().int().min(1).max(2147483647);
const patchSchema = z.object({ supplierId: id.optional(), documentType: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/).optional(),
  documentId: id.optional(), expiryDate: z.string().datetime({ offset: true }).nullable().optional(), requiredForPo: z.boolean().optional(), status: z.literal("approved").optional() }).strict();
const requestPayload = (row: RequestRow) => ({ action: row.action, entityId: row.action === "create" ? null : row.entity_id, patch: row.proposed_patch });

async function transaction<T>(input: Input, work: (client: PoolClient, row: RequestRow) => Promise<T>): Promise<T> {
  if (input.allowAdminOverride) throw fail("SUPPLIER_COMPLIANCE_OVERRIDE_DENIED", "Compliance approval cannot be overridden.", 403);
  const actor = getTenantContext();
  if (actor.organizationId !== input.organizationId || actor.userId !== input.actorId) throw fail("SUPPLIER_COMPLIANCE_ACCESS_DENIED", "Current organization access is required.", 403);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock($1,$2)", [812743, input.organizationId]);
    const [row] = (await client.query<RequestRow>("SELECT * FROM mdm_change_requests WHERE organization_id=$1 AND id=$2 AND domain='supplier-documents' FOR UPDATE", [input.organizationId, input.id])).rows;
    if (!row) throw fail("SUPPLIER_COMPLIANCE_REQUEST_NOT_FOUND", "Compliance request not found.", 404);
    const access = await documentAccess(client, actor, true, true);
    if (!await access.can("suppliers") || (!await access.can("suppliers", "update") && !await access.can("suppliers", "manage"))) throw fail("SUPPLIER_COMPLIANCE_ACCESS_DENIED", "Current supplier stewardship and document access are required.", 403);
    const result = await work(client, row);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function sourceRecord(client: PoolClient, org: number, row: RequestRow): Promise<Target | null> {
  if (row.action === "create") return null;
  const [record] = (await client.query<{ target: Target }>("SELECT to_jsonb(s) AS target FROM mdm_supplier_documents s WHERE organization_id=$1 AND id=$2 FOR UPDATE", [org, row.entity_id])).rows;
  if (!record) throw fail("SUPPLIER_COMPLIANCE_TARGET_NOT_FOUND", "Compliance record not found.", 404);
  return record.target;
}

async function latest(client: PoolClient, org: number, supplier: number, type: string) {
  return (await client.query<{ id: string; source_record_id: number; document_id: number; document_version: number; sha256: string; withdrawn: boolean }>(
    "SELECT id::text,source_record_id,document_id,document_version,sha256,withdrawn FROM supplier_compliance_publications WHERE organization_id=$1 AND supplier_id=$2 AND document_type=$3 ORDER BY id DESC LIMIT 1", [org, supplier, type])).rows[0];
}

export async function verifiedSupplierComplianceDocument(client: PoolClient, org: number, supplier: number, documentId: number) {
  const [row] = (await client.query<EvidenceRow>(`${documentProofsSql} SELECT ${documentColumnsSql}
    FROM documents d LEFT JOIN proofs p ON p.resource_id=d.id WHERE d.organization_id=$1 AND d.entity_type='supplier'
    AND d.entity_id=$2 AND d.id=$3 AND d.archived_at IS NULL FOR SHARE OF d`, [org, supplier, documentId])).rows;
  if (!row?.proofHash) throw fail("SUPPLIER_COMPLIANCE_SOURCE_UNVERIFIED", "Attach an available, verified document belonging to this supplier.");
  try {
    const stream = await openDocument(row);
    const closed = once(stream, "close");
    stream.destroy();
    await closed;
  } catch { throw fail("SUPPLIER_COMPLIANCE_SOURCE_UNVERIFIED", "The approved document bytes could not be verified. Upload a verified document and resubmit."); }
  return { documentVersion: row.version, sha256: row.proofHash };
}

export async function approveSupplierCompliance(input: Input) {
  return transaction(input, async (client, row) => {
    const org = input.organizationId;
    if (!row.submitted_by || row.submitted_by === input.actorId) throw fail("SUPPLIER_COMPLIANCE_INDEPENDENT_APPROVAL", "A different authorized person must approve this evidence.", 403);
    if (!["submitted", "validation_passed", "pending_approval"].includes(row.status)) throw fail("SUPPLIER_COMPLIANCE_NOT_APPROVABLE", "This request is not awaiting approval.");
    const withdrawn = ["archive", "deactivate"].includes(row.action);
    if (!["create", "update", "archive", "deactivate"].includes(row.action)) throw fail("SUPPLIER_COMPLIANCE_INVALID_ACTION", "Choose a supported compliance action.", 400);
    const parsed = patchSchema.safeParse(row.proposed_patch);
    if (!parsed.success || (withdrawn && Object.keys(row.proposed_patch).length)) throw fail("SUPPLIER_COMPLIANCE_INVALID_FIELDS", "Provide valid supplier document fields, or an empty withdrawal patch.", 400);
    const patch = parsed.data;
    const target = await sourceRecord(client, org, row);
    const supplierId = patch.supplierId ?? target?.supplier_id;
    const documentType = patch.documentType ?? target?.document_type;
    const documentId = patch.documentId ?? target?.document_id;
    if (!supplierId || !documentId || !documentType || (target && (target.supplier_id !== supplierId || target.document_type !== documentType))) {
      throw fail("SUPPLIER_COMPLIANCE_INVALID_LINK", "A compliance record must keep its supplier and evidence type. Choose a verified source document.");
    }
    if (!(await client.query("SELECT 1 FROM suppliers WHERE organization_id=$1 AND id=$2 FOR SHARE", [org, supplierId])).rowCount) throw fail("SUPPLIER_NOT_FOUND", "Supplier not found.", 404);
    const prior = await latest(client, org, supplierId, documentType);
    if ((withdrawn && (!prior || prior.withdrawn || prior.source_record_id !== row.entity_id)) || (!withdrawn && target && prior && prior.source_record_id !== row.entity_id)) {
      throw fail("SUPPLIER_COMPLIANCE_SUPERSEDED", "Use the latest published compliance record or submit a new publication.");
    }
    const expiry = patch.expiryDate !== undefined ? patch.expiryDate : target?.expiry_date ? `${target.expiry_date}Z` : null;
    const date = expiry ? new Date(expiry) : null;
    if (!withdrawn && date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) throw fail("SUPPLIER_COMPLIANCE_EXPIRED", "Provide a future expiry or leave it unset if the evidence has no expiry.");
    const proof = withdrawn ? { documentVersion: prior!.document_version, sha256: prior!.sha256 } : await verifiedSupplierComplianceDocument(client, org, supplierId, documentId);
    const frozen: Frozen = { target, supplierId, documentType, documentId: withdrawn ? prior!.document_id : documentId, ...proof,
      expiresAt: withdrawn ? null : date?.toISOString() ?? null, requiredForPo: patch.requiredForPo ?? target?.required_for_po ?? false, withdrawn, priorId: prior?.id ?? null };
    await client.query("INSERT INTO supplier_compliance_approvals(organization_id,change_request_id,maker_id,approver_id,request_payload,frozen) VALUES($1,$2,$3,$4,$5,$6)",
      [org, row.id, row.submitted_by, input.actorId, requestPayload(row), frozen]);
    await client.query("UPDATE mdm_change_requests SET status='approved',approved_by=$3,decided_at=clock_timestamp() WHERE organization_id=$1 AND id=$2", [org, row.id, input.actorId]);
    await recordStep(client, input, "approval", "approved");
    return { id: row.id, status: "approved" };
  });
}

async function recordStep(client: PoolClient, input: Input, step: string, status: string, publicationId?: string) {
  const details = publicationId ? { publicationId } : null;
  await client.query("INSERT INTO mdm_change_request_steps(organization_id,change_request_id,step,status,actor_id,reason,after_state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())",
    [input.organizationId, input.id, step, status, input.actorId, input.reason ?? null, details]);
  await appendAuditEventWithClient(client, { organizationId: input.organizationId, actor: { userId: input.actorId }, action: step === "approval" ? "SUPPLIER_COMPLIANCE_APPROVED" : "SUPPLIER_COMPLIANCE_PUBLISHED",
    resourceType: "mdm_change_request", resourceId: input.id, reason: input.reason, details: details ?? undefined });
}

export async function applySupplierCompliance(input: Input) {
  return transaction(input, async (client, row) => {
    const org = input.organizationId;
    const [approval] = (await client.query<{ frozen: Frozen; matches: boolean; maker_id: number }>("SELECT frozen,maker_id,request_payload=$3::jsonb AS matches FROM supplier_compliance_approvals WHERE organization_id=$1 AND change_request_id=$2",
      [org, row.id, requestPayload(row)])).rows;
    if (!approval?.matches || approval.maker_id !== row.submitted_by) throw fail("SUPPLIER_COMPLIANCE_APPROVAL_REQUIRED", "Apply an unchanged, independently approved request.");
    const [previous] = (await client.query<{ id: string }>("SELECT id::text FROM supplier_compliance_publications WHERE organization_id=$1 AND change_request_id=$2", [org, row.id])).rows;
    if (previous && row.status === "applied") return { id: row.id, status: "applied", publicationId: previous.id };
    if (row.status !== "approved") throw fail("SUPPLIER_COMPLIANCE_APPROVAL_REQUIRED", "An independent approval is required before publication.");
    const f = approval.frozen;
    const target = await sourceRecord(client, org, row);
    const prior = await latest(client, org, f.supplierId, f.documentType);
    const matches = row.action === "create" || (await client.query("SELECT to_jsonb(s)=$3::jsonb AS matches FROM mdm_supplier_documents s WHERE organization_id=$1 AND id=$2", [org, row.entity_id, f.target])).rows[0]?.matches;
    if ((!target && row.action !== "create") || !matches || (prior?.id ?? null) !== f.priorId) throw fail("SUPPLIER_COMPLIANCE_STALE", "The evidence changed after approval. Submit a fresh review.");
    if (!(await client.query("SELECT 1 FROM suppliers WHERE organization_id=$1 AND id=$2 FOR SHARE", [org, f.supplierId])).rowCount) throw fail("SUPPLIER_NOT_FOUND", "Supplier not found.", 404);
    if (!f.withdrawn) {
      const proof = await verifiedSupplierComplianceDocument(client, org, f.supplierId, f.documentId);
      if (proof.documentVersion !== f.documentVersion || proof.sha256 !== f.sha256 || (f.expiresAt && new Date(f.expiresAt).getTime() <= Date.now())) {
        throw fail("SUPPLIER_COMPLIANCE_STALE", "The verified source changed or expired after approval. Submit a fresh review.");
      }
    }
    const status = f.withdrawn ? "withdrawn" : "approved";
    let sourceId = row.entity_id;
    if (row.action === "create") {
      sourceId = (await client.query("INSERT INTO mdm_supplier_documents(organization_id,supplier_id,document_type,document_id,status,expiry_date,required_for_po) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [org, f.supplierId, f.documentType, f.documentId, status, f.expiresAt, f.requiredForPo])).rows[0].id;
    } else {
      await client.query("UPDATE mdm_supplier_documents SET document_id=$3,status=$4,expiry_date=$5,required_for_po=$6,updated_at=now() WHERE organization_id=$1 AND id=$2",
        [org, sourceId, f.documentId, status, f.expiresAt, f.requiredForPo]);
    }
    const [publication] = (await client.query<{ id: string }>(`INSERT INTO supplier_compliance_publications(organization_id,supplier_id,document_type,source_record_id,document_id,document_version,sha256,expires_at,withdrawn,change_request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text`, [org, f.supplierId, f.documentType, sourceId, f.documentId, f.documentVersion, f.sha256, f.expiresAt, f.withdrawn, row.id])).rows;
    await client.query("UPDATE mdm_change_requests SET status='applied',entity_id=$3 WHERE organization_id=$1 AND id=$2", [org, row.id, sourceId]);
    await recordStep(client, input, "apply", "applied", publication.id);
    return { id: row.id, status: "applied", publicationId: publication.id };
  });
}

/** Latest publication is authoritative; never fall back after withdrawal/expiry. */
export async function readPublishedSupplierCompliance(client: PoolClient, org: number, supplier: number, at: Date, lock = false, requiredTypes: readonly string[] | null = null) {
  const result = await client.query<{ id: string; documentType: string; sourceRecordId: number; documentId: number; documentVersion: number; sha256: string; effectiveAt: Date; expiresAt: Date | null; withdrawn: boolean; sourceMatches: boolean }>(`WITH latest AS (
    SELECT DISTINCT ON(document_type) * FROM supplier_compliance_publications WHERE organization_id=$1 AND supplier_id=$2 AND effective_at<=$3
    AND ($4::text[] IS NULL OR document_type=ANY($4::text[]))
    ORDER BY document_type,id DESC
  ) SELECT p.id::text,p.document_type AS "documentType",p.source_record_id AS "sourceRecordId",p.document_id AS "documentId",p.document_version AS "documentVersion",p.sha256,p.effective_at AS "effectiveAt",p.expires_at AS "expiresAt",p.withdrawn,
    coalesce((SELECT d.version=p.document_version AND d.checksum=p.sha256 AND d.archived_at IS NULL FROM documents d
      WHERE d.organization_id=p.organization_id AND d.entity_type='supplier' AND d.entity_id=p.supplier_id AND d.id=p.document_id${lock ? " FOR SHARE" : ""}),false) AS "sourceMatches"
    FROM latest p ORDER BY p.document_type LIMIT 100`, [org, supplier, at, requiredTypes]);
  return result.rows.map(row => ({ ...row, state: row.withdrawn ? "withdrawn" : row.expiresAt && row.expiresAt <= at ? "expired" : !row.sourceMatches ? "unavailable" : "verified" }));
}

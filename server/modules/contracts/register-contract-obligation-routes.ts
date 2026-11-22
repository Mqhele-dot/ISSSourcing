import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { resolveRequestId, sendError, sendOk } from "../../api-response";
import { pool } from "../../db";
import { getTenantContext, type TenantContext } from "../../organization-context";
import { appendAuditEventWithClient } from "../../services/audit-chain-client";
import { DocumentAccessError, documentAccess } from "../documents/document-access";
import { documentColumnsSql, documentProofsSql, openDocument, type EvidenceRow } from "../documents/document-evidence";
import type { AuthBundle } from "../procurement/types";
import { OrganizationCalendarError, readOrganizationCalendar } from "../../lib/organization-calendar";

const id = z.number().int().positive().max(2147483647);
const pathId = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(id);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const note = z.string().trim().min(5).max(1000);
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value);
  return value.slice(0, 4) !== "0000" && Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
});
const terms = { title: z.string().trim().min(1).max(160), ownerUserId: id, dueDate, note };
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...terms }).strict(),
  z.object({ action: z.literal("revise"), obligationId: uuid, revision: id, ...terms }).strict(),
  z.object({ action: z.literal("complete"), obligationId: uuid, revision: id, note, documentId: id, documentVersion: id }).strict(),
  z.object({ action: z.literal("cancel"), obligationId: uuid, revision: id, note }).strict(),
]);
const pageFields = { page: z.coerce.number().int().min(1).max(400).default(1), pageSize: z.enum(["25", "50", "100"]).default("25").transform(Number) };
const pageQuery = z.object(pageFields).strict();
const listQuery = pageQuery.extend({ obligationId: uuid.optional() }).refine(query=>!query.obligationId || query.page===1);
const ownersQuery = z.object({ ...pageFields, q: z.string().trim().max(80).default("") }).strict();
type Scope = { client: PoolClient; req: Request; requestId: string; actor: TenantContext; contract: number; access: Awaited<ReturnType<typeof documentAccess>> };
class ObligationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function requireResult(ok: unknown, status: number, code: string, message: string): asserts ok {
  if (!ok) throw new ObligationError(status, code, message);
}

const projection = (todayParameter: "$6" | "$7") => `
  v.obligation_id AS "obligationId", v.revision, v.title, v.owner_user_id AS "ownerUserId",
  (SELECT u.username FROM users u WHERE u.id=v.owner_user_id AND u.active AND EXISTS (
    SELECT 1 FROM organization_members m WHERE m.organization_id=v.organization_id AND m.user_id=u.id
      AND m.active AND m.status='active')) AS "ownerName",
  to_char(v.due_date,'YYYY-MM-DD') AS "dueDate", v.state, v.note, v.recorded_at AS "recordedAt",
  (v.state='open' AND v.due_date < ${todayParameter}::date) AS overdue,
  CASE WHEN $5::boolean AND d.id IS NOT NULL THEN v.document_id END AS "documentId",
  CASE WHEN $5::boolean AND d.id IS NOT NULL THEN v.document_version END AS "documentVersion"`;
const documentJoin = `LEFT JOIN documents d ON d.organization_id=v.organization_id AND d.entity_type='contract'
  AND d.entity_id=v.contract_id AND d.id=v.document_id AND d.version=v.document_version AND d.checksum=v.document_sha256`;

export function registerContractObligationRoutes(app: Express, auth: AuthBundle) {
  const root = "/api/v2/procurement/contracts/:contractId/obligations";
  const read = [auth.ensureAuthenticated, auth.ensurePermission("purchases", "read")];
  function scoped(write: boolean, run: (scope: Scope) => Promise<unknown>) {
    return async (req: Request, res: Response) => {
      let client: PoolClient | undefined;
      try {
        const contract = pathId.parse(req.params.contractId), actor = getTenantContext();
        client = await pool.connect();
        await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout='5s'");
        const access = await documentAccess(client, actor, false, write);
        requireResult(await access.can("purchases"), 403, "OBLIGATION_SCOPE_DENIED", "Purchase read access is required.");
        const source = await client.query(`SELECT c.id FROM supplier_contracts c
          JOIN suppliers s ON s.id=c.supplier_id AND s.organization_id=c.organization_id
          WHERE c.organization_id=$1 AND c.id=$2${write ? " FOR UPDATE OF c" : ""}`, [actor.organizationId, contract]);
        requireResult(source.rowCount, 404, "CONTRACT_NOT_FOUND", "This contract is not available.");
        const result = await run({ client, req, requestId: resolveRequestId(res), actor, contract, access });
        await client.query("COMMIT");
        res.setHeader("Cache-Control", "private, no-store");
        return sendOk(res, result);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        if (error instanceof z.ZodError) return sendError(res, 400, "OBLIGATION_INPUT_INVALID", "Choose valid obligation fields, dates and page settings.");
        if (error instanceof ObligationError || error instanceof DocumentAccessError) return sendError(res, error.status, error.code, error.message);
        if (error instanceof OrganizationCalendarError && error.reason === "invalid_timezone")
          return sendError(res,409,"OBLIGATION_TIMEZONE_SETUP_REQUIRED",error.message);
        return sendError(res, 503, "OBLIGATIONS_UNAVAILABLE", "Contract obligations are unavailable. Retry or ask an administrator to verify the obligations migration.");
      } finally {
        client?.release();
      }
    };
  }

  app.get(root, ...read, scoped(false, async ({ client, req, actor, contract, access }) => {
    const { page, pageSize, obligationId } = listQuery.parse(req.query);
    const { today, timezone } = await readOrganizationCalendar(client, actor.organizationId);
    const { rows } = await client.query(`WITH latest AS (
      SELECT DISTINCT ON (obligation_id) * FROM contract_obligation_versions
      WHERE organization_id=$1 AND contract_id=$2 AND ($7::uuid IS NULL OR obligation_id=$7) ORDER BY obligation_id, revision DESC
    ) SELECT ${projection("$6")} FROM latest v ${documentJoin}
      ORDER BY (v.state='open') DESC,v.due_date,v.obligation_id LIMIT $3 OFFSET $4`,
    [actor.organizationId, contract, pageSize + 1, (page - 1) * pageSize, access.types.includes("contract"), today, obligationId ?? null]);
    if(obligationId) requireResult(rows.length,404,"OBLIGATION_NOT_FOUND","This obligation is not available on the selected contract.");
    return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize, today, timezone };
  }));

  app.get(`${root}/owners`, ...read, scoped(false, async ({ client, req, actor, access }) => {
    requireResult(await access.can("purchases", "manage"), 403, "OBLIGATION_MANAGE_REQUIRED", "Purchase manage access is required.");
    const { page, pageSize, q } = ownersQuery.parse(req.query);
    const { rows } = await client.query(`SELECT DISTINCT u.id,u.username AS name FROM organization_members m
      JOIN users u ON u.id=m.user_id AND u.active WHERE m.organization_id=$1 AND m.active AND m.status='active'
      AND strpos(lower(u.username),lower($2))>0 ORDER BY name,id LIMIT $3 OFFSET $4`,
    [actor.organizationId, q, pageSize + 1, (page - 1) * pageSize]);
    return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
  }));

  app.get(`${root}/:obligationId/history`, ...read, scoped(false, async ({ client, req, actor, contract, access }) => {
    const obligation = uuid.parse(req.params.obligationId), { page, pageSize } = pageQuery.parse(req.query);
    const { today, timezone } = await readOrganizationCalendar(client, actor.organizationId);
    const { rows } = await client.query(`SELECT ${projection("$7")} FROM contract_obligation_versions v ${documentJoin}
      WHERE v.organization_id=$1 AND v.contract_id=$2 AND v.obligation_id=$6 ORDER BY v.revision DESC LIMIT $3 OFFSET $4`,
    [actor.organizationId, contract, pageSize + 1, (page - 1) * pageSize, access.types.includes("contract"), obligation, today]);
    return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize, today, timezone };
  }));

  app.post(root, ...read, auth.ensureTwoFactorAuthenticated, scoped(true, async ({ client, req, requestId, actor, contract, access }) => {
    const input = command.parse(req.body), key = uuid.parse(req.get("Idempotency-Key"));
    const organization = actor.organizationId;
    const canManage = await access.can("purchases", "manage");
    requireResult(input.action === "complete" || canManage, 403, "OBLIGATION_MANAGE_REQUIRED", "Purchase manage access is required.");
    requireResult(input.action !== "complete" || access.types.includes("contract"), 403, "OBLIGATION_DOCUMENT_ACCESS_REQUIRED", "Contract document access is required to record completion.");
    const replay = await client.query(`SELECT obligation_id AS "obligationId",revision,
      (command_payload=$4::jsonb AND actor_user_id=$5) AS matches FROM contract_obligation_versions
      WHERE organization_id=$1 AND contract_id=$2 AND command_id=$3`, [organization, contract, key, input, actor.userId]);
    if (replay.rowCount) {
      const { matches, ...saved } = replay.rows[0];
      requireResult(matches, 409, "OBLIGATION_COMMAND_CONFLICT", "This command key already identifies a different change.");
      return saved;
    }
    const obligation = input.action === "create" ? key : input.obligationId;
    const previous = input.action === "create" ? null : (await client.query(`SELECT revision,state,title,
      owner_user_id AS "ownerUserId",to_char(due_date,'YYYY-MM-DD') AS "dueDate"
      FROM contract_obligation_versions WHERE organization_id=$1 AND contract_id=$2 AND obligation_id=$3
      ORDER BY revision DESC LIMIT 1`, [organization, contract, obligation])).rows[0];
    if (input.action !== "create") {
      requireResult(previous, 404, "OBLIGATION_NOT_FOUND", "This obligation is not available.");
      requireResult(input.action !== "complete" || actor.userId === previous.ownerUserId, 403, "OBLIGATION_OWNER_REQUIRED", "Only the current owner can record completion.");
      requireResult(previous.revision === input.revision && previous.state === "open", 409, "OBLIGATION_CHANGED", "The obligation has changed or is closed. Refresh and review it.");
    }
    const fields = input.action === "create" || input.action === "revise" ? input : previous;
    if (input.action === "create" || input.action === "revise") {
      const member = await client.query(`SELECT 1 FROM organization_members m JOIN users u ON u.id=m.user_id AND u.active
        WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND m.status='active' FOR SHARE OF m,u`, [organization, fields.ownerUserId]);
      requireResult(member.rowCount, 409, "OBLIGATION_OWNER_UNAVAILABLE", "Choose an active member of this organization.");
    }
    let document: EvidenceRow | undefined;
    if (input.action === "complete") {
      const source = await client.query<EvidenceRow>(`${documentProofsSql} SELECT ${documentColumnsSql} FROM documents d
        LEFT JOIN proofs p ON p.resource_id=d.id WHERE d.organization_id=$1 AND d.entity_type='contract'
        AND d.entity_id=$2 AND d.id=$3 AND d.version=$4 AND d.archived_at IS NULL FOR SHARE OF d`,
      [organization, contract, input.documentId, input.documentVersion]);
      document = source.rows[0];
      requireResult(document?.proofHash, 409, "OBLIGATION_DOCUMENT_UNVERIFIED", "Select a current, verified document attached to this contract.");
      try {
        const stream = await openDocument(document);
        await new Promise<void>((resolve, reject) => { stream.once("close", resolve); stream.once("error", reject); stream.destroy(); });
      } catch {
        throw new ObligationError(409, "OBLIGATION_DOCUMENT_UNVERIFIED", "The evidence file could not be verified. Upload a valid contract document.");
      }
    }
    const state = input.action === "complete" ? "completed" : input.action === "cancel" ? "cancelled" : "open";
    const revision = (previous?.revision ?? 0) + 1;
    await client.query(`INSERT INTO contract_obligation_versions(organization_id,contract_id,obligation_id,revision,command_id,command_payload,
      title,owner_user_id,due_date,state,note,document_id,document_version,document_sha256,actor_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [organization, contract, obligation, revision, key, input, fields.title, fields.ownerUserId, fields.dueDate, state, input.note,
      document?.id ?? null, document?.version ?? null, document?.proofHash ?? null, actor.userId]);
    await appendAuditEventWithClient(client, { organizationId: organization, actor: { userId: actor.userId },
      resourceType: "supplier_contract", resourceId: contract, action: `CONTRACT_OBLIGATION_${input.action.toUpperCase()}`,
      before: previous, after: { obligation, revision, title: fields.title, dueDate: fields.dueDate, ownerUserId: fields.ownerUserId,
        state, documentId: document?.id, documentVersion: document?.version }, reason: input.note, requestId });
    return { obligationId: obligation, revision };
  }));
}

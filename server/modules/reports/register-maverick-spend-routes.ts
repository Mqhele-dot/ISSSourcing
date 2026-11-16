import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { sendError, sendOk } from "../../api-response";
import { pool } from "../../db";
import { getTenantContext } from "../../organization-context";
import { DocumentAccessError, documentAccess } from "../documents/document-access";
import type { AuthBundle } from "../procurement/types";
import { approvedOrderScopeSql, approvedOrderStates, orderDateSupplierScopeSql, readFinancialSourceContributions } from "./financial-source-contributions";
import { hasAgreementReleaseEvidence } from "../procurement-completion/agreement-release-evidence";
import { maverickEvidenceFamilies, type MaverickEvidenceCoverage, type MaverickEvidenceFamily } from "@shared/maverick-evidence";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = new Date(`${value}T00:00:00Z`);
  return !value.startsWith("0000") && Number.isFinite(+time) && time.toISOString().slice(0,10) === value;
});

const filters = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.enum(["25", "50", "100"]).default("25").transform(Number),
  outcome: z.enum(["all", "outside_budget", "within_budget", "unverified", "approved_override", "agreement_release", "po_submission", "po_conversion"]).default("outside_budget"),
  evidenceFamily: z.custom<MaverickEvidenceFamily>(value => typeof value === "string" && Object.hasOwn(maverickEvidenceFamilies,value)).optional(),
  from: date.optional(),
  to: date.optional(),
  supplierId: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647)).optional(),
}).strict().refine(query => (!query.from||!query.to||query.from<=query.to) &&
  (!query.evidenceFamily||query.outcome==="unverified"));

export function registerMaverickSpendRoutes(app: Express, auth: AuthBundle) {
  app.get("/api/v2/procurement/maverick-spend", auth.ensureAuthenticated, auth.ensurePermission("purchases", "read"), async (req, res) => {
    let client: PoolClient | undefined;
    try {
      const query = filters.parse(req.query), actor = getTenantContext();
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout='5s'");
      const access = await documentAccess(client, actor, false);
      if (!await access.can("purchases")) throw new DocumentAccessError(403, "PURCHASE_EVIDENCE_SCOPE_DENIED", "Current purchase access is required.");
      if (query.supplierId != null) {
        if (!await access.can("suppliers")) throw new DocumentAccessError(403,"PURCHASE_EVIDENCE_SUPPLIER_DENIED","Supplier read access is required to filter this evidence.");
        if (!(await client.query("SELECT 1 FROM suppliers WHERE organization_id=$1 AND id=$2",[actor.organizationId,query.supplierId])).rowCount)
          throw new DocumentAccessError(404,"PURCHASE_EVIDENCE_SUPPLIER_NOT_FOUND","The selected supplier is not available.");
      }
      const scope = {from:query.from,to:query.to,supplierId:query.supplierId};
      const captureAvailable = await hasAgreementReleaseEvidence(client);
      const agreementVersion = captureAvailable ? "release_evidence.agreement_version" : "NULL::int";
      const result = await client.query(`WITH scoped_orders AS MATERIALIZED (
          SELECT p.id,p.order_number,p.order_date,p.organization_id,p.requisition_id,p.sourcing_award_id,p.contract_id,p.supplier_id,p.created_at
          FROM purchase_orders p WHERE p.organization_id=$1 AND ${approvedOrderScopeSql}($2::text[])
          AND ${orderDateSupplierScopeSql("$6","$7","$8")}
        ), latest_workflow_evidence AS (
          SELECT DISTINCT ON (a.resource_id,a.action) a.resource_id,a.action,a.created_at,a.details
          FROM audit_logs a JOIN scoped_orders p ON p.id=a.resource_id AND p.organization_id=a.organization_id
          WHERE a.organization_id=$1 AND a.resource_type='purchase_order'
            AND a.action IN ('PURCHASE_ORDER_SUBMITTED','REQUISITION_CONVERTED_TO_PO') AND a.event_hash IS NOT NULL
          ORDER BY a.resource_id,a.action,a.created_at DESC,a.id DESC
        )
        SELECT p.id,p.order_number AS "orderNumber", coverage.evidence AS "coverage",
        to_char(p.order_date,'YYYY-MM-DD') AS "orderDate", r.id AS "requisitionId", r.requisition_number AS "requisitionNumber",
        e.outcome,e.policy_mode AS "policyMode",e.policy_revision AS "policyRevision",to_char(e.approved_at,'YYYY-MM-DD"T"HH24:MI:SS.US') AS "evaluatedAt",
        e.budget_id::text AS "budgetId", x.id::text AS "exceptionId",
        award.event_id AS "sourcingEventId", award.id AS "sourcingAwardId",
        proof."approvedAt" AS "overrideApprovedAt", proof."ruleRevision" AS "overrideRuleRevision",
        proof.reason AS "approvedOverrideReason",
        ${agreementVersion} AS "agreementVersion",
        ${captureAvailable ? "CASE WHEN release_evidence.release_id IS NOT NULL THEN linked_release.contract_id END" : "NULL::int"} AS "agreementId",
        ${captureAvailable ? "release_evidence.release_id::text" : "NULL::text"} AS "agreementReleaseId",
        ${captureAvailable ? "release_evidence.snapshot->'agreement'->>'reference'" : "NULL::text"} AS "agreementReference",
        CASE WHEN submission.resource_id IS NOT NULL THEN jsonb_build_object(
          'observedAt',submission.created_at,
          'readinessPolicy',submission.details #> '{submissionPolicyDecision,readiness,policy}',
          'readinessRules',submission.details #> '{submissionPolicyDecision,readiness,rules}',
          'sourcing',submission.details #> '{submissionPolicyDecision,sourcing}'
        ) END AS "submissionEvidence",
        CASE WHEN conversion.resource_id IS NOT NULL THEN jsonb_build_object(
          'observedAt',conversion.created_at,
          'sourcing',conversion.details #> '{conversionPolicyDecision,sourcing}',
          'supplier',conversion.details #> '{conversionPolicyDecision,supplier}',
          'budgetTransferred',conversion.details #> '{conversionPolicyDecision,budgetTransferred}'
        ) END AS "conversionEvidence"
        FROM scoped_orders p
        LEFT JOIN latest_workflow_evidence submission ON submission.resource_id=p.id AND submission.action='PURCHASE_ORDER_SUBMITTED'
          AND submission.details #>> '{submissionPolicyDecision,schemaVersion}'='1'
          AND submission.details #>> '{after,id}'=p.id::text
          AND submission.details #>> '{after,approvalStatus}'='PENDING'
        LEFT JOIN latest_workflow_evidence conversion ON conversion.resource_id=p.id AND conversion.action='REQUISITION_CONVERTED_TO_PO'
          AND conversion.details #>> '{conversionPolicyDecision,schemaVersion}'='1'
          AND conversion.details #>> '{after,id}'=p.id::text
          AND conversion.details #>> '{before,requisitionId}'=p.requisition_id::text
          AND conversion.details #>> '{after,supplierId}'=p.supplier_id::text
        ${captureAvailable ? `LEFT JOIN supplier_contract_releases linked_release ON linked_release.organization_id=p.organization_id
          AND linked_release.purchase_order_id=p.id AND linked_release.contract_id=p.contract_id AND linked_release.requisition_id=p.requisition_id
          LEFT JOIN agreement_release_policy_evidence release_evidence ON release_evidence.release_id=linked_release.id
            AND release_evidence.snapshot->'supplier'->>'id'=p.supplier_id::text` : ""}
        LEFT JOIN purchase_requisitions r ON r.organization_id=p.organization_id AND r.id=p.requisition_id
        LEFT JOIN purchase_budget_policy_evidence e ON e.organization_id=p.organization_id AND e.requisition_id=r.id
          AND e.approved_at=r.approval_date AND e.approver_user_id=r.approver_id AND e.approved_at<=p.created_at
        LEFT JOIN operational_exceptions x ON x.organization_id=p.organization_id AND x.id=e.exception_id
          AND x.related_refs @> jsonb_build_object('requisitionId',r.id)
          AND (e.outcome<>'over_budget' OR x.related_refs->>'budgetId'=e.budget_id::text)
          AND x.type=CASE e.outcome WHEN 'over_budget' THEN 'procurement_budget_override' WHEN 'no_matching_budget' THEN 'procurement_budget_missing' END
        LEFT JOIN sourcing_awards award ON award.organization_id=p.organization_id AND award.id=p.sourcing_award_id AND award.status='CONVERTED'
        LEFT JOIN sourcing_events event ON event.organization_id=p.organization_id AND event.id=award.event_id
        LEFT JOIN LATERAL (
          SELECT to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "approvedAt", a.details->'after'->>'version' AS "ruleRevision",
            a.details->'after'->>'overrideReason' AS reason
          FROM audit_logs a WHERE a.organization_id=p.organization_id AND a.resource_type='sourcing_award' AND a.resource_id=award.id
            AND a.event_hash IS NOT NULL AND a.action='RFQ_AWARD_APPROVED' AND a.user_id=award.approved_by_user_id
            AND a.user_id<>award.recommended_by_user_id AND a.user_id<>event.owner_user_id
            AND a.details->'before'->>'status'='SUBMITTED' AND a.details->'after'->>'status'='APPROVED'
            AND a.details->'after'->>'id'=award.id::text AND a.details->'after'->>'eventId'=event.id::text
            AND a.details->'after'->>'version'=award.version::text
            AND a.details->'after'->>'overrideReason'=award.override_reason AND length(btrim(award.override_reason))>0
            AND EXISTS(SELECT 1 FROM audit_logs c WHERE c.organization_id=a.organization_id AND c.resource_type=a.resource_type
              AND c.resource_id=a.resource_id AND c.action='RFQ_AWARD_CONVERTED_TO_PO' AND c.event_hash IS NOT NULL AND c.id>a.id
              AND c.details->'after'->'purchaseOrderIds' @> jsonb_build_array(p.id))
          ORDER BY a.id DESC LIMIT 1
        ) proof ON true
        CROSS JOIN LATERAL (SELECT jsonb_build_object(
          'budget', CASE WHEN e.outcome IS NOT NULL THEN 'recorded' WHEN p.requisition_id IS NULL THEN 'not_linked' ELSE 'unverified' END,
          'sourcingOverride', CASE WHEN proof.reason IS NOT NULL THEN 'recorded' WHEN p.sourcing_award_id IS NULL THEN 'not_linked' ELSE 'unverified' END,
          'agreementRelease', CASE WHEN ${agreementVersion} IS NOT NULL THEN 'recorded' WHEN p.contract_id IS NULL THEN 'not_linked' ELSE 'unverified' END,
          'poSubmission', CASE WHEN submission.resource_id IS NOT NULL THEN 'recorded' ELSE 'unverified' END,
          'poConversion', CASE WHEN conversion.resource_id IS NOT NULL THEN 'recorded' WHEN p.requisition_id IS NULL THEN 'not_linked' ELSE 'unverified' END
        ) AS evidence) coverage
        WHERE ($3='all' OR ($3='unverified' AND
          (CASE WHEN $9::text IS NULL THEN 'unverified' IN (
            coverage.evidence->>'budget',coverage.evidence->>'sourcingOverride',coverage.evidence->>'agreementRelease',
            coverage.evidence->>'poSubmission',coverage.evidence->>'poConversion')
          ELSE coverage.evidence->>$9='unverified' END))
          OR ($3='po_submission' AND submission.resource_id IS NOT NULL)
          OR ($3='po_conversion' AND conversion.resource_id IS NOT NULL)
          OR ($3='agreement_release' AND ${agreementVersion} IS NOT NULL)
          OR ($3='approved_override' AND proof.reason IS NOT NULL)
          OR ($3='within_budget' AND e.outcome='within_budget')
          OR ($3='outside_budget' AND e.outcome IN ('over_budget','no_matching_budget')))
        ORDER BY p.order_date DESC NULLS LAST,p.id DESC LIMIT $4 OFFSET $5`,
      [actor.organizationId, approvedOrderStates, query.outcome, query.pageSize + 1, (query.page - 1) * query.pageSize,
        scope.from ?? null,scope.to ?? null,scope.supplierId ?? null,query.evidenceFamily ?? null]);
      // One ordered contribution per PO; never sum currencies or join amounts per reason.
      const rows = result.rows.slice(0, query.pageSize);
      const contributions = await readFinancialSourceContributions(client, actor.organizationId, "ordered", scope, rows.map(row => row.id));
      const amounts = new Map(contributions.map(row => [row.sourceId, row]));
      await client.query("COMMIT");
      res.setHeader("Cache-Control", "private, no-store");
      return sendOk(res, { items: rows.map(row => {
        const amount = amounts.get(String(row.id));
        const { sourcingEventId, sourcingAwardId, ...rest } = row;
        return { ...rest, coverage:row.coverage as MaverickEvidenceCoverage, sourcingEventId: row.approvedOverrideReason ? sourcingEventId : null,
          sourcingAwardId: row.approvedOverrideReason ? sourcingAwardId : null,
          orderedAmount: amount?.currencyCode ? amount.amount : null, currencyCode: amount?.currencyCode ?? null };
      }), hasNext: result.rows.length > query.pageSize, page:query.page,pageSize:query.pageSize,filters:scope,
        scope: "linked-budget-sourcing-release-and-workflow-evidence-v5" });
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      if (error instanceof z.ZodError) return sendError(res, 400, "MAVERICK_SPEND_FILTER_INVALID", "Choose a valid purchase evidence filter and page.");
      if (error instanceof DocumentAccessError) return sendError(res, error.status, error.code, error.message);
      return sendError(res, 503, "MAVERICK_SPEND_UNAVAILABLE", "Purchase policy evidence is unavailable. Retry or ask an administrator to verify the reporting migration.");
    } finally { client?.release(); }
  });
}

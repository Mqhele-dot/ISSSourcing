/**
 * Runtime MDM security/governance proof.
 *
 * This uses the same DB-backed services as the API routes so it can run inside
 * the release gate without a browser. Route-level auth remains covered by the
 * existing permission and control-plane E2E suites.
 */
import assert from "node:assert/strict";
import { pool } from "../server/db.ts";
import {
  createMdmDomainRecord,
  listMdmDomain,
  updateMdmDomainRecord,
} from "../server/modules/master-data/mdm-control-centre.ts";
import {
  addMdmChangeRequestComment,
  applyMdmChangeRequest,
  approveMdmChangeRequest,
  createMdmChangeRequest,
  getMdmChangeRequest,
} from "../server/modules/master-data/mdm-change-request-service.ts";
import { exitTest } from "./test-exit.ts";

async function main(): Promise<void> {
  const suffix = Date.now().toString().slice(-8);
  console.log("MDM runtime security proof\n");

  const orgA = 1;
  const orgB = 987654;
  const actorA = 1;
  const actorB = 2;

  const orgALegal = await createMdmDomainRecord(
    "legal-entities",
    orgA,
    {
      code: `RT-A-${suffix}`,
      name: `Runtime Org A ${suffix}`,
      defaultCurrencyCode: "ZAR",
      countryCode: "ZA",
      active: true,
    },
    actorA,
  );
  const orgBLegal = await createMdmDomainRecord(
    "legal-entities",
    orgB,
    {
      code: `RT-B-${suffix}`,
      name: `Runtime Org B ${suffix}`,
      defaultCurrencyCode: "ZAR",
      countryCode: "ZA",
      active: true,
    },
    actorB,
  );

  const orgARecords = await listMdmDomain("legal-entities", orgA, `RT-`);
  assert.ok(orgARecords.some((row) => Number(row.id) === Number(orgALegal.id)), "Tenant A should read own MDM record");
  assert.ok(
    !orgARecords.some((row) => Number(row.id) === Number(orgBLegal.id)),
    "Tenant A must not read Tenant B MDM record",
  );
  console.log("  ok tenant-scoped MDM reads");

  const lowRiskSite = await createMdmDomainRecord(
    "sites",
    orgA,
    {
      legalEntityId: Number(orgALegal.id),
      code: `RT-SITE-${suffix}`,
      name: `Runtime Site ${suffix}`,
      siteType: "warehouse",
      address: "Runtime test address",
      active: true,
    },
    actorA,
  );
  assert.ok(Number(lowRiskSite.id) > 0, "Admin/manager service path should create a low-risk MDM record");

  const audit = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM mdm_audit_logs
      WHERE organization_id = $1 AND domain = 'sites' AND record_id = $2 AND action = 'create'
    `,
    [orgA, Number(lowRiskSite.id)],
  );
  assert.ok(Number(audit.rows[0]?.count ?? 0) > 0, "Successful mutation should write MDM audit evidence");
  console.log("  ok low-risk create writes audit evidence");

  const highRisk = await createMdmChangeRequest({
    organizationId: orgA,
    domain: "supplier-banks",
    entityId: null,
    action: "create",
    proposedPatch: {
      supplierId: 1,
      bankName: `Runtime Bank ${suffix}`,
      accountNumberMasked: `****${suffix.slice(-4)}`,
      currencyCode: "ZAR",
      verificationStatus: "pending",
    },
    submittedBy: actorA,
    reason: "Runtime high-risk proof",
  });
  assert.equal(highRisk.status, "pending_approval", "High-risk MDM change should require approval");
  await assert.rejects(
    () =>
      approveMdmChangeRequest({
        organizationId: orgA,
        id: Number(highRisk.id),
        actorId: actorA,
        reason: "Self approval attempt",
      }),
    /Maker-checker control blocked/,
    "Maker must not approve own high-risk MDM change",
  );
  console.log("  ok high-risk maker-checker self-approval block");

  const detailBeforeComment = await getMdmChangeRequest(orgA, Number(highRisk.id));
  assert.equal(detailBeforeComment?.id, highRisk.id, "Detail route service should be tenant scoped");
  await addMdmChangeRequestComment({
    organizationId: orgA,
    id: Number(highRisk.id),
    actorId: actorB,
    comment: "Runtime approval note",
  });
  const detailAfterComment = await getMdmChangeRequest(orgA, Number(highRisk.id));
  assert.ok(Array.isArray(detailAfterComment?.comments), "Change request details should include comments");
  assert.ok((detailAfterComment?.comments as unknown[]).length > 0, "Comment should be persisted");
  console.log("  ok tenant-scoped comments are persisted");

  await assert.rejects(
    () =>
      updateMdmDomainRecord(
        "legal-entities",
        orgA,
        Number(orgALegal.id),
        { name: `Stale update ${suffix}`, expectedVersion: 0 },
        actorA,
      ),
    (error: unknown) => (error as { code?: string })?.code === "MDM_STALE_VERSION",
    "Stale updates must return MDM_STALE_VERSION",
  );
  console.log("  ok stale-version update blocked");

  const approvedCreate = await createMdmChangeRequest({
    organizationId: orgA,
    domain: "sites",
    entityId: null,
    action: "create",
    proposedPatch: {
      legalEntityId: Number(orgALegal.id),
      code: `RT-APPLY-${suffix}`,
      name: `Runtime Applied Site ${suffix}`,
      siteType: "branch",
      address: "Runtime apply address",
      active: true,
    },
    submittedBy: actorA,
    reason: "Runtime apply proof",
  });
  await approveMdmChangeRequest({
    organizationId: orgA,
    id: Number(approvedCreate.id),
    actorId: actorB,
    reason: "Approved by runtime test",
  });
  const applied = await applyMdmChangeRequest({
    organizationId: orgA,
    id: Number(approvedCreate.id),
    actorId: actorB,
    reason: "Apply once",
  });
  assert.equal(applied?.status, "applied", "Approved change should apply");
  await assert.rejects(
    () =>
      applyMdmChangeRequest({
        organizationId: orgA,
        id: Number(approvedCreate.id),
        actorId: actorB,
        reason: "Apply again",
      }),
    (error: unknown) => (error as { code?: string })?.code === "MDM_CHANGE_ALREADY_APPLIED",
    "Approved changes must not apply twice",
  );
  console.log("  ok approved changes apply exactly once");

  const badChange = await createMdmChangeRequest({
    organizationId: orgA,
    domain: "unknown-domain",
    entityId: null,
    action: "create",
    proposedPatch: { code: `BAD-${suffix}` },
    submittedBy: actorA,
    reason: "Runtime failed apply proof",
  });
  await approveMdmChangeRequest({
    organizationId: orgA,
    id: Number(badChange.id),
    actorId: actorB,
    reason: "Approved to prove failure recording",
  });
  await assert.rejects(() =>
    applyMdmChangeRequest({
      organizationId: orgA,
      id: Number(badChange.id),
      actorId: actorB,
      reason: "Expected failure",
    }),
  );
  const failedDetail = await getMdmChangeRequest(orgA, Number(badChange.id));
  assert.equal(failedDetail?.status, "failed_to_apply", "Failed apply should be recorded");
  console.log("  ok failed apply is recorded");

  console.log("\nMDM runtime security proof passed.");
}

main()
  .catch((error) => {
    console.error(error);
    exitTest(1);
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });

import assert from "node:assert/strict";
import { pool } from "../server/db.ts";
import {
  appendAuditEventWithClient,
  getAuditChainRowsWithClient,
  verifyAuditChainRows,
  verifyAuditChainWithClient,
} from "../server/services/audit-chain-service.ts";
import {
  hasCriticalAuditIntegrityDiagnostic,
  reportAuditChainIntegrityFailure,
} from "../server/services/audit-integrity-monitor.ts";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organization = await client.query<{ id: number }>(
      `INSERT INTO organizations (name, slug, active, country_code, default_currency_code, locale, timezone)
       VALUES ($1, $2, TRUE, 'ZA', 'ZAR', 'en-ZA', 'Africa/Johannesburg') RETURNING id`,
      [`Audit integrity test ${suffix}`, `audit-integrity-${suffix}`],
    );
    const organizationId = organization.rows[0].id;

    for (const [index, action] of ["created", "submitted", "approved"].entries()) {
      await appendAuditEventWithClient(client, {
        organizationId,
        actor: { systemActor: "audit-integrity-runtime-test" },
        action,
        resourceType: "release_evidence",
        resourceId: index + 1,
        before: index === 0 ? null : { state: index - 1 },
        after: { state: index },
        reason: "Wave 6A audit-chain integrity proof",
        requestId: `audit-integrity-${suffix}-${index}`,
      });
    }

    const valid = await verifyAuditChainWithClient(client, organizationId);
    assert.equal(valid.valid, true);
    assert.equal(valid.checked, 3);

    const rows = await getAuditChainRowsWithClient(client, organizationId);
    const tampered = rows.map((row) => ({ ...row, details: structuredClone(row.details) }));
    tampered[1] = { ...tampered[1], details: { tampered: true } };
    const broken = verifyAuditChainRows(organizationId, tampered);
    assert.equal(broken.valid, false);
    assert.equal(broken.firstBrokenId, rows[1].id);
    assert.notEqual(broken.expectedHash, broken.actualHash);

    const diagnostic = reportAuditChainIntegrityFailure(broken);
    assert.equal(diagnostic.severity, "critical");
    assert.equal(diagnostic.source, "security");
    assert.equal(hasCriticalAuditIntegrityDiagnostic(organizationId), true);

    console.log("Audit-chain append, verification, tamper detection, and critical diagnostics passed.");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

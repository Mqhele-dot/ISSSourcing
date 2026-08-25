import "dotenv/config";
import fs from "node:fs";
import { pool } from "../server/db";
import { appendAuditEventWithClient } from "../server/services/audit-chain-service";

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main() {
  const organizationId = Number(argument("tenant-id"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error("Quotation evidence repair requires --tenant-id=<positive organization id>.");
  }
  const apply = process.argv.includes("--apply");
  const backupFile = argument("backup-file");
  if (apply && (!backupFile || !fs.existsSync(backupFile) || fs.statSync(backupFile).size === 0)) {
    throw new Error("Apply mode requires --backup-file=<existing non-empty pg_dump file>.");
  }
  if (apply && argument("confirm") !== "repair-quotation-rejection-evidence") {
    throw new Error("Apply mode requires --confirm=repair-quotation-rejection-evidence.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [812742, organizationId]);
    const candidates = await client.query<{
      id: number;
      rejected_by_name: string;
      rejection_reason: string;
      rejection_reference: string | null;
      rejected_at: Date;
      audit_id: number;
    }>(`
      SELECT q.id,
             audit.details->>'rejectedByName' AS rejected_by_name,
             audit.details->>'rejectionReason' AS rejection_reason,
             NULLIF(audit.details->>'rejectionReference', '') AS rejection_reference,
             audit.created_at AS rejected_at,
             audit.id AS audit_id
      FROM commercial_quotations q
      JOIN LATERAL (
        SELECT id, details, created_at
        FROM audit_logs
        WHERE organization_id = q.organization_id
          AND resource_type = 'commercial_quotation'
          AND resource_id = q.id
          AND action = 'COMMERCIAL_QUOTATION_REJECTED'
          AND event_hash IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) audit ON TRUE
      WHERE q.organization_id = $1
        AND q.status = 'REJECTED'
        AND (q.rejected_by_name IS NULL OR q.rejection_reason IS NULL OR q.rejected_at IS NULL)
        AND NULLIF(audit.details->>'rejectedByName', '') IS NOT NULL
        AND NULLIF(audit.details->>'rejectionReason', '') IS NOT NULL
      ORDER BY q.id
    `, [organizationId]);

    if (!apply) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ tenantId: organizationId, mode: "audit", candidates: candidates.rows }, null, 2));
      return;
    }

    for (const row of candidates.rows) {
      await client.query(`
        UPDATE commercial_quotations
        SET rejected_by_name = COALESCE(rejected_by_name, $1),
            rejection_reason = COALESCE(rejection_reason, $2),
            rejection_reference = COALESCE(rejection_reference, $3),
            rejected_at = COALESCE(rejected_at, $4),
            updated_at = NOW()
        WHERE organization_id = $5 AND id = $6
      `, [row.rejected_by_name, row.rejection_reason, row.rejection_reference, row.rejected_at, organizationId, row.id]);
      await appendAuditEventWithClient(client, {
        organizationId,
        actor: { systemActor: "quotation-evidence-repair" },
        action: "COMMERCIAL_QUOTATION_REJECTION_EVIDENCE_REPAIRED",
        resourceType: "commercial_quotation",
        resourceId: row.id,
        details: { sourceAuditId: row.audit_id },
      });
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ tenantId: organizationId, mode: "apply", repaired: candidates.rowCount }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

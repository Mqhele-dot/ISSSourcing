import { pool } from "../db";
import { getServerDiagnosticEvents, recordServerDiagnosticEvent } from "../diagnostics/server-diagnostics-store";
import { logger } from "../lib/logger";
import { verifyAuditChain, type AuditChainVerification } from "./audit-chain-service";

export function reportAuditChainIntegrityFailure(verification: AuditChainVerification) {
  logger.warn("Audit chain integrity failure", verification);
  return recordServerDiagnosticEvent({
    severity: "critical",
    source: "security",
    title: "Audit chain integrity failure",
    message: `Audit history integrity failed for organization ${verification.organizationId}.`,
    details: verification,
  });
}

export async function runAuditIntegrityChecks(): Promise<AuditChainVerification[]> {
  const organizations = await pool.query<{ id: number }>("SELECT id FROM organizations WHERE active = TRUE ORDER BY id");
  const results: AuditChainVerification[] = [];
  for (const organization of organizations.rows) {
    const verification = await verifyAuditChain(organization.id);
    results.push(verification);
    if (!verification.valid) reportAuditChainIntegrityFailure(verification);
  }
  return results;
}

export function hasCriticalAuditIntegrityDiagnostic(organizationId: number): boolean {
  return getServerDiagnosticEvents().some((event) => {
    const details = event.details as Partial<AuditChainVerification> | undefined;
    return event.severity === "critical"
      && event.source === "security"
      && event.title === "Audit chain integrity failure"
      && details?.organizationId === organizationId;
  });
}

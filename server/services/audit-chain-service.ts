// Compatibility facade: application-owned helpers retain their existing API.
// Worker/domain transactions import the client-only module without a global pool.
import { pool } from "../db";
import { appendAuditEventWithClient, verifyAuditChainWithClient, type AuditChainInput, type AuditChainVerification } from "./audit-chain-client";
export * from "./audit-chain-client";

export async function appendAuditEvent(input: AuditChainInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await appendAuditEventWithClient(client, input);
    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyAuditChain(organizationId: number): Promise<AuditChainVerification> {
  const client = await pool.connect();
  try {
    return await verifyAuditChainWithClient(client, organizationId);
  } finally {
    client.release();
  }
}

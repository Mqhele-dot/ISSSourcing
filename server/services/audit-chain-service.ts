import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";

export type AuditActor = {
  userId?: number | null;
  systemActor?: string | null;
};

export type AuditChainInput = {
  organizationId: number;
  actor: AuditActor;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  details?: Record<string, unknown>;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditChainVerification = {
  organizationId: number;
  valid: boolean;
  checked: number;
  firstBrokenId: number | null;
  expectedHash: string | null;
  actualHash: string | null;
};

export type AuditChainRow = {
  id: number;
  organization_id: number;
  user_id: number | null;
  action: string;
  resource_type: string;
  resource_id: number | null;
  details: unknown;
  reason: string | null;
  previous_hash: string | null;
  event_hash: string | null;
  hash_version: number;
  request_id: string | null;
  created_at_hash: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function eventHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function hashPayload(input: {
  organizationId: number;
  userId: number | null;
  action: string;
  resourceType: string;
  resourceId: number | null;
  details: unknown;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
  previousHash: string | null;
  hashVersion: number;
}) {
  return {
    organizationId: input.organizationId,
    userId: input.userId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    details: input.details,
    reason: input.reason,
    requestId: input.requestId,
    createdAt: input.createdAt,
    previousHash: input.previousHash,
    hashVersion: input.hashVersion,
  };
}

async function lockOrganizationChain(client: PoolClient, organizationId: number): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [812741, organizationId]);
}

export async function appendAuditEventWithClient(client: PoolClient, input: AuditChainInput) {
  await lockOrganizationChain(client, input.organizationId);
  const previous = await client.query<{ event_hash: string | null }>(
      `SELECT event_hash FROM audit_logs
       WHERE organization_id = $1 AND event_hash IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [input.organizationId],
  );
  const previousHash = previous.rows[0]?.event_hash ?? null;
  const createdAt = new Date().toISOString();
  const hashVersion = 1;
  const details = {
    ...(input.details ?? {}),
    before: input.before ?? null,
    after: input.after ?? null,
    systemActor: input.actor.systemActor ?? null,
  };
  const payload = hashPayload({
    organizationId: input.organizationId,
    userId: input.actor.userId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    details,
    reason: input.reason ?? null,
    requestId: input.requestId ?? null,
    createdAt,
    previousHash,
    hashVersion,
  });
  const calculatedHash = eventHash(payload);
  const inserted = await client.query(
    `INSERT INTO audit_logs (
       organization_id, user_id, action, resource_type, resource_id, details, reason,
       previous_hash, event_hash, hash_version, request_id, ip_address, user_agent, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      input.organizationId,
      input.actor.userId ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      canonicalJson(details),
      input.reason ?? null,
      previousHash,
      calculatedHash,
      hashVersion,
      input.requestId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      createdAt,
    ],
  );
  return inserted.rows[0];
}

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

export async function getAuditChainRowsWithClient(client: PoolClient, organizationId: number): Promise<AuditChainRow[]> {
  const result = await client.query<AuditChainRow>(
    `SELECT id, organization_id, user_id, action, resource_type, resource_id, details, reason,
            previous_hash, event_hash, hash_version, request_id,
            to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at_hash
     FROM audit_logs
     WHERE organization_id = $1 AND event_hash IS NOT NULL
     ORDER BY created_at ASC, id ASC`,
    [organizationId],
  );
  return result.rows;
}

export function verifyAuditChainRows(organizationId: number, rows: AuditChainRow[]): AuditChainVerification {
  let previousHash: string | null = null;
  for (const [index, row] of rows.entries()) {
    const expected = eventHash(
      hashPayload({
        organizationId: row.organization_id,
        userId: row.user_id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        details: row.details,
        reason: row.reason,
        requestId: row.request_id,
        // audit_logs.created_at is a timestamp without time zone. Hash its stored wall-clock
        // representation so verification is independent of the Node process time zone.
        createdAt: row.created_at_hash,
        previousHash,
        hashVersion: row.hash_version,
      }),
    );
    if (row.previous_hash !== previousHash || row.event_hash !== expected) {
      return {
        organizationId,
        valid: false,
        checked: index + 1,
        firstBrokenId: row.id,
        expectedHash: expected,
        actualHash: row.event_hash,
      };
    }
    previousHash = row.event_hash;
  }
  return {
    organizationId,
    valid: true,
    checked: rows.length,
    firstBrokenId: null,
    expectedHash: null,
    actualHash: null,
  };
}

export async function verifyAuditChainWithClient(
  client: PoolClient,
  organizationId: number,
): Promise<AuditChainVerification> {
  return verifyAuditChainRows(organizationId, await getAuditChainRowsWithClient(client, organizationId));
}

export async function verifyAuditChain(organizationId: number): Promise<AuditChainVerification> {
  const client = await pool.connect();
  try {
    return await verifyAuditChainWithClient(client, organizationId);
  } finally {
    client.release();
  }
}

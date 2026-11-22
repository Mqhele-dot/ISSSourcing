import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

type Mapping = { requisitionItemId: number; contractLineId: number };

export function releaseCommandHash(contractId: number, requisitionId: number, mappings: Mapping[]) {
  const sorted = [...mappings].sort((a, b) => a.requisitionItemId - b.requisitionItemId);
  return createHash("sha256").update(JSON.stringify([contractId, requisitionId, sorted.map(m => [m.requisitionItemId, m.contractLineId])])).digest("hex");
}

export async function hasAgreementReleaseEvidence(client: Pick<PoolClient, "query">) {
  const result = await client.query<{ installed: boolean }>(
    "SELECT to_regclass('public.agreement_release_policy_evidence') IS NOT NULL AS installed",
  );
  return result.rows[0].installed;
}

import type { PoolClient } from "pg";
import type { TenantContext } from "../../organization-context";

/** Company-wide supplier observations must not leak warehouse-restricted evidence, even to admins. */
export async function hasCompanySupplierObservationScope(client: PoolClient, actor: Pick<TenantContext, "organizationId" | "userId" | "membershipId">) {
  const membership = await client.query(`SELECT u.warehouse_id FROM organization_members m
    JOIN users u ON u.id=m.user_id AND u.active=true
    JOIN organizations o ON o.id=m.organization_id AND o.active=true
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.id=$3 AND m.active=true AND m.status='active'`,
  [actor.organizationId, actor.userId, actor.membershipId]);
  return membership.rowCount === 1 && membership.rows[0].warehouse_id === null;
}

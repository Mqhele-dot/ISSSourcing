import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { organizations, suppliers } from "@shared/schema";
import { pool } from "../../db";
import { appendAuditEventWithClient, type AuditChainInput } from "../../services/audit-chain-service";
import { getCountryPack } from "../master-data/country-pack-registry";
import { dependencyBlockedMessage, getSupplierWhereUsed } from "../master-data/dependency-checks";
import { syncCarrierProfile } from "./carrier-profile";
import { hasSupplierBankingFields, supplierProfileCommandSchema, supplierProfilePatchSchema, type SupplierProfileCommand, type SupplierProfilePatch } from "./supplier-profile-command";
import { readPublishedSupplierCompliance, verifiedSupplierComplianceDocument } from "../master-data/governed-supplier-compliance";

export class SupplierOnboardingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

type ActorInput = Pick<AuditChainInput, "organizationId" | "requestId" | "ipAddress" | "userAgent"> & { userId: number };
type ApprovalInput = Omit<ActorInput, "userId"> & {
  supplierId: number;
  approverId: number;
  reason: string;
  expectedRevision: string;
};

function assertNoSupplierBankingFields(payload: unknown) {
  if (hasSupplierBankingFields(payload)) {
    throw new SupplierOnboardingError(409, "SUPPLIER_BANK_GOVERNANCE_REQUIRED", "Supplier banking details require a governed Master Data change request.");
  }
}

async function withSupplierWrite<T>(organizationId: number, write: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize writers sharing the tenant carrier code/legacy adoption space.
    await client.query("SELECT pg_advisory_xact_lock($1,$2)", [812743, organizationId]);
    const result = await write(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function startSupplierOnboarding(input: ActorInput, payload: SupplierProfileCommand) {
  assertNoSupplierBankingFields(payload);
  const { organizationId, userId, requestId, ipAddress, userAgent } = input;
  const data = supplierProfileCommandSchema.parse(payload);
  return withSupplierWrite(organizationId, async client => {
    const tx = drizzle(client);
    const [existing] = await tx.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.name, data.name))).limit(1);
    if (existing) throw new SupplierOnboardingError(400, "SUPPLIER_NAME_EXISTS", "Supplier with this name already exists.");
    const [supplier] = await tx.insert(suppliers).values({ ...data, organizationId, createdByUserId: userId,
      status: "prospective", onboardingStatus: "prospective", complianceStatus: "unknown", approvedAt: null, approvedByUserId: null }).returning();
    await syncCarrierProfile(organizationId, supplier, tx);
    await appendAuditEventWithClient(client, { organizationId, actor: { userId }, action: "SUPPLIER_ONBOARDING_STARTED",
      resourceType: "supplier", resourceId: supplier.id, requestId, ipAddress, userAgent,
      after: { status: supplier.status, onboardingStatus: supplier.onboardingStatus, makerId: userId } });
    return supplier;
  });
}

export async function updateSupplierProfile(input: ActorInput, supplierId: number, payload: SupplierProfilePatch) {
  assertNoSupplierBankingFields(payload);
  const { organizationId, userId, requestId, ipAddress, userAgent } = input;
  const patch = supplierProfilePatchSchema.parse(payload);
  return withSupplierWrite(organizationId, async client => {
    const tx = drizzle(client);
    const scope = and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId));
    const [supplier] = await tx.select().from(suppliers).where(scope).for("update");
    if (!supplier) throw new SupplierOnboardingError(404, "SUPPLIER_NOT_FOUND", "Supplier not found.");
    const status = patch.status?.trim().toLowerCase();
    if (status === "active" && supplier.onboardingStatus.toLowerCase() !== "approved") {
      throw new SupplierOnboardingError(409, "SUPPLIER_APPROVAL_WORKFLOW_REQUIRED", "Prospective suppliers must be approved through the controlled onboarding action.");
    }
    if (status && ["inactive", "blocked", "suspended", "archived"].includes(status)) {
      const dependencies = await getSupplierWhereUsed(organizationId, supplierId, client);
      if (dependencies.length) throw new SupplierOnboardingError(409, "MASTER_DATA_RECORD_IN_USE", dependencyBlockedMessage("supplier", "disable", dependencies), { action: "disable", dependencies });
    }
    if (!Object.keys(patch).length) return supplier;
    const nextRevision = new Date(Math.max(Date.now(), (supplier.updatedAt?.getTime() ?? 0) + 1));
    const [updated] = await tx.update(suppliers).set({ ...patch, ...(status ? { status } : {}), updatedAt: nextRevision }).where(scope).returning();
    await syncCarrierProfile(organizationId, updated, tx);
    await appendAuditEventWithClient(client, { organizationId, actor: { userId }, action: "SUPPLIER_PROFILE_UPDATED",
      resourceType: "supplier", resourceId: supplierId, requestId, ipAddress, userAgent,
      before: { status: supplier.status, supplierType: supplier.supplierType },
      after: { status: updated.status, supplierType: updated.supplierType }, details: { changedFields: Object.keys(patch).sort() } });
    return updated;
  });
}

export async function approveSupplierOnboarding(input: ApprovalInput) {
  const { organizationId, supplierId, approverId, reason, expectedRevision, requestId, ipAddress, userAgent } = input;
  return withSupplierWrite(organizationId, async client => {
    const tx = drizzle(client);
    const scope = and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, organizationId));
    const [supplier] = await tx.select().from(suppliers).where(scope).for("update");
    if (!supplier) throw new SupplierOnboardingError(404, "SUPPLIER_NOT_FOUND", "Supplier not found.");
    if (!supplier.createdByUserId || supplier.createdByUserId === approverId) {
      throw new SupplierOnboardingError(403, "SEGREGATION_OF_DUTIES_VIOLATION", "Approval requires a known maker and a different authorized approver.");
    }
    if (supplier.onboardingStatus === "approved") {
      const replay = await client.query(
        `SELECT 1 FROM audit_logs WHERE organization_id=$1 AND resource_type='supplier' AND resource_id=$2
         AND action='SUPPLIER_ONBOARDING_APPROVED' AND user_id=$3 AND reason=$4 AND event_hash IS NOT NULL
         AND details->'after'->>'approvedAt'=$5 AND details->>'profileRevision'=$6 LIMIT 1`,
        [organizationId, supplierId, approverId, reason, supplier.approvedAt?.toISOString(), expectedRevision],
      );
      if (supplier.approvedByUserId !== approverId || !replay.rowCount) {
        throw new SupplierOnboardingError(409, "SUPPLIER_ALREADY_APPROVED", "This supplier already has an approval decision.");
      }
      return supplier;
    }
    if (supplier.updatedAt?.toISOString() !== expectedRevision) throw new SupplierOnboardingError(409, "SUPPLIER_PROFILE_CHANGED", "The supplier profile changed. Reload and review it before approval.");
    const [editor] = (await client.query<{ user_id: number | null }>(`SELECT user_id FROM audit_logs WHERE organization_id=$1 AND resource_type='supplier' AND resource_id=$2 AND action='SUPPLIER_PROFILE_UPDATED' ORDER BY id DESC LIMIT 1`, [organizationId, supplierId])).rows;
    if (editor?.user_id === approverId) throw new SupplierOnboardingError(403, "SEGREGATION_OF_DUTIES_VIOLATION", "The last profile editor cannot approve this revision.");
    if (!supplier.defaultCurrencyCode || !supplier.paymentTermsId || !supplier.taxCodeId) {
      throw new SupplierOnboardingError(409, "SUPPLIER_ONBOARDING_INCOMPLETE", "Supplier currency, payment terms, and tax code are required before approval.", {
        missing: [!supplier.defaultCurrencyCode && "defaultCurrencyCode", !supplier.paymentTermsId && "paymentTermsId", !supplier.taxCodeId && "taxCodeId"].filter(Boolean),
      });
    }
    const decidedAt = new Date();
    if (supplier.isOnceOff && (!supplier.onceOffExpiresAt || supplier.onceOffExpiresAt <= decidedAt)) {
      throw new SupplierOnboardingError(409, "ONCE_OFF_SUPPLIER_EXPIRY_REQUIRED", "Once-off suppliers require a future expiration date before approval.");
    }
    const [organization] = await tx.select({ countryCode: organizations.countryCode }).from(organizations).where(eq(organizations.id, organizationId)).for("share");
    const pack = getCountryPack(organization?.countryCode);
    if (!(await client.query("SELECT to_regclass('supplier_compliance_publications') AS ready")).rows[0].ready) {
      throw new SupplierOnboardingError(503, "SUPPLIER_COMPLIANCE_NOT_INSTALLED", "Dated compliance evidence is not installed. Ask an administrator to review the migration prerequisites.");
    }
    const documents = await readPublishedSupplierCompliance(client, organizationId, supplierId, decidedAt, true, pack.supplierCompliance);
    const selected = documents.filter(document => document.state === "verified" && pack.supplierCompliance.includes(document.documentType));
    const missingDocuments = pack.supplierCompliance.filter(type => !selected.some(document => document.documentType === type));
    if (missingDocuments.length) {
      throw new SupplierOnboardingError(409, "SUPPLIER_COMPLIANCE_INCOMPLETE", `Supplier is missing ${pack.name} compliance evidence. Upload and approve the required documents in Master Data.`, { missingDocuments });
    }
    for (const document of selected) {
      const proof = await verifiedSupplierComplianceDocument(client, organizationId, supplierId, document.documentId);
      if (proof.sha256 !== document.sha256 || proof.documentVersion !== document.documentVersion) throw new SupplierOnboardingError(409, "SUPPLIER_COMPLIANCE_STALE", "Published supplier evidence no longer matches its source.");
    }
    const [approved] = await tx.update(suppliers).set({ status: "active", onboardingStatus: "approved", approvedAt: decidedAt, approvedByUserId: approverId,
      complianceStatus: "compliant", updatedAt: decidedAt }).where(scope).returning();
    await syncCarrierProfile(organizationId, approved, tx);
    await appendAuditEventWithClient(client, { organizationId, actor: { userId: approverId }, action: "SUPPLIER_ONBOARDING_APPROVED",
      resourceType: "supplier", resourceId: supplierId, reason, requestId, ipAddress, userAgent,
      before: { status: supplier.status, onboardingStatus: supplier.onboardingStatus, makerId: supplier.createdByUserId },
      after: { status: approved.status, onboardingStatus: approved.onboardingStatus, approvedAt: decidedAt.toISOString(), approvedByUserId: approverId },
      details: { profileRevision: expectedRevision, countryPack: pack.code, compliancePublications: selected.map(document => document.id) },
    });
    return approved;
  });
}

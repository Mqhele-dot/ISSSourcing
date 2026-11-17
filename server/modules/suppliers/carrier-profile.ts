import { and, eq } from "drizzle-orm";
import { carriers, type Supplier } from "@shared/schema";
import { db } from "../../db";

const CARRIER_SUPPLIER_TYPES = new Set(["carrier", "logistics_provider"]);

/** Existing operational projection, shared by supplier create/update/approval.
 * This does not approve onboarding or certify compliance evidence.
 */
export async function syncCarrierProfile(organizationId: number, supplier: Supplier, writer: Pick<typeof db, "select" | "update" | "insert"> = db): Promise<void> {
  const [linkedCarrier] = await writer.select().from(carriers)
    .where(and(eq(carriers.organizationId, organizationId), eq(carriers.supplierId, supplier.id))).limit(1);

  if (!CARRIER_SUPPLIER_TYPES.has(String(supplier.supplierType ?? "").trim().toLowerCase())) {
    if (linkedCarrier && linkedCarrier.active !== false) {
      await writer.update(carriers).set({ active: false, updatedAt: new Date() })
        .where(and(eq(carriers.organizationId, organizationId), eq(carriers.id, linkedCarrier.id)));
    }
    return;
  }

  const requestedCode = String(supplier.supplierCode ?? `CAR-${supplier.id}`).trim().toUpperCase();
  const [codeOwner] = await writer.select({ id: carriers.id, supplierId: carriers.supplierId, name: carriers.name })
    .from(carriers).where(and(eq(carriers.organizationId, organizationId), eq(carriers.code, requestedCode))).limit(1);
  const mayAdoptLegacy = codeOwner?.supplierId == null &&
    String(codeOwner?.name ?? "").trim().toLowerCase() === supplier.name.trim().toLowerCase();
  const carrierCode = codeOwner && codeOwner.supplierId !== supplier.id && !mayAdoptLegacy
    ? `${requestedCode}-${supplier.id}` : requestedCode;
  const carrierValues = {
    supplierId: supplier.id, code: carrierCode, name: supplier.name,
    contact: supplier.logisticsContactName || supplier.email || supplier.phone || null,
    active: String(supplier.status ?? "").toLowerCase() === "active" &&
      String(supplier.onboardingStatus ?? "").toLowerCase() === "approved",
    updatedAt: new Date(),
  };
  if (linkedCarrier) {
    await writer.update(carriers).set(carrierValues)
      .where(and(eq(carriers.organizationId, organizationId), eq(carriers.id, linkedCarrier.id)));
  } else if (mayAdoptLegacy && codeOwner) {
    await writer.update(carriers).set(carrierValues)
      .where(and(eq(carriers.organizationId, organizationId), eq(carriers.id, codeOwner.id)));
  } else {
    await writer.insert(carriers).values({ organizationId, ...carrierValues });
  }
}

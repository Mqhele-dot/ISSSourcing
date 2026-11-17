import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  activityLogs, inventoryItems, PaymentStatus, purchaseOrderItems, purchaseOrders, PurchaseOrderStatus,
  purchaseRequisitionItems, purchaseRequisitions, PurchaseRequisitionStatus,
  type PurchaseRequisition,
} from "@shared/schema";
import type { db } from "../../db";
import { applySupplierDefaultsToPurchaseOrder, type SupplierCommercialDefaults } from "./supplier-defaults";

type ConversionDatabase = Pick<typeof db, "select" | "insert" | "update">;

export function lockConversionRequisition(database: Pick<ConversionDatabase, "select">, orgId: number, requisitionId: number) {
  return database.select().from(purchaseRequisitions)
    .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.organizationId, orgId)))
    .for("update").then(rows => rows[0]);
}

/** The caller owns the transaction and has locked the organization-owned requisition. */
export async function writeRequisitionPurchaseOrder(
  database: ConversionDatabase, requisition: PurchaseRequisition,
  options: { actorUserId?: number | null; canonical?: boolean } = {},
) {
  const orgId = requisition.organizationId, requisitionId = requisition.id;
  const conflict = (code: string, message: string) => Object.assign(new Error(message), { status: 409, code });
  if (requisition.status !== PurchaseRequisitionStatus.APPROVED) {
    throw conflict("REQUISITION_NOT_APPROVED", "Only an approved requisition can be converted.");
  }
  if (requisition.supplierId == null) throw conflict("REQUISITION_SUPPLIER_REQUIRED", "Choose a supplier before conversion.");
  const lines = await database.select().from(purchaseRequisitionItems)
    .where(eq(purchaseRequisitionItems.requisitionId, requisitionId)).orderBy(asc(purchaseRequisitionItems.id)).for("share");
  if (!lines.length) throw conflict("REQUISITION_LINES_REQUIRED", "Add at least one requisition line before conversion.");

  const itemIds = [...new Set(lines.flatMap(line => line.itemId == null ? [] : [line.itemId]))];
  const items = itemIds.length ? await database.select({
    id: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name,
    unitOfMeasureId: inventoryItems.unitOfMeasureId, commodityCodeId: inventoryItems.commodityCodeId,
  }).from(inventoryItems).where(and(
    inArray(inventoryItems.id, itemIds), or(eq(inventoryItems.organizationId, orgId), isNull(inventoryItems.organizationId)),
  )).for("share") : [];
  if (items.length !== itemIds.length || lines.some(line => line.lineType === "CATALOG" && line.itemId == null)) {
    throw conflict("REQUISITION_ITEM_UNAVAILABLE", "A referenced catalogue item is not available to this organization.");
  }
  const byId = new Map(items.map(item => [item.id, item]));
  let supplierDecision: Pick<SupplierCommercialDefaults, "supplierStatus" | "supplierComplianceStatus"> | null = null;
  const defaults = await applySupplierDefaultsToPurchaseOrder({
    supplierId: requisition.supplierId, departmentId: requisition.departmentId ?? null,
    contractId: null, paymentTermsId: null, incotermId: null, currencyCode: requisition.currencyCode ?? null, taxCodeId: null,
  }, { database, observe: ({ supplierStatus, supplierComplianceStatus }) => { supplierDecision = { supplierStatus, supplierComplianceStatus }; } });

  const now = new Date();
  const orderNumber = `PO-${now.getFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const [order] = await database.insert(purchaseOrders).values({
    organizationId: orgId, orderNumber, supplierId: requisition.supplierId, requisitionId,
    departmentId: Number(defaults.departmentId ?? requisition.departmentId ?? null) || null,
    contractId: Number(defaults.contractId ?? null) || null, paymentTermsId: Number(defaults.paymentTermsId ?? null) || null,
    incotermId: Number(defaults.incotermId ?? null) || null, currencyCode: String(defaults.currencyCode ?? "ZAR").trim().toUpperCase(),
    taxCodeId: Number(defaults.taxCodeId ?? null) || null, projectId: requisition.projectId ?? null, status: PurchaseOrderStatus.DRAFT,
    orderDate: now, expectedDeliveryDate: requisition.requiredDate ?? new Date(now.getTime() + 14 * 86400000), deliveryAddress: "",
    totalAmount: Number(requisition.totalAmount ?? 0), notes: requisition.notes ?? null, paymentStatus: PaymentStatus.UNPAID,
    emailSent: false, createdByUserId: options.actorUserId ?? null, updatedAt: now,
  }).returning();

  const orderLines = lines.map(line => {
    const item = line.itemId == null ? undefined : byId.get(line.itemId);
    return {
      orderId: order.id, itemId: line.itemId, lineNumber: line.lineNumber, lineType: line.lineType, description: line.description,
      itemCodeSnapshot: line.itemCodeSnapshot ?? item?.sku ?? null,
      itemDescriptionSnapshot: line.itemDescriptionSnapshot ?? item?.name ?? line.description,
      manualEntryReason: line.manualEntryReason, fulfilmentType: line.fulfilmentType, receiptRequired: line.receiptRequired,
      quantity: line.quantity, unitPrice: line.unitPrice, totalPrice: line.totalPrice, receivedQuantity: 0, notes: line.notes ?? null,
      unitOfMeasureId: line.unitOfMeasureId ?? item?.unitOfMeasureId ?? null, commodityCodeId: item?.commodityCodeId ?? null,
      taxCodeId: line.taxCodeId ?? (Number(defaults.taxCodeId ?? null) || null), costCentreId: line.costCentreId ?? null,
      glAccountCode: line.glAccountCode ?? null,
    };
  });
  for (let i = 0; i < orderLines.length; i += 500) {
    await database.insert(purchaseOrderItems).values(orderLines.slice(i, i + 500));
  }
  await database.update(purchaseRequisitions)
    .set({ status: options.canonical ? "CONVERTED_TO_PO" : PurchaseRequisitionStatus.CONVERTED, updatedAt: now })
    .where(and(eq(purchaseRequisitions.id, requisitionId), eq(purchaseRequisitions.organizationId, orgId)));
  await database.insert(activityLogs).values({
    organizationId: orgId, action: "Purchase Order Created from Requisition",
    description: `Created PO ${orderNumber} from requisition ${requisition.requisitionNumber}`,
    referenceType: "purchase_order", referenceId: order.id, userId: options.actorUserId ?? requisition.approverId ?? requisition.requestorId,
  });
  return { order, supplierDecision };
}

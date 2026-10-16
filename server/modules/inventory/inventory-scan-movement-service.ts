import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  appSettings,
  barcodes,
  inventoryItems,
  stockMovements,
  warehouses,
  warehouseInventory,
  workflowIdempotency,
} from "@shared/schema";

export const inventoryScanMovementSchema = z.object({
  value: z.string().trim().min(1).max(512),
  direction: z.enum(["IN", "OUT"]),
  warehouseId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive().max(1_000_000),
  location: z.string().trim().max(160).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export class InventoryScanMovementError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type InventoryScanMovementInput = z.infer<typeof inventoryScanMovementSchema>;

export async function executeInventoryScanMovement(input: {
  organizationId: number;
  userId: number | null;
  idempotencyKey: string;
  data: InventoryScanMovementInput;
}) {
  const action = `BARCODE_SCAN_${input.data.direction}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout='5s'`);
    const authorized=await tx.execute(sql`SELECT u.id FROM users u JOIN organization_members om ON om.user_id=u.id AND om.organization_id=${input.organizationId} AND om.active=true AND om.status='active' WHERE u.id=${input.userId} AND (u.warehouse_id IS NULL OR u.warehouse_id=${input.data.warehouseId})`);
    if(!authorized.rows.length)throw new InventoryScanMovementError("WAREHOUSE_ACCESS_DENIED","Your warehouse scope does not allow this scan.",403);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:scan-key:${input.idempotencyKey}`},0))`);
  const duplicate = await tx
    .select()
    .from(workflowIdempotency)
    .where(
      and(
        eq(workflowIdempotency.organizationId, input.organizationId),
        eq(workflowIdempotency.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (duplicate[0]) {
    if (duplicate[0].action !== action) {
      throw new InventoryScanMovementError(
        "IDEMPOTENCY_KEY_REUSED",
        "This scan retry key was already used for a different inventory action.",
        409,
      );
    }
    const previous=duplicate[0].response as {request?:unknown;movement?:{userId?:number|null}}|null;
    if(previous?.movement?.userId!==input.userId)throw new InventoryScanMovementError("IDEMPOTENCY_KEY_REUSED","This retry belongs to another operator.",409);
    if(JSON.stringify(previous?.request)!==JSON.stringify(input.data))throw new InventoryScanMovementError("IDEMPOTENCY_KEY_REUSED","Use a new retry key for changed scan details.",409);
    return { duplicate: true, ...(duplicate[0].response ?? {}) };
  }

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.data.warehouseId}:${input.data.value}`}, 0))`,
    );

    const [warehouse] = await tx
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.organizationId, input.organizationId),
          eq(warehouses.id, input.data.warehouseId),
        ),
      )
      .limit(1);
    if (!warehouse) {
      throw new InventoryScanMovementError(
        "WAREHOUSE_NOT_FOUND",
        "Select a warehouse owned by the active organization.",
      );
    }

    const directMatches = await tx
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, input.organizationId),
          or(eq(inventoryItems.sku, input.data.value), eq(inventoryItems.barcode, input.data.value)),
        ),
      );
    const barcodeMatches = await tx
      .select({ item: inventoryItems })
      .from(barcodes)
      .innerJoin(
        inventoryItems,
        and(
          eq(inventoryItems.organizationId, input.organizationId),
          eq(inventoryItems.id, barcodes.itemId),
        ),
      )
      .where(
        and(
          eq(barcodes.organizationId, input.organizationId),
          eq(barcodes.value, input.data.value),
        ),
      );
    const matches = new Map<number, typeof inventoryItems.$inferSelect>();
    directMatches.forEach((item) => matches.set(item.id, item));
    barcodeMatches.forEach(({ item }) => matches.set(item.id, item));
    if (matches.size === 0) {
      throw new InventoryScanMovementError(
        "SCAN_ITEM_NOT_FOUND",
        "No inventory item is linked to this barcode, QR code, or SKU.",
        404,
      );
    }
    if (matches.size > 1) {
      throw new InventoryScanMovementError(
        "SCAN_ITEM_AMBIGUOUS",
        "This code resolves to more than one item and cannot be posted safely.",
        409,
      );
    }
    const item = [...matches.values()][0];
    if(input.data.direction==="IN")await tx.execute(sql`SELECT assert_unlinked_receipt_inspection(${input.organizationId},${item.id})`);
    await tx.execute(sql`SELECT id FROM inventory_items WHERE id=${item.id} AND organization_id=${input.organizationId} FOR UPDATE`);
    const scope=await tx.execute(sql`SELECT u.id FROM users u JOIN organization_members om ON om.user_id=u.id AND om.organization_id=${input.organizationId} AND om.active=true AND om.status='active' WHERE u.id=${input.userId} AND (u.warehouse_id IS NULL OR u.warehouse_id=${warehouse.id})`);
    if(!scope.rows.length)throw new InventoryScanMovementError("WAREHOUSE_ACCESS_DENIED","Your warehouse scope does not allow this scan.",403);
    if (String(item.status ?? "active").toLowerCase() !== "active") {
      throw new InventoryScanMovementError("SCAN_ITEM_INACTIVE", "Inactive inventory items cannot be moved.", 409);
    }

    const [settings] = await tx
      .select({
        allowNegativeInventory: appSettings.allowNegativeInventory,
        requireLocationForItems: appSettings.requireLocationForItems,
      })
      .from(appSettings)
      .where(eq(appSettings.organizationId, input.organizationId))
      .limit(1);
    const [position] = await tx
      .select()
      .from(warehouseInventory)
      .where(
        and(
          eq(warehouseInventory.organizationId, input.organizationId),
          eq(warehouseInventory.warehouseId, warehouse.id),
          eq(warehouseInventory.itemId, item.id),
        ),
      )
      .limit(1).for("update");

    const resolvedLocation = input.data.location || position?.location || item.location || null;
    if (input.data.direction === "IN" && settings?.requireLocationForItems && !resolvedLocation) {
      throw new InventoryScanMovementError(
        "WAREHOUSE_LOCATION_REQUIRED",
        "A storage location is required by Inventory Settings before stock can be received.",
      );
    }

    const previousQuantity = Number(position?.quantity ?? 0);
    const signedQuantity = input.data.direction === "IN" ? input.data.quantity : -input.data.quantity;
    const newQuantity = previousQuantity + signedQuantity;
    if(input.data.direction==="OUT") {
      const reservations=await tx.execute(sql`SELECT COALESCE(sum(quantity),0)::int AS quantity FROM inventory_allocations WHERE organization_id=${input.organizationId} AND item_id=${item.id} AND (warehouse_id=${warehouse.id} OR warehouse_id IS NULL) AND status='reserved'`);
      if(newQuantity<Number(reservations.rows[0]?.quantity??0))throw new InventoryScanMovementError("INSUFFICIENT_ELIGIBLE_STOCK","Stock reserved for demand cannot be scanned out as an unallocated issue.",409);
    }
    if (newQuantity < 0 && !settings?.allowNegativeInventory) {
      throw new InventoryScanMovementError(
        "INSUFFICIENT_WAREHOUSE_STOCK",
        `Only ${previousQuantity} unit(s) are available in ${warehouse.name}.`,
        409,
        { available: previousQuantity, requested: input.data.quantity },
      );
    }

    if (position) {
      await tx
        .update(warehouseInventory)
        .set({ quantity: newQuantity, location: resolvedLocation, updatedAt: new Date() })
        .where(
          and(
            eq(warehouseInventory.id, position.id),
            eq(warehouseInventory.organizationId, input.organizationId),
          ),
        );
    } else {
      await tx.insert(warehouseInventory).values({
        organizationId: input.organizationId,
        warehouseId: warehouse.id,
        itemId: item.id,
        quantity: newQuantity,
        location: resolvedLocation,
      });
    }

    await tx.update(inventoryItems).set({quantity:sql`${inventoryItems.quantity}+${signedQuantity}`,updatedAt:new Date()}).where(and(eq(inventoryItems.id,item.id),eq(inventoryItems.organizationId,input.organizationId)));
    const [movement] = await tx
      .insert(stockMovements)
      .values({
        organizationId: input.organizationId,
        itemId: item.id,
        warehouseId: warehouse.id,
        sourceWarehouseId: input.data.direction === "OUT" ? warehouse.id : null,
        destinationWarehouseId: input.data.direction === "IN" ? warehouse.id : null,
        type: input.data.direction === "IN" ? "RECEIPT" : "ISSUE",
        quantity: signedQuantity,
        referenceType: "barcode_scan",
        notes: input.data.notes || `${input.data.direction === "IN" ? "Scanned in" : "Scanned out"} via ${input.data.value}`,
        userId: input.userId,
        previousQuantity,
        newQuantity,
        warehouseLocation: resolvedLocation,
        receivedAt: input.data.direction === "IN" ? new Date() : null,
      })
      .returning();

    const response = {
      request:input.data,
      movement,
      item: { id: item.id, sku: item.sku, name: item.name, barcode: item.barcode },
      warehouse,
      balance: { previousQuantity, newQuantity, delta: signedQuantity, location: resolvedLocation },
      policy: {
        allowNegativeInventory: Boolean(settings?.allowNegativeInventory),
        requireLocationForItems: Boolean(settings?.requireLocationForItems),
      },
    };
    await tx.insert(workflowIdempotency).values({
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
      action,
      resourceType: "stock_movement",
      resourceId: movement.id,
      response,
    });
    return { duplicate: false, ...response };
  });
}

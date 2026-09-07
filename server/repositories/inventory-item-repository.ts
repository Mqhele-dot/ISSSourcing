/**
 * Org-scoped inventory item persistence (extracted from DatabaseStorage).
 */
import { db } from "../db";
import { getActiveOrganizationId } from "../organization-context";
import { and, eq } from "drizzle-orm";
import { barcodes, inventoryItems, type InsertInventoryItem, type InventoryItem } from "@shared/schema";
import type { InventoryItemRepositoryPort } from "./ports/inventory-item-port";

export async function repoGetAllInventoryItems(): Promise<InventoryItem[]> {
  return db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.organizationId, getActiveOrganizationId()));
}

export async function repoGetInventoryItem(id: number): Promise<InventoryItem | undefined> {
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, getActiveOrganizationId())));
  return item;
}

export async function repoGetInventoryItemBySku(sku: string): Promise<InventoryItem | undefined> {
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.sku, sku), eq(inventoryItems.organizationId, getActiveOrganizationId())),
    );
  return item;
}

export async function repoCreateInventoryItem(item: InsertInventoryItem): Promise<InventoryItem> {
  const organizationId = getActiveOrganizationId();
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(inventoryItems)
      .values({
        ...item,
        organizationId,
      })
      .returning();

    const primaryValue = item.barcode?.trim() || `INV-${organizationId}-${String(created.id).padStart(8, "0")}`;
    const primaryType = item.barcodeType?.trim() || "CODE128";
    const itemHref = `/inventory/${encodeURIComponent(created.sku)}`;
    const generatedCodes = [
      { organizationId, itemId: created.id, value: primaryValue, type: primaryType, isPrimary: true },
      ...(itemHref === primaryValue
        ? []
        : [{ organizationId, itemId: created.id, value: itemHref, type: "QR", isPrimary: false }]),
    ];
    await tx.insert(barcodes).values(generatedCodes);

    const [updated] = await tx
      .update(inventoryItems)
      .set({ barcode: primaryValue, barcodeType: primaryType, updatedAt: new Date() })
      .where(and(eq(inventoryItems.id, created.id), eq(inventoryItems.organizationId, organizationId)))
      .returning();
    return updated;
  });
}

export async function repoUpdateInventoryItem(
  id: number,
  item: Partial<InsertInventoryItem>,
): Promise<InventoryItem | undefined> {
  const organizationId = getActiveOrganizationId();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, organizationId)))
      .limit(1);
    if (!current) return undefined;

    const primaryValue = item.barcode?.trim() || current.barcode || `INV-${organizationId}-${String(id).padStart(8, "0")}`;
    const primaryType = item.barcodeType?.trim() || current.barcodeType || "CODE128";
    const nextSku = item.sku?.trim() || current.sku;
    const [updatedItem] = await tx
      .update(inventoryItems)
      .set({
        ...item,
        barcode: primaryValue,
        barcodeType: primaryType,
        updatedAt: new Date(),
      })
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, organizationId)))
      .returning();

    const itemCodes = await tx
      .select()
      .from(barcodes)
      .where(and(eq(barcodes.organizationId, organizationId), eq(barcodes.itemId, id)));
    const primary = itemCodes.find((code) => code.isPrimary);
    if (primary) {
      await tx
        .update(barcodes)
        .set({ value: primaryValue, type: primaryType })
        .where(and(eq(barcodes.id, primary.id), eq(barcodes.organizationId, organizationId)));
    } else {
      await tx.insert(barcodes).values({ organizationId, itemId: id, value: primaryValue, type: primaryType, isPrimary: true });
    }
    const qrValue = `/inventory/${encodeURIComponent(nextSku)}`;
    const qr = itemCodes.find((code) => !code.isPrimary && code.type === "QR");
    if (qr && qrValue === primaryValue) {
      await tx
        .delete(barcodes)
        .where(and(eq(barcodes.id, qr.id), eq(barcodes.organizationId, organizationId)));
    } else if (qr) {
      await tx
        .update(barcodes)
        .set({ value: qrValue })
        .where(and(eq(barcodes.id, qr.id), eq(barcodes.organizationId, organizationId)));
    } else if (qrValue !== primaryValue) {
      await tx.insert(barcodes).values({ organizationId, itemId: id, value: qrValue, type: "QR", isPrimary: false });
    }
    return updatedItem;
  });
}

/** Typed facade for dependency injection / tests. */
export const inventoryItemRepository: InventoryItemRepositoryPort = {
  getAll: repoGetAllInventoryItems,
  getById: repoGetInventoryItem,
  getBySku: repoGetInventoryItemBySku,
  create: repoCreateInventoryItem,
  update: repoUpdateInventoryItem,
};

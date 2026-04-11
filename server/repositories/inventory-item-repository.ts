/**
 * Org-scoped inventory item persistence (extracted from DatabaseStorage).
 */
import { db } from "../db";
import { getActiveOrganizationId } from "../organization-context";
import { and, eq } from "drizzle-orm";
import { inventoryItems, type InsertInventoryItem, type InventoryItem } from "@shared/schema";
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
  const [newItem] = await db
    .insert(inventoryItems)
    .values({
      ...item,
      organizationId: item.organizationId ?? getActiveOrganizationId(),
    })
    .returning();
  return newItem;
}

export async function repoUpdateInventoryItem(
  id: number,
  item: Partial<InsertInventoryItem>,
): Promise<InventoryItem | undefined> {
  const [updatedItem] = await db
    .update(inventoryItems)
    .set({
      ...item,
      updatedAt: new Date(),
    })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, getActiveOrganizationId())))
    .returning();

  return updatedItem;
}

/** Typed facade for dependency injection / tests. */
export const inventoryItemRepository: InventoryItemRepositoryPort = {
  getAll: repoGetAllInventoryItems,
  getById: repoGetInventoryItem,
  getBySku: repoGetInventoryItemBySku,
  create: repoCreateInventoryItem,
  update: repoUpdateInventoryItem,
};
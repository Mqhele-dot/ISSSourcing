import type { InsertInventoryItem, InventoryItem } from "@shared/schema";

/**
 * Narrow port for inventory item persistence (implemented by inventory-item-repository).
 * New code can depend on this interface for tests/mocks.
 */
export interface InventoryItemRepositoryPort {
  getAll(): Promise<InventoryItem[]>;
  getById(id: number): Promise<InventoryItem | undefined>;
  getBySku(sku: string): Promise<InventoryItem | undefined>;
  create(item: InsertInventoryItem): Promise<InventoryItem>;
  update(id: number, item: Partial<InsertInventoryItem>): Promise<InventoryItem | undefined>;
}

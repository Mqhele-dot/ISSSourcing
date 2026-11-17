/**
 * Compile-time check that inventoryItemRepository satisfies InventoryItemRepositoryPort.
 * Run: npx tsx scripts/test-inventory-port.ts
 */
import type { InventoryItemRepositoryPort } from "../server/repositories/ports/inventory-item-port";
import { inventoryItemRepository } from "../server/repositories/inventory-item-repository";

const _port: InventoryItemRepositoryPort = inventoryItemRepository;
void _port;
console.log("inventory port shape OK");

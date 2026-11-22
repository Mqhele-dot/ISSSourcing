/**
 * Supplier service — business logic for suppliers.
 * Handles audit logging; delegates data access to the repository.
 */
import type { Supplier, InsertSupplier } from "@shared/schema";
import type { ISupplierRepository } from "../repositories/supplier-repository";
import type { IStorage } from "../storage";

export interface ISupplierService {
  create(data: InsertSupplier, userId?: number | null): Promise<Supplier>;
  update(id: number, data: Partial<InsertSupplier>, userId?: number | null): Promise<Supplier | undefined>;
  delete(id: number, userId?: number | null): Promise<boolean>;
}

export function createSupplierService(
  repo: ISupplierRepository,
  storage: IStorage,
): ISupplierService {
  return {
    async create(data, userId) {
      const supplier = await repo.create(data);
      await storage.createActivityLog({
        action: "Supplier Created",
        description: `Created supplier "${supplier.name}" (ID ${supplier.id})`,
        referenceType: "supplier",
        referenceId: supplier.id,
        userId: userId ?? undefined,
      }).catch(() => {});
      return supplier;
    },
    async update(id, data, userId) {
      const supplier = await repo.update(id, data);
      if (!supplier) return undefined;
      await storage.createActivityLog({
        action: "Supplier Updated",
        description: `Updated supplier "${supplier.name}" (ID ${id})`,
        referenceType: "supplier",
        referenceId: id,
        userId: userId ?? undefined,
      }).catch(() => {});
      return supplier;
    },
    async delete(id, userId) {
      const existing = await repo.findById(id);
      const ok = await repo.delete(id);
      if (ok) {
        await storage.createActivityLog({
          action: "Supplier Deleted",
          description: existing ? `Deleted supplier "${existing.name}" (ID ${id})` : `Deleted supplier ID ${id}`,
          referenceType: "supplier",
          referenceId: id,
          userId: userId ?? undefined,
        }).catch(() => {});
      }
      return ok;
    },
  };
}

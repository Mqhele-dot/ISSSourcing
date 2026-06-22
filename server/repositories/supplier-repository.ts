/**
 * Supplier repository — data access layer for suppliers.
 * Delegates to storage; can be extended with caching or alternate backends.
 */
import type { Supplier, InsertSupplier } from "@shared/schema";
import type { IStorage } from "../storage";

export interface ISupplierRepository {
  findAll(): Promise<Supplier[]>;
  findById(id: number): Promise<Supplier | undefined>;
  findByName(name: string): Promise<Supplier | undefined>;
  create(data: InsertSupplier): Promise<Supplier>;
  update(id: number, data: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  delete(id: number): Promise<boolean>;
}

export function createSupplierRepository(storage: IStorage): ISupplierRepository {
  return {
    async findAll() {
      return storage.getAllSuppliers();
    },
    async findById(id: number) {
      return storage.getSupplier(id);
    },
    async findByName(name: string) {
      return storage.getSupplierByName(name);
    },
    async create(data: InsertSupplier) {
      return storage.createSupplier(data);
    },
    async update(id: number, data: Partial<InsertSupplier>) {
      return storage.updateSupplier(id, data);
    },
    async delete(id: number) {
      return storage.deleteSupplier(id);
    },
  };
}

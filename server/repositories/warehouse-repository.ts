/**
 * Warehouse repository — data access layer for warehouses.
 * Delegates to storage; can be extended with caching or alternate backends.
 */
import type { Warehouse, InsertWarehouse } from "@shared/schema";
import type { IStorage } from "../storage";

export interface IWarehouseRepository {
  findAll(): Promise<Warehouse[]>;
  findById(id: number): Promise<Warehouse | undefined>;
  findDefault(): Promise<Warehouse | undefined>;
  create(data: InsertWarehouse): Promise<Warehouse>;
  update(id: number, data: Partial<InsertWarehouse>): Promise<Warehouse | undefined>;
  delete(id: number): Promise<boolean>;
  setDefault(id: number): Promise<Warehouse | undefined>;
}

export function createWarehouseRepository(storage: IStorage): IWarehouseRepository {
  return {
    async findAll() {
      return storage.getAllWarehouses();
    },
    async findById(id: number) {
      return storage.getWarehouse(id);
    },
    async findDefault() {
      return storage.getDefaultWarehouse();
    },
    async create(data: InsertWarehouse) {
      return storage.createWarehouse(data);
    },
    async update(id: number, data: Partial<InsertWarehouse>) {
      return storage.updateWarehouse(id, data);
    },
    async delete(id: number) {
      return storage.deleteWarehouse(id);
    },
    async setDefault(id: number) {
      return storage.setDefaultWarehouse(id);
    },
  };
}

/**
 * Contract repository — data access layer for supplier contracts.
 * Delegates to storage; can be extended with caching, logging, or alternate backends.
 */
import type { SupplierContract, InsertSupplierContract } from "@shared/schema";
import type { IStorage } from "../storage";

export interface IContractRepository {
  findAll(supplierId?: number): Promise<SupplierContract[]>;
  findById(id: number): Promise<SupplierContract | undefined>;
  create(data: InsertSupplierContract): Promise<SupplierContract>;
  update(id: number, data: Partial<InsertSupplierContract>): Promise<SupplierContract | undefined>;
  delete(id: number): Promise<boolean>;
}

export function createContractRepository(storage: IStorage): IContractRepository {
  return {
    async findAll(supplierId?: number) {
      return storage.getContracts(supplierId);
    },
    async findById(id: number) {
      return storage.getContract(id);
    },
    async create(data: InsertSupplierContract) {
      return storage.createContract(data);
    },
    async update(id: number, data: Partial<InsertSupplierContract>) {
      return storage.updateContract(id, data);
    },
    async delete(id: number) {
      return storage.deleteContract(id);
    },
  };
}

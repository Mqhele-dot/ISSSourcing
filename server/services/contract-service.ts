/**
 * Contract service — business logic for supplier contracts.
 * Handles date validation and audit logging; delegates data access to the repository.
 */
import type { SupplierContract, InsertSupplierContract } from "@shared/schema";
import type { IContractRepository } from "../repositories/contract-repository";
import type { IStorage } from "../storage";

export class ContractDateError extends Error {
  constructor(message: string = "End date must be on or after start date") {
    super(message);
    this.name = "ContractDateError";
  }
}

function assertValidDateRange(startDate: Date, endDate: Date | null | undefined): void {
  if (endDate != null && startDate != null && new Date(endDate) < new Date(startDate)) {
    throw new ContractDateError("End date must be on or after start date");
  }
}

export interface IContractService {
  create(data: InsertSupplierContract, userId?: number | null): Promise<SupplierContract>;
  update(id: number, data: Partial<InsertSupplierContract>, userId?: number | null): Promise<SupplierContract | undefined>;
  delete(id: number, userId?: number | null): Promise<boolean>;
}

export function createContractService(
  repo: IContractRepository,
  storage: IStorage,
): IContractService {
  return {
    async create(data, userId) {
      assertValidDateRange(data.startDate as Date, data.endDate ?? undefined);
      const contract = await repo.create(data);
      await storage.createActivityLog({
        action: "Contract Created",
        description: `Created contract "${contract.title}" (supplier ID ${contract.supplierId})`,
        referenceType: "supplier_contract",
        referenceId: contract.id,
        userId: userId ?? undefined,
      }).catch(() => {});
      return contract;
    },
    async update(id, data, userId) {
      const existing = await repo.findById(id);
      if (existing) {
        const start = (data.startDate != null ? new Date(data.startDate) : new Date(existing.startDate)) as Date;
        const end = data.endDate != null ? new Date(data.endDate) : (existing.endDate ? new Date(existing.endDate) : null);
        assertValidDateRange(start, end);
      }
      const contract = await repo.update(id, data);
      if (!contract) return undefined;
      await storage.createActivityLog({
        action: "Contract Updated",
        description: `Updated contract "${contract.title}" (ID ${id})`,
        referenceType: "supplier_contract",
        referenceId: id,
        userId: userId ?? undefined,
      }).catch(() => {});
      return contract;
    },
    async delete(id, userId) {
      const existing = await repo.findById(id);
      const ok = await repo.delete(id);
      if (ok) {
        await storage.createActivityLog({
          action: "Contract Deleted",
          description: existing ? `Deleted contract "${existing.title}" (ID ${id})` : `Deleted contract ID ${id}`,
          referenceType: "supplier_contract",
          referenceId: id,
          userId: userId ?? undefined,
        }).catch(() => {});
      }
      return ok;
    },
  };
}

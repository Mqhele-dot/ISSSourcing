import type { Express, Request, Response } from "express";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../../storage";
import { createContractRepository } from "../../repositories";
import { createContractService, ContractDateError } from "../../services/contract-service";
import { insertSupplierContractSchema } from "@shared/schema";
import type { AuthBundle } from "../procurement/types";

const contractRepo = createContractRepository(storage);
const contractService = createContractService(contractRepo, storage);

/** Supplier contracts CRUD — org-scoped via contract repository. */
export function registerContractRoutes(app: Express, auth: AuthBundle): void {
  const contractRead = [auth.ensureAuthenticated];
  const contractWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])];

  app.get("/api/contracts", ...contractRead, async (req: Request, res: Response) => {
    try {
      const supplierId = req.query.supplierId;
      const id = typeof supplierId === "string" ? Number(supplierId) : undefined;
      const contracts = await contractRepo.findAll(isNaN(id as number) ? undefined : id);
      res.json(contracts);
    } catch (error) {
      console.error("Error fetching contracts:", error);
      res.status(500).json({ message: "Failed to fetch contracts" });
    }
  });

  app.get("/api/contracts/:id", ...contractRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid contract ID" });
      const contract = await contractRepo.findById(id);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      res.json(contract);
    } catch (error) {
      console.error("Error fetching contract:", error);
      res.status(500).json({ message: "Failed to fetch contract" });
    }
  });

  app.post("/api/contracts", ...contractWrite, async (req: Request, res: Response) => {
    try {
      const body = { ...req.body };
      if (typeof body.startDate === "string") body.startDate = new Date(body.startDate);
      if (body.endDate != null && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
      const validated = insertSupplierContractSchema.parse(body);
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const contract = await contractService.create(validated, userId);
      res.status(201).json(contract);
    } catch (error) {
      if (error instanceof ContractDateError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      console.error("Error creating contract:", error);
      res.status(500).json({ message: "Failed to create contract" });
    }
  });

  app.patch("/api/contracts/:id", ...contractWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid contract ID" });
      const body = { ...req.body };
      if (typeof body.startDate === "string") body.startDate = new Date(body.startDate);
      if (body.endDate != null && typeof body.endDate === "string") body.endDate = new Date(body.endDate);
      const validated = insertSupplierContractSchema.partial().parse(body);
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const contract = await contractService.update(id, validated, userId);
      if (!contract) return res.status(404).json({ message: "Contract not found" });
      res.json(contract);
    } catch (error) {
      if (error instanceof ContractDateError) {
        return res.status(400).json({ message: error.message });
      }
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return res.status(400).json({ message: validationError.message });
      }
      console.error("Error updating contract:", error);
      res.status(500).json({ message: "Failed to update contract" });
    }
  });

  app.delete("/api/contracts/:id", ...contractWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid contract ID" });
      const userId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      const ok = await contractService.delete(id, userId);
      if (!ok) return res.status(404).json({ message: "Contract not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting contract:", error);
      res.status(500).json({ message: "Failed to delete contract" });
    }
  });
}

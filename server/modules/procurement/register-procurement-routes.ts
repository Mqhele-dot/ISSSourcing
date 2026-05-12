import type { Express, Request, Response } from "express";
import { ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { and, eq } from "drizzle-orm";
import { storage } from "../../storage";
import { db, pool } from "../../db";
import { sendError, sendFunctionError, sendOk } from "../../api-response";
import { emitNotification } from "../../services/notification-emitter";
import {
  insertPurchaseRequisitionSchema,
  insertPurchaseRequisitionItemSchema,
  insertPurchaseOrderSchema,
  insertPurchaseOrderItemSchema,
  departments,
  projects,
  approvalHistory,
  purchaseOrderRevisions,
  supplierContracts,
  paymentTerms,
  incoterms,
  PurchaseRequisitionStatus,
  PurchaseOrderStatus,
  PaymentStatus,
  type InsertPurchaseOrder,
} from "@shared/schema";
import { canUpdatePurchaseOrder } from "@shared/purchase-order-status";
import { getActiveOrganizationId } from "../../organization-context";
import { getApplicableRequisitionPolicyForOrg, roleMatchesPolicy } from "./service";
import type { AuthBundle } from "./types";

async function validateProjectIdForOrg(
  projectId: number | null | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (projectId == null) return { ok: true };
  const orgId = getActiveOrganizationId();
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
    .limit(1);
  if (!row) return { ok: false, message: "Project not found in this organization" };
  return { ok: true };
}

async function assertPurchaseOrderCommercialReferences(params: {
  organizationId: number;
  supplierId: number;
  patch: Pick<
    Partial<InsertPurchaseOrder>,
    "departmentId" | "contractId" | "paymentTermsId" | "incotermId"
  >;
}): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const { organizationId, supplierId, patch } = params;

  if (patch.departmentId != null) {
    const [row] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, patch.departmentId), eq(departments.organizationId, organizationId)))
      .limit(1);
    if (!row) {
      return { ok: false, code: "PO_DEPARTMENT_NOT_FOUND", message: "Department not found for this organization." };
    }
  }

  if (patch.contractId != null) {
    const [row] = await db
      .select({ id: supplierContracts.id })
      .from(supplierContracts)
      .where(
        and(
          eq(supplierContracts.id, patch.contractId),
          eq(supplierContracts.organizationId, organizationId),
          eq(supplierContracts.supplierId, supplierId),
        ),
      )
      .limit(1);
    if (!row) {
      return {
        ok: false,
        code: "PO_CONTRACT_NOT_FOUND",
        message: "Contract not found for this supplier and organization.",
      };
    }
  }

  if (patch.paymentTermsId != null) {
    const [row] = await db
      .select({ id: paymentTerms.id })
      .from(paymentTerms)
      .where(eq(paymentTerms.id, patch.paymentTermsId))
      .limit(1);
    if (!row) {
      return { ok: false, code: "PO_PAYMENT_TERMS_NOT_FOUND", message: "Payment terms not found." };
    }
  }

  if (patch.incotermId != null) {
    const [row] = await db
      .select({ id: incoterms.id })
      .from(incoterms)
      .where(eq(incoterms.id, patch.incotermId))
      .limit(1);
    if (!row) {
      return { ok: false, code: "PO_INCOTERM_NOT_FOUND", message: "Incoterm not found." };
    }
  }

  return { ok: true };
}

const purchaseOrderCommercialPatchSchema = z
  .object({
    departmentId: z.union([z.number().int().positive(), z.null()]).optional(),
    contractId: z.union([z.number().int().positive(), z.null()]).optional(),
    paymentTermsId: z.union([z.number().int().positive(), z.null()]).optional(),
    incotermId: z.union([z.number().int().positive(), z.null()]).optional(),
  })
  .strict();

function normalizeRequisitionLineInput(item: unknown, index: number) {
  const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const itemId = Number(row.itemId);
  const qty = Number(row.quantity);
  const unit = Number(row.unitPrice);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new Error(`Line ${index + 1}: item is required`);
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`Line ${index + 1}: quantity must be greater than zero`);
  }
  if (!Number.isFinite(unit) || unit <= 0) {
    throw new Error(`Line ${index + 1}: unit price must be greater than zero`);
  }
  const id = row.id == null ? null : Number(row.id);
  return {
    id: id !== null && Number.isFinite(id) && id > 0 ? id : undefined,
    itemId,
    quantity: qty,
    unitPrice: unit,
    totalPrice: qty * unit,
    notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null,
  };
}

/**
 * Purchase requisitions, purchase orders, line items, receive — org-scoped via storage.
 */
export function registerProcurementRoutes(app: Express, auth: AuthBundle): void {
  // Purchase Requisition & Purchase Order — RBAC: viewer read-only; manager/admin for create/update/delete/approve
  const poRead = [auth.ensureAuthenticated];
  const poWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "planner", "admin"])];
    app.get("/api/purchase-requisitions", ...poRead, async (_req: Request, res: Response) => {
    try {
      const requisitions = await storage.getAllPurchaseRequisitions();
      res.json(requisitions);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Error fetching purchase requisitions:", error);
      res.status(500).json({
        message: "Failed to fetch purchase requisitions",
        ...(process.env.NODE_ENV !== "production" && { detail: errMsg }),
      });
    }
  });

  app.get("/api/purchase-requisitions/:id", ...poRead, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const requisition = await storage.getRequisitionWithDetails(id);
      
      if (!requisition) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      
      res.json(requisition);
    } catch (error) {
      console.error("Error fetching purchase requisition:", error);
      res.status(500).json({ message: "Failed to fetch purchase requisition" });
    }
  });

  app.post("/api/purchase-requisitions", ...poWrite, async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "At least one item is required");
      }
      for (let i = 0; i < req.body.items.length; i++) {
        const it = req.body.items[i];
        if (Number(it?.quantity) <= 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: quantity must be greater than zero`);
        }
        const price = Number(it?.unitPrice);
        if (price < 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: unit price cannot be negative`);
        }
        if (price === 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", `Item ${i + 1}: unit price must be greater than zero`);
        }
      }
      
      const requisitionInput = { ...(req.body ?? {}) } as Record<string, unknown>;
      // Generate business defaults before strict schema parsing.
      if (!requisitionInput.requisitionNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().substr(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
        requisitionInput.requisitionNumber = `REQ-${year}${month}-${random}`;
      }
      if (!requisitionInput.status) {
        requisitionInput.status = PurchaseRequisitionStatus.PENDING;
      }
      if (typeof requisitionInput.requiredDate === "string" && requisitionInput.requiredDate.trim()) {
        const parsedRequiredDate = new Date(requisitionInput.requiredDate);
        if (!Number.isNaN(parsedRequiredDate.getTime())) {
          requisitionInput.requiredDate = parsedRequiredDate;
        }
      }

      const validatedReqData = insertPurchaseRequisitionSchema.parse(requisitionInput);
      const validatedItemsData = req.body.items.map((item: any, index: number) => {
        const qty = Number(item?.quantity);
        const unit = Number(item?.unitPrice);
        const itemId = Number(item?.itemId);
        if (!Number.isFinite(itemId) || itemId <= 0) {
          throw new Error(`createPurchaseRequisition:item_${index + 1}_itemId_invalid`);
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`createPurchaseRequisition:item_${index + 1}_quantity_invalid`);
        }
        if (!Number.isFinite(unit) || unit <= 0) {
          throw new Error(`createPurchaseRequisition:item_${index + 1}_unitPrice_invalid`);
        }
        const providedTotal = Number(item?.totalPrice);
        const totalPrice =
          Number.isFinite(providedTotal) && providedTotal > 0 ? providedTotal : qty * unit;
        return {
          itemId,
          quantity: qty,
          unitPrice: unit,
          totalPrice,
          notes: typeof item?.notes === "string" ? item.notes : null,
        };
      });
      if (!validatedReqData.supplierId) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Supplier is required");
      }
      const supplier = await storage.getSupplier(Number(validatedReqData.supplierId));
      if (!supplier) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", "Supplier does not exist");
      }
      if (validatedReqData.departmentId) {
        const deptRows = await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, Number(validatedReqData.departmentId)))
          .limit(1);
        if (deptRows.length === 0) {
          return sendFunctionError(res, 400, "createPurchaseRequisition", "Department does not exist");
        }
      }
      const projectCheck = await validateProjectIdForOrg(validatedReqData.projectId ?? undefined);
      if (!projectCheck.ok) {
        return sendFunctionError(res, 400, "createPurchaseRequisition", projectCheck.message);
      }

      const newRequisition = await storage.createPurchaseRequisition(
        validatedReqData, 
        validatedItemsData
      );
      
      res.status(201).json(newRequisition);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendFunctionError(res, 400, "createPurchaseRequisition", validationError.message);
      } else {
        console.error("Error creating purchase requisition:", error);
        return sendFunctionError(
          res,
          500,
          "createPurchaseRequisition",
          "Failed to create purchase requisition",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  });

  app.put("/api/purchase-requisitions/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "updatePurchaseRequisition", "Invalid purchase requisition ID");
      }
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const { items, revisionReason: _revisionReason, ...headerPatch } = body;
      const validatedData = insertPurchaseRequisitionSchema.partial().parse(headerPatch);
      if (validatedData.supplierId != null) {
        const supplier = await storage.getSupplier(Number(validatedData.supplierId));
        if (!supplier) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "Supplier does not exist");
        }
      }
      if (validatedData.departmentId != null) {
        const deptRows = await db
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.id, Number(validatedData.departmentId)))
          .limit(1);
        if (deptRows.length === 0) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "Department does not exist");
        }
      }
      const projectCheckPut = await validateProjectIdForOrg(validatedData.projectId ?? undefined);
      if (!projectCheckPut.ok) {
        return sendFunctionError(res, 400, "updatePurchaseRequisition", projectCheckPut.message);
      }
      let updatedRequisition = await storage.updatePurchaseRequisition(id, validatedData);
      
      if (!updatedRequisition) {
        return sendFunctionError(res, 404, "updatePurchaseRequisition", "Purchase requisition not found");
      }

      if (Array.isArray(items)) {
        if (items.length === 0) {
          return sendFunctionError(res, 400, "updatePurchaseRequisition", "At least one requisition line is required");
        }
        const normalizedLines = items.map((item, index) => normalizeRequisitionLineInput(item, index));
        const existingLines = await storage.getPurchaseRequisitionItems(id);
        const existingById = new Map(existingLines.map((line) => [line.id, line]));
        const keptIds = new Set<number>();
        for (const line of normalizedLines) {
          const payload = {
            requisitionId: id,
            itemId: line.itemId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            totalPrice: line.totalPrice,
            notes: line.notes,
          };
          if (line.id && existingById.has(line.id)) {
            await storage.updatePurchaseRequisitionItem(line.id, payload);
            keptIds.add(line.id);
          } else {
            const created = await storage.addPurchaseRequisitionItem(payload);
            keptIds.add(created.id);
          }
        }
        for (const existing of existingLines) {
          if (!keptIds.has(existing.id)) {
            await storage.deletePurchaseRequisitionItem(existing.id);
          }
        }
        const totalAmount = normalizedLines.reduce((sum, line) => sum + line.totalPrice, 0);
        updatedRequisition = await storage.updatePurchaseRequisition(id, { totalAmount }) ?? updatedRequisition;
        await storage.createActivityLog({
          action: "Requisition Lines Revised",
          description: `Revised ${normalizedLines.length} line(s) on requisition ${updatedRequisition.requisitionNumber}`,
          referenceType: "requisition",
          referenceId: id,
          userId: (req as Request & { user?: { id?: number } }).user?.id ?? null,
        }).catch(() => {});
        await db.insert(approvalHistory).values({
          organizationId: getActiveOrganizationId(),
          entityType: "requisition",
          entityId: id,
          level: 0,
          action: "revised",
          performedBy: Number((req as Request & { user?: { id?: number } }).user?.id ?? 0),
          previousStatus: updatedRequisition.status,
          newStatus: updatedRequisition.status,
          comment: typeof body.revisionReason === "string" ? body.revisionReason : "Requisition lines revised",
        } as any).catch(() => {});
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        return sendFunctionError(res, 400, "updatePurchaseRequisition", validationError.message);
      } else {
        console.error("Error updating purchase requisition:", error);
        return sendFunctionError(
          res,
          500,
          "updatePurchaseRequisition",
          "Failed to update purchase requisition",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  });

  app.delete("/api/purchase-requisitions/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const success = await storage.deletePurchaseRequisition(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase requisition not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase requisition:", error);
      res.status(500).json({ message: "Failed to delete purchase requisition" });
    }
  });

  app.post("/api/purchase-requisitions/:id/approve", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "approvePurchaseRequisition", "Invalid purchase requisition ID");
      }
      
      const approverId = req.body?.approverId != null ? Number(req.body.approverId) : (req as any).user?.id ?? 0;
      const approverRole = String((req as any).user?.role ?? "");
      const existing = await storage.getPurchaseRequisition(id);
      if (!existing) return sendFunctionError(res, 404, "approvePurchaseRequisition", "Purchase requisition not found");
      if (![PurchaseRequisitionStatus.PENDING, PurchaseRequisitionStatus.DRAFT].includes(existing.status as PurchaseRequisitionStatus)) {
        return sendFunctionError(
          res,
          409,
          "approvePurchaseRequisition",
          `Requisition must be PENDING or DRAFT before approval; current status is ${existing.status}`,
        );
      }
      if (existing.requestorId != null && approverId === existing.requestorId && approverRole.toLowerCase() !== "admin") {
        return sendFunctionError(res, 403, "approvePurchaseRequisition", "Requester cannot approve their own requisition");
      }
      const requisitionTotal = Number(existing.totalAmount ?? 0);
      const approverUser = await storage.getUser(approverId);
      const userCap = approverUser?.approverAmountLimit != null ? Number(approverUser.approverAmountLimit) : null;
      if (userCap != null && userCap > 0 && requisitionTotal > userCap) {
        return sendFunctionError(
          res,
          403,
          "approvePurchaseRequisition",
          `Requisition total exceeds your approver limit (${userCap.toFixed(2)}).`,
        );
      }
      const applicable = await getApplicableRequisitionPolicyForOrg(getActiveOrganizationId(), requisitionTotal);
      if (applicable) {
        if (applicable.approverUserId != null && Number(applicable.approverUserId) !== approverId) {
          return sendFunctionError(res, 403, "approvePurchaseRequisition", "Only the configured approver can approve this requisition");
        }
        if (!roleMatchesPolicy(applicable.approverRole, approverRole)) {
          return sendFunctionError(res, 403, "approvePurchaseRequisition", "Your role is not allowed to approve this requisition amount");
        }
      }
      
      const updatedRequisition = await storage.approvePurchaseRequisition(id, approverId);
      
      if (!updatedRequisition) return sendFunctionError(res, 404, "approvePurchaseRequisition", "Purchase requisition not found");
      await db.insert(approvalHistory).values({
        organizationId: getActiveOrganizationId(),
        entityType: "requisition",
        entityId: id,
        level: Number(applicable?.approvalLevel ?? 1),
        action: "approved",
        performedBy: approverId,
        previousStatus: existing.status,
        newStatus: updatedRequisition.status,
        comment: typeof req.body?.comment === "string" ? req.body.comment : null,
      } as any);
      if (existing.requestorId) {
        await emitNotification({
          userId: Number(existing.requestorId),
          type: "approval_request",
          title: `Requisition ${existing.requisitionNumber ?? `#${id}`} approved`,
          body: `Your requisition has been approved.`,
          entityType: "requisition",
          entityId: id,
        });
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      console.error("Error approving purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "approvePurchaseRequisition",
        "Failed to approve purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/reject", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "rejectPurchaseRequisition", "Invalid purchase requisition ID");
      }
      
      const approverId = req.body?.approverId != null ? Number(req.body.approverId) : (req as any).user?.id ?? 0;
      const approverRole = String((req as any).user?.role ?? "");
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      const existing = await storage.getPurchaseRequisition(id);
      if (!existing) return sendFunctionError(res, 404, "rejectPurchaseRequisition", "Purchase requisition not found");
      if (existing.requestorId != null && approverId === existing.requestorId && approverRole.toLowerCase() !== "admin") {
        return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Requester cannot reject their own requisition");
      }
      const requisitionTotal = Number(existing.totalAmount ?? 0);
      const applicable = await getApplicableRequisitionPolicyForOrg(getActiveOrganizationId(), requisitionTotal);
      if (applicable) {
        if (applicable.approverUserId != null && Number(applicable.approverUserId) !== approverId) {
          return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Only the configured approver can reject this requisition");
        }
        if (!roleMatchesPolicy(applicable.approverRole, approverRole)) {
          return sendFunctionError(res, 403, "rejectPurchaseRequisition", "Your role is not allowed to reject this requisition amount");
        }
      }
      
      const updatedRequisition = await storage.rejectPurchaseRequisition(id, approverId, reason);
      
      if (!updatedRequisition) return sendFunctionError(res, 404, "rejectPurchaseRequisition", "Purchase requisition not found");
      await db.insert(approvalHistory).values({
        organizationId: getActiveOrganizationId(),
        entityType: "requisition",
        entityId: id,
        level: Number(applicable?.approvalLevel ?? 1),
        action: "rejected",
        performedBy: approverId,
        previousStatus: existing.status,
        newStatus: updatedRequisition.status,
        comment: reason || null,
      } as any);
      if (existing.requestorId) {
        await emitNotification({
          userId: Number(existing.requestorId),
          type: "approval_request",
          title: `Requisition ${existing.requisitionNumber ?? `#${id}`} rejected`,
          body: reason || "Your requisition has been rejected.",
          entityType: "requisition",
          entityId: id,
        });
      }
      
      res.json(updatedRequisition);
    } catch (error) {
      console.error("Error rejecting purchase requisition:", error);
      return sendFunctionError(
        res,
        500,
        "rejectPurchaseRequisition",
        "Failed to reject purchase requisition",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/convert", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return sendFunctionError(res, 400, "convertPurchaseRequisitionToPO", "Invalid purchase requisition ID");
      }
      
      const purchaseOrder = await storage.createPurchaseOrderFromRequisition(id);

      if (!purchaseOrder) {
        return sendError(
          res,
          404,
          "CONVERT_REQUISITION_FAILED",
          "Could not convert: the requisition must exist, be approved, and have valid lines and supplier.",
        );
      }

      return sendOk(res, purchaseOrder, 201);
    } catch (error) {
      console.error("Error converting requisition to purchase order:", error);
      return sendFunctionError(
        res,
        500,
        "convertPurchaseRequisitionToPO",
        "Failed to convert requisition to purchase order",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.post("/api/purchase-requisitions/:id/share", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id < 1) {
        return sendError(res, 400, "INVALID_ID", "Invalid purchase requisition ID");
      }
      const { userIds } = req.body as { userIds?: number[] };
      if (!Array.isArray(userIds)) {
        return sendError(res, 400, "INVALID_BODY", "userIds must be an array of user IDs");
      }
      const normalized = userIds
        .map((u) => Number(u))
        .filter((u) => Number.isFinite(u) && u >= 1);
      if (normalized.length !== userIds.length) {
        return sendError(res, 400, "INVALID_USER_IDS", "userIds must contain only positive integer user IDs");
      }
      const updated = await storage.updatePurchaseRequisition(id, { sharedWithUserIds: normalized });
      if (!updated) {
        return sendError(res, 404, "NOT_FOUND", "Purchase requisition not found");
      }
      return sendOk(res, updated);
    } catch (error) {
      console.error("Error sharing requisition:", error);
      return sendError(res, 500, "SHARE_REQUISITION_FAILED", "Failed to share requisition");
    }
  });

  // Purchase Requisition Items endpoints
  app.get("/api/purchase-requisitions/:reqId/items", ...poRead, async (req: Request, res: Response) => {
    try {
      const reqId = Number(req.params.reqId);
      if (isNaN(reqId)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const items = await storage.getPurchaseRequisitionItems(reqId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching purchase requisition items:", error);
      res.status(500).json({ message: "Failed to fetch purchase requisition items" });
    }
  });

  app.post("/api/purchase-requisitions/:reqId/items", ...poWrite, async (req: Request, res: Response) => {
    try {
      const reqId = Number(req.params.reqId);
      if (isNaN(reqId)) {
        return res.status(400).json({ message: "Invalid purchase requisition ID" });
      }
      
      const validatedData = insertPurchaseRequisitionItemSchema.parse({
        ...req.body,
        requisitionId: reqId
      });
      
      const newItem = await storage.addPurchaseRequisitionItem(validatedData);
      res.status(201).json(newItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error adding purchase requisition item:", error);
        res.status(500).json({ message: "Failed to add purchase requisition item" });
      }
    }
  });

  app.put("/api/purchase-requisitions-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition item ID" });
      }
      
      const validatedData = insertPurchaseRequisitionItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updatePurchaseRequisitionItem(id, validatedData);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Purchase requisition item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating purchase requisition item:", error);
        res.status(500).json({ message: "Failed to update purchase requisition item" });
      }
    }
  });

  app.delete("/api/purchase-requisitions-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase requisition item ID" });
      }
      
      const success = await storage.deletePurchaseRequisitionItem(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase requisition item not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase requisition item:", error);
      res.status(500).json({ message: "Failed to delete purchase requisition item" });
    }
  });

  // Purchase Order endpoints (same RBAC as requisitions) — legacy + canonical record paths
  app.get(
    ["/api/purchase-orders", "/api/procurement/purchase-orders/records"],
    ...poRead,
    async (_req: Request, res: Response) => {
      try {
        const orders = await storage.getAllPurchaseOrders();
        res.json(orders);
      } catch (error) {
        console.error("Error fetching purchase orders:", error);
        res.status(500).json({ message: "Failed to fetch purchase orders" });
      }
    },
  );

  app.get(
    ["/api/purchase-orders/:id", "/api/procurement/purchase-orders/records/:id"],
    ...poRead,
    async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const order = await storage.getPurchaseOrderWithDetails(id);
      
      if (!order) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.json(order);
    } catch (error) {
      console.error("Error fetching purchase order:", error);
      res.status(500).json({ message: "Failed to fetch purchase order" });
    }
  },
  );

  app.post("/api/purchase-orders", ...poWrite, async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
        return res.status(400).json({ message: "At least one item is required" });
      }
      
      const purchaseOrderInput = { ...(req.body ?? {}) } as Record<string, unknown>;
      // Generate business defaults before strict schema parsing.
      if (!purchaseOrderInput.orderNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().substr(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
        purchaseOrderInput.orderNumber = `PO-${year}${month}-${random}`;
      }
      if (!purchaseOrderInput.status) {
        purchaseOrderInput.status = PurchaseOrderStatus.DRAFT;
      }
      if (typeof purchaseOrderInput.orderDate === "string" && purchaseOrderInput.orderDate.trim()) {
        const parsedOrderDate = new Date(purchaseOrderInput.orderDate);
        if (!Number.isNaN(parsedOrderDate.getTime())) {
          purchaseOrderInput.orderDate = parsedOrderDate;
        }
      }
      if (
        typeof purchaseOrderInput.expectedDeliveryDate === "string" &&
        purchaseOrderInput.expectedDeliveryDate.trim()
      ) {
        const parsedExpectedDate = new Date(purchaseOrderInput.expectedDeliveryDate);
        if (!Number.isNaN(parsedExpectedDate.getTime())) {
          purchaseOrderInput.expectedDeliveryDate = parsedExpectedDate;
        }
      }

      const validatedOrderData = insertPurchaseOrderSchema.parse(purchaseOrderInput);
      const validatedItemsData = req.body.items.map((item: any, index: number) => {
        const qty = Number(item?.quantity);
        const unit = Number(item?.unitPrice);
        const itemId = Number(item?.itemId);
        if (!Number.isFinite(itemId) || itemId <= 0) {
          throw new Error(`createPurchaseOrder:item_${index + 1}_itemId_invalid`);
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`createPurchaseOrder:item_${index + 1}_quantity_invalid`);
        }
        if (!Number.isFinite(unit) || unit <= 0) {
          throw new Error(`createPurchaseOrder:item_${index + 1}_unitPrice_invalid`);
        }
        const providedTotal = Number(item?.totalPrice);
        const totalPrice =
          Number.isFinite(providedTotal) && providedTotal > 0 ? providedTotal : qty * unit;
        return {
          itemId,
          quantity: qty,
          unitPrice: unit,
          totalPrice,
          notes: typeof item?.notes === "string" ? item.notes : null,
        };
      });
      const projectCheckPo = await validateProjectIdForOrg(validatedOrderData.projectId ?? undefined);
      if (!projectCheckPo.ok) {
        return res.status(400).json({ message: projectCheckPo.message });
      }

      const newOrder = await storage.createPurchaseOrder(
        validatedOrderData, 
        validatedItemsData
      );
      const creatorId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      await db.insert(purchaseOrderRevisions).values({
        orderId: newOrder.id,
        revisionNumber: 1,
        snapshot: {
          order: newOrder,
          items: validatedItemsData,
          source: "create",
        },
        createdBy: creatorId,
      } as any);
      
      res.status(201).json(newOrder);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error creating purchase order:", error);
        res.status(500).json({ message: "Failed to create purchase order" });
      }
    }
  });

  const handlePurchaseOrderCommercialUpdate = async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return sendError(res, 400, "PO_INVALID_ID", "Invalid purchase order ID");
      }

      const parsedBody = purchaseOrderCommercialPatchSchema.safeParse(req.body);
      if (!parsedBody.success) {
        const validationError = fromZodError(parsedBody.error);
        return sendError(res, 400, "PO_COMMERCIAL_VALIDATION_FAILED", validationError.message);
      }

      const existing = await storage.getPurchaseOrder(id);
      if (!existing) {
        return sendError(res, 404, "PO_NOT_FOUND", "Purchase order not found");
      }

      if (!canUpdatePurchaseOrder(existing.status)) {
        return sendError(
          res,
          409,
          "PO_COMMERCIAL_UPDATE_LOCKED",
          "Commercial terms can only be updated before the PO is sent.",
          { hint: String(existing.status) },
        );
      }

      const patchPayload = parsedBody.data;
      const validatedData: Partial<InsertPurchaseOrder> = {};
      (["departmentId", "contractId", "paymentTermsId", "incotermId"] as const).forEach((key) => {
        if (patchPayload[key] !== undefined) {
          validatedData[key] = patchPayload[key] as never;
        }
      });

      if (Object.keys(validatedData).length === 0) {
        return sendError(res, 400, "PO_COMMERCIAL_EMPTY", "Provide at least one commercial field to update.");
      }

      const orgId = getActiveOrganizationId();
      const refCheck = await assertPurchaseOrderCommercialReferences({
        organizationId: orgId,
        supplierId: existing.supplierId,
        patch: validatedData,
      });
      if (!refCheck.ok) {
        return sendError(res, 400, refCheck.code, refCheck.message);
      }

      const updatedOrder = await storage.updatePurchaseOrder(id, validatedData);

      if (!updatedOrder) {
        return sendError(res, 404, "PO_NOT_FOUND", "Purchase order not found");
      }

      const rev = await pool.query<{ max: number }>(
        "SELECT COALESCE(MAX(revision_number), 0) AS max FROM purchase_order_revisions WHERE order_id = $1",
        [id],
      );
      const nextRevision = Number(rev.rows[0]?.max ?? 0) + 1;
      const updaterId = (req as Request & { user?: { id: number } }).user?.id ?? null;
      await db.insert(purchaseOrderRevisions).values({
        orderId: id,
        revisionNumber: nextRevision,
        snapshot: {
          update: validatedData,
          orderAfterUpdate: updatedOrder,
          source: "commercial_update",
        },
        createdBy: updaterId,
      } as any);
      res.json(updatedOrder);
    } catch (error) {
      console.error("Error updating purchase order:", error);
      res.status(500).json({ message: "Failed to update purchase order" });
    }
  };

  app.put("/api/purchase-orders/:id", ...poWrite, handlePurchaseOrderCommercialUpdate);
  app.patch(
    "/api/procurement/purchase-orders/records/:id/commercial",
    ...poWrite,
    handlePurchaseOrderCommercialUpdate,
  );

  app.get(
    [
      "/api/purchase-orders/:id/revisions",
      "/api/procurement/purchase-orders/records/:id/revisions",
    ],
    ...poRead,
    async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid purchase order ID" });
      const rows = await db.select().from(purchaseOrderRevisions).where(eq(purchaseOrderRevisions.orderId, id));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching purchase order revisions:", error);
      res.status(500).json({ message: "Failed to fetch purchase order revisions" });
    }
  },
  );

  app.delete("/api/purchase-orders/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const success = await storage.deletePurchaseOrder(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase order:", error);
      res.status(500).json({ message: "Failed to delete purchase order" });
    }
  });

  app.post("/api/purchase-orders/:id/update-status", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const { status } = req.body;
      if (!status || !Object.values(PurchaseOrderStatus).includes(status as PurchaseOrderStatus)) {
        return res.status(400).json({ message: "Valid status is required" });
      }
      
      const updatedOrder = await storage.updatePurchaseOrderStatus(id, status);
      
      if (!updatedOrder) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.json(updatedOrder);
    } catch (error) {
      console.error("Error updating purchase order status:", error);
      res.status(500).json({ message: "Failed to update purchase order status" });
    }
  });

  app.post("/api/purchase-orders/:id/update-payment", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const { paymentStatus, reference } = req.body;
      if (!paymentStatus || !Object.values(PaymentStatus).includes(paymentStatus as PaymentStatus)) {
        return res.status(400).json({ message: "Valid payment status is required" });
      }
      
      const updatedOrder = await storage.updatePurchaseOrderPaymentStatus(id, paymentStatus, reference);
      
      if (!updatedOrder) {
        return res.status(404).json({ message: "Purchase order not found" });
      }
      
      res.json(updatedOrder);
    } catch (error) {
      console.error("Error updating purchase order payment status:", error);
      res.status(500).json({ message: "Failed to update purchase order payment status" });
    }
  });

  app.post("/api/purchase-orders/:id/send-email", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Recipient email is required" });
      }
      
      const success = await storage.sendPurchaseOrderEmail(id, email);
      
      if (!success) {
        return res.status(500).json({ message: "Failed to send purchase order email" });
      }
      
      // Update the order status to SENT if successful
      await storage.updatePurchaseOrderStatus(id, PurchaseOrderStatus.SENT);
      
      res.json({ message: "Purchase order email sent successfully" });
    } catch (error) {
      console.error("Error sending purchase order email:", error);
      res.status(500).json({ message: "Failed to send purchase order email" });
    }
  });

  // Purchase Order Items endpoints
  app.get(
    [
      "/api/purchase-orders/:orderId/items",
      "/api/procurement/purchase-orders/records/:orderId/items",
    ],
    ...poRead,
    async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.orderId);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const items = await storage.getPurchaseOrderItems(orderId);
      res.json(items);
    } catch (error) {
      console.error("Error fetching purchase order items:", error);
      res.status(500).json({ message: "Failed to fetch purchase order items" });
    }
  },
  );

  app.post(
    [
      "/api/purchase-orders/:orderId/items",
      "/api/procurement/purchase-orders/records/:orderId/items",
    ],
    ...poWrite,
    async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.orderId);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid purchase order ID" });
      }
      
      const validatedData = insertPurchaseOrderItemSchema.parse({
        ...req.body,
        orderId
      });
      
      const newItem = await storage.addPurchaseOrderItem(validatedData);
      res.status(201).json(newItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error adding purchase order item:", error);
        res.status(500).json({ message: "Failed to add purchase order item" });
      }
    }
  },
  );

  app.put("/api/purchase-order-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order item ID" });
      }
      
      const validatedData = insertPurchaseOrderItemSchema.partial().parse(req.body);
      const updatedItem = await storage.updatePurchaseOrderItem(id, validatedData);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Purchase order item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Error updating purchase order item:", error);
        res.status(500).json({ message: "Failed to update purchase order item" });
      }
    }
  });

  app.delete("/api/purchase-order-items/:id", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order item ID" });
      }
      
      const success = await storage.deletePurchaseOrderItem(id);
      
      if (!success) {
        return res.status(404).json({ message: "Purchase order item not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting purchase order item:", error);
      res.status(500).json({ message: "Failed to delete purchase order item" });
    }
  });

  app.post("/api/purchase-order-items/:id/receive", ...poWrite, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid purchase order item ID" });
      }
      
      const { receivedQuantity, receiverName, warehouseLocation, receivedAt, receiverUserId } = req.body ?? {};
      if (receivedQuantity === undefined || isNaN(Number(receivedQuantity)) || Number(receivedQuantity) < 0) {
        return res.status(400).json({ message: "Valid received quantity is required" });
      }

      const meta =
        receiverName != null || warehouseLocation != null || receivedAt != null || receiverUserId != null
          ? {
              receiverName: typeof receiverName === "string" ? receiverName : null,
              warehouseLocation: typeof warehouseLocation === "string" ? warehouseLocation : null,
              receivedAt: typeof receivedAt === "string" ? receivedAt : null,
              receiverUserId:
                receiverUserId != null && !isNaN(Number(receiverUserId)) ? Number(receiverUserId) : null,
            }
          : undefined;

      const updatedItem = await storage.recordPurchaseOrderItemReceived(id, Number(receivedQuantity), meta);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Purchase order item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      console.error("Error recording received quantity:", error);
      res.status(500).json({ message: "Failed to record received quantity" });
    }
  });

}

import type { Express, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { storage } from "../../storage";
import { executeStockCommand, stockCommandSchema } from "./stock-command-service";
import { stockGuardError } from "./stock-guard-error";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError } from "../../api-response";

/**
 * Stock movement list/create/transfer/receipt/issue — extracted from legacy routes.ts.
 */
export function registerStockMovementRoutes(
  app: Express,
  auth: {
    ensureAuthenticated: RequestHandler;
    ensurePermission: (resource: string, permissionType: string) => RequestHandler;
  },
): void {
  const stockRead = [auth.ensureAuthenticated, auth.ensurePermission("stock_movements", "read")];
  const stockWrite = [auth.ensureAuthenticated, auth.ensurePermission("stock_movements", "create")];
  const stockExecute = [auth.ensureAuthenticated, auth.ensurePermission("stock_movements", "execute")];

  app.get("/api/stock-movements", ...stockRead, async (_req: Request, res: Response) => {
    try {
      const movements = await storage.getAllStockMovements();
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements:", error);
      res.status(500).json({ message: "Failed to fetch stock movements" });
    }
  });

  app.get("/api/stock-movements/item/:itemId", ...stockRead, async (req: Request, res: Response) => {
    try {
      const itemId = Number(req.params.itemId);
      if (isNaN(itemId)) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const movements = await storage.getStockMovementsByItemId(itemId);
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements for item:", error);
      res.status(500).json({ message: "Failed to fetch stock movements for item" });
    }
  });

  app.get("/api/stock-movements/warehouse/:warehouseId", ...stockRead, async (req: Request, res: Response) => {
    try {
      const warehouseId = Number(req.params.warehouseId);
      if (isNaN(warehouseId)) {
        return res.status(400).json({ message: "Invalid warehouse ID" });
      }

      const movements = await storage.getStockMovementsByWarehouseId(warehouseId);
      res.json(movements);
    } catch (error) {
      console.error("Error fetching stock movements for warehouse:", error);
      res.status(500).json({ message: "Failed to fetch stock movements for warehouse" });
    }
  });

  // Do not accept client-authored ledger evidence. Commands own stock and evidence together.
  app.post("/api/stock-movements", ...stockWrite, async (_req:Request,res:Response)=>{
    return sendError(res,409,"STOCK_COMMAND_REQUIRED","Use receipt, issue, transfer, count or adjustment commands. Direct ledger insertion is not allowed.");
  });

  for (const kind of ["TRANSFER","RECEIPT","ISSUE"] as const) {
    app.post(`/api/stock-movements/${kind.toLowerCase()}`, ...stockExecute, async(req:Request,res:Response)=>{
      try {
        const key=String(req.get("Idempotency-Key")??"").trim();
        if(key.length<8||key.length>128)return sendError(res,400,"IDEMPOTENCY_KEY_REQUIRED","Provide an Idempotency-Key of 8–128 characters.");
        const user=Number((req as Request&{user?:{id:number}}).user?.id);
        const movement=await executeStockCommand(getActiveOrganizationId(),user,key,kind,stockCommandSchema.parse(req.body));
        return res.status(201).json(movement);
      } catch(error) {
        if(error instanceof ZodError)return sendError(res,400,"INVALID_STOCK_COMMAND","Check the quantity and warehouse fields.");
          const code=stockGuardError(error);
          if(code==="STOCK_INSPECTION_RECEIPT_REQUIRED")return sendError(res,409,code,"Use PO Receiving to record supplier provenance and required inspection evidence.");
        if(code)return sendError(res,409,code,"Stock cannot move while held, reserved, or busy. Refresh and check its eligibility.");
        const message=error instanceof Error?error.message:"";
        if(message.startsWith("STOCK_"))return sendError(res,message.endsWith("DENIED")?403:message.endsWith("NOT_FOUND")?404:409,message,message.replaceAll("_"," "));
        return sendError(res,500,"STOCK_COMMAND_FAILED","The stock transaction failed and was rolled back.");
      }
    });
  }
}

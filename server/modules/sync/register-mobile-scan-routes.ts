import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { getActiveOrganizationId } from "../../organization-context";
import { sendError, sendOk } from "../../api-response";
import { barcodes, trackedAssets } from "@shared/schema";
import { scanResolveBodySchema } from "./scan-validators";

type Auth = {
  ensureAuthenticated: import("express").RequestHandler;
};

const DEFAULT_NEXT_ACTIONS = ["receive", "transfer", "issue", "count", "inspect"] as const;

/**
 * Scan-to-action: resolve a scanned code to an inventory item and/or tracked asset.
 * Pairs with offline queue `type: "scan"` in `/api/sync/batch`.
 */
export function registerMobileScanRoutes(app: Express, auth: Auth): void {
  app.post("/api/mobile/scan/resolve", auth.ensureAuthenticated, async (req: Request, res: Response) => {
    const parsed = scanResolveBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid scan body", {
        details: parsed.error.flatten(),
      });
    }
    const raw = parsed.data.value.trim();
    const orgId = getActiveOrganizationId();

    const [bc] = await db
      .select()
      .from(barcodes)
      .where(and(eq(barcodes.organizationId, orgId), eq(barcodes.value, raw)))
      .limit(1);

    if (bc) {
      const item = await storage.getInventoryItem(bc.itemId);
      return sendOk(res, {
        kind: "item" as const,
        intent: parsed.data.intent ?? null,
        item: item
          ? { id: item.id, sku: item.sku, name: item.name }
          : null,
        barcode: { id: bc.id, value: bc.value },
        nextActions: [...DEFAULT_NEXT_ACTIONS],
      });
    }

    const [asset] = await db
      .select()
      .from(trackedAssets)
      .where(and(eq(trackedAssets.organizationId, orgId), eq(trackedAssets.serialNumber, raw)))
      .limit(1);

    if (asset) {
      return sendOk(res, {
        kind: "asset" as const,
        intent: parsed.data.intent ?? null,
        asset: {
          id: asset.id,
          assetType: asset.assetType,
          serialNumber: asset.serialNumber,
          status: asset.status,
        },
        nextActions: ["inspect", "transfer", "assign_vehicle", "return", "quarantine"],
      });
    }

    return sendOk(res, {
      kind: "unknown" as const,
      intent: parsed.data.intent ?? null,
      value: raw,
      nextActions: ["create_item", "link_barcode", "register_asset"],
    });
  });
}

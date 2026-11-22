import { and, eq } from "drizzle-orm";
import { barcodes, trackedAssets } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";

const DEFAULT_ITEM_NEXT_ACTIONS = ["receive", "transfer", "issue", "count", "inspect"] as const;
const DEFAULT_ASSET_NEXT_ACTIONS = ["inspect", "transfer", "assign_vehicle", "return", "quarantine"] as const;
const DEFAULT_UNKNOWN_NEXT_ACTIONS = ["create_item", "link_barcode", "register_asset"] as const;

export type MobileScanResolveResult =
  | {
      kind: "item";
      intent: string | null;
      item: { id: number; sku: string; name: string } | null;
      barcode: { id: number; value: string };
      nextActions: string[];
    }
  | {
      kind: "asset";
      intent: string | null;
      asset: {
        id: number;
        assetType: string;
        serialNumber: string | null;
        status: string | null;
      };
      nextActions: string[];
    }
  | {
      kind: "unknown";
      intent: string | null;
      value: string;
      nextActions: string[];
    };

export async function resolveMobileScanValue(input: {
  organizationId: number;
  value: string;
  intent?: string | null;
}): Promise<MobileScanResolveResult> {
  const raw = input.value.trim();

  const [barcode] = await db
    .select()
    .from(barcodes)
    .where(and(eq(barcodes.organizationId, input.organizationId), eq(barcodes.value, raw)))
    .limit(1);

  if (barcode) {
    const item = await storage.getInventoryItem(barcode.itemId);
    return {
      kind: "item",
      intent: input.intent ?? null,
      item: item
        ? { id: item.id, sku: item.sku, name: item.name }
        : null,
      barcode: { id: barcode.id, value: barcode.value },
      nextActions: [...DEFAULT_ITEM_NEXT_ACTIONS],
    };
  }

  const [asset] = await db
    .select()
    .from(trackedAssets)
    .where(and(eq(trackedAssets.organizationId, input.organizationId), eq(trackedAssets.serialNumber, raw)))
    .limit(1);

  if (asset) {
    return {
      kind: "asset",
      intent: input.intent ?? null,
      asset: {
        id: asset.id,
        assetType: asset.assetType,
        serialNumber: asset.serialNumber,
        status: asset.status,
      },
      nextActions: [...DEFAULT_ASSET_NEXT_ACTIONS],
    };
  }

  return {
    kind: "unknown",
    intent: input.intent ?? null,
    value: raw,
    nextActions: [...DEFAULT_UNKNOWN_NEXT_ACTIONS],
  };
}

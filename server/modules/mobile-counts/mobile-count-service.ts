import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { getEffectiveCompanyConfigurationValue } from "../../company-configuration-resolver";
import {
  barcodes,
  inventoryItems,
  mobileSyncEvents,
  stockCountLines,
  stockCountSessions,
  stockCountTargets,
  stockCountVariances,
} from "@shared/schema";

export class MobileCountDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const countModeSchema = z.enum(["blind", "guided", "spot", "recount"]);

export const createMobileCountSessionSchema = z.object({
  warehouseId: z.coerce.number().int().positive(),
  mode: countModeSchema.default("guided"),
  assignedUserId: z.coerce.number().int().positive().optional().nullable(),
  deviceId: z.string().max(128).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  targets: z
    .array(
      z.object({
        itemId: z.coerce.number().int().positive(),
        locationId: z.string().max(128).optional().nullable(),
        lotId: z.coerce.number().int().positive().optional().nullable(),
        serialId: z.coerce.number().int().positive().optional().nullable(),
        systemQtySnapshot: z.coerce.number().int().default(0),
        blindMode: z.boolean().optional(),
      }),
    )
    .default([]),
});

export const mobileCountLineSchema = z.object({
  targetId: z.coerce.number().int().positive().optional().nullable(),
  itemId: z.coerce.number().int().positive().optional().nullable(),
  countedQty: z.coerce.number().int().min(0),
  scanValue: z.string().max(256).optional().nullable(),
  locationId: z.string().max(128).optional().nullable(),
  binCode: z.string().max(128).optional().nullable(),
  deviceClockAt: z.coerce.date().optional().nullable(),
  syncStatus: z.enum(["synced", "queued", "replayed"]).optional(),
});

type MobileCountLineInput = z.infer<typeof mobileCountLineSchema>;
type CreateMobileCountSessionInput = z.infer<typeof createMobileCountSessionSchema>;

type ScanCandidate = {
  id: number;
  sku: string;
  name: string;
  barcode?: string | null;
  source: "sku" | "item_barcode" | "barcode_table";
};

export async function resolveMobileCountScanValue(organizationId: number, rawValue: string) {
  const value = rawValue.trim();
  if (!value) {
    return { value, status: "empty" as const, candidates: [] as ScanCandidate[] };
  }

  const candidates = new Map<number, ScanCandidate>();
  const addCandidate = (item: typeof inventoryItems.$inferSelect | undefined, source: ScanCandidate["source"]) => {
    if (!item) return;
    candidates.set(item.id, {
      id: item.id,
      sku: item.sku,
      name: item.name,
      barcode: item.barcode ?? null,
      source,
    });
  };

  const [skuMatch] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, organizationId), eq(inventoryItems.sku, value)))
    .limit(1);
  addCandidate(skuMatch, "sku");

  const [itemBarcodeMatch] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.organizationId, organizationId), eq(inventoryItems.barcode, value)))
    .limit(1);
  addCandidate(itemBarcodeMatch, "item_barcode");

  const barcodeRows = await db
    .select({ item: inventoryItems, barcode: barcodes })
    .from(barcodes)
    .innerJoin(inventoryItems, and(eq(inventoryItems.organizationId, organizationId), eq(inventoryItems.id, barcodes.itemId)))
    .where(and(eq(barcodes.organizationId, organizationId), eq(barcodes.value, value)));
  for (const row of barcodeRows) addCandidate(row.item, "barcode_table");

  const list = [...candidates.values()];
  return {
    value,
    status: list.length === 0 ? ("not_found" as const) : list.length === 1 ? ("resolved" as const) : ("ambiguous" as const),
    item: list.length === 1 ? list[0] : null,
    candidates: list,
  };
}

export async function createMobileCountSession(input: {
  organizationId: number;
  data: CreateMobileCountSessionInput;
  idempotencyKey: string;
  userId: number | null;
}) {
  const existing = await db
    .select()
    .from(mobileSyncEvents)
    .where(and(eq(mobileSyncEvents.organizationId, input.organizationId), eq(mobileSyncEvents.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing[0]) return { duplicate: true, idempotencyKey: input.idempotencyKey };

  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(stockCountSessions)
      .values({
        organizationId: input.organizationId,
        warehouseId: input.data.warehouseId,
        mode: input.data.mode,
        status: input.data.mode === "spot" ? "in_progress" : "assigned",
        assignedUserId: input.data.assignedUserId ?? input.userId,
        startedAt: input.data.mode === "spot" ? new Date() : null,
        source: "mobile",
        deviceId: input.data.deviceId ?? null,
        notes: input.data.notes ?? null,
      })
      .returning();

    const targets = input.data.targets.length
      ? await tx
          .insert(stockCountTargets)
          .values(
            input.data.targets.map((target) => ({
              organizationId: input.organizationId,
              sessionId: session.id,
              warehouseId: input.data.warehouseId,
              itemId: target.itemId,
              locationId: target.locationId ?? null,
              lotId: target.lotId ?? null,
              serialId: target.serialId ?? null,
              systemQtySnapshot: target.systemQtySnapshot,
              blindMode: target.blindMode ?? input.data.mode === "blind",
            })),
          )
          .returning()
      : [];

    await tx.insert(mobileSyncEvents).values({
      organizationId: input.organizationId,
      deviceId: input.data.deviceId ?? "unknown-device",
      eventType: input.data.mode === "spot" ? "mobile_count_spot" : "mobile_count_session_create",
      body: { sessionId: session.id, mode: input.data.mode },
      idempotencyKey: input.idempotencyKey,
      status: "applied",
      ackedAt: new Date(),
      appliedAt: new Date(),
    });

    return { session, targets };
  });
}

async function resolveLineItemId(organizationId: number, parsed: MobileCountLineInput): Promise<number> {
  if (parsed.itemId) return parsed.itemId;
  if (!parsed.scanValue?.trim()) {
    throw new MobileCountDomainError(
      "MOBILE_COUNT_ITEM_OR_SCAN_REQUIRED",
      "Scan an item or select one manually before saving the count line.",
      400,
    );
  }

  const resolved = await resolveMobileCountScanValue(organizationId, parsed.scanValue);
  if (resolved.status === "resolved" && resolved.item) return resolved.item.id;
  if (resolved.status === "ambiguous") {
    throw new MobileCountDomainError("SCAN_VALUE_AMBIGUOUS", "Scan matched more than one inventory item.", 409, {
      candidates: resolved.candidates,
    });
  }
  throw new MobileCountDomainError("SCAN_VALUE_NOT_FOUND", "No inventory item matched the scanned value.", 404, {
    scanValue: parsed.scanValue,
  });
}

export async function addMobileCountLine(input: {
  organizationId: number;
  sessionId: number;
  data: MobileCountLineInput;
  idempotencyKey: string;
  userId: number | null;
}) {
  const parsed = mobileCountLineSchema.parse(input.data);
  const [session] = await db
    .select()
    .from(stockCountSessions)
    .where(and(eq(stockCountSessions.organizationId, input.organizationId), eq(stockCountSessions.id, input.sessionId)))
    .limit(1);
  if (!session) throw new MobileCountDomainError("MOBILE_COUNT_NOT_FOUND", "Mobile count session not found.", 404);
  if (["submitted", "approved", "posted"].includes(session.status)) {
    throw new MobileCountDomainError("MOBILE_COUNT_CLOSED", "This count session is no longer accepting lines.", 409);
  }

  const locationRequired = await getEffectiveCompanyConfigurationValue(
    input.organizationId,
    "inventory.count.locationRequired",
    false,
  );
  if (locationRequired && !parsed.locationId?.trim() && !parsed.binCode?.trim()) {
    throw new MobileCountDomainError(
      "COUNT_LOCATION_REQUIRED",
      "A warehouse location or bin is required before this count line can be saved.",
      400,
    );
  }

  const duplicate = await db
    .select()
    .from(stockCountLines)
    .where(and(eq(stockCountLines.organizationId, input.organizationId), eq(stockCountLines.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (duplicate[0]) return { line: duplicate[0], duplicate: true };

  const itemId = await resolveLineItemId(input.organizationId, parsed);
  const countSeq =
    (
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(stockCountLines)
        .where(and(eq(stockCountLines.organizationId, input.organizationId), eq(stockCountLines.sessionId, input.sessionId)))
    )[0]?.count ?? 0;

  const [line] = await db
    .insert(stockCountLines)
    .values({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      targetId: parsed.targetId ?? null,
      itemId,
      countSeq: countSeq + 1,
      countedQty: parsed.countedQty,
      scanValue: parsed.scanValue ?? null,
      locationId: parsed.locationId ?? null,
      binCode: parsed.binCode ?? null,
      countedBy: input.userId ? String(input.userId) : null,
      countUserId: input.userId,
      idempotencyKey: input.idempotencyKey,
      deviceClockAt: parsed.deviceClockAt ?? null,
      syncStatus: parsed.syncStatus ?? "synced",
    })
    .returning();

  await db
    .update(stockCountSessions)
    .set({ status: "in_progress", startedAt: session.startedAt ?? new Date(), updatedAt: new Date() })
    .where(and(eq(stockCountSessions.organizationId, input.organizationId), eq(stockCountSessions.id, input.sessionId)));

  return { line, duplicate: false };
}

export async function submitMobileCountSession(input: {
  organizationId: number;
  sessionId: number;
  idempotencyKey: string;
  deviceId?: string | null;
}) {
  const now = new Date();
  const thresholdPct = await getEffectiveCompanyConfigurationValue(input.organizationId, "inventory.variance.thresholdPct", 10);
  const thresholdValue = await getEffectiveCompanyConfigurationValue(input.organizationId, "inventory.variance.thresholdValue", 0);

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(stockCountSessions)
      .where(and(eq(stockCountSessions.organizationId, input.organizationId), eq(stockCountSessions.id, input.sessionId)))
      .limit(1);
    if (!session) throw new MobileCountDomainError("MOBILE_COUNT_NOT_FOUND", "Mobile count session not found.", 404);

    const targets = await tx
      .select()
      .from(stockCountTargets)
      .where(and(eq(stockCountTargets.organizationId, input.organizationId), eq(stockCountTargets.sessionId, input.sessionId)));
    const lines = await tx
      .select()
      .from(stockCountLines)
      .where(and(eq(stockCountLines.organizationId, input.organizationId), eq(stockCountLines.sessionId, input.sessionId)));
    if (lines.length === 0) throw new MobileCountDomainError("MOBILE_COUNT_EMPTY", "Add at least one count line before submitting.", 400);

    await tx.delete(stockCountVariances).where(and(eq(stockCountVariances.organizationId, input.organizationId), eq(stockCountVariances.sessionId, input.sessionId)));

    const varianceRows = targets.map((target) => {
      const counted = lines
        .filter((line) => line.targetId === target.id || (!line.targetId && line.itemId === target.itemId))
        .reduce((sum, line) => sum + Number(line.countedQty ?? 0), 0);
      const systemQty = Number(target.systemQtySnapshot ?? 0);
      const deltaQty = counted - systemQty;
      const variancePct = Math.abs(deltaQty) / Math.max(Math.abs(systemQty), 1) * 100;
      const deltaValue = 0;
      const requiresApproval =
        Math.abs(deltaQty) > 0 &&
        (variancePct >= thresholdPct || (thresholdValue > 0 && Math.abs(deltaValue) >= thresholdValue));
      return {
        organizationId: input.organizationId,
        sessionId: input.sessionId,
        targetId: target.id,
        itemId: target.itemId,
        deltaQty,
        deltaValue,
        requiresApproval,
        disposition: requiresApproval ? "pending" : "accepted",
        notes: `Variance policy: ${thresholdPct}% / value ${thresholdValue}`,
      };
    });
    const variances = varianceRows.length ? await tx.insert(stockCountVariances).values(varianceRows).returning() : [];

    const [updated] = await tx
      .update(stockCountSessions)
      .set({ status: "submitted", submittedAt: now, updatedAt: now })
      .where(and(eq(stockCountSessions.organizationId, input.organizationId), eq(stockCountSessions.id, input.sessionId)))
      .returning();

    await tx.insert(mobileSyncEvents).values({
      organizationId: input.organizationId,
      deviceId: String(input.deviceId ?? session.deviceId ?? "unknown-device"),
      eventType: "mobile_count_submit",
      body: { sessionId: input.sessionId },
      idempotencyKey: input.idempotencyKey,
      status: "applied",
      ackedAt: now,
      appliedAt: now,
    }).onConflictDoNothing();

    return { session: updated, variances };
  });
}

export async function createMobileRecountSession(input: {
  organizationId: number;
  sourceId: number;
  idempotencyKey: string;
  userId: number | null;
  deviceId?: string | null;
}) {
  const [source] = await db
    .select()
    .from(stockCountSessions)
    .where(and(eq(stockCountSessions.organizationId, input.organizationId), eq(stockCountSessions.id, input.sourceId)))
    .limit(1);
  if (!source) throw new MobileCountDomainError("MOBILE_COUNT_NOT_FOUND", "Mobile count session not found.", 404);

  const targets = await db
    .select()
    .from(stockCountTargets)
    .where(and(eq(stockCountTargets.organizationId, input.organizationId), eq(stockCountTargets.sessionId, input.sourceId)));

  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(stockCountSessions)
      .values({
        organizationId: input.organizationId,
        warehouseId: source.warehouseId,
        mode: "recount",
        status: "assigned",
        assignedUserId: input.userId,
        source: "mobile",
        deviceId: String(input.deviceId ?? source.deviceId ?? "unknown-device"),
        notes: `Recount for mobile count #${input.sourceId}`,
      })
      .returning();
    const newTargets = targets.length
      ? await tx
          .insert(stockCountTargets)
          .values(
            targets.map((target) => ({
              organizationId: input.organizationId,
              sessionId: session.id,
              warehouseId: target.warehouseId,
              itemId: target.itemId,
              locationId: target.locationId,
              lotId: target.lotId,
              serialId: target.serialId,
              systemQtySnapshot: target.systemQtySnapshot,
              blindMode: target.blindMode,
            })),
          )
          .returning()
      : [];
    await tx.insert(mobileSyncEvents).values({
      organizationId: input.organizationId,
      deviceId: session.deviceId ?? "unknown-device",
      eventType: "mobile_count_recount",
      body: { sourceId: input.sourceId, sessionId: session.id },
      idempotencyKey: input.idempotencyKey,
      status: "applied",
      ackedAt: new Date(),
      appliedAt: new Date(),
    }).onConflictDoNothing();
    return { session, targets: newTargets };
  });
}

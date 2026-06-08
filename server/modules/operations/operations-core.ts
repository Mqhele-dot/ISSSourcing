import { pool } from "../../db";
import { resetAndSeedDemoData } from "../../seed";
import { initializeOperationalData } from "./operational-ddl";
import { refsMatch, toNumber, toString } from "./operational-utils";
import {
  buildOperationalExceptionInvtrackContext,
  inferOperationalExceptionArea,
  mergeOperationalExceptionRelatedRefs,
  normalizeOperationalExceptionCode,
  OPERATIONAL_EXCEPTION_CONTEXT_KEY,
  parseInvtrackFromRelatedRefs,
} from "./operational-exception-context";
import { getActiveOrganizationId } from "../../organization-context";
import { normalizePurchaseOrderStatus, OPERATIONAL_PO_TRANSITIONS, type PurchaseOrderNorm } from "@shared/purchase-order-status";
import {
  normalizeShipmentDirection,
  normalizeShipmentFilters,
  normalizeShipmentSourceType,
} from "@shared/logistics-shipment-filters";

type InventoryFilterInput = {
  location?: string;
  q?: string;
  category?: string;
  low?: boolean;
};

type InventoryItemRecord = {
  id: number;
  sku: string;
  name: string;
  categoryId: number | null;
  quantity: number;
  lowStockThreshold: number | null;
  location: string | null;
  defaultLocation: string | null;
  updatedAt: Date | null;
};

type PositionAggregate = {
  sku: string;
  onHand: number;
  allocated: number;
  updatedAt: Date | null;
};

type InventoryPositionRecord = {
  location: string;
  onHand: number;
  allocated: number;
  available: number;
  updatedAt: Date | null;
};

type InventoryMovementRecord = {
  id: number;
  sku: string;
  location: string;
  delta: number;
  reason: string;
  ref: string | null;
  createdBy: string | null;
  createdAt: Date | null;
};

type InventorySummary = {
  onHand: number;
  allocated: number;
  available: number;
};

type AdjustInventoryInput = {
  skuOrId: string;
  location: string;
  delta: number;
  reason: string;
  ref?: string;
  createdBy?: string;
  skipLocationValidation?: boolean;
};

type ExceptionPayload = {
  type: string;
  severity: "low" | "medium" | "high";
  title: string;
  description?: string;
  relatedRefs: Record<string, string | number>;
  slaHours?: number;
};

type OperationalExceptionSqlRow = {
  id: number;
  type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  related_refs: Record<string, unknown>;
  assignee: string | null;
  sla_hours: number;
  comments: unknown;
  created_at: Date | null;
  updated_at: Date | null;
};

function mapOperationalExceptionSqlRow(row: OperationalExceptionSqlRow) {
  const relatedRefs = row.related_refs || {};
  const ctx = parseInvtrackFromRelatedRefs(relatedRefs);
  const createdAt = row.created_at;
  const cMs = createdAt ? new Date(createdAt).getTime() : NaN;
  const agedHours = !Number.isNaN(cMs) ? Math.max(0, (Date.now() - cMs) / 3600000) : 0;
  const slaHours = toNumber(row.sla_hours, 24);
  const slaDueMs = !Number.isNaN(cMs) ? cMs + slaHours * 3600000 : NaN;
  const st = String(row.status || "").toLowerCase();
  let slaStatus: "ok" | "due" | "breached" | "n/a" = "n/a";
  if (!Number.isNaN(slaDueMs)) {
    if (st === "open" || st === "in_progress") {
      if (Date.now() > slaDueMs) slaStatus = "breached";
      else if (Date.now() > slaDueMs - 3600000) slaStatus = "due";
      else slaStatus = "ok";
    } else {
      slaStatus = "ok";
    }
  }
  const exceptionCode =
    typeof ctx.exceptionCode === "string"
      ? ctx.exceptionCode
      : normalizeOperationalExceptionCode(row.type);
  const area = typeof ctx.area === "string" ? ctx.area : inferOperationalExceptionArea(row.type);
  const relatedSummaryParts: string[] = [];
  if (typeof ctx.poNumber === "string" && ctx.poNumber) relatedSummaryParts.push(`PO ${ctx.poNumber}`);
  if (typeof ctx.shipmentId === "number") relatedSummaryParts.push(`Shipment ${ctx.shipmentId}`);
  if (typeof ctx.itemSku === "string" && ctx.itemSku) relatedSummaryParts.push(`SKU ${ctx.itemSku}`);

  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    relatedRefs,
    assignee: row.assignee,
    slaHours,
    comments: Array.isArray(row.comments) ? (row.comments as Array<Record<string, unknown>>) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    exceptionCode,
    area,
    agedHours: Math.round(agedHours * 10) / 10,
    slaStatus,
    relatedSummary: relatedSummaryParts.length > 0 ? relatedSummaryParts.join(" · ") : null,
  };
}

type ActivityInput = {
  actor?: string;
  entityType: string;
  entityId: string | number;
  action: string;
  summary: Record<string, unknown>;
};

type ActivityListFilters = {
  limit?: number;
  entityType?: string;
  entityId?: string;
  /** Case-insensitive substring match on action */
  action?: string;
};

async function logActivity(
  eventType: string,
  title: string,
  details: string,
  relatedRefs: Record<string, string | number>,
) {
  await pool.query(
    `
    INSERT INTO ops_activity_feed (event_type, title, details, related_refs)
    VALUES ($1, $2, $3, $4::jsonb)
    `,
    [eventType, title, details, JSON.stringify(relatedRefs)],
  );

  const entityType =
    typeof relatedRefs.exception_id === "number"
      ? "exception"
      : typeof relatedRefs.po_number === "string"
        ? "purchase_order"
        : typeof relatedRefs.shipment_id === "number"
          ? "shipment"
          : typeof relatedRefs.sku === "string"
            ? "inventory"
            : "system";
  const entityId =
    relatedRefs.exception_id ??
    relatedRefs.po_number ??
    relatedRefs.shipment_id ??
    relatedRefs.sku ??
    "global";

  await recordActivity({
    actor: "system",
    entityType,
    entityId: String(entityId),
    action: eventType,
    summary: {
      title,
      details,
      relatedRefs,
    },
  });
}

export async function recordActivity(input: ActivityInput) {
  await pool.query(
    `
    INSERT INTO ops_activity (actor, entity_type, entity_id, action, summary_json)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      input.actor?.trim() || "system",
      input.entityType,
      String(input.entityId),
      input.action,
      JSON.stringify(input.summary ?? {}),
    ],
  );
}

export async function createOrGetOperationalException(payload: ExceptionPayload) {
  const mergedRefs = mergeOperationalExceptionRelatedRefs(payload.relatedRefs, payload.type);
  const inv = parseInvtrackFromRelatedRefs(mergedRefs);
  const exceptionCode =
    typeof inv.exceptionCode === "string" && inv.exceptionCode
      ? inv.exceptionCode
      : normalizeOperationalExceptionCode(payload.type);
  const rootEntityType = inv.rootEntityType != null ? String(inv.rootEntityType) : "";
  const rootEntityId = inv.rootEntityId != null ? String(inv.rootEntityId) : "";

  if (exceptionCode && rootEntityType && rootEntityId) {
    const dup = await pool.query<{ id: number; related_refs: Record<string, unknown> }>(
      `
      SELECT id, related_refs
      FROM operational_exceptions
      WHERE status IN ('open', 'in_progress')
        AND related_refs->'_invtrack'->>'exceptionCode' = $1
        AND related_refs->'_invtrack'->>'rootEntityType' = $2
        AND related_refs->'_invtrack'->>'rootEntityId' = $3
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [exceptionCode, rootEntityType, rootEntityId],
    );
    const hit = dup.rows[0];
    if (hit) {
      const freshInv = buildOperationalExceptionInvtrackContext(payload.type, payload.relatedRefs);
      const prior = (hit.related_refs || {}) as Record<string, unknown>;
      const priorInv = parseInvtrackFromRelatedRefs(prior);
      const nextInv = { ...priorInv, ...freshInv, detectedAt: new Date().toISOString() };
      const nextRefs: Record<string, unknown> = {
        ...prior,
        ...payload.relatedRefs,
        [OPERATIONAL_EXCEPTION_CONTEXT_KEY]: nextInv,
      };
      await pool.query(
        `
        UPDATE operational_exceptions
        SET related_refs = $2::jsonb,
            title = COALESCE(NULLIF($3, ''), title),
            description = COALESCE(NULLIF($4, ''), description),
            updated_at = now()
        WHERE id = $1
        `,
        [hit.id, JSON.stringify(nextRefs), payload.title, payload.description ?? ""],
      );
      return { id: hit.id, created: false, updated: true, skippedDuplicate: true };
    }
  }

  const existingResult = await pool.query<{
    id: number;
    related_refs: Record<string, unknown>;
    status: string;
  }>(
    `
    SELECT id, related_refs, status
    FROM operational_exceptions
    WHERE type = $1
      AND status IN ('open', 'in_progress')
    ORDER BY created_at DESC
    `,
    [payload.type],
  );

  const existing = existingResult.rows.find((row) =>
    refsMatch(row.related_refs || {}, payload.relatedRefs),
  );

  if (existing) {
    return { id: existing.id, created: false, updated: false, skippedDuplicate: false };
  }

  const insertResult = await pool.query<{ id: number }>(
    `
    INSERT INTO operational_exceptions (
      type, severity, status, title, description, related_refs, sla_hours, comments
    )
    VALUES (
      $1, $2, 'open', $3, $4, $5::jsonb, $6, '[]'::jsonb
    )
    RETURNING id
    `,
    [
      payload.type,
      payload.severity,
      payload.title,
      payload.description ?? "",
      JSON.stringify(mergedRefs),
      payload.slaHours ?? 24,
    ],
  );

  await logActivity(
    "exception_created",
    payload.title,
    payload.description ?? "",
    payload.relatedRefs,
  );

  return { id: insertResult.rows[0].id, created: true, updated: false, skippedDuplicate: false };
}

export { initializeOperationalData };

export async function listOperationalInventory(filters: InventoryFilterInput) {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];
  const orgId = getActiveOrganizationId();
  params.push(orgId);
  if (orgId === 1) {
    // Backward compatibility for legacy seed rows created before org_id backfill.
    whereClauses.push(`(i.organization_id = $${params.length} OR i.organization_id IS NULL)`);
  } else {
    whereClauses.push(`i.organization_id = $${params.length}`);
  }

  if (filters.q && filters.q.trim().length > 0) {
    params.push(`%${filters.q.trim().toLowerCase()}%`);
    whereClauses.push(`(lower(i.name) LIKE $${params.length} OR lower(i.sku) LIKE $${params.length})`);
  }

  const categoryFilter = filters.category?.trim();
  if (categoryFilter) {
    const parsedCategory = Number(categoryFilter);
    if (Number.isFinite(parsedCategory)) {
      params.push(parsedCategory);
      whereClauses.push(`i.category_id = $${params.length}`);
    }
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const itemsResult = await pool.query<{
    id: number;
    sku: string;
    name: string;
    price: string | number | null;
    category_id: number | null;
    quantity: number | null;
    low_stock_threshold: number | null;
    location: string | null;
    default_location: string | null;
    updated_at: Date | null;
    expiry_date: Date | null;
    manufacturing_date: Date | null;
  }>(
    `
    SELECT
      i.id,
      i.sku,
      i.name,
      i.price,
      i.category_id,
      i.quantity,
      i.low_stock_threshold,
      i.location,
      i.default_location,
      i.updated_at,
      i.expiry_date,
      i.manufacturing_date
    FROM inventory_items i
    ${whereSql}
    ORDER BY i.name ASC
    `,
    params,
  );

  const skus = itemsResult.rows.map((row) => row.sku);
  const positionBySku = new Map<string, PositionAggregate>();

  if (skus.length > 0) {
    const positionParams: Array<string | string[]> = [skus];
    let locationSql = "";

    if (filters.location && filters.location.trim().length > 0) {
      positionParams.push(filters.location.trim());
      locationSql = `AND p.location = $2`;
    }

    const positionsResult = await pool.query<{
      sku: string;
      on_hand: number;
      allocated: number;
      updated_at: Date | null;
    }>(
      `
      SELECT
        p.sku,
        COALESCE(SUM(p.on_hand), 0)::int AS on_hand,
        COALESCE(SUM(p.allocated), 0)::int AS allocated,
        MAX(p.updated_at) AS updated_at
      FROM inventory_positions p
      WHERE p.sku = ANY($1)
      ${locationSql}
      GROUP BY p.sku
      `,
      positionParams,
    );

    for (const row of positionsResult.rows) {
      positionBySku.set(row.sku, {
        sku: row.sku,
        onHand: toNumber(row.on_hand),
        allocated: toNumber(row.allocated),
        updatedAt: row.updated_at,
      });
    }
  }

  const normalizedLocationFilter = filters.location?.trim().toLowerCase();
  const includeLowOnly = Boolean(filters.low);

  return itemsResult.rows
    .map((row) => {
      const aggregate = positionBySku.get(row.sku);
      const fallbackOnHand = toNumber(row.quantity, 0);
      const onHand = aggregate ? aggregate.onHand : fallbackOnHand;
      const allocated = aggregate ? aggregate.allocated : 0;
      const available = onHand - allocated;
      const lowStockThreshold = toNumber(row.low_stock_threshold, 0);
      const location = toString(row.default_location) ?? toString(row.location);

      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        price: toNumber(row.price, 0),
        categoryId: row.category_id,
        quantity: fallbackOnHand,
        lowStockThreshold,
        location,
        onHand,
        allocated,
        available,
        updatedAt: aggregate?.updatedAt ?? row.updated_at,
        expiryDate: row.expiry_date,
        manufacturingDate: row.manufacturing_date,
      };
    })
    .filter((item) => {
      if (
        normalizedLocationFilter &&
        (item.location ?? "").toLowerCase() !== normalizedLocationFilter
      ) {
        return false;
      }

      if (includeLowOnly && item.available > item.lowStockThreshold) {
        return false;
      }

      return true;
    });
}

async function findInventoryItemByIdentifier(identifier: string): Promise<InventoryItemRecord | null> {
  const orgId = getActiveOrganizationId();
  const orgClause = orgId === 1 ? "(organization_id = $2 OR organization_id IS NULL)" : "organization_id = $2";
  const numericId = Number(identifier);
  const byIdResult = Number.isFinite(numericId)
    ? await pool.query<{
        id: number;
        sku: string;
        name: string;
        category_id: number | null;
        quantity: number | null;
        low_stock_threshold: number | null;
        location: string | null;
        default_location: string | null;
        updated_at: Date | null;
      }>(
        `
        SELECT id, sku, name, category_id, quantity, low_stock_threshold, location, default_location, updated_at
        FROM inventory_items
        WHERE id = $1
          AND ${orgClause}
        LIMIT 1
        `,
        [numericId, orgId],
      )
    : { rows: [] };

  if (byIdResult.rows.length > 0) {
    const row = byIdResult.rows[0];
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      categoryId: row.category_id,
      quantity: toNumber(row.quantity, 0),
      lowStockThreshold: row.low_stock_threshold,
      location: row.location,
      defaultLocation: row.default_location,
      updatedAt: row.updated_at,
    };
  }

  const bySkuResult = await pool.query<{
    id: number;
    sku: string;
    name: string;
    category_id: number | null;
    quantity: number | null;
    low_stock_threshold: number | null;
    location: string | null;
    default_location: string | null;
    updated_at: Date | null;
  }>(
    `
    SELECT id, sku, name, category_id, quantity, low_stock_threshold, location, default_location, updated_at
    FROM inventory_items
    WHERE sku = $1
      AND ${orgClause}
    LIMIT 1
    `,
    [identifier, orgId],
  );

  if (bySkuResult.rows.length === 0) {
    return null;
  }

  const row = bySkuResult.rows[0];
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.category_id,
    quantity: toNumber(row.quantity, 0),
    lowStockThreshold: row.low_stock_threshold,
    location: row.location,
    defaultLocation: row.default_location,
    updatedAt: row.updated_at,
  };
}

async function getInventoryPositionsForSku(sku: string): Promise<InventoryPositionRecord[]> {
  const result = await pool.query<{
    location: string;
    on_hand: number;
    allocated: number;
    updated_at: Date | null;
  }>(
    `
    SELECT location, on_hand, allocated, updated_at
    FROM inventory_positions
    WHERE sku = $1
    ORDER BY location ASC
    `,
    [sku],
  );

  return result.rows.map((row) => ({
    location: row.location,
    onHand: toNumber(row.on_hand),
    allocated: toNumber(row.allocated),
    available: toNumber(row.on_hand) - toNumber(row.allocated),
    updatedAt: row.updated_at,
  }));
}

async function getInventoryMovementsForSku(sku: string): Promise<InventoryMovementRecord[]> {
  const result = await pool.query<{
    id: number;
    sku: string;
    location: string;
    delta: number;
    reason: string;
    ref: string | null;
    created_by: string | null;
    created_at: Date | null;
  }>(
    `
    SELECT id, sku, location, delta, reason, ref, created_by, created_at
    FROM inventory_movements
    WHERE sku = $1
    ORDER BY created_at DESC
    LIMIT 50
    `,
    [sku],
  );

  return result.rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    location: row.location,
    delta: toNumber(row.delta),
    reason: row.reason,
    ref: row.ref,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

function summarizePositions(positions: InventoryPositionRecord[]): InventorySummary {
  return positions.reduce<InventorySummary>(
    (acc, position) => ({
      onHand: acc.onHand + position.onHand,
      allocated: acc.allocated + position.allocated,
      available: acc.available + position.available,
    }),
    { onHand: 0, allocated: 0, available: 0 },
  );
}

export async function getOperationalInventoryDetail(skuOrId: string) {
  const item = await findInventoryItemByIdentifier(skuOrId);
  if (!item) {
    return null;
  }

  let positions = await getInventoryPositionsForSku(item.sku);
  if (positions.length === 0) {
    const fallbackLocation = item.defaultLocation || item.location || "Main Warehouse";
    positions = [
      {
        location: fallbackLocation,
        onHand: item.quantity,
        allocated: 0,
        available: item.quantity,
        updatedAt: item.updatedAt,
      },
    ];
  }

  const movements = await getInventoryMovementsForSku(item.sku);
  const summary = summarizePositions(positions);

  return {
    ...item,
    location: item.defaultLocation || item.location,
    onHand: summary.onHand,
    allocated: summary.allocated,
    available: summary.available,
    positions,
    movements,
    summary,
  };
}

export async function adjustOperationalInventory(input: AdjustInventoryInput) {
  if (!Number.isFinite(input.delta) || input.delta === 0) {
    throw new Error("delta_must_be_non_zero");
  }

  const normalizedLocation = input.location.trim();
  if (!normalizedLocation) {
    throw new Error("location_required");
  }

  const item = await findInventoryItemByIdentifier(input.skuOrId);
  if (!item) {
    throw new Error("sku_not_found");
  }

  if (!input.skipLocationValidation) {
    const locationValidation = await pool.query(
      `
      SELECT 1
      FROM warehouses
      WHERE lower(name) = lower($1)
      LIMIT 1
      `,
      [normalizedLocation],
    );

    const existingPositionValidation = await pool.query(
      `
      SELECT 1
      FROM inventory_positions
      WHERE sku = $1
        AND lower(location) = lower($2)
      LIMIT 1
      `,
      [item.sku, normalizedLocation],
    );

    const matchesItemDefault =
      (item.defaultLocation ?? item.location ?? "").toLowerCase() ===
      normalizedLocation.toLowerCase();

    if (
      locationValidation.rows.length === 0 &&
      existingPositionValidation.rows.length === 0 &&
      !matchesItemDefault
    ) {
      throw new Error("location_not_found");
    }
  }

  await pool.query(
    `
    INSERT INTO inventory_positions (sku, location, on_hand, allocated, updated_at)
    VALUES ($1, $2, 0, 0, now())
    ON CONFLICT (sku, location) DO NOTHING
    `,
    [item.sku, normalizedLocation],
  );

  const updatedPositionResult = await pool.query<{
    location: string;
    on_hand: number;
    allocated: number;
    updated_at: Date | null;
  }>(
    `
    UPDATE inventory_positions
    SET on_hand = on_hand + $3,
        updated_at = now()
    WHERE sku = $1
      AND location = $2
    RETURNING location, on_hand, allocated, updated_at
    `,
    [item.sku, normalizedLocation, input.delta],
  );

  const updatedPositionRow = updatedPositionResult.rows[0];
  const position = {
    location: updatedPositionRow.location,
    onHand: toNumber(updatedPositionRow.on_hand),
    allocated: toNumber(updatedPositionRow.allocated),
    available: toNumber(updatedPositionRow.on_hand) - toNumber(updatedPositionRow.allocated),
    updatedAt: updatedPositionRow.updated_at,
  };

  const movementResult = await pool.query<{ id: number; created_at: Date | null }>(
    `
    INSERT INTO inventory_movements (sku, location, delta, reason, ref, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, created_at
    `,
    [
      item.sku,
      normalizedLocation,
      input.delta,
      input.reason,
      input.ref ?? null,
      input.createdBy ?? "system",
    ],
  );

  const allPositions = await getInventoryPositionsForSku(item.sku);
  const summary = summarizePositions(allPositions);

  await pool.query(
    `
    UPDATE inventory_items
    SET quantity = $2,
        default_location = COALESCE(default_location, $3),
        updated_at = now()
    WHERE id = $1
    `,
    [item.id, summary.onHand, normalizedLocation],
  );

  let shortageException = null as null | { id: number; created: boolean };
  if (summary.available < 0) {
    shortageException = await createOrGetOperationalException({
      type: "inventory_shortage",
      severity: "high",
      title: `Inventory shortage detected for ${item.sku}`,
      description: `Available stock is ${summary.available} after adjustment`,
      relatedRefs: {
        sku: item.sku,
        location: normalizedLocation,
      },
      slaHours: 4,
    });
  }

  await recordActivity({
    actor: input.createdBy ?? "system",
    entityType: "inventory",
    entityId: item.sku,
    action: "adjust",
    summary: {
      sku: item.sku,
      delta: input.delta,
      location: normalizedLocation,
      reason: input.reason,
      ref: input.ref ?? null,
      available: summary.available,
      onHand: summary.onHand,
      shortageExceptionId: shortageException?.id ?? null,
    },
  });

  return {
    sku: item.sku,
    movement: {
      id: movementResult.rows[0].id,
      delta: input.delta,
      reason: input.reason,
      ref: input.ref ?? null,
      createdAt: movementResult.rows[0].created_at,
    },
    position,
    summary,
    exception: shortageException,
  };
}

type PurchaseOrderListItem = {
  id: number;
  poNumber: string;
  supplierId: number;
  supplierName: string | null;
  status: string;
  requestedDate: Date | null;
  createdAt: Date | null;
  totalAmount: number;
  linesCount: number;
  qtyOrdered: number;
  qtyReceived: number;
  receivedProgress: number;
};

type PurchaseOrderLine = {
  id: number;
  itemId: number;
  sku: string;
  itemName: string;
  supplierPartNumber: string | null;
  commodityCode: string | null;
  commodityDescription: string | null;
  qtyOrdered: number;
  qtyReceived: number;
  unitPrice: number;
  expectedRemaining: number;
};

type PurchaseOrderShipment = {
  id: number;
  carrier: string | null;
  status: string;
  eta: Date | null;
  driftMinutes: number;
  updatedAt: Date | null;
  trackingNumber?: string | null;
  carrierId?: number | null;
  transportMode?: string | null;
  freightCost?: number | null;
  deliveryNoteRef?: string | null;
  grnNumber?: string | null;
};

type ReceivePurchaseLineInput = {
  sku: string;
  qty_received_now: number;
  batch_number?: string;
  serial_numbers?: string[];
};

type ReceivePurchaseMetaInput = {
  receiver_user_id?: number | null;
  receiver_name?: string | null;
  warehouse_location?: string | null;
  warehouse_id?: number | null;
  aisle?: string | null;
  bin_code?: string | null;
  received_at?: Date | null;
  shipment_id?: number | null;
  grn_number?: string | null;
};

const PURCHASE_TRANSITIONS: Record<string, string[]> = Object.fromEntries(
  (Object.entries(OPERATIONAL_PO_TRANSITIONS) as [PurchaseOrderNorm, PurchaseOrderNorm[]][]).map(([from, targets]) => [
    from,
    targets.map((t) => String(t)),
  ]),
);

function normalizePurchaseStatus(rawStatus: string | null | undefined): string {
  return normalizePurchaseOrderStatus(rawStatus);
}

async function resolvePurchaseOrder(poOrId: string) {
  const numericId = Number(poOrId);
  const byIdResult = Number.isFinite(numericId)
    ? await pool.query<{
        id: number;
        order_number: string;
        supplier_id: number;
        status: string;
        order_date: Date | null;
        created_at: Date | null;
        total_amount: number | null;
      }>(
        `
        SELECT id, order_number, supplier_id, status, order_date, created_at, total_amount
        FROM purchase_orders
        WHERE id = $1
        LIMIT 1
        `,
        [numericId],
      )
    : { rows: [] };

  if (byIdResult.rows.length > 0) {
    return byIdResult.rows[0];
  }

  const byNumberResult = await pool.query<{
    id: number;
    order_number: string;
    supplier_id: number;
    status: string;
    order_date: Date | null;
    created_at: Date | null;
    total_amount: number | null;
  }>(
    `
    SELECT id, order_number, supplier_id, status, order_date, created_at, total_amount
    FROM purchase_orders
    WHERE order_number = $1
    LIMIT 1
    `,
    [poOrId],
  );

  return byNumberResult.rows[0] ?? null;
}

async function resolvePurchaseOrderForOrganization(
  poNumberRaw: string,
  organizationId: number,
): Promise<{ id: number; order_number: string } | null> {
  const poNumber = poNumberRaw.trim();
  if (!poNumber) return null;
  const r = await pool.query<{ id: number; order_number: string }>(
    `
    SELECT id, order_number
    FROM purchase_orders
    WHERE organization_id = $2 AND (order_number = $1 OR id::text = $1)
    LIMIT 1
    `,
    [poNumber, organizationId],
  );
  return r.rows[0] ?? null;
}

async function resolveSupplierDefaultsForPo(
  purchaseOrderId: number,
  organizationId: number,
): Promise<{ carrierId: number | null; transportMode: string | null }> {
  const r = await pool.query<{ default_carrier_id: number | null; default_transport_mode: string | null }>(
    `
    SELECT s.default_carrier_id, s.default_transport_mode
    FROM purchase_orders po
    JOIN suppliers s
      ON s.id = po.supplier_id
     AND s.organization_id = po.organization_id
    WHERE po.id = $1
      AND po.organization_id = $2
    LIMIT 1
    `,
    [purchaseOrderId, organizationId],
  );
  return {
    carrierId: r.rows[0]?.default_carrier_id ?? null,
    transportMode: r.rows[0]?.default_transport_mode ?? null,
  };
}

async function resolveCarrierSnapshotForOrg(params: {
  organizationId: number;
  carrierId: number | null;
  carrierTextFallback: string | null;
}): Promise<{ carrierId: number | null; carrierSnapshot: string }> {
  if (params.carrierId != null && Number.isFinite(params.carrierId) && params.carrierId > 0) {
    const r = await pool.query<{ name: string; active: boolean | null }>(
      `SELECT name, active FROM carriers WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [params.carrierId, params.organizationId],
    );
    const row = r.rows[0];
    if (!row) throw new Error("carrier_not_found");
    if (row.active === false) throw new Error("carrier_inactive");
    return { carrierId: params.carrierId, carrierSnapshot: row.name };
  }
  const snap =
    params.carrierTextFallback && params.carrierTextFallback.trim()
      ? params.carrierTextFallback.trim()
      : "Carrier TBD";
  return { carrierId: null, carrierSnapshot: snap };
}

export type OperationalShipmentCreateMode = "logistics_page" | "po_send";

export type OperationalShipmentCreateRow = {
  id: number;
  poNumber: string;
  carrier: string | null;
  status: string;
  eta: Date | null;
  driftMinutes: number;
  trackingNumber: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  atRisk: boolean;
  riskBucket: "late" | "no_eta" | "due_soon" | "exception" | "on_time";
  direction: string;
  sourceType: string;
  freightCost: number | null;
};

export async function createOperationalShipment(input: {
  poNumber: string;
  mode: OperationalShipmentCreateMode;
  carrier?: string | null;
  carrierId?: number | null;
  transportMode?: string | null;
  freightCost?: number | null;
  trackingNumber?: string | null;
  deliveryNoteRef?: string | null;
  vehicle?: string | null;
  driver?: string | null;
  eta?: Date | null;
  purchaseOrder?: { id: number; order_number: string } | null;
  direction?: string | null;
  sourceType?: string | null;
  sourceId?: number | null;
  sourceRef?: string | null;
}): Promise<OperationalShipmentCreateRow> {
  const orgId = getActiveOrganizationId();
  const order =
    input.purchaseOrder != null
      ? input.purchaseOrder
      : await resolvePurchaseOrderForOrganization(input.poNumber, orgId);
  if (!order) {
    throw new Error("po_not_found_for_shipment");
  }

  const requestedCarrierId =
    input.carrierId != null && Number.isFinite(Number(input.carrierId)) ? Number(input.carrierId) : null;
  const carrierText = typeof input.carrier === "string" && input.carrier.trim() ? input.carrier.trim() : null;
  const supplierDefaults =
    requestedCarrierId == null && carrierText == null
      ? await resolveSupplierDefaultsForPo(order.id, orgId)
      : null;
  const { carrierId: cid, carrierSnapshot } = await resolveCarrierSnapshotForOrg({
    organizationId: orgId,
    carrierId: requestedCarrierId ?? supplierDefaults?.carrierId ?? null,
    carrierTextFallback: carrierText,
  });

  const transportMode =
    typeof input.transportMode === "string" && input.transportMode.trim()
      ? input.transportMode.trim()
      : supplierDefaults?.transportMode ?? null;
  const freightCost =
    input.freightCost != null && Number.isFinite(Number(input.freightCost)) ? Number(input.freightCost) : null;
  if (freightCost != null && freightCost < 0) {
    throw new Error("shipment_freight_cost_invalid");
  }
  const trackingNumber =
    typeof input.trackingNumber === "string" && input.trackingNumber.trim()
      ? input.trackingNumber.trim()
      : null;
  const deliveryNoteRef =
    typeof input.deliveryNoteRef === "string" && input.deliveryNoteRef.trim()
      ? input.deliveryNoteRef.trim()
      : null;
  const vehicle = typeof input.vehicle === "string" && input.vehicle.trim() ? input.vehicle.trim() : null;
  const driver = typeof input.driver === "string" && input.driver.trim() ? input.driver.trim() : null;

  const rawDirection = typeof input.direction === "string" ? input.direction : "";
  const normalizedDirection = normalizeShipmentDirection(rawDirection);
  if (rawDirection.trim() && !normalizedDirection) {
    throw new Error("shipment_direction_invalid");
  }
  const direction = normalizedDirection || "inbound";
  const rawSourceType = typeof input.sourceType === "string" ? input.sourceType : "";
  const normalizedSourceType = normalizeShipmentSourceType(rawSourceType);
  if (rawSourceType.trim() && !normalizedSourceType) {
    throw new Error("shipment_source_type_invalid");
  }
  const sourceType = normalizedSourceType || "purchase_order";
  const sourceIdRaw = input.sourceId != null ? input.sourceId : order.id;
  const sourceRef =
    typeof input.sourceRef === "string" && input.sourceRef.trim()
      ? input.sourceRef.trim()
      : order.order_number;

  const initialStatus = input.mode === "po_send" ? "in_transit" : "created";
  const eta =
    input.mode === "po_send" ? (input.eta ?? new Date(Date.now() + 3 * 86400000)) : input.eta ?? null;

  const ins = await pool.query<{
    id: number;
    po_number: string;
    carrier: string | null;
    status: string;
    eta: Date | null;
    drift_minutes: number;
    tracking_number: string | null;
    created_at: Date | null;
    updated_at: Date | null;
  }>(
    `
    INSERT INTO shipments (
      po_number,
      purchase_order_id,
      carrier,
      carrier_id,
      transport_mode,
      freight_cost,
      vehicle,
      driver,
      delivery_note_ref,
      tracking_number,
      status,
      eta,
      direction,
      source_type,
      source_id,
      source_ref,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now())
    RETURNING id, po_number, carrier, status, eta, drift_minutes, tracking_number, created_at, updated_at
    `,
    [
      order.order_number,
      order.id,
      carrierSnapshot,
      cid,
      transportMode,
      freightCost,
      vehicle,
      driver,
      deliveryNoteRef || null,
      trackingNumber || null,
      initialStatus,
      eta,
      direction,
      sourceType,
      sourceIdRaw,
      sourceRef,
    ],
  );

  const row = ins.rows[0];
  if (!row) {
    throw new Error("shipment_insert_failed");
  }

  const eventNote =
    input.mode === "po_send"
      ? `Created when PO ${order.order_number} was sent`
      : `Inbound shipment created from logistics (${carrierSnapshot})`;

  await pool.query(`INSERT INTO shipment_events (shipment_id, status, note) VALUES ($1, $2, $3)`, [
    row.id,
    initialStatus,
    eventNote,
  ]);

  const statusLower = row.status.toLowerCase();
  const atRisk = Boolean(row.eta && row.eta.getTime() < Date.now() && statusLower !== "delivered");
  const riskBucket = computeOperationalShipmentRiskBucket({ status: statusLower, eta: row.eta });

  return {
    id: row.id,
    poNumber: row.po_number,
    carrier: row.carrier,
    status: statusLower,
    eta: row.eta,
    driftMinutes: toNumber(row.drift_minutes, 0),
    trackingNumber: row.tracking_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    atRisk,
    riskBucket,
    direction,
    sourceType,
    freightCost,
  };
}

async function getPurchaseOrderLines(orderId: number): Promise<PurchaseOrderLine[]> {
  const lineResult = await pool.query<{
    id: number;
    item_id: number;
    quantity: number;
    received_quantity: number | null;
    unit_price: number;
    sku: string | null;
    item_name: string | null;
    supplier_part_number: string | null;
    commodity_code: string | null;
    commodity_description: string | null;
  }>(
    `
    SELECT
      pol.id,
      pol.item_id,
      pol.quantity,
      pol.received_quantity,
      pol.unit_price,
      i.sku,
      i.name AS item_name,
      i.supplier_part_number,
      cc.code AS commodity_code,
      cc.description AS commodity_description
    FROM purchase_order_items pol
    LEFT JOIN inventory_items i ON i.id = pol.item_id
    LEFT JOIN commodity_codes cc ON cc.id = i.commodity_code_id
    WHERE pol.order_id = $1
    ORDER BY pol.id ASC
    `,
    [orderId],
  );

  return lineResult.rows.map((line) => {
    const qtyOrdered = toNumber(line.quantity, 0);
    const qtyReceived = toNumber(line.received_quantity, 0);
    return {
      id: line.id,
      itemId: line.item_id,
      sku: line.sku ?? `ITEM-${line.item_id}`,
      itemName: line.item_name ?? `Item #${line.item_id}`,
      supplierPartNumber: line.supplier_part_number ?? null,
      commodityCode: line.commodity_code ?? null,
      commodityDescription: line.commodity_description ?? null,
      qtyOrdered,
      qtyReceived,
      unitPrice: toNumber(line.unit_price, 0),
      expectedRemaining: Math.max(qtyOrdered - qtyReceived, 0),
    };
  });
}

/**
 * Replace reserved allocations for this PO so receive can consume them FIFO.
 * Called when a PO moves to approved (expected inbound commitment / planning bucket).
 */
async function syncPurchaseOrderAllocations(orderId: number): Promise<void> {
  await pool.query(`DELETE FROM inventory_allocations WHERE order_id = $1 AND status = 'reserved'`, [orderId]);
  const lines = await getPurchaseOrderLines(orderId);
  for (const line of lines) {
    const remaining = Math.max(0, line.qtyOrdered - line.qtyReceived);
    if (remaining <= 0) continue;
    const whRes = await pool.query<{ default_warehouse_id: number | null }>(
      `SELECT default_warehouse_id FROM inventory_items WHERE id = $1 LIMIT 1`,
      [line.itemId],
    );
    const warehouseId = whRes.rows[0]?.default_warehouse_id ?? null;
    await pool.query(
      `
      INSERT INTO inventory_allocations (item_id, warehouse_id, quantity, order_id, status, updated_at)
      VALUES ($1, $2, $3, $4, 'reserved', now())
      `,
      [line.itemId, warehouseId, remaining, orderId],
    );
  }
}

async function getPurchaseOrderShipments(poNumber: string): Promise<PurchaseOrderShipment[]> {
  const shipmentResult = await pool.query<{
    id: number;
    carrier: string | null;
    status: string;
    eta: Date | null;
    drift_minutes: number;
    updated_at: Date | null;
    tracking_number: string | null;
    carrier_id: number | null;
    transport_mode: string | null;
    freight_cost: number | null;
    delivery_note_ref: string | null;
    grn_number: string | null;
    direction: string | null;
    source_type: string | null;
  }>(
    `
    SELECT id, carrier, status, eta, drift_minutes, updated_at, tracking_number,
           carrier_id, transport_mode, freight_cost, delivery_note_ref, grn_number,
           direction, source_type
    FROM shipments
    WHERE po_number = $1
    ORDER BY updated_at DESC
    `,
    [poNumber],
  );

  return shipmentResult.rows.map((shipment) => ({
    id: shipment.id,
    carrier: shipment.carrier,
    status: shipment.status,
    eta: shipment.eta,
    driftMinutes: toNumber(shipment.drift_minutes, 0),
    updatedAt: shipment.updated_at,
    trackingNumber: shipment.tracking_number,
    carrierId: shipment.carrier_id,
    transportMode: shipment.transport_mode,
    freightCost: shipment.freight_cost,
    deliveryNoteRef: shipment.delivery_note_ref,
    grnNumber: shipment.grn_number,
    direction: (shipment.direction && String(shipment.direction).trim()) || "inbound",
    sourceType: (shipment.source_type && String(shipment.source_type).trim()) || "purchase_order",
  }));
}

export async function listOperationalPurchaseOrders(filters: {
  status?: string;
  supplier?: string;
  q?: string;
}): Promise<PurchaseOrderListItem[]> {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.supplier && filters.supplier.trim()) {
    const supplier = filters.supplier.trim();
    const parsedSupplierId = Number(supplier);
    if (Number.isFinite(parsedSupplierId)) {
      params.push(parsedSupplierId);
      whereClauses.push(`po.supplier_id = $${params.length}`);
    } else {
      params.push(`%${supplier.toLowerCase()}%`);
      whereClauses.push(`lower(s.name) LIKE $${params.length}`);
    }
  }

  if (filters.q && filters.q.trim()) {
    params.push(`%${filters.q.trim().toLowerCase()}%`);
    whereClauses.push(
      `(lower(po.order_number) LIKE $${params.length} OR lower(COALESCE(s.name, '')) LIKE $${params.length})`,
    );
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const result = await pool.query<{
    id: number;
    order_number: string;
    supplier_id: number;
    supplier_name: string | null;
    status: string;
    order_date: Date | null;
    created_at: Date | null;
    total_amount: number | null;
    lines_count: number;
    qty_ordered_total: number;
    qty_received_total: number;
  }>(
    `
    SELECT
      po.id,
      po.order_number,
      po.supplier_id,
      s.name AS supplier_name,
      po.status,
      po.order_date,
      po.created_at,
      po.total_amount,
      COUNT(pol.id)::int AS lines_count,
      COALESCE(SUM(pol.quantity), 0)::int AS qty_ordered_total,
      COALESCE(SUM(pol.received_quantity), 0)::int AS qty_received_total
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN purchase_order_items pol ON pol.order_id = po.id
    ${whereSql}
    GROUP BY po.id, s.name
    ORDER BY po.created_at DESC
    `,
    params,
  );

  const statusFilter = filters.status?.trim()
    ? normalizePurchaseStatus(filters.status)
    : "";

  return result.rows
    .map((row) => {
      const qtyOrdered = toNumber(row.qty_ordered_total, 0);
      const qtyReceived = toNumber(row.qty_received_total, 0);
      const receivedProgress =
        qtyOrdered > 0 ? Math.round((qtyReceived / qtyOrdered) * 100) : 0;

      return {
        id: row.id,
        poNumber: row.order_number,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        status: normalizePurchaseStatus(row.status),
        requestedDate: row.order_date,
        createdAt: row.created_at,
        totalAmount: toNumber(row.total_amount, 0),
        linesCount: toNumber(row.lines_count, 0),
        qtyOrdered,
        qtyReceived,
        receivedProgress,
      };
    })
    .filter((order) => {
      if (!statusFilter) {
        return true;
      }
      return order.status === statusFilter;
    });
}

export async function getOperationalPurchaseOrderDetail(poOrId: string) {
  const order = await resolvePurchaseOrder(poOrId);
  if (!order) {
    return null;
  }

  const supplierResult = await pool.query<{ id: number; name: string }>(
    `
    SELECT id, name
    FROM suppliers
    WHERE id = $1
    LIMIT 1
    `,
    [order.supplier_id],
  );

  const lines = await getPurchaseOrderLines(order.id);
  const shipments = await getPurchaseOrderShipments(order.order_number);
  const qtyOrdered = lines.reduce((sum, line) => sum + line.qtyOrdered, 0);
  const qtyReceived = lines.reduce((sum, line) => sum + line.qtyReceived, 0);

  return {
    id: order.id,
    poNumber: order.order_number,
    supplierId: order.supplier_id,
    supplierName: supplierResult.rows[0]?.name ?? null,
    status: normalizePurchaseStatus(order.status),
    requestedDate: order.order_date,
    createdAt: order.created_at,
    totalAmount: toNumber(order.total_amount, 0),
    lines,
    shipments,
    progress: {
      qtyOrdered,
      qtyReceived,
      percent: qtyOrdered > 0 ? Math.round((qtyReceived / qtyOrdered) * 100) : 0,
    },
  };
}

export async function transitionOperationalPurchaseOrderStatus(
  poOrId: string,
  toStatusInput: string,
  actor = "system",
) {
  const order = await resolvePurchaseOrder(poOrId);
  if (!order) {
    throw new Error("po_not_found");
  }

  const currentStatus = normalizePurchaseStatus(order.status);
  const toStatus = normalizePurchaseStatus(toStatusInput);

  if (!toStatus) {
    throw new Error("invalid_target_status");
  }

  if (currentStatus === toStatus) {
    return getOperationalPurchaseOrderDetail(order.order_number);
  }

  const allowedTransitions = PURCHASE_TRANSITIONS[currentStatus] ?? [];
  if (!allowedTransitions.includes(toStatus)) {
    throw new Error("invalid_transition");
  }

  await pool.query(
    `
    UPDATE purchase_orders
    SET status = $2, updated_at = now()
    WHERE id = $1
    `,
    [order.id, toStatus],
  );

  if (toStatus === "approved") {
    try {
      await syncPurchaseOrderAllocations(order.id);
    } catch (allocationError) {
      console.warn("[operations] syncPurchaseOrderAllocations failed:", allocationError);
    }
  }

  await pool.query(
    `
    INSERT INTO purchase_order_events (po_number, event_type, note, payload)
    VALUES ($1, 'status_transition', $2, $3::jsonb)
    `,
    [
      order.order_number,
      `${currentStatus} -> ${toStatus}`,
      JSON.stringify({ from: currentStatus, to: toStatus }),
    ],
  );

  const action =
    toStatus === "approved"
      ? "approve"
      : toStatus === "sent"
        ? "send"
        : toStatus === "partially_received"
          ? "partial_receive"
          : "status_change";
  await recordActivity({
    actor,
    entityType: "purchase_order",
    entityId: order.order_number,
    action,
    summary: {
      poNumber: order.order_number,
      fromStatus: currentStatus,
      toStatus,
    },
  });

  const updated = await getOperationalPurchaseOrderDetail(order.order_number);
  if (!updated) {
    throw new Error("po_not_found");
  }
  return updated;
}

/** Optional: create an in-transit shipment when a PO is sent (`POST .../send` body.shipment.create). */
export async function tryCreateOperationalShipmentOnSend(
  poOrId: string,
  body: unknown,
): Promise<{ shipmentId: number | null }> {
  const order = await resolvePurchaseOrder(poOrId);
  if (!order) {
    return { shipmentId: null };
  }
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const sh = root.shipment;
  if (!sh || typeof sh !== "object") {
    return { shipmentId: null };
  }
  const s = sh as Record<string, unknown>;
  if (s.create !== true) {
    return { shipmentId: null };
  }

  const carrierText = typeof s.carrier === "string" && s.carrier.trim() ? s.carrier.trim() : null;
  const carrierId = s.carrierId != null && Number.isFinite(Number(s.carrierId)) ? Number(s.carrierId) : null;
  const transportMode = typeof s.transportMode === "string" ? s.transportMode.trim() : null;
  const freightCost = s.freightCost != null && Number.isFinite(Number(s.freightCost)) ? Number(s.freightCost) : null;
  const trackingNumber = typeof s.trackingNumber === "string" ? s.trackingNumber.trim() : null;
  const deliveryNoteRef = typeof s.deliveryNoteRef === "string" ? s.deliveryNoteRef.trim() : null;
  const vehicle = typeof s.vehicle === "string" ? s.vehicle.trim() : null;
  const driver = typeof s.driver === "string" ? s.driver.trim() : null;

  const created = await createOperationalShipment({
    poNumber: order.order_number,
    mode: "po_send",
    purchaseOrder: { id: order.id, order_number: order.order_number },
    carrier: carrierText,
    carrierId,
    transportMode,
    freightCost,
    trackingNumber,
    deliveryNoteRef,
    vehicle,
    driver,
  });
  return { shipmentId: created.id };
}

type ResolvedReceivePutaway = {
  warehouseId: number | null;
  locationFromPutaway: string | null;
};

async function resolveReceivePutaway(meta: ReceivePurchaseMetaInput): Promise<ResolvedReceivePutaway> {
  const widRaw = meta.warehouse_id;
  const wid = widRaw != null && Number.isFinite(Number(widRaw)) ? Number(widRaw) : null;

  if (wid == null) {
    const legacy = meta.warehouse_location != null ? String(meta.warehouse_location).trim() : "";
    return { warehouseId: null, locationFromPutaway: legacy || null };
  }

  const orgId = getActiveOrganizationId();
  const whRes = await pool.query<{ id: number; name: string; aisles: unknown; bins: unknown }>(
    `
    SELECT id, name, aisles, bins
    FROM warehouses
    WHERE id = $1 AND organization_id = $2
    LIMIT 1
    `,
    [wid, orgId],
  );
  const row = whRes.rows[0];
  if (!row) {
    throw new Error("putaway_warehouse_not_found");
  }

  const aisles = Array.isArray(row.aisles) ? row.aisles.map((a) => String(a)) : [];
  const rawBins = Array.isArray(row.bins) ? row.bins : [];
  const normalizedBins = rawBins
    .map((b: { code?: unknown; aisle?: unknown }) => ({
      code: String(b?.code ?? "").trim(),
      aisle: b?.aisle != null ? String(b.aisle).trim() : "",
    }))
    .filter((b) => b.code.length > 0);

  const aisleParam = meta.aisle != null ? String(meta.aisle).trim() : "";
  const binCodeParam = meta.bin_code != null ? String(meta.bin_code).trim() : "";

  if (aisles.length > 0) {
    if (!aisleParam || !aisles.includes(aisleParam)) {
      throw new Error("putaway_aisle_invalid");
    }
  }

  let binsFiltered = normalizedBins;
  if (aisles.length > 0 && aisleParam) {
    binsFiltered = normalizedBins.filter((b) => !b.aisle || b.aisle === aisleParam);
  }

  if (normalizedBins.length > 0 && aisles.length > 0 && aisleParam && binsFiltered.length === 0) {
    throw new Error("putaway_no_bins_for_aisle");
  }

  if (binsFiltered.length > 0) {
    if (!binCodeParam) {
      throw new Error("putaway_bin_required");
    }
    const binMatch = binsFiltered.find((b) => b.code === binCodeParam);
    if (!binMatch) {
      throw new Error("putaway_bin_invalid");
    }
    const segments = [row.name, ...(aisleParam ? [aisleParam] : []), binMatch.code];
    return { warehouseId: wid, locationFromPutaway: segments.join(" / ") };
  }

  if (aisles.length > 0) {
    return { warehouseId: wid, locationFromPutaway: `${row.name} / ${aisleParam}` };
  }

  return { warehouseId: wid, locationFromPutaway: row.name };
}

async function resolveContractDefaultWarehouseForPo(purchaseOrderId: number): Promise<number | null> {
  const orgId = getActiveOrganizationId();
  const r = await pool.query<{ default_warehouse_id: number | null }>(
    `
    SELECT sc.default_warehouse_id
    FROM purchase_orders po
    JOIN supplier_contracts sc
      ON sc.id = po.contract_id
     AND sc.organization_id = po.organization_id
    WHERE po.id = $1
      AND po.organization_id = $2
      AND sc.default_warehouse_id IS NOT NULL
    LIMIT 1
    `,
    [purchaseOrderId, orgId],
  );
  return r.rows[0]?.default_warehouse_id ?? null;
}

async function applyWarehouseInventoryReceipt(params: {
  organizationId: number;
  itemId: number;
  warehouseId: number | null;
  quantity: number;
  location: string | null;
}) {
  if (params.warehouseId == null || params.quantity <= 0) return;
  const existing = await pool.query<{ id: number; quantity: number }>(
    `
    SELECT id, quantity
    FROM warehouse_inventory
    WHERE organization_id = $1
      AND warehouse_id = $2
      AND item_id = $3
    LIMIT 1
    `,
    [params.organizationId, params.warehouseId, params.itemId],
  );
  const row = existing.rows[0];
  if (row) {
    await pool.query(
      `
      UPDATE warehouse_inventory
      SET quantity = quantity + $2,
          location = COALESCE($3, location),
          updated_at = now()
      WHERE id = $1
      `,
      [row.id, params.quantity, params.location],
    );
    return;
  }
  await pool.query(
    `
    INSERT INTO warehouse_inventory (
      organization_id,
      item_id,
      warehouse_id,
      quantity,
      location,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, now())
    `,
    [params.organizationId, params.itemId, params.warehouseId, params.quantity, params.location],
  );
}

export async function receiveOperationalPurchaseOrder(
  poOrId: string,
  lines: ReceivePurchaseLineInput[],
  receiveMeta: ReceivePurchaseMetaInput = {},
  actor = "system",
) {
  const order = await resolvePurchaseOrder(poOrId);
  if (!order) {
    throw new Error("po_not_found");
  }

  const currentStatus = normalizePurchaseStatus(order.status);
  if (!["approved", "sent", "partially_received"].includes(currentStatus)) {
    throw new Error("invalid_receive_state");
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("lines_required");
  }

  const contractDefaultWarehouseId =
    receiveMeta.warehouse_id == null ? await resolveContractDefaultWarehouseForPo(order.id) : null;
  const effectiveReceiveMeta: ReceivePurchaseMetaInput = {
    ...receiveMeta,
    warehouse_id: receiveMeta.warehouse_id ?? contractDefaultWarehouseId,
  };
  const putaway = await resolveReceivePutaway(effectiveReceiveMeta);

  const currentLines = await getPurchaseOrderLines(order.id);
  const lineBySku = new Map(currentLines.map((line) => [line.sku, line]));

  const apReceiptLines: Array<{ purchaseOrderItemId: number; itemId: number; acceptedQty: number }> = [];

  const inventoryChanges: Array<{
    sku: string;
    location: string;
    delta: number;
    available: number;
    onHand: number;
  }> = [];
  const mismatchExceptions: Array<{ id: number; sku: string; created: boolean }> = [];

  const MAX_BATCH_LEN = 256;
  const MAX_SERIAL_TOKENS = 200;
  const MAX_SERIAL_TOKEN_LEN = 128;

  for (const lineInput of lines) {
    const sku = String(lineInput.sku ?? "").trim();
    if (!sku) {
      throw new Error("line_sku_required");
    }
    const receiveNow = Number(lineInput.qty_received_now);
    const batchNumber =
      typeof lineInput.batch_number === "string"
        ? lineInput.batch_number.trim().slice(0, MAX_BATCH_LEN)
        : "";
    const serialNumbers = Array.isArray(lineInput.serial_numbers)
      ? lineInput.serial_numbers
          .map((s) => String(s).trim().slice(0, MAX_SERIAL_TOKEN_LEN))
          .filter(Boolean)
          .slice(0, MAX_SERIAL_TOKENS)
      : [];
    const line = lineBySku.get(sku);

    if (!line) {
      throw new Error(`line_not_found:${sku}`);
    }
    if (!Number.isFinite(receiveNow) || receiveNow <= 0) {
      throw new Error(`invalid_receive_qty:${sku}`);
    }
    if (!Number.isInteger(receiveNow)) {
      throw new Error(`invalid_receive_qty_integer:${sku}`);
    }

    const remaining = Math.max(line.qtyOrdered - line.qtyReceived, 0);
    if (receiveNow > remaining) {
      throw new Error(`receive_exceeds_remaining:${sku}`);
    }

    await pool.query(
      `
      UPDATE purchase_order_items
      SET received_quantity = COALESCE(received_quantity, 0) + $2
      WHERE id = $1
      `,
      [line.id, receiveNow],
    );

    if (receiveNow > 0) {
      apReceiptLines.push({
        purchaseOrderItemId: line.id,
        itemId: line.itemId,
        acceptedQty: receiveNow,
      });
      const itemLocationResult = await pool.query<{
        default_location: string | null;
        location: string | null;
      }>(
        `
        SELECT default_location, location
        FROM inventory_items
        WHERE id = $1
        LIMIT 1
        `,
        [line.itemId],
      );

      const itemFallback =
        itemLocationResult.rows[0]?.default_location ||
        itemLocationResult.rows[0]?.location ||
        "Main Warehouse";
      const location = putaway.locationFromPutaway ?? itemFallback;
      const receiveWarehouseId = putaway.warehouseId;

      const adjustment = await adjustOperationalInventory({
        skuOrId: line.sku,
        location,
        delta: receiveNow,
        reason: "PO Receive",
        ref: order.order_number,
        createdBy: "po-receive",
        skipLocationValidation: true,
      });

      inventoryChanges.push({
        sku: line.sku,
        location,
        delta: receiveNow,
        available: adjustment.summary.available,
        onHand: adjustment.summary.onHand,
      });

      const receivedAt = receiveMeta.received_at ?? new Date();
      /** Stock movement / serial location label (structured putaway or legacy string). */
      const movementLocationLabel = location;

      await pool.query(
        `
        INSERT INTO stock_movements (
          organization_id,
          item_id,
          warehouse_id,
          type,
          quantity,
          reference_id,
          reference_type,
          notes,
          user_id,
          receiver_user_id,
          receiver_name,
          warehouse_location,
          received_at,
          timestamp,
          created_at
        )
        VALUES ($11, $1, $10, 'RECEIPT', $2, $3, 'purchase_order', $4, $5, $6, $7, $8, $9, now(), now())
        `,
        [
          line.itemId,
          receiveNow,
          order.id,
          `Received against PO ${order.order_number}`,
          effectiveReceiveMeta.receiver_user_id ?? null,
          effectiveReceiveMeta.receiver_user_id ?? null,
          effectiveReceiveMeta.receiver_name ?? null,
          movementLocationLabel,
          receivedAt,
          receiveWarehouseId,
          getActiveOrganizationId(),
        ],
      );

      await applyWarehouseInventoryReceipt({
        organizationId: getActiveOrganizationId(),
        itemId: line.itemId,
        warehouseId: receiveWarehouseId,
        quantity: receiveNow,
        location,
      });

      if (batchNumber) {
        const existingBatch = await pool.query<{ id: number }>(
          `
          SELECT id
          FROM inventory_batches
          WHERE item_id = $1
            AND COALESCE(warehouse_id, 0) = COALESCE($3::integer, 0)
            AND batch_number = $2
          LIMIT 1
          `,
          [line.itemId, batchNumber, receiveWarehouseId],
        );

        if (existingBatch.rows[0]?.id) {
          await pool.query(
            `
            UPDATE inventory_batches
            SET quantity_received = quantity_received + $2,
                quantity_on_hand = quantity_on_hand + $2,
                updated_at = now()
            WHERE id = $1
            `,
            [existingBatch.rows[0].id, receiveNow],
          );
        } else {
          await pool.query(
            `
            INSERT INTO inventory_batches (item_id, warehouse_id, batch_number, quantity_received, quantity_on_hand)
            VALUES ($1, $2, $3, $4, $4)
            `,
            [line.itemId, receiveWarehouseId, batchNumber, receiveNow],
          );
        }
      }

      if (serialNumbers.length > 0) {
        for (const serial of serialNumbers) {
          await pool.query(
            `
            INSERT INTO inventory_serials (item_id, warehouse_id, serial_number, status, current_location)
            VALUES ($1, $2, $3, 'available', $4)
            ON CONFLICT (serial_number)
            DO UPDATE SET
              item_id = EXCLUDED.item_id,
              warehouse_id = EXCLUDED.warehouse_id,
              status = 'available',
              current_location = EXCLUDED.current_location,
              updated_at = now()
            `,
            [line.itemId, receiveWarehouseId, serial, movementLocationLabel],
          );
        }
      }

      let remainingToFulfill = receiveNow;
      const allocationRows = await pool.query<{ id: number; quantity: number }>(
        `
        SELECT id, quantity
        FROM inventory_allocations
        WHERE order_id = $1
          AND item_id = $2
          AND status = 'reserved'
        ORDER BY created_at ASC
        `,
        [order.id, line.itemId],
      );
      for (const allocation of allocationRows.rows) {
        if (remainingToFulfill <= 0) break;
        const reservedQty = Number(allocation.quantity ?? 0);
        if (reservedQty <= 0) continue;
        const consume = Math.min(reservedQty, remainingToFulfill);
        const nextQty = reservedQty - consume;
        await pool.query(
          `
          UPDATE inventory_allocations
          SET quantity = $2,
              status = CASE WHEN $2 <= 0 THEN 'fulfilled' ELSE status END
          WHERE id = $1
          `,
          [allocation.id, nextQty],
        );
        remainingToFulfill -= consume;
      }
    }
  }

  const refreshedLines = await getPurchaseOrderLines(order.id);
  const fullyReceived = refreshedLines.every((line) => line.qtyReceived >= line.qtyOrdered);
  const nextStatus = fullyReceived ? "received" : "partially_received";

  await pool.query(
    `
    UPDATE purchase_orders
    SET status = $2, updated_at = now()
    WHERE id = $1
    `,
    [order.id, nextStatus],
  );

  const targetShipmentId =
    receiveMeta.shipment_id != null && Number.isFinite(Number(receiveMeta.shipment_id))
      ? Number(receiveMeta.shipment_id)
      : null;

  const shipmentCandidates = await pool.query<{
    id: number;
    status: string;
  }>(
    targetShipmentId != null
      ? `
    SELECT id, status
    FROM shipments
    WHERE po_number = $1 AND id = $2
    `
      : `
    SELECT id, status
    FROM shipments
    WHERE po_number = $1
    `,
    targetShipmentId != null ? [order.order_number, targetShipmentId] : [order.order_number],
  );

  if (targetShipmentId != null && shipmentCandidates.rows.length === 0) {
    throw new Error("shipment_not_found_for_po");
  }

  const shipmentUpdates: Array<{ shipmentId: number; toStatus: string }> = [];
  for (const shipment of shipmentCandidates.rows) {
    if (shipment.status !== "delivered") {
      await pool.query(
        `
        UPDATE shipments
        SET status = 'delivered', updated_at = now()
        WHERE id = $1
        `,
        [shipment.id],
      );
      await pool.query(
        `
        INSERT INTO shipment_events (shipment_id, status, note)
        VALUES ($1, 'delivered', $2)
        `,
        [shipment.id, `Auto-delivered from PO receipt ${order.order_number}`],
      );
      shipmentUpdates.push({ shipmentId: shipment.id, toStatus: "delivered" });
    }
  }

  const grnTrim =
    receiveMeta.grn_number != null && String(receiveMeta.grn_number).trim()
      ? String(receiveMeta.grn_number).trim()
      : null;
  if (grnTrim && targetShipmentId != null) {
    await pool.query(
      `UPDATE shipments SET grn_number = $2, updated_at = now() WHERE id = $1 AND po_number = $3`,
      [targetShipmentId, grnTrim, order.order_number],
    );
  }

  await pool.query(
    `
    INSERT INTO purchase_order_events (po_number, event_type, note, payload)
    VALUES ($1, 'receive', $2, $3::jsonb)
    `,
    [
      order.order_number,
      "PO receive processed",
      JSON.stringify({ lines, inventoryChanges, shipmentUpdates }),
    ],
  );

  await recordActivity({
    actor,
    entityType: "purchase_order",
    entityId: order.order_number,
    action: "receive",
    summary: {
      poNumber: order.order_number,
      linesReceived: lines.length,
      inventoryChanges: inventoryChanges.length,
      shipmentUpdates: shipmentUpdates.length,
      mismatchExceptions: mismatchExceptions.length,
      nextStatus,
    },
  });

  if (apReceiptLines.length > 0) {
    try {
      const { syncOperationalReceiveToApReceipt } = await import("../accounts-payable/service");
      await syncOperationalReceiveToApReceipt({
        purchaseOrderId: order.id,
        receiptLines: apReceiptLines,
        receivedByUserId: receiveMeta.receiver_user_id ?? null,
      });
    } catch (apErr) {
      console.warn("[operations] AP receipt bridge failed:", apErr);
    }
  }

  const updatedOrder = await getOperationalPurchaseOrderDetail(order.order_number);
  if (!updatedOrder) {
    throw new Error("po_not_found");
  }

  return {
    order: updatedOrder,
    inventoryChanges,
    shipmentUpdates,
    mismatchExceptions,
  };
}

async function ensureLateShipmentException(shipment: {
  id: number;
  poNumber: string;
  status: string;
  eta: Date | null;
}) {
  if (!shipment.eta) {
    return null;
  }
  const isLate = shipment.eta.getTime() < Date.now() && shipment.status !== "delivered";
  if (!isLate) {
    return null;
  }

  return createOrGetOperationalException({
    type: "late_shipment",
    severity: "high",
    title: `Late shipment ${shipment.id}`,
    description: `Shipment ${shipment.id} for ${shipment.poNumber} is past ETA`,
    relatedRefs: {
      shipment_id: shipment.id,
      po_number: shipment.poNumber,
    },
    slaHours: 2,
  });
}

async function ensureNoEtaShipmentException(shipment: {
  id: number;
  poNumber: string;
  status: string;
}) {
  const st = shipment.status.toLowerCase();
  if (st === "delivered" || st === "cancelled") {
    return null;
  }
  return createOrGetOperationalException({
    type: "shipment_no_eta",
    severity: "medium",
    title: `Shipment ${shipment.id} has no ETA`,
    description: `Shipment ${shipment.id} for ${shipment.poNumber} is missing an ETA while still active`,
    relatedRefs: {
      shipment_id: shipment.id,
      po_number: shipment.poNumber,
    },
    slaHours: 12,
  });
}

export async function runOperationalExceptionChecks(actor = "system") {
  type Totals = {
    lateShipments: number;
    noEtaShipments: number;
    stockShortages: number;
    contractViolations: number;
  };
  const emptyTotals = (): Totals => ({
    lateShipments: 0,
    noEtaShipments: 0,
    stockShortages: 0,
    contractViolations: 0,
  });
  const created = emptyTotals();
  const updated = emptyTotals();
  const skippedDuplicates = emptyTotals();

  const apply = (key: keyof Totals, result: Awaited<ReturnType<typeof createOrGetOperationalException>>) => {
    if (result.created) {
      created[key] += 1;
      return;
    }
    if (result.updated && result.skippedDuplicate) {
      updated[key] += 1;
      skippedDuplicates[key] += 1;
    }
  };

  const lateShipments = await pool.query<{
    id: number;
    po_number: string;
    status: string;
    eta: Date | null;
  }>(
    `
    SELECT id, po_number, status, eta
    FROM shipments
    WHERE eta IS NOT NULL
      AND eta < now()
      AND lower(status) <> 'delivered'
    `,
  );
  for (const shipment of lateShipments.rows) {
    const result = await ensureLateShipmentException({
      id: shipment.id,
      poNumber: shipment.po_number,
      status: shipment.status.toLowerCase(),
      eta: shipment.eta,
    });
    if (result) apply("lateShipments", result);
  }

  const noEtaRows = await pool.query<{
    id: number;
    po_number: string;
    status: string;
  }>(
    `
    SELECT id, po_number, status
    FROM shipments
    WHERE eta IS NULL
      AND lower(status) NOT IN ('delivered', 'cancelled')
    `,
  );
  for (const shipment of noEtaRows.rows) {
    const result = await ensureNoEtaShipmentException({
      id: shipment.id,
      poNumber: shipment.po_number,
      status: shipment.status.toLowerCase(),
    });
    if (result) apply("noEtaShipments", result);
  }

  const lowStockRows = await pool.query<{
    id: number;
    sku: string;
    name: string;
    quantity: number;
    low_stock_threshold: number | null;
  }>(
    `
    SELECT id, sku, name, quantity, low_stock_threshold
    FROM inventory_items
    WHERE quantity <= COALESCE(low_stock_threshold, 0)
    `,
  );
  for (const item of lowStockRows.rows) {
    const result = await createOrGetOperationalException({
      type: "stock_shortage",
      severity: "high",
      title: `Low stock: ${item.sku}`,
      description: `${item.name} is at ${item.quantity} units`,
      relatedRefs: {
        item_id: item.id,
        sku: item.sku,
      },
      slaHours: 6,
    });
    apply("stockShortages", result);
  }

  const contractViolations = await pool.query<{
    id: number;
    order_number: string;
    total_amount: number | null;
    contract_id: number | null;
    value: number | null;
  }>(
    `
    SELECT po.id, po.order_number, po.total_amount, po.contract_id, sc.value
    FROM purchase_orders po
    JOIN supplier_contracts sc ON sc.id = po.contract_id
    WHERE po.contract_id IS NOT NULL
      AND sc.value IS NOT NULL
      AND po.total_amount > sc.value
      AND lower(COALESCE(po.status, '')) NOT IN ('cancelled', 'void')
    `,
  );
  for (const po of contractViolations.rows) {
    const result = await createOrGetOperationalException({
      type: "contract_violation",
      severity: "high",
      title: `Contract limit exceeded: ${po.order_number}`,
      description: `PO total ${toNumber(po.total_amount)} exceeds contract value ${toNumber(po.value)}`,
      relatedRefs: {
        po_number: po.order_number,
        contract_id: po.contract_id ?? 0,
      },
      slaHours: 8,
    });
    apply("contractViolations", result);
  }

  const checksRun = [
    "late_shipments",
    "no_eta_shipments",
    "low_stock",
    "contract_violations",
  ] as const;
  const generatedAt = new Date().toISOString();

  await recordActivity({
    actor,
    entityType: "exception",
    entityId: "system",
    action: "run_checks",
    summary: { created, updated, skippedDuplicates, checksRun, generatedAt },
  });

  return { created, updated, skippedDuplicates, checksRun, generatedAt };
}

function computeOperationalShipmentRiskBucket(params: { status: string; eta: Date | null }):
  | "late"
  | "no_eta"
  | "due_soon"
  | "exception"
  | "on_time" {
  const status = params.status.toLowerCase();
  if (status === "delayed" || status === "exception") {
    return "exception";
  }
  if (!params.eta) {
    return "no_eta";
  }
  const etaMs = params.eta.getTime();
  const now = Date.now();
  if (etaMs < now && status !== "delivered") {
    return "late";
  }
  if (status === "delivered") {
    return "on_time";
  }
  if (
    etaMs >= now &&
    etaMs <= now + 3 * 24 * 60 * 60 * 1000 &&
    !["delivered", "cancelled"].includes(status)
  ) {
    return "due_soon";
  }
  return "on_time";
}

export async function listOperationalShipments(filters: {
  status?: string;
  po?: string;
  supplier?: string;
  carrier?: string;
  risk?: string;
  etaFrom?: string;
  etaTo?: string;
  tracking?: string;
  direction?: string;
  sourceType?: string;
}) {
  const n = normalizeShipmentFilters(filters);
  const statusPat = n.status;
  const poPat = n.po;
  const supplierPat = n.supplier;
  const carrierPat = n.carrier;
  const trackingPat = n.tracking;
  const etaFrom = n.etaFrom;
  const etaTo = n.etaTo;
  const directionPat = n.direction;
  const sourceTypePat = n.sourceType;

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (statusPat) {
    params.push(statusPat);
    whereClauses.push(`position($${params.length} in lower(coalesce(s.status, ''))) > 0`);
  }
  if (poPat) {
    params.push(poPat);
    whereClauses.push(`position($${params.length} in lower(s.po_number)) > 0`);
  }
  if (supplierPat) {
    params.push(supplierPat);
    whereClauses.push(`position($${params.length} in lower(coalesce(sup.name, ''))) > 0`);
  }
  if (carrierPat) {
    params.push(carrierPat);
    const carrierParam = params.length;
    whereClauses.push(`(
      position($${carrierParam} in lower(coalesce(s.carrier, ''))) > 0
      OR EXISTS (
        SELECT 1 FROM carriers c
        WHERE (
          position($${carrierParam} in lower(coalesce(c.name, ''))) > 0
          OR position($${carrierParam} in lower(coalesce(c.code, ''))) > 0
        )
        AND (
          lower(trim(coalesce(s.carrier, ''))) = lower(trim(coalesce(c.code, '')))
          OR lower(trim(coalesce(s.carrier, ''))) = lower(trim(coalesce(c.name, '')))
        )
      )
    )`);
  }
  if (trackingPat) {
    params.push(trackingPat);
    whereClauses.push(`position($${params.length} in lower(coalesce(s.tracking_number, ''))) > 0`);
  }

  if (directionPat) {
    params.push(directionPat);
    whereClauses.push(`lower(coalesce(nullif(trim(s.direction), ''), 'inbound')) = $${params.length}`);
  }
  if (sourceTypePat) {
    params.push(sourceTypePat);
    whereClauses.push(`lower(coalesce(nullif(trim(s.source_type), ''), 'purchase_order')) = $${params.length}`);
  }

  if (etaFrom) {
    params.push(etaFrom);
    whereClauses.push(`s.eta IS NOT NULL AND s.eta >= $${params.length}::timestamptz`);
  }
  if (etaTo) {
    params.push(etaTo);
    whereClauses.push(`s.eta IS NOT NULL AND s.eta <= $${params.length}::timestamptz`);
  }

  const riskToken = n.risk;
  const riskWanted =
    riskToken && ["late", "no_eta", "due_soon", "exception", "on_time"].includes(riskToken)
      ? (riskToken as "late" | "no_eta" | "due_soon" | "exception" | "on_time")
      : "";

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const result = await pool.query<{
    id: number;
    po_number: string;
    carrier: string | null;
    status: string;
    eta: Date | null;
    drift_minutes: number;
    created_at: Date | null;
    updated_at: Date | null;
    tracking_number: string | null;
    direction: string | null;
    source_type: string | null;
    freight_cost: number | null;
    transport_mode: string | null;
  }>(
    `
    SELECT s.id, s.po_number, s.carrier, s.status, s.eta, s.drift_minutes, s.created_at, s.updated_at,
           s.tracking_number, s.direction, s.source_type, s.freight_cost, s.transport_mode
    FROM shipments s
    LEFT JOIN purchase_orders po ON po.order_number = s.po_number
    LEFT JOIN suppliers sup ON sup.id = po.supplier_id
    ${whereSql}
    ORDER BY s.updated_at DESC
    `,
    params,
  );

  const shipments = [];
  for (const row of result.rows) {
    const status = row.status.toLowerCase();
    const atRisk = Boolean(row.eta && row.eta.getTime() < Date.now() && status !== "delivered");
    if (atRisk) {
      await ensureLateShipmentException({
        id: row.id,
        poNumber: row.po_number,
        status,
        eta: row.eta,
      });
    }

    const riskBucket = computeOperationalShipmentRiskBucket({ status, eta: row.eta });

    const rowDto = {
      id: row.id,
      poNumber: row.po_number,
      carrier: row.carrier,
      status,
      eta: row.eta,
      driftMinutes: toNumber(row.drift_minutes, 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      trackingNumber: row.tracking_number,
      atRisk,
      riskBucket,
      direction: (row.direction && String(row.direction).trim()) || "inbound",
      sourceType: (row.source_type && String(row.source_type).trim()) || "purchase_order",
      freightCost: row.freight_cost,
      transportMode: row.transport_mode,
    };

    if (!riskWanted || riskBucket === riskWanted) {
      shipments.push(rowDto);
    }
  }

  return shipments;
}

export async function getOperationalShipmentDetail(idOrRef: string) {
  const id = Number(idOrRef);
  if (!Number.isFinite(id)) {
    throw new Error("shipment_not_found");
  }

  const shipmentResult = await pool.query<{
    id: number;
    po_number: string;
    carrier: string | null;
    status: string;
    eta: Date | null;
    drift_minutes: number;
    created_at: Date | null;
    updated_at: Date | null;
    tracking_number: string | null;
    purchase_order_id: number | null;
    supplier_id: number | null;
    supplier_name: string | null;
    carrier_id: number | null;
    transport_mode: string | null;
    freight_cost: number | null;
    vehicle: string | null;
    driver: string | null;
    delivery_note_ref: string | null;
    grn_number: string | null;
    direction: string | null;
    source_type: string | null;
    source_id: number | null;
    source_ref: string | null;
  }>(
    `
    SELECT
      s.id,
      s.po_number,
      s.carrier,
      s.status,
      s.eta,
      s.drift_minutes,
      s.created_at,
      s.updated_at,
      s.tracking_number,
      po.id AS purchase_order_id,
      sup.id AS supplier_id,
      sup.name AS supplier_name,
      s.carrier_id,
      s.transport_mode,
      s.freight_cost,
      s.vehicle,
      s.driver,
      s.delivery_note_ref,
      s.grn_number,
      s.direction,
      s.source_type,
      s.source_id,
      s.source_ref
    FROM shipments s
    LEFT JOIN purchase_orders po ON po.order_number = s.po_number
    LEFT JOIN suppliers sup ON sup.id = po.supplier_id
    WHERE s.id = $1
    LIMIT 1
    `,
    [id],
  );

  const shipment = shipmentResult.rows[0];
  if (!shipment) {
    throw new Error("shipment_not_found");
  }

  const timelineResult = await pool.query<{
    id: number;
    status: string;
    note: string | null;
    event_at: Date | null;
  }>(
    `
    SELECT id, status, note, event_at
    FROM shipment_events
    WHERE shipment_id = $1
    ORDER BY event_at DESC
    `,
    [shipment.id],
  );

  const status = shipment.status.toLowerCase();
  const atRisk = Boolean(
    shipment.eta && shipment.eta.getTime() < Date.now() && status !== "delivered",
  );
  if (atRisk) {
    await ensureLateShipmentException({
      id: shipment.id,
      poNumber: shipment.po_number,
      status,
      eta: shipment.eta,
    });
  }

  const relatedEx = await pool.query<{
    id: number;
    status: string;
    title: string;
    type: string;
  }>(
    `
    SELECT id, status, title, type
    FROM operational_exceptions e
    WHERE (e.related_refs->>'shipment_id') = $1
    ORDER BY
      CASE WHEN lower(e.status) IN ('open', 'in_progress') THEN 0 ELSE 1 END,
      e.updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [String(shipment.id)],
  );
  const relatedException = relatedEx.rows[0] ?? null;

  const riskBucket = computeOperationalShipmentRiskBucket({ status, eta: shipment.eta });
  const updatedAt = shipment.updated_at;

  return {
    id: shipment.id,
    poNumber: shipment.po_number,
    carrier: shipment.carrier,
    carrierId: shipment.carrier_id,
    status,
    eta: shipment.eta,
    driftMinutes: toNumber(shipment.drift_minutes, 0),
    createdAt: shipment.created_at,
    updatedAt,
    trackingNumber: shipment.tracking_number,
    atRisk,
    riskBucket,
    supplierId: shipment.supplier_id,
    supplierName: shipment.supplier_name,
    purchaseOrderId: shipment.purchase_order_id,
    transportMode: shipment.transport_mode,
    freightCost: shipment.freight_cost,
    vehicle: shipment.vehicle,
    driver: shipment.driver,
    deliveryNoteRef: shipment.delivery_note_ref,
    grnNumber: shipment.grn_number,
    direction: (shipment.direction && String(shipment.direction).trim()) || "inbound",
    sourceType: (shipment.source_type && String(shipment.source_type).trim()) || "purchase_order",
    sourceId: shipment.source_id,
    sourceRef: shipment.source_ref,
    relatedException,
    /** Freight on the shipment is informational for goods-PO context; not auto-posted as carrier AP invoice. */
    freightApNote:
      "Shipment freight cost is for visibility and planning only. Carrier payables are not created from this field.",
    updatedAtFormatted:
      updatedAt && !Number.isNaN(new Date(updatedAt).getTime())
        ? new Date(updatedAt).toISOString()
        : null,
    timeline: timelineResult.rows.map((event) => ({
      id: event.id,
      status: event.status,
      note: event.note,
      eventAt: event.event_at,
    })),
  };
}

const SHIPMENT_TRANSITIONS: Record<string, string[]> = {
  created: ["in_transit", "cancelled"],
  in_transit: ["delivered", "delayed", "cancelled"],
  delayed: ["in_transit", "delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export async function patchOperationalShipmentMeta(input: {
  shipmentId: string;
  carrier?: string | null;
  carrierId?: number | null;
  eta?: Date | string | null;
  trackingNumber?: string | null;
  transportMode?: string | null;
  freightCost?: number | null;
  vehicle?: string | null;
  driver?: string | null;
  deliveryNoteRef?: string | null;
  grnNumber?: string | null;
  actor?: string;
}) {
  const orgId = getActiveOrganizationId();
  const existing = await getOperationalShipmentDetail(input.shipmentId);
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;

  if (input.carrierId !== undefined) {
    if (input.carrierId != null && Number.isFinite(Number(input.carrierId)) && Number(input.carrierId) > 0) {
      const res = await resolveCarrierSnapshotForOrg({
        organizationId: orgId,
        carrierId: Number(input.carrierId),
        carrierTextFallback: input.carrier ?? null,
      });
      sets.push(`carrier_id = $${n++}`, `carrier = $${n++}`);
      vals.push(res.carrierId, res.carrierSnapshot);
    } else {
      sets.push(`carrier_id = $${n++}`);
      vals.push(null);
      if (input.carrier !== undefined) {
        sets.push(`carrier = $${n++}`);
        vals.push(input.carrier);
      }
    }
  } else if (input.carrier !== undefined) {
    sets.push(`carrier = $${n++}`);
    vals.push(input.carrier);
  }

  if (input.eta !== undefined) {
    sets.push(`eta = $${n++}`);
    if (input.eta === null) {
      vals.push(null);
    } else {
      vals.push(typeof input.eta === "string" ? new Date(input.eta) : input.eta);
    }
  }
  if (input.trackingNumber !== undefined) {
    sets.push(`tracking_number = $${n++}`);
    vals.push(input.trackingNumber);
  }
  if (input.transportMode !== undefined) {
    const tm =
      typeof input.transportMode === "string" && input.transportMode.trim() ? input.transportMode.trim() : null;
    sets.push(`transport_mode = $${n++}`);
    vals.push(tm);
  }
  if (input.freightCost !== undefined) {
    const freightCost =
      input.freightCost != null && Number.isFinite(Number(input.freightCost)) ? Number(input.freightCost) : null;
    if (freightCost != null && freightCost < 0) {
      throw new Error("shipment_freight_cost_invalid");
    }
    sets.push(`freight_cost = $${n++}`);
    vals.push(freightCost);
  }
  if (input.vehicle !== undefined) {
    const v = typeof input.vehicle === "string" && input.vehicle.trim() ? input.vehicle.trim() : null;
    sets.push(`vehicle = $${n++}`);
    vals.push(v);
  }
  if (input.driver !== undefined) {
    const d = typeof input.driver === "string" && input.driver.trim() ? input.driver.trim() : null;
    sets.push(`driver = $${n++}`);
    vals.push(d);
  }
  if (input.deliveryNoteRef !== undefined) {
    const dr =
      typeof input.deliveryNoteRef === "string" && input.deliveryNoteRef.trim()
        ? input.deliveryNoteRef.trim()
        : null;
    sets.push(`delivery_note_ref = $${n++}`);
    vals.push(dr);
  }
  if (input.grnNumber !== undefined) {
    const g = typeof input.grnNumber === "string" && input.grnNumber.trim() ? input.grnNumber.trim() : null;
    sets.push(`grn_number = $${n++}`);
    vals.push(g);
  }
  if (sets.length === 0) {
    return existing;
  }
  vals.push(existing.id);
  await pool.query(`UPDATE shipments SET ${sets.join(", ")}, updated_at = now() WHERE id = $${n}`, vals);
  await pool.query(`INSERT INTO shipment_events (shipment_id, status, note) VALUES ($1, $2, $3)`, [
    existing.id,
    existing.status,
    `Shipment details updated (${input.actor ?? "user"})`,
  ]);
  return getOperationalShipmentDetail(input.shipmentId);
}

export async function updateOperationalShipmentStatus(input: {
  shipmentId: string;
  toStatus: string;
  note?: string;
  actor?: string;
}) {
  const shipment = await getOperationalShipmentDetail(input.shipmentId);
  const fromStatus = shipment.status;
  const toStatus = input.toStatus.toLowerCase();
  const allowed = SHIPMENT_TRANSITIONS[fromStatus] ?? [];

  if (!toStatus) {
    throw new Error("invalid_target_status");
  }
  if (toStatus !== fromStatus && !allowed.includes(toStatus)) {
    throw new Error("invalid_transition");
  }

  await pool.query(
    `
    UPDATE shipments
    SET status = $2, updated_at = now()
    WHERE id = $1
    `,
    [shipment.id, toStatus],
  );
  await pool.query(
    `
    INSERT INTO shipment_events (shipment_id, status, note)
    VALUES ($1, $2, $3)
    `,
    [shipment.id, toStatus, input.note ?? null],
  );

  await recordActivity({
    actor: input.actor ?? "system",
    entityType: "shipment",
    entityId: shipment.id,
    action: "status_change",
    summary: {
      shipmentId: shipment.id,
      poNumber: shipment.poNumber,
      fromStatus,
      toStatus,
      note: input.note ?? null,
    },
  });

  return getOperationalShipmentDetail(String(shipment.id));
}

type ExceptionListFilters = {
  severity?: string;
  status?: string;
  type?: string;
};

export async function listOperationalExceptions(filters: ExceptionListFilters) {
  const whereClauses: string[] = [];
  const params: string[] = [];

  if (filters.severity && filters.severity.trim()) {
    params.push(filters.severity.trim().toLowerCase());
    whereClauses.push(`lower(e.severity) = $${params.length}`);
  }
  if (filters.status && filters.status.trim()) {
    params.push(filters.status.trim().toLowerCase());
    whereClauses.push(`lower(e.status) = $${params.length}`);
  }
  if (filters.type && filters.type.trim()) {
    params.push(filters.type.trim().toLowerCase());
    whereClauses.push(`lower(e.type) = $${params.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const result = await pool.query<OperationalExceptionSqlRow>(
    `
    SELECT
      e.id,
      e.type,
      e.severity,
      e.status,
      e.title,
      e.description,
      e.related_refs,
      e.assignee,
      e.sla_hours,
      e.comments,
      e.created_at,
      e.updated_at
    FROM operational_exceptions e
    ${whereSql}
    ORDER BY e.created_at DESC
    `,
    params,
  );

  return result.rows.map((row) => mapOperationalExceptionSqlRow(row));
}

export async function getOperationalExceptionDetail(idOrRef: string) {
  const id = Number(idOrRef);
  if (!Number.isFinite(id)) {
    throw new Error("exception_not_found");
  }

  const result = await pool.query<OperationalExceptionSqlRow>(
    `
    SELECT
      e.id,
      e.type,
      e.severity,
      e.status,
      e.title,
      e.description,
      e.related_refs,
      e.assignee,
      e.sla_hours,
      e.comments,
      e.created_at,
      e.updated_at
    FROM operational_exceptions e
    WHERE e.id = $1
    LIMIT 1
    `,
    [id],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("exception_not_found");
  }
  return mapOperationalExceptionSqlRow(row);
}

const EXCEPTION_TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed", "open"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

export async function transitionOperationalExceptionStatus(
  idOrRef: string,
  toStatusInput: string,
  actor = "system",
) {
  const detail = await getOperationalExceptionDetail(idOrRef);
  const toStatus = toStatusInput.toLowerCase();
  const currentStatus = detail.status.toLowerCase();

  if (!toStatus) {
    throw new Error("invalid_target_status");
  }
  if (toStatus !== currentStatus) {
    const allowed = EXCEPTION_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new Error("invalid_transition");
    }
  }

  await pool.query(
    `
    UPDATE operational_exceptions
    SET status = $2, updated_at = now()
    WHERE id = $1
    `,
    [detail.id, toStatus],
  );

  await recordActivity({
    actor,
    entityType: "exception",
    entityId: detail.id,
    action: "status_change",
    summary: {
      exceptionId: detail.id,
      fromStatus: currentStatus,
      toStatus,
    },
  });

  return getOperationalExceptionDetail(String(detail.id));
}

export async function assignOperationalException(
  idOrRef: string,
  assignee: string,
  actor = "system",
) {
  const detail = await getOperationalExceptionDetail(idOrRef);

  await pool.query(
    `
    UPDATE operational_exceptions
    SET assignee = $2, updated_at = now()
    WHERE id = $1
    `,
    [detail.id, assignee || null],
  );

  await recordActivity({
    actor,
    entityType: "exception",
    entityId: detail.id,
    action: "assign",
    summary: {
      exceptionId: detail.id,
      assignee: assignee || null,
    },
  });

  return getOperationalExceptionDetail(String(detail.id));
}

export async function addOperationalExceptionComment(input: {
  idOrRef: string;
  author: string;
  comment: string;
}) {
  if (!input.comment.trim()) {
    throw new Error("comment_required");
  }
  const detail = await getOperationalExceptionDetail(input.idOrRef);
  const commentEntry = {
    author: input.author || "system",
    comment: input.comment.trim(),
    at: new Date().toISOString(),
  };

  await pool.query(
    `
    UPDATE operational_exceptions
    SET comments = COALESCE(comments, '[]'::jsonb) || $2::jsonb,
        updated_at = now()
    WHERE id = $1
    `,
    [detail.id, JSON.stringify([commentEntry])],
  );

  await recordActivity({
    actor: input.author || "system",
    entityType: "exception",
    entityId: detail.id,
    action: "comment",
    summary: {
      exceptionId: detail.id,
      comment: commentEntry.comment,
    },
  });

  return getOperationalExceptionDetail(String(detail.id));
}

export async function listOperationalIntegrationRuns(limit = 20) {
  const cappedLimit = Math.min(Math.max(limit, 1), 100);
  const result = await pool.query<{
    id: number;
    connector: string;
    status: string;
    started_at: Date | null;
    finished_at: Date | null;
    message: string | null;
  }>(
    `
    SELECT id, connector, status, started_at, finished_at, message
    FROM integration_runs
    ORDER BY started_at DESC
    LIMIT $1
    `,
    [cappedLimit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    connector: row.connector,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    message: row.message,
  }));
}

const SUPPORTED_CONNECTORS = new Set(["erp", "wms", "tms"]);

export async function runOperationalConnector(connectorInput: string) {
  const connector = connectorInput.toLowerCase();
  if (!SUPPORTED_CONNECTORS.has(connector)) {
    throw new Error("unsupported_connector");
  }

  const startResult = await pool.query<{ id: number }>(
    `
    INSERT INTO integration_runs (connector, status, started_at, message)
    VALUES ($1, 'running', now(), 'Connector run started')
    RETURNING id
    `,
    [connector],
  );
  const runId = startResult.rows[0].id;

  await new Promise((resolve) => setTimeout(resolve, 500));

  const message = `Connector ${connector.toUpperCase()} run completed successfully`;
  await pool.query(
    `
    UPDATE integration_runs
    SET status = 'success', finished_at = now(), message = $2
    WHERE id = $1
    `,
    [runId, message],
  );

  await logActivity(
    "integration_run",
    `${connector.toUpperCase()} run completed`,
    message,
    { connector, run_id: runId },
  );

  const runs = await listOperationalIntegrationRuns(1);
  return runs[0];
}

export async function listOperationalActivity(filters: ActivityListFilters = {}) {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.entityType && filters.entityType.trim()) {
    params.push(filters.entityType.trim().toLowerCase());
    whereClauses.push(`lower(entity_type) = $${params.length}`);
  }

  if (filters.entityId && filters.entityId.trim()) {
    params.push(filters.entityId.trim());
    whereClauses.push(`entity_id = $${params.length}`);
  }

  if (filters.action && filters.action.trim()) {
    params.push(`%${filters.action.trim().toLowerCase()}%`);
    whereClauses.push(`lower(action) LIKE $${params.length}`);
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  params.push(limit);
  const limitParam = `$${params.length}`;
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const result = await pool.query<{
    id: number;
    created_at: Date | null;
    actor: string;
    entity_type: string;
    entity_id: string;
    action: string;
    summary_json: Record<string, unknown>;
  }>(
    `
    SELECT id, created_at, actor, entity_type, entity_id, action, summary_json
    FROM ops_activity
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limitParam}
    `,
    params,
  );

  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actor: row.actor,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    summary: row.summary_json ?? {},
  }));
}

export async function getOperationalControlTowerOverview() {
  const openExceptionsResult = await pool.query<{
    severity: string;
    count: number;
  }>(
    `
    SELECT severity, count(*)::int AS count
    FROM operational_exceptions
    WHERE status IN ('open', 'in_progress')
    GROUP BY severity
    `,
  );

  const lateShipmentsResult = await pool.query<{ count: number }>(
    `
    SELECT count(*)::int AS count
    FROM shipments
    WHERE eta IS NOT NULL
      AND eta < now()
      AND status <> 'delivered'
    `,
  );

  const poAwaitingActionResult = await pool.query<{ count: number }>(
    `
    SELECT count(*)::int AS count
    FROM purchase_orders
    WHERE lower(status) = 'approved'
    `,
  );

  const lowStockResult = await pool.query<{ count: number }>(
    `
    SELECT count(*)::int AS count
    FROM (
      SELECT
        i.sku,
        COALESCE(SUM(p.on_hand), COALESCE(i.quantity, 0)) AS on_hand,
        COALESCE(SUM(p.allocated), 0) AS allocated,
        COALESCE(i.low_stock_threshold, 0) AS threshold
      FROM inventory_items i
      LEFT JOIN inventory_positions p ON p.sku = i.sku
      GROUP BY i.id
    ) stock
    WHERE (stock.on_hand - stock.allocated) <= stock.threshold
    `,
  );

  const activity = await listOperationalActivity({ limit: 20 });

  const exceptionsBySeverity: Record<string, number> = {};
  for (const row of openExceptionsResult.rows) {
    exceptionsBySeverity[row.severity] = toNumber(row.count, 0);
  }

  const openExceptionsTotal = Object.values(exceptionsBySeverity).reduce((a, c) => a + c, 0);

  let pendingRequisitions = 0;
  let inTransitShipments = 0;
  let overdueInvoices = 0;
  try {
    const pr = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM purchase_requisitions WHERE status IN ('PENDING','DRAFT')`,
    );
    pendingRequisitions = toNumber(pr.rows[0]?.count, 0);
  } catch {
    pendingRequisitions = 0;
  }
  try {
    const sh = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM shipments WHERE lower(status) IN ('created','in_transit','delayed')`,
    );
    inTransitShipments = toNumber(sh.rows[0]?.count, 0);
  } catch {
    inTransitShipments = 0;
  }
  try {
    const inv = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM invoices WHERE status = 'OVERDUE'`,
    );
    overdueInvoices = toNumber(inv.rows[0]?.count, 0);
  } catch {
    overdueInvoices = 0;
  }

  return {
    kpis: {
      exceptionsBySeverity,
      openExceptionsTotal,
      lateShipments: toNumber(lateShipmentsResult.rows[0]?.count, 0),
      posAwaitingAction: toNumber(poAwaitingActionResult.rows[0]?.count, 0),
      lowStockSkus: toNumber(lowStockResult.rows[0]?.count, 0),
      pendingRequisitions,
      inTransitShipments,
      overdueInvoices,
    },
    activity: activity.map((entry) => ({
      id: entry.id,
      eventType: entry.action,
      title:
        typeof entry.summary.title === "string"
          ? entry.summary.title
          : `${entry.entityType} ${entry.action}`,
      details:
        typeof entry.summary.details === "string"
          ? entry.summary.details
          : typeof entry.summary.message === "string"
            ? entry.summary.message
            : null,
      relatedRefs: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        ...(typeof entry.summary === "object" && entry.summary !== null ? entry.summary : {}),
      },
      createdAt: entry.createdAt,
    })),
  };
}

export async function runOperationalDemoWalkthrough(actor: string) {
  const steps: Array<{ id: string; label: string; completed: boolean; details?: string }> = [];

  const resetSummary = await resetAndSeedDemoData();
  await initializeOperationalData();
  steps.push({
    id: "reset-demo",
    label: "Reset demo data",
    completed: true,
    details: `Users ${resetSummary.users}, Items ${resetSummary.items}`,
  });

  const inventoryItems = await listOperationalInventory({});
  const firstInventoryItem = inventoryItems[0];
  if (!firstInventoryItem) {
    throw new Error("inventory_empty");
  }

  const shortageDelta = -Math.max(firstInventoryItem.available + 1, 1);
  const shortageAdjustment = await adjustOperationalInventory({
    skuOrId: firstInventoryItem.sku,
    location: firstInventoryItem.location ?? "Main Warehouse",
    delta: shortageDelta,
    reason: "Demo Walkthrough - force shortage",
    ref: "DEMO-WALKTHROUGH",
    createdBy: actor,
    skipLocationValidation: true,
  });
  const shortageExceptionId = shortageAdjustment.exception?.id ?? null;
  steps.push({
    id: "create-shortage",
    label: "Create inventory shortage",
    completed: true,
    details:
      shortageExceptionId !== null
        ? `Exception #${shortageExceptionId}`
        : `Available ${shortageAdjustment.summary.available}`,
  });

  const supplierResult = await pool.query<{ id: number }>(
    `
    SELECT id
    FROM suppliers
    ORDER BY id ASC
    LIMIT 1
    `,
  );
  const supplierId = supplierResult.rows[0]?.id;
  if (!supplierId) {
    throw new Error("supplier_not_found");
  }

  const itemLookup = await pool.query<{ id: number; price: number }>(
    `
    SELECT id, price
    FROM inventory_items
    WHERE sku = $1
    LIMIT 1
    `,
    [firstInventoryItem.sku],
  );
  const itemId = itemLookup.rows[0]?.id;
  const itemPrice = toNumber(itemLookup.rows[0]?.price, 10);
  if (!itemId) {
    throw new Error("item_not_found");
  }

  const now = Date.now();
  const poNumber = `PO-DEMO-${now}`;
  const lineQuantity = 10;
  const lineUnitPrice = Math.max(itemPrice, 1);
  const lineTotal = lineQuantity * lineUnitPrice;

  const poInsert = await pool.query<{ id: number; order_number: string }>(
    `
    INSERT INTO purchase_orders (
      organization_id,
      order_number,
      supplier_id,
      status,
      order_date,
      total_amount,
      created_at,
      updated_at
    )
    VALUES (1, $1, $2, 'sent', now(), $3, now(), now())
    RETURNING id, order_number
    `,
    [poNumber, supplierId, lineTotal],
  );
  const poId = poInsert.rows[0].id;

  await pool.query(
    `
    INSERT INTO purchase_order_items (
      order_id,
      item_id,
      quantity,
      unit_price,
      total_price,
      received_quantity
    )
    VALUES ($1, $2, $3, $4, $5, 0)
    `,
    [poId, itemId, lineQuantity, lineUnitPrice, lineTotal],
  );
  steps.push({
    id: "create-po",
    label: "Create demo purchase order",
    completed: true,
    details: poNumber,
  });

  const shipmentInsert = await pool.query<{ id: number }>(
    `
    INSERT INTO shipments (po_number, carrier, status, eta, created_at, updated_at)
    VALUES ($1, 'Demo Carrier', 'created', now() + interval '2 days', now(), now())
    RETURNING id
    `,
    [poNumber],
  );
  const shipmentId = shipmentInsert.rows[0].id;

  await updateOperationalShipmentStatus({
    shipmentId: String(shipmentId),
    toStatus: "in_transit",
    note: "Demo walkthrough status update",
    actor,
  });
  steps.push({
    id: "flip-shipment",
    label: "Flip shipment status",
    completed: true,
    details: `Shipment #${shipmentId} -> in_transit`,
  });

  const receiveResult = await receiveOperationalPurchaseOrder(
    poNumber,
    [
      {
        sku: firstInventoryItem.sku,
        qty_received_now: 4,
      },
    ],
    {},
    actor,
  );
  steps.push({
    id: "partial-receive",
    label: "Partial receive",
    completed: true,
    details: `Received 4 of ${lineQuantity} ordered (exceptions ${receiveResult.mismatchExceptions.length})`,
  });

  const chosenExceptionId = shortageExceptionId;
  if (chosenExceptionId !== null) {
    await getOperationalExceptionDetail(String(chosenExceptionId));
    steps.push({
      id: "open-exception",
      label: "Open created exception detail",
      completed: true,
      details: `Exception #${chosenExceptionId}`,
    });
  }

  return {
    steps,
    context: {
      sku: firstInventoryItem.sku,
      poNumber,
      shipmentId,
      exceptionId: chosenExceptionId,
    },
    links: {
      inventory: `/inventory/${encodeURIComponent(firstInventoryItem.sku)}`,
      purchase: `/purchase/${encodeURIComponent(poNumber)}`,
      logistics: `/logistics/${shipmentId}`,
      exception:
        chosenExceptionId !== null ? `/exceptions/${chosenExceptionId}` : null,
    },
  };
}

export { getOperationalExceptionSummary } from "../../operations-internal/exception-summary";

import { pool } from "../../db";
import { resetAndSeedDemoData } from "../../seed";
import { initializeOperationalData } from "./operational-ddl";
import { refsMatch, toNumber, toString } from "./operational-utils";
import { getActiveOrganizationId } from "../../organization-context";

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
    return { id: existing.id, created: false };
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
      JSON.stringify(payload.relatedRefs),
      payload.slaHours ?? 24,
    ],
  );

  await logActivity(
    "exception_created",
    payload.title,
    payload.description ?? "",
    payload.relatedRefs,
  );

  return { id: insertResult.rows[0].id, created: true };
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
  received_at?: Date | null;
};

const PURCHASE_TRANSITIONS: Record<string, string[]> = {
  draft: ["open"],
  open: ["approved"],
  approved: ["sent"],
  sent: ["received"],
};

function normalizePurchaseStatus(rawStatus: string | null | undefined): string {
  const normalized = (rawStatus ?? "").toLowerCase();
  if (normalized === "acknowledged" || normalized === "partially_received") {
    return "sent";
  }
  if (normalized === "completed") {
    return "received";
  }
  return normalized;
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
  }>(
    `
    SELECT id, carrier, status, eta, drift_minutes, updated_at, tracking_number
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

  const statusFilter = normalizePurchaseStatus(filters.status);

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
  if (!["approved", "sent"].includes(currentStatus)) {
    throw new Error("invalid_receive_state");
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("lines_required");
  }

  const currentLines = await getPurchaseOrderLines(order.id);
  const lineBySku = new Map(currentLines.map((line) => [line.sku, line]));

  const inventoryChanges: Array<{
    sku: string;
    location: string;
    delta: number;
    available: number;
    onHand: number;
  }> = [];
  const mismatchExceptions: Array<{ id: number; sku: string; created: boolean }> = [];

  for (const lineInput of lines) {
    const sku = lineInput.sku;
    const receiveNow = Number(lineInput.qty_received_now);
    const batchNumber = typeof lineInput.batch_number === "string" ? lineInput.batch_number.trim() : "";
    const serialNumbers = Array.isArray(lineInput.serial_numbers)
      ? lineInput.serial_numbers.map((s) => String(s).trim()).filter(Boolean)
      : [];
    const line = lineBySku.get(sku);

    if (!line) {
      throw new Error(`line_not_found:${sku}`);
    }
    if (!Number.isFinite(receiveNow) || receiveNow <= 0) {
      throw new Error(`invalid_receive_qty:${sku}`);
    }

    const remaining = Math.max(line.qtyOrdered - line.qtyReceived, 0);
    const appliedQty = Math.min(remaining, receiveNow);

    await pool.query(
      `
      UPDATE purchase_order_items
      SET received_quantity = LEAST(quantity, COALESCE(received_quantity, 0) + $2)
      WHERE id = $1
      `,
      [line.id, receiveNow],
    );

    if (receiveNow !== remaining) {
      const mismatch = await createOrGetOperationalException({
        type: "po_mismatch",
        severity: "medium",
        title: `PO mismatch on ${order.order_number}`,
        description: `Expected remaining ${remaining}, received now ${receiveNow}`,
        relatedRefs: {
          po_number: order.order_number,
          sku: line.sku,
        },
        slaHours: 12,
      });
      mismatchExceptions.push({ id: mismatch.id, sku: line.sku, created: mismatch.created });
    }

    if (appliedQty > 0) {
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

      const location =
        itemLocationResult.rows[0]?.default_location ||
        itemLocationResult.rows[0]?.location ||
        "Main Warehouse";

      const adjustment = await adjustOperationalInventory({
        skuOrId: line.sku,
        location,
        delta: appliedQty,
        reason: "PO Receive",
        ref: order.order_number,
        createdBy: "po-receive",
        skipLocationValidation: true,
      });

      inventoryChanges.push({
        sku: line.sku,
        location,
        delta: appliedQty,
        available: adjustment.summary.available,
        onHand: adjustment.summary.onHand,
      });

      const receivedAt = receiveMeta.received_at ?? new Date();
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
        VALUES (1, $1, NULL, 'RECEIPT', $2, $3, 'purchase_order', $4, $5, $6, $7, $8, $9, now(), now())
        `,
        [
          line.itemId,
          appliedQty,
          order.id,
          `Received against PO ${order.order_number}`,
          receiveMeta.receiver_user_id ?? null,
          receiveMeta.receiver_user_id ?? null,
          receiveMeta.receiver_name ?? null,
          receiveMeta.warehouse_location ?? location,
          receivedAt,
        ],
      );

      if (batchNumber) {
        const existingBatch = await pool.query<{ id: number }>(
          `
          SELECT id
          FROM inventory_batches
          WHERE item_id = $1
            AND COALESCE(warehouse_id, 0) = 0
            AND batch_number = $2
          LIMIT 1
          `,
          [line.itemId, batchNumber],
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
            [existingBatch.rows[0].id, appliedQty],
          );
        } else {
          await pool.query(
            `
            INSERT INTO inventory_batches (item_id, warehouse_id, batch_number, quantity_received, quantity_on_hand)
            VALUES ($1, NULL, $2, $3, $3)
            `,
            [line.itemId, batchNumber, appliedQty],
          );
        }
      }

      if (serialNumbers.length > 0) {
        for (const serial of serialNumbers) {
          await pool.query(
            `
            INSERT INTO inventory_serials (item_id, warehouse_id, serial_number, status, current_location)
            VALUES ($1, NULL, $2, 'available', $3)
            ON CONFLICT (serial_number)
            DO UPDATE SET
              item_id = EXCLUDED.item_id,
              warehouse_id = EXCLUDED.warehouse_id,
              status = 'available',
              current_location = EXCLUDED.current_location,
              updated_at = now()
            `,
            [line.itemId, serial, receiveMeta.warehouse_location ?? location],
          );
        }
      }

      let remainingToFulfill = appliedQty;
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
  const nextStatus = fullyReceived ? "received" : "sent";

  await pool.query(
    `
    UPDATE purchase_orders
    SET status = $2, updated_at = now()
    WHERE id = $1
    `,
    [order.id, nextStatus],
  );

  const shipmentCandidates = await pool.query<{
    id: number;
    status: string;
  }>(
    `
    SELECT id, status
    FROM shipments
    WHERE po_number = $1
    `,
    [order.order_number],
  );

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

export async function runOperationalExceptionChecks(actor = "system") {
  const created = {
    lateShipments: 0,
    stockShortages: 0,
    contractViolations: 0,
  };
  const touched = {
    lateShipments: 0,
    stockShortages: 0,
    contractViolations: 0,
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
    touched.lateShipments += 1;
    const result = await ensureLateShipmentException({
      id: shipment.id,
      poNumber: shipment.po_number,
      status: shipment.status.toLowerCase(),
      eta: shipment.eta,
    });
    if (result?.created) created.lateShipments += 1;
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
    touched.stockShortages += 1;
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
    if (result.created) created.stockShortages += 1;
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
    touched.contractViolations += 1;
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
    if (result.created) created.contractViolations += 1;
  }

  await recordActivity({
    actor,
    entityType: "exception",
    entityId: "system",
    action: "run_checks",
    summary: { created, touched },
  });

  return { created, touched };
}

export async function listOperationalShipments(filters: {
  status?: string;
  po?: string;
  carrier?: string;
  risk?: string;
}) {
  const whereClauses: string[] = [];
  const params: string[] = [];

  if (filters.status && filters.status.trim()) {
    params.push(filters.status.trim().toLowerCase());
    whereClauses.push(`lower(s.status) = $${params.length}`);
  }
  if (filters.po && filters.po.trim()) {
    params.push(`%${filters.po.trim().toLowerCase()}%`);
    whereClauses.push(`lower(s.po_number) LIKE $${params.length}`);
  }
  if (filters.carrier && filters.carrier.trim()) {
    params.push(`%${filters.carrier.trim().toLowerCase()}%`);
    whereClauses.push(`lower(COALESCE(s.carrier, '')) LIKE $${params.length}`);
  }

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
  }>(
    `
    SELECT id, po_number, carrier, status, eta, drift_minutes, created_at, updated_at,
           tracking_number
    FROM shipments s
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

    shipments.push({
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
    });
  }

  if (filters.risk?.trim().toLowerCase() === "late") {
    return shipments.filter((shipment) => shipment.atRisk);
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
  }>(
    `
    SELECT id, po_number, carrier, status, eta, drift_minutes, created_at, updated_at, tracking_number
    FROM shipments
    WHERE id = $1
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

  return {
    id: shipment.id,
    poNumber: shipment.po_number,
    carrier: shipment.carrier,
    status,
    eta: shipment.eta,
    driftMinutes: toNumber(shipment.drift_minutes, 0),
    createdAt: shipment.created_at,
    updatedAt: shipment.updated_at,
    trackingNumber: shipment.tracking_number,
    atRisk,
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
  eta?: Date | string | null;
  trackingNumber?: string | null;
  actor?: string;
}) {
  const existing = await getOperationalShipmentDetail(input.shipmentId);
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (input.carrier !== undefined) {
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
  if (sets.length === 0) {
    return existing;
  }
  vals.push(existing.id);
  await pool.query(
    `UPDATE shipments SET ${sets.join(", ")}, updated_at = now() WHERE id = $${n}`,
    vals,
  );
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
  const result = await pool.query<{
    id: number;
    type: string;
    severity: string;
    status: string;
    title: string;
    description: string | null;
    related_refs: Record<string, unknown>;
    assignee: string | null;
    sla_hours: number;
    comments: Array<Record<string, unknown>>;
    created_at: Date | null;
    updated_at: Date | null;
  }>(
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

  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    relatedRefs: row.related_refs || {},
    assignee: row.assignee,
    slaHours: toNumber(row.sla_hours, 24),
    comments: Array.isArray(row.comments) ? row.comments : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getOperationalExceptionDetail(idOrRef: string) {
  const id = Number(idOrRef);
  if (!Number.isFinite(id)) {
    throw new Error("exception_not_found");
  }

  const list = await listOperationalExceptions({});
  const found = list.find((exception) => exception.id === id);
  if (!found) {
    throw new Error("exception_not_found");
  }
  return found;
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

  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 200);
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
  const mismatchExceptionId = receiveResult.mismatchExceptions[0]?.id ?? null;
  steps.push({
    id: "partial-receive",
    label: "Partial receive causing mismatch",
    completed: true,
    details: `Mismatches ${receiveResult.mismatchExceptions.length}`,
  });

  const chosenExceptionId = mismatchExceptionId ?? shortageExceptionId;
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

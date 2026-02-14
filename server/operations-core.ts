import { pool } from "./db";

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

const OPERATIONAL_TABLE_DDLS = [
  `
  ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS default_location text
  `,
  `
  ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS uom text
  `,
  `
  CREATE TABLE IF NOT EXISTS inventory_positions (
    id serial PRIMARY KEY,
    sku text NOT NULL,
    location text NOT NULL,
    on_hand integer NOT NULL DEFAULT 0,
    allocated integer NOT NULL DEFAULT 0,
    updated_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (sku, location)
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS inventory_movements (
    id serial PRIMARY KEY,
    sku text NOT NULL,
    location text NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    ref text,
    created_by text,
    created_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS operational_exceptions (
    id serial PRIMARY KEY,
    type text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    status text NOT NULL DEFAULT 'open',
    title text NOT NULL,
    description text,
    related_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    assignee text,
    sla_hours integer NOT NULL DEFAULT 24,
    comments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS ops_activity_feed (
    id serial PRIMARY KEY,
    event_type text NOT NULL,
    title text NOT NULL,
    details text,
    related_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS shipments (
    id serial PRIMARY KEY,
    po_number text NOT NULL,
    carrier text,
    status text NOT NULL DEFAULT 'created',
    eta timestamp,
    drift_minutes integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS shipment_events (
    id serial PRIMARY KEY,
    shipment_id integer NOT NULL,
    status text NOT NULL,
    note text,
    event_at timestamp NOT NULL DEFAULT now()
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS integration_runs (
    id serial PRIMARY KEY,
    connector text NOT NULL,
    status text NOT NULL,
    started_at timestamp NOT NULL DEFAULT now(),
    finished_at timestamp,
    message text
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS purchase_order_events (
    id serial PRIMARY KEY,
    po_number text NOT NULL,
    event_type text NOT NULL,
    note text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp NOT NULL DEFAULT now()
  )
  `,
];

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function refsMatch(
  existing: Record<string, unknown>,
  candidate: Record<string, string | number>,
): boolean {
  for (const [key, value] of Object.entries(candidate)) {
    if (existing[key] !== value) {
      return false;
    }
  }
  return true;
}

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

export async function initializeOperationalData() {
  for (const ddl of OPERATIONAL_TABLE_DDLS) {
    await pool.query(ddl);
  }

  await pool.query(`
    INSERT INTO inventory_positions (sku, location, on_hand, allocated, updated_at)
    SELECT
      i.sku,
      COALESCE(NULLIF(i.default_location, ''), NULLIF(i.location, ''), 'Main Warehouse') AS location,
      COALESCE(i.quantity, 0) AS on_hand,
      0 AS allocated,
      now()
    FROM inventory_items i
    ON CONFLICT (sku, location) DO NOTHING
  `);

  const shipmentCountResult = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM shipments`,
  );
  const shipmentCount = Number(shipmentCountResult.rows[0]?.count ?? "0");

  if (shipmentCount === 0) {
    await pool.query(`
      INSERT INTO shipments (po_number, carrier, status, eta, created_at, updated_at)
      SELECT
        po.order_number,
        'Demo Carrier',
        CASE
          WHEN lower(po.status) = 'received' THEN 'delivered'
          WHEN lower(po.status) IN ('approved', 'sent') THEN 'in_transit'
          ELSE 'created'
        END AS status,
        now() + interval '2 days' AS eta,
        now(),
        now()
      FROM purchase_orders po
      ORDER BY po.created_at DESC
      LIMIT 10
    `);
  }
}

export async function listOperationalInventory(filters: InventoryFilterInput) {
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

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
    category_id: number | null;
    quantity: number | null;
    low_stock_threshold: number | null;
    location: string | null;
    default_location: string | null;
    updated_at: Date | null;
  }>(
    `
    SELECT
      i.id,
      i.sku,
      i.name,
      i.category_id,
      i.quantity,
      i.low_stock_threshold,
      i.location,
      i.default_location,
      i.updated_at
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
        categoryId: row.category_id,
        quantity: fallbackOnHand,
        lowStockThreshold,
        location,
        onHand,
        allocated,
        available,
        updatedAt: aggregate?.updatedAt ?? row.updated_at,
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
        LIMIT 1
        `,
        [numericId],
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
    LIMIT 1
    `,
    [identifier],
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

  await logActivity(
    "inventory_adjustment",
    `Adjusted ${item.sku} by ${input.delta > 0 ? "+" : ""}${input.delta}`,
    `${input.reason}${input.ref ? ` (ref: ${input.ref})` : ""}`,
    { sku: item.sku, location: normalizedLocation },
  );

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
};

type ReceivePurchaseLineInput = {
  sku: string;
  qty_received_now: number;
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
  }>(
    `
    SELECT
      pol.id,
      pol.item_id,
      pol.quantity,
      pol.received_quantity,
      pol.unit_price,
      i.sku,
      i.name AS item_name
    FROM purchase_order_items pol
    LEFT JOIN inventory_items i ON i.id = pol.item_id
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
      qtyOrdered,
      qtyReceived,
      unitPrice: toNumber(line.unit_price, 0),
      expectedRemaining: Math.max(qtyOrdered - qtyReceived, 0),
    };
  });
}

async function getPurchaseOrderShipments(poNumber: string): Promise<PurchaseOrderShipment[]> {
  const shipmentResult = await pool.query<{
    id: number;
    carrier: string | null;
    status: string;
    eta: Date | null;
    drift_minutes: number;
    updated_at: Date | null;
  }>(
    `
    SELECT id, carrier, status, eta, drift_minutes, updated_at
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

  await logActivity(
    "po_status_transition",
    `PO ${order.order_number} moved to ${toStatus}`,
    `${currentStatus} -> ${toStatus}`,
    { po_number: order.order_number },
  );

  const updated = await getOperationalPurchaseOrderDetail(order.order_number);
  if (!updated) {
    throw new Error("po_not_found");
  }
  return updated;
}

export async function receiveOperationalPurchaseOrder(
  poOrId: string,
  lines: ReceivePurchaseLineInput[],
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

  await logActivity(
    "po_receive",
    `PO ${order.order_number} received`,
    `Received ${lines.length} line(s)`,
    { po_number: order.order_number },
  );

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

export async function getOperationalExceptionSummary() {
  const result = await pool.query<{
    users: number;
    warehouses: number;
    suppliers: number;
    items: number;
    settings: number;
  }>(
    `
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM warehouses) AS warehouses,
      (SELECT count(*)::int FROM suppliers) AS suppliers,
      (SELECT count(*)::int FROM inventory_items) AS items,
      (SELECT count(*)::int FROM app_settings) AS settings
    `,
  );

  return result.rows[0];
}

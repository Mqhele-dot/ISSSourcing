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

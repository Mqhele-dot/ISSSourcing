/**
 * Canonical operational availability. This is not quality-eligible allocation stock.
 * Parameter $1 is always organization id; optional warehouseParam identifies the
 * parameter containing a warehouse id.
 */
import { operationalStockThresholdSql } from "./stock-threshold";
export function operationalStockBaseSql(warehouseParam?:number){
  const warehouse=warehouseParam?` AND ($${warehouseParam}::int IS NULL OR wi.warehouse_id=$${warehouseParam})`:"";
  const attributedAllocation=warehouseParam?` AND ($${warehouseParam}::int IS NULL OR warehouse_id=$${warehouseParam})`:"";
  const unattributed=warehouseParam?`, unattributed_allocations AS (
    SELECT item_id::text AS item_key,COALESCE(SUM(quantity),0)::numeric AS quantity
    FROM inventory_allocations WHERE organization_id=$1 AND status='reserved' AND warehouse_id IS NULL AND $${warehouseParam}::int IS NOT NULL GROUP BY item_id::text
  )`:"";
  return `WITH warehouse_totals AS (
    SELECT wi.item_id::text AS item_key,SUM(wi.quantity)::numeric AS quantity,COUNT(*)::int AS positions,
      MIN(COALESCE(wi.location,w.location)) AS location,MAX(wi.updated_at) AS updated_at
    FROM warehouse_inventory wi JOIN warehouses w ON w.id=wi.warehouse_id AND w.organization_id=wi.organization_id
    WHERE wi.organization_id=$1${warehouse} GROUP BY wi.item_id::text
  ), allocation_totals AS (
    SELECT item_id::text AS item_key,COALESCE(SUM(quantity),0)::numeric AS quantity
    FROM inventory_allocations WHERE organization_id=$1 AND status='reserved'${attributedAllocation} GROUP BY item_id::text
  )${unattributed}, latest_movements AS (
    SELECT DISTINCT ON(item_id::text) item_id::text AS item_key,type::text AS reason,timestamp
    FROM stock_movements WHERE organization_id=$1 ORDER BY item_id::text,timestamp DESC,id DESC
  ), base AS (
    SELECT i.id,i.name,i.sku,i.category_id,i.supplier_id,COALESCE(i.quantity,0)::numeric AS quantity,
      COALESCE(i.price,0) AS price,COALESCE(i.cost,i.price,0) AS valuation_rate,i.expiry_date,
      ${operationalStockThresholdSql}::numeric AS low_stock_threshold,
      COALESCE(wt.quantity,0)::numeric AS warehouse_quantity,
      ${warehouseParam?`CASE WHEN $${warehouseParam}::int IS NULL AND wt.item_key IS NULL THEN COALESCE(i.quantity,0)::numeric WHEN $${warehouseParam}::int IS NULL THEN GREATEST(COALESCE(i.quantity,0)-wt.quantity,0)::numeric ELSE 0::numeric END`:"CASE WHEN wt.item_key IS NULL THEN COALESCE(i.quantity,0)::numeric ELSE GREATEST(COALESCE(i.quantity,0)-wt.quantity,0)::numeric END"} AS unassigned_quantity,
      ${warehouseParam?`CASE WHEN $${warehouseParam}::int IS NULL AND wt.item_key IS NULL THEN COALESCE(i.quantity,0)::numeric ELSE COALESCE(wt.quantity,0)::numeric END`:"CASE WHEN wt.item_key IS NULL THEN COALESCE(i.quantity,0)::numeric ELSE wt.quantity END"} AS on_hand,
      COALESCE(at.quantity,0)::numeric AS allocated,
      (CASE WHEN COALESCE((to_jsonb(i)->>'safety_hold')::boolean,false) THEN 0 ELSE
        ${warehouseParam?`CASE WHEN $${warehouseParam}::int IS NULL AND wt.item_key IS NULL THEN COALESCE(i.quantity,0) ELSE COALESCE(wt.quantity,0) END`:"CASE WHEN wt.item_key IS NULL THEN COALESCE(i.quantity,0) ELSE wt.quantity END"}-COALESCE(at.quantity,0) END)::numeric AS available,
      COALESCE(wt.positions,0)::int AS warehouse_position_count,
      ${warehouseParam?`CASE WHEN $${warehouseParam}::int IS NULL THEN (wt.item_key IS NOT NULL AND COALESCE(i.quantity,0)<>wt.quantity) ELSE false END`:"(wt.item_key IS NOT NULL AND COALESCE(i.quantity,0)<>wt.quantity)"} AS has_quantity_mismatch,
      ${warehouseParam?"COALESCE(ua.quantity,0)>0":"false"} AS incomplete_reservation_evidence,
      COALESCE((to_jsonb(i)->>'safety_hold')::boolean,false) AS safety_hold,
      COALESCE(wt.location,i.default_location,i.location) AS location,lm.timestamp AS last_movement_at,
      lm.reason AS last_movement_reason,GREATEST(i.updated_at,wt.updated_at,lm.timestamp) AS updated_at
    FROM inventory_items i LEFT JOIN warehouse_totals wt ON wt.item_key=i.id::text
    LEFT JOIN allocation_totals at ON at.item_key=i.id::text
    ${warehouseParam?"LEFT JOIN unattributed_allocations ua ON ua.item_key=i.id::text":""}
    LEFT JOIN latest_movements lm ON lm.item_key=i.id::text
    WHERE i.organization_id=$1 AND lower(COALESCE(i.status,'active'))='active'
  )`;
}

export const INVENTORY_BASE_SQL=operationalStockBaseSql();

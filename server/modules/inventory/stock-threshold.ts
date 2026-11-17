/** An explicit low-stock threshold takes precedence, including an explicit zero. */
export function operationalStockThreshold(lowStock: unknown, reorderPoint: unknown): number {
  return Number(lowStock ?? reorderPoint ?? 0);
}
export const operationalStockThresholdSql = "COALESCE(i.low_stock_threshold,i.reorder_point,0)";

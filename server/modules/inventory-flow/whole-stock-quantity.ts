/** Transitional guard while canonical warehouse balances still use integer columns. */
export function wholeStockQuantity(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error("INVALID_STOCK_QUANTITY");
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) throw new Error("INVALID_STOCK_QUANTITY_PRECISION");
  return quantity;
}

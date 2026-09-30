type PoLine = { id: number; itemId: number | null; receivedQuantity: unknown };
type ReceiptLine = { purchaseOrderItemId: number | null; itemId: number | null; acceptedQuantity: unknown; quantity: unknown };

function quantity(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Never let receipts for one PO line satisfy another line for the same SKU. */
export function receiptEvidenceByPoLine(poLines: PoLine[], receipts: ReceiptLine[], allowLegacyFallback = true) {
  const totals = new Map<number, number>();
  const byId = new Map(poLines.map(line => [line.id, line]));
  const byItem = new Map<number, PoLine[]>();
  for (const line of poLines) {
    if (line.itemId != null) byItem.set(line.itemId, [...(byItem.get(line.itemId) ?? []), line]);
  }
  for (const receipt of receipts) {
    const candidates = receipt.itemId == null ? [] : byItem.get(receipt.itemId) ?? [];
    const line = receipt.purchaseOrderItemId != null
      ? byId.get(receipt.purchaseOrderItemId)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (!line || line.itemId !== receipt.itemId) continue;
    totals.set(line.id, (totals.get(line.id) ?? 0) + quantity(receipt.acceptedQuantity ?? receipt.quantity));
  }
  // Compatibility for pre-GRN orders only. Once receipt evidence exists, missing
  // line evidence must not silently fall back to a possibly stale PO aggregate.
  if (receipts.length === 0 && allowLegacyFallback) {
    for (const line of poLines) totals.set(line.id, quantity(line.receivedQuantity));
  }
  return totals;
}

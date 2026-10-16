/**
 * Pure filter predicates — mirror client/server behavior for automated checks.
 */

export function inventoryMatchesSearch(item: { sku: string; name: string }, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return item.sku.toLowerCase().includes(n) || item.name.toLowerCase().includes(n);
}

export function inventoryMatchesLocation(item: { location: string | null | undefined }, location: string): boolean {
  const want = location.trim().toLowerCase();
  if (!want) return true;
  return (item.location ?? "").trim().toLowerCase() === want;
}

export function inventoryMatchesCategoryId(item: { categoryId?: number | null }, categoryId: string): boolean {
  const id = categoryId.trim();
  if (!id) return true;
  const n = Number(id);
  if (!Number.isFinite(n)) return false;
  return item.categoryId === n;
}

export function inventoryMatchesLowStock(item: { available: number; lowStockThreshold: number }): boolean {
  return item.available <= item.lowStockThreshold;
}

export function purchaseOrderMatchesStatus(
  order: { status: string },
  statusFilter: string,
): boolean {
  const f = statusFilter.trim().toLowerCase();
  if (!f) return true;
  return String(order.status).toLowerCase() === f;
}

export function purchaseOrderMatchesSupplier(
  order: { supplierId: number },
  supplierId: number | null,
): boolean {
  if (supplierId == null) return true;
  return order.supplierId === supplierId;
}

export function requisitionMatchesStatus(req: { status: string }, statusFilter: string): boolean {
  const f = statusFilter.trim().toUpperCase();
  if (!f) return true;
  return String(req.status).toUpperCase() === f;
}

export function supplierMatchesSearch(sup: { name: string; id: number }, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return sup.name.toLowerCase().includes(n) || String(sup.id).includes(n);
}

export function contractMatchesStatus(contract: { status: string }, statusFilter: string): boolean {
  const f = statusFilter.trim().toLowerCase();
  if (!f) return true;
  return String(contract.status).toLowerCase() === f;
}

export function apInvoiceMatchesStatus(inv: { status: string }, statusFilter: string)
: boolean {
  const f = statusFilter.trim().toUpperCase();
  if (!f) return true;
  return String(inv.status).toUpperCase() === f;
}

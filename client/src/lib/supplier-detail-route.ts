import { APP_ROUTES } from "@/lib/routes/app-routes";

/** Must match `ProtectedRoute` path for supplier detail (wouter `:id` segment). */
export const SUPPLIER_DETAIL_ROUTE_PATTERN = "/procurement/suppliers/:id" as const;

export type ParsedSupplierRouteId = { ok: true; id: number } | { ok: false };

/** Parse `:id` from the supplier detail route (shared by page + tests). */
export function parseSupplierRouteId(raw: string | undefined): ParsedSupplierRouteId {
  if (raw == null || raw === "") return { ok: false };
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id) || id <= 0) return { ok: false };
  return { ok: true, id };
}

export function supplierDetailHref(id: string | number): string {
  return APP_ROUTES.procurement.supplier(id);
}

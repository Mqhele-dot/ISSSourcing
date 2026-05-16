/**
 * Normalization for logistics shipment list filters (GET /api/logistics/shipments).
 * Used by the API route, `listOperationalShipments`, and the client fetch layer so
 * `meta.appliedFilters` matches the effective query parameters.
 */

export type ShipmentListFiltersNormalized = {
  status: string;
  po: string;
  supplier: string;
  carrier: string;
  risk: string;
  etaFrom: string;
  etaTo: string;
  tracking: string;
};

const RISK_BUCKETS = new Set(["late", "no_eta", "due_soon", "exception", "on_time"]);

function trimStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Idempotent: trims pattern fields, lowercases substring-match dimensions (status/po/supplier/carrier/tracking),
 * preserves eta bounds as trimmed strings (validated separately), and drops unknown risk tokens.
 */
export function normalizeShipmentFilters(
  input: Partial<ShipmentListFiltersNormalized> | Record<string, unknown>,
): ShipmentListFiltersNormalized {
  const riskRaw = trimStr((input as { risk?: unknown }).risk).toLowerCase();
  return {
    status: trimStr((input as { status?: unknown }).status).toLowerCase(),
    po: trimStr((input as { po?: unknown }).po).toLowerCase(),
    supplier: trimStr((input as { supplier?: unknown }).supplier).toLowerCase(),
    carrier: trimStr((input as { carrier?: unknown }).carrier).toLowerCase(),
    risk: RISK_BUCKETS.has(riskRaw) ? riskRaw : "",
    etaFrom: trimStr((input as { etaFrom?: unknown }).etaFrom),
    etaTo: trimStr((input as { etaTo?: unknown }).etaTo),
    tracking: trimStr((input as { tracking?: unknown }).tracking).toLowerCase(),
  };
}

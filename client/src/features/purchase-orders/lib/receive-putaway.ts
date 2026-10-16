/**
 * Client-side validation for structured PO receive putaway (warehouse → aisle → bin).
 * Server remains authoritative; this mirrors resolve rules for UX.
 */

export type ReceivePutawayWarehouse = {
  id: number;
  name: string;
  isDefault?: boolean | null;
  aisles?: string[] | null;
  bins?: Array<{ code: string; aisle?: string | null }> | null;
};

export type ReceivePutawayState = {
  warehouseId: number | null;
  aisle: string;
  binCode: string;
};

export function normalizePutawayBins(
  warehouse: ReceivePutawayWarehouse | undefined,
  aisleTrimmed: string,
): Array<{ code: string; aisle: string }> {
  if (!warehouse?.bins?.length) return [];
  const aisles = Array.isArray(warehouse.aisles) ? warehouse.aisles : [];
  const normalized = warehouse.bins
    .map((b) => ({
      code: String(b.code ?? "").trim(),
      aisle: b.aisle != null ? String(b.aisle).trim() : "",
    }))
    .filter((b) => b.code.length > 0);
  if (aisles.length === 0) return normalized;
  if (!aisleTrimmed) return [];
  return normalized.filter((b) => !b.aisle || b.aisle === aisleTrimmed);
}

export type ValidateReceivePutawayResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateReceivePutaway(
  warehouses: ReceivePutawayWarehouse[],
  state: ReceivePutawayState,
): ValidateReceivePutawayResult {
  if (state.warehouseId == null || !Number.isFinite(state.warehouseId)) {
    return { ok: false, message: "Select a warehouse to receive into." };
  }
  const wh = warehouses.find((w) => w.id === state.warehouseId);
  if (!wh) {
    return { ok: false, message: "Selected warehouse is not available." };
  }
  const aisles = Array.isArray(wh.aisles) ? wh.aisles.map((a) => String(a)) : [];
  const aisleTrimmed = String(state.aisle ?? "").trim();
  if (aisles.length > 0) {
    if (!aisleTrimmed || !aisles.includes(aisleTrimmed)) {
      return { ok: false, message: "Select an aisle from this warehouse." };
    }
  }
  const rawBins = Array.isArray(wh.bins) ? wh.bins : [];
  const normalizedBins = rawBins
    .map((b) => ({
      code: String(b.code ?? "").trim(),
      aisle: b.aisle != null ? String(b.aisle).trim() : "",
    }))
    .filter((b) => b.code.length > 0);

  let binsFiltered = normalizedBins;
  if (aisles.length > 0 && aisleTrimmed) {
    binsFiltered = normalizedBins.filter((b) => !b.aisle || b.aisle === aisleTrimmed);
  }

  if (normalizedBins.length > 0 && aisles.length > 0 && aisleTrimmed && binsFiltered.length === 0) {
    return {
      ok: false,
      message: "This aisle has no bins configured. Add bins for this aisle in warehouse master data.",
    };
  }

  const binTrimmed = String(state.binCode ?? "").trim();
  if (binsFiltered.length > 0) {
    if (!binTrimmed || !binsFiltered.some((b) => b.code === binTrimmed)) {
      return { ok: false, message: "Select a bin from this warehouse (and aisle, if applicable)." };
    }
  }

  return { ok: true };
}

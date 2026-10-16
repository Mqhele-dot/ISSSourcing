/** Reserved key for structured exception metadata inside `related_refs` (JSON). */
export const OPERATIONAL_EXCEPTION_CONTEXT_KEY = "_invtrack" as const;

const LEGACY_EXCEPTION_CODE_MAP: Record<string, string> = {
  late_shipment: "late_shipment",
  stock_shortage: "stock_shortage",
  inventory_shortage: "stock_shortage",
  shipment_no_eta: "shipment_no_eta",
  contract_violation: "contract_violation",
  po_mismatch: "po_mismatch",
  receive_mismatch: "po_mismatch",
};

export function normalizeOperationalExceptionCode(rawType: string): string {
  const key = rawType.trim().toLowerCase();
  return LEGACY_EXCEPTION_CODE_MAP[key] ?? key;
}

export function inferOperationalExceptionArea(rawType: string): string {
  const code = normalizeOperationalExceptionCode(rawType);
  if (code === "late_shipment" || code === "shipment_no_eta") return "logistics";
  if (code === "stock_shortage" || code === "inventory_shortage") return "inventory";
  if (code === "contract_violation") return "procurement";
  if (code === "po_mismatch") return "procurement";
  return "operations";
}

type RelatedRefsInput = Record<string, string | number>;

function readOptionalString(refs: RelatedRefsInput, key: string): string | null {
  const v = refs[key as keyof RelatedRefsInput];
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export function buildOperationalExceptionInvtrackContext(
  type: string,
  relatedRefs: RelatedRefsInput,
): Record<string, unknown> {
  const exceptionCode = normalizeOperationalExceptionCode(type);
  const area = inferOperationalExceptionArea(type);
  let rootEntityType: string | null = null;
  let rootEntityId: string | null = null;
  if (typeof relatedRefs.shipment_id === "number") {
    rootEntityType = "shipment";
    rootEntityId = String(relatedRefs.shipment_id);
  } else if (typeof relatedRefs.po_number === "string") {
    rootEntityType = "purchase_order";
    rootEntityId = relatedRefs.po_number;
  } else if (typeof relatedRefs.sku === "string") {
    rootEntityType = "inventory_item";
    rootEntityId = relatedRefs.sku;
  }
  return {
    area,
    exceptionCode,
    rootEntityType,
    rootEntityId,
    detectedAt: new Date().toISOString(),
    supplierName: readOptionalString(relatedRefs, "supplier_name") ?? readOptionalString(relatedRefs, "supplierName"),
    poNumber: typeof relatedRefs.po_number === "string" ? relatedRefs.po_number : null,
    shipmentId: typeof relatedRefs.shipment_id === "number" ? relatedRefs.shipment_id : null,
    itemSku: typeof relatedRefs.sku === "string" ? relatedRefs.sku : null,
  };
}

export function mergeOperationalExceptionRelatedRefs(
  relatedRefs: RelatedRefsInput,
  type: string,
): Record<string, unknown> {
  return {
    ...relatedRefs,
    [OPERATIONAL_EXCEPTION_CONTEXT_KEY]: buildOperationalExceptionInvtrackContext(type, relatedRefs),
  };
}

export function parseInvtrackFromRelatedRefs(
  relatedRefs: Record<string, unknown>,
): Record<string, unknown> {
  const raw = relatedRefs[OPERATIONAL_EXCEPTION_CONTEXT_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

import type { PurchaseOrderDetail, PurchaseOrderDetailLine, PurchaseOrderShipment } from "@/api/types";

function pickNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickStr(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function pickNullableStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizeDetailLine(ln: Record<string, unknown>): PurchaseOrderDetailLine {
  const explicit = ln.serialTrackingRequired ?? ln.serial_tracking_required;
  const serialReq =
    explicit === true ||
    explicit === 1 ||
    ln.serialTrackingRequired === true ||
    ln.serial_tracking_required === true;
  const serialTrackingRequired: boolean | null = serialReq
    ? true
    : explicit === false || explicit === 0
      ? false
      : null;

  return {
    id: pickNum(ln.id ?? ln.line_id, 0),
    itemId: pickNum(ln.itemId ?? ln.item_id, 0),
    sku: pickStr(ln.sku),
    itemName: pickStr(ln.itemName ?? ln.item_name ?? ln.name),
    supplierPartNumber: pickNullableStr(ln.supplierPartNumber ?? ln.supplier_part_number),
    commodityCode: pickNullableStr(ln.commodityCode ?? ln.commodity_code),
    commodityDescription: pickNullableStr(ln.commodityDescription ?? ln.commodity_description),
    qtyOrdered: pickNum(ln.qtyOrdered ?? ln.qty_ordered, 0),
    qtyReceived: pickNum(ln.qtyReceived ?? ln.qty_received, 0),
    unitPrice: pickNum(ln.unitPrice ?? ln.unit_price, 0),
    expectedRemaining: pickNum(ln.expectedRemaining ?? ln.expected_remaining, 0),
    serialTrackingRequired,
  };
}

function normalizeShipment(s: Record<string, unknown>): PurchaseOrderShipment {
  return {
    id: pickNum(s.id, 0),
    carrier: pickNullableStr(s.carrier),
    status: pickStr(s.status),
    eta: pickNullableStr(s.eta),
    driftMinutes: pickNum(s.driftMinutes ?? s.drift_minutes, 0),
    updatedAt: pickNullableStr(s.updatedAt ?? s.updated_at),
    trackingNumber: pickNullableStr(s.trackingNumber ?? s.tracking_number),
  };
}

export function normalizePurchaseOrderDetail(raw: unknown): PurchaseOrderDetail {
  const r = asRecord(raw);
  const rawLines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : [];
  const lines: PurchaseOrderDetailLine[] = rawLines.map((ln) => normalizeDetailLine(asRecord(ln)));

  const rawShipments = Array.isArray(r.shipments) ? (r.shipments as Record<string, unknown>[]) : [];
  const shipments: PurchaseOrderShipment[] = rawShipments.map((s) => normalizeShipment(asRecord(s)));

  const prog = asRecord(r.progress);
  const qtyOrdered = pickNum(prog.qtyOrdered ?? prog.qty_ordered, 0);
  const qtyReceived = pickNum(prog.qtyReceived ?? prog.qty_received, 0);
  const percentRaw = prog.percent;
  const percent =
    typeof percentRaw === "number" && Number.isFinite(percentRaw)
      ? percentRaw
      : qtyOrdered > 0
        ? Math.round((qtyReceived / qtyOrdered) * 100)
        : 0;

  return {
    id: pickNum(r.id, 0),
    poNumber: pickStr(r.poNumber ?? r.po_number),
    supplierId: pickNum(r.supplierId ?? r.supplier_id, 0),
    supplierName: pickNullableStr(r.supplierName ?? r.supplier_name),
    status: pickStr(r.status),
    requestedDate: pickNullableStr(r.requestedDate ?? r.requested_date),
    createdAt: pickNullableStr(r.createdAt ?? r.created_at),
    totalAmount: pickNum(r.totalAmount ?? r.total_amount, 0),
    lines,
    shipments,
    progress: { qtyOrdered, qtyReceived, percent },
  };
}

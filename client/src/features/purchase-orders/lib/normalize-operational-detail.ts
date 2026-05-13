import type { PurchaseOrderDetail } from "@/api/types";

export function normalizePurchaseOrderDetail(raw: unknown): PurchaseOrderDetail {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawLines = Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : [];
  const lines: PurchaseOrderDetail["lines"] = rawLines.map((ln) => {
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
      ...(ln as PurchaseOrderDetail["lines"][number]),
      serialTrackingRequired,
    };
  });
  const shipments = Array.isArray(r.shipments) ? (r.shipments as PurchaseOrderDetail["shipments"]) : [];
  const prog = r.progress && typeof r.progress === "object" ? (r.progress as Record<string, unknown>) : {};
  const qtyOrdered = Number(prog.qtyOrdered ?? 0);
  const qtyReceived = Number(prog.qtyReceived ?? 0);
  const percentRaw = prog.percent;
  const percent =
    typeof percentRaw === "number" && Number.isFinite(percentRaw)
      ? percentRaw
      : qtyOrdered > 0
        ? Math.round((qtyReceived / qtyOrdered) * 100)
        : 0;
  return {
    id: Number(r.id ?? 0),
    poNumber: String(r.poNumber ?? ""),
    supplierId: Number(r.supplierId ?? 0),
    supplierName: (r.supplierName as string | null) ?? null,
    status: String(r.status ?? ""),
    requestedDate: (r.requestedDate as string | null) ?? null,
    createdAt: (r.createdAt as string | null) ?? null,
    totalAmount: Number(r.totalAmount ?? 0),
    lines,
    shipments,
    progress: { qtyOrdered, qtyReceived, percent },
  };
}

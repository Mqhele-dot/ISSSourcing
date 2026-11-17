import { getOperationalControlTowerOverview } from "./operations-core";

export type SupplyInsight = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  href?: string;
};

/**
 * Rule-based operational insights (no LLM). Satisfies "optional AI" roadmap row as heuristic layer.
 */
export async function buildSupplyInsights(): Promise<{ generatedAt: string; insights: SupplyInsight[] }> {
  const ct = await getOperationalControlTowerOverview();
  const kpis = ct.kpis;
  const insights: SupplyInsight[] = [];

  const low = kpis.lowStockSkus ?? 0;
  if (low > 0) {
    insights.push({
      id: "low-stock",
      severity: low > 10 ? "critical" : "warning",
      title: `${low} SKU(s) at or below threshold`,
      detail: "Review reorder points and open purchase requisitions.",
      href: "/inventory?filter=low-stock",
    });
  }

  const late = kpis.lateShipments ?? 0;
  if (late > 0) {
    insights.push({
      id: "late-shipments",
      severity: "warning",
      title: `${late} shipment(s) past ETA`,
      detail: "Confirm carrier updates or create logistics exceptions.",
      href: "/logistics?risk=late",
    });
  }

  const poAct = kpis.posAwaitingAction ?? 0;
  if (poAct > 0) {
    insights.push({
      id: "po-action",
      severity: "info",
      title: `${poAct} purchase order(s) awaiting send/receive`,
      detail: "Approved POs still need to be sent or progressed.",
      href: "/purchase?status=approved",
    });
  }

  const ex = kpis.exceptionsBySeverity ?? {};
  const totalFromKpi = (kpis as { openExceptionsTotal?: number }).openExceptionsTotal;
  const openEx =
    typeof totalFromKpi === "number"
      ? totalFromKpi
      : Object.values(ex).reduce((a, b) => a + Number(b ?? 0), 0);
  if (openEx > 0) {
    insights.push({
      id: "open-exceptions",
      severity: "warning",
      title: `${openEx} open exception(s)`,
      detail: "Triage by severity on the Exceptions page.",
      href: "/exceptions?status=open",
    });
  }

  const pendReq = Number((kpis as { pendingRequisitions?: number }).pendingRequisitions ?? 0);
  if (pendReq > 0) {
    insights.push({
      id: "pending-requisitions",
      severity: pendReq > 5 ? "warning" : "info",
      title: `${pendReq} requisition(s) awaiting approval`,
      detail: "Review pending and draft requisitions in the Requisitions workspace.",
      href: "/requisitions",
    });
  }

  const overdueInv = Number((kpis as { overdueInvoices?: number }).overdueInvoices ?? 0);
  if (overdueInv > 0) {
    insights.push({
      id: "overdue-invoices",
      severity: "warning",
      title: `${overdueInv} invoice(s) overdue`,
      detail: "Follow up on AP / supplier invoices marked OVERDUE.",
      href: "/invoices",
    });
  }

  const inTransit = Number((kpis as { inTransitShipments?: number }).inTransitShipments ?? 0);
  if (inTransit > 0) {
    insights.push({
      id: "in-transit",
      severity: "info",
      title: `${inTransit} active shipment(s)`,
      detail: "Monitor ETAs and tracking on the Logistics page.",
      href: "/logistics",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "all-clear",
      severity: "info",
      title: "No critical supply signals",
      detail: "Control tower KPIs are within normal ranges right now.",
      href: "/control-tower",
    });
  }

  return { generatedAt: new Date().toISOString(), insights };
}

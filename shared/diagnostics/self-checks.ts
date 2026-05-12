import {
  calculateAvailable,
  invoicePayableCents,
  sumMoneyCents,
  sumSelectedInvoicePayableCents,
} from "../functional-calculations";
import {
  apInvoiceMatchesStatus,
  inventoryMatchesSearch,
  purchaseOrderMatchesStatus,
} from "../functional-filters";
import {
  slowApiDiagnosticDedupeKey,
  SLOW_API_DIAGNOSTIC_TITLE,
  isSlowApiDiagnosticEvent,
} from "./event-dedupe";
import { expectedSelectorsForRoute } from "../../client/src/lib/diagnostics/route-diagnostics";

export type SelfCheckResult = {
  id: string;
  name: string;
  ok: boolean;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export type SelfCheckReport = {
  generatedAt: string;
  passed: number;
  failed: number;
  checks: SelfCheckResult[];
};

function check(id: string, name: string, actual: unknown, expected: unknown, message: string): SelfCheckResult {
  const ok = Object.is(actual, expected);
  return { id, name, ok, message: ok ? message : `${message} Expected ${String(expected)}, got ${String(actual)}.`, expected, actual };
}

export function runDiagnosticsSelfChecks(): SelfCheckReport {
  const invoices = [
    { id: 1, total: 20, dueAmount: 12.5 },
    { id: 2, total: 15.5, dueAmount: null },
  ];
  const checks: SelfCheckResult[] = [
    check(
      "money-cents",
      "Money cents aggregation",
      sumMoneyCents([0.1, 0.2]).toString(),
      "30",
      "0.1 + 0.2 is aggregated as 30 cents.",
    ),
    check(
      "inventory-available",
      "Inventory available calculation",
      calculateAvailable(10, 3),
      7,
      "Available stock is on hand minus allocated.",
    ),
    check(
      "negative-availability",
      "Negative availability preserved",
      calculateAvailable(2, 5),
      -3,
      "Negative availability remains visible for operational triage.",
    ),
    check(
      "ap-due-fallback",
      "AP due amount fallback",
      invoicePayableCents(15.5, null).toString(),
      "1550",
      "AP payable cents uses total when due amount is absent.",
    ),
    check(
      "ap-selection-dedupe",
      "Duplicate invoice selection not double-counted",
      sumSelectedInvoicePayableCents(invoices, [1, 1, 2]).toString(),
      "2800",
      "Repeated selected invoice IDs count once.",
    ),
    check(
      "inventory-search",
      "Inventory search predicate",
      inventoryMatchesSearch({ sku: "PEN-BP-12", name: "Blue Pen" }, "bp-12"),
      true,
      "Inventory search matches SKU fragments.",
    ),
    check(
      "po-status",
      "PO status predicate",
      purchaseOrderMatchesStatus({ status: "approved" }, "APPROVED"),
      true,
      "PO status filtering is case-insensitive.",
    ),
    check(
      "ap-status",
      "AP status predicate",
      apInvoiceMatchesStatus({ status: "PENDING_APPROVAL" }, "pending_approval"),
      true,
      "AP invoice status filtering normalizes case.",
    ),
    check(
      "slow-api-dedupe-key",
      "Slow API diagnostics dedupe key stable",
      slowApiDiagnosticDedupeKey("/api/activity", "GET") === slowApiDiagnosticDedupeKey("/api/activity", "GET"),
      true,
      "Slow API diagnostics dedupe key is stable for same endpoint.",
    ),
    check(
      "slow-api-flag",
      "Slow API diagnostic detection",
      isSlowApiDiagnosticEvent({ source: "api", title: SLOW_API_DIAGNOSTIC_TITLE, endpoint: "/api/activity" }),
      true,
      "isSlowApiDiagnosticEvent matches slow API rows.",
    ),
    check(
      "route-system-diagnostics",
      "System diagnostics route contract",
      expectedSelectorsForRoute("/admin/system-diagnostics").includes(`[data-testid="system-diagnostics-page"]`),
      true,
      "Route diagnostics expects system-diagnostics page marker.",
    ),
    check(
      "route-control-tower",
      "Control tower route contract",
      expectedSelectorsForRoute("/operations/control-tower").includes(`[data-testid="control-tower-page"]`),
      true,
      "Route diagnostics expects control-tower page marker.",
    ),
  ];
  const failed = checks.filter((row) => !row.ok).length;
  return {
    generatedAt: new Date().toISOString(),
    passed: checks.length - failed,
    failed,
    checks,
  };
}

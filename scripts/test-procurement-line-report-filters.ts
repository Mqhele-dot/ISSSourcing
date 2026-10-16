import assert from "node:assert/strict";
import { normalizeProcurementDocumentNumberFilter, serializeProcurementLineReportFilters } from "../client/src/pages/reports/procurement-line-report-filters.ts";
import type { ReportFilter } from "../shared/schema.ts";

function main() {
  assert.equal(normalizeProcurementDocumentNumberFilter("  PO-2048  "), "PO-2048");
  assert.equal(normalizeProcurementDocumentNumberFilter("   "), undefined);

  const explicitDocumentFilter: ReportFilter = {
    documentNumber: "  PR-1009  ",
    supplierId: 7,
    projectId: 4,
    status: "APPROVED",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-07-31T23:59:59.000Z"),
  };
  assert.deepEqual(serializeProcurementLineReportFilters(explicitDocumentFilter), {
    documentNumber: "PR-1009",
    supplierId: 7,
    projectId: 4,
    status: "APPROVED",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-31T23:59:59.000Z",
  });

  const legacySearchFallback: ReportFilter = {
    search: "  PO-legacy-search  ",
    supplierId: 2,
  };
  assert.deepEqual(serializeProcurementLineReportFilters(legacySearchFallback), {
    documentNumber: "PO-legacy-search",
    supplierId: 2,
    projectId: undefined,
    status: undefined,
    startDate: undefined,
    endDate: undefined,
  });

  const explicitOverridesSearch: ReportFilter = {
    documentNumber: "PR-explicit",
    search: "PO-legacy",
  };
  assert.equal(
    serializeProcurementLineReportFilters(explicitOverridesSearch).documentNumber,
    "PR-explicit",
    "explicit documentNumber should take precedence over legacy search",
  );

  console.log("test-procurement-line-report-filters: all checks passed.");
}

main();

#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportPath = path.join(root, "docs", "PROFESSIONAL-APP-AUDIT.md");
const sourceRoots = ["client/src", "server", "shared", "scripts", "e2e"];
const ignoredDirs = new Set([".git", "node_modules", "dist", "build", "uploads", "tmp", "output", ".cache"]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function walk(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of readdirSync(absoluteDir)) {
    if (ignoredDirs.has(entry)) continue;
    const absolute = path.join(absoluteDir, entry);
    const relative = path.relative(root, absolute);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...walk(relative));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|md|json)$/i.test(entry)) {
      files.push(relative);
    }
  }
  return files;
}

function read(relativeFile) {
  return readFileSync(path.join(root, relativeFile), "utf8");
}

const files = sourceRoots.flatMap(walk);
const codeFiles = files.filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
const serverFiles = codeFiles.filter((file) => toPosix(file).startsWith("server/"));
const pageFiles = codeFiles.filter((file) => toPosix(file).startsWith("client/src/pages/"));
const routeFiles = codeFiles.filter((file) => toPosix(file).includes("/routes/"));
const testFiles = codeFiles.filter((file) => {
  const normalized = toPosix(file);
  return normalized.startsWith("scripts/test-") || normalized.startsWith("e2e/");
});
const schemaText = existsSync(path.join(root, "shared", "schema.ts")) ? read("shared/schema.ts") : "";

function parseEndpoints() {
  const endpoints = [];
  const endpointRegex = /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(?:\[([^\]]+)\]|["'`]([^"'`]+)["'`])/g;
  const stringRegex = /["'`]([^"'`]+)["'`]/g;
  for (const file of serverFiles) {
    const text = read(file);
    for (const match of text.matchAll(endpointRegex)) {
      const method = match[1].toUpperCase();
      if (match[2]) {
        for (const routeMatch of match[2].matchAll(stringRegex)) {
          endpoints.push({ method, path: routeMatch[1], file });
        }
      } else if (match[3]) {
        endpoints.push({ method, path: match[3], file });
      }
    }
  }
  return endpoints;
}

function parseTables() {
  const tables = [];
  const tableRegex = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*pgTable\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of schemaText.matchAll(tableRegex)) {
    tables.push({ symbol: match[1], table: match[2] });
  }
  return tables;
}

const endpoints = parseEndpoints();
const tables = parseTables();

const riskPatterns = [
  { label: "TODO/FIXME", regex: /\b(?:TODO|FIXME)\b/i },
  { label: "not implemented", regex: /not implemented|planned but not implemented/i },
  { label: "coming soon", regex: /coming soon/i },
  { label: "demo/mock/fake data", regex: /\b(?:mock data|fake data|demo only|stubOverview|buildEmptyControlTowerDashboard)\b/i },
  { label: "visible degraded fallback", regex: /fallback:\s*["'`]degraded["'`]|fallback:\s*getFallbackValue/i },
  { label: "manual placeholder action", regex: /would be initiated here/i },
];

function collectRiskHits() {
  const hits = [];
  for (const file of codeFiles) {
    if (toPosix(file) === "scripts/audit-professional-readiness.mjs") continue;
    const lines = read(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of riskPatterns) {
        if (pattern.regex.test(line)) {
          hits.push({
            file,
            line: index + 1,
            label: pattern.label,
            text: line.trim().slice(0, 160),
          });
        }
      }
    });
  }
  return hits;
}

const riskHits = collectRiskHits();

const modules = [
  {
    name: "Master Data & Control Centre",
    routes: ["/admin/master-data"],
    pageHints: ["master-data"],
    apiHints: ["/api/mdm", "/api/currencies", "/api/departments", "/api/warehouses", "/api/carriers"],
    tableHints: ["mdm_", "currencies", "departments", "warehouses", "carriers", "payment_terms", "tax_codes"],
    testHints: ["master-data", "diagnostics"],
    professionalProof:
      "Reference data owns defaults, validation, data-quality issues, imports, audit history, and transaction context.",
  },
  {
    name: "Requisitions",
    routes: ["/procurement/requisitions", "/procurement/requisitions/new"],
    pageHints: ["requisitions"],
    apiHints: ["/api/requisitions", "/api/extensions/projects", "/api/mdm/defaults/requisition-context"],
    tableHints: ["purchase_requisitions", "purchase_requisition_items", "mdm_approval_rules"],
    testHints: ["requisitions", "procurement-flow"],
    professionalProof:
      "New requests should consume MDM supplier/item/UOM/currency/tax/cost-centre defaults and create approval-ready transactions.",
  },
  {
    name: "Purchase Orders",
    routes: ["/procurement/orders", "/orders"],
    pageHints: ["orders", "purchase-order"],
    apiHints: ["/api/purchase-orders", "/api/procurement/purchase-orders", "/api/mdm/defaults/po-context"],
    tableHints: ["purchase_orders", "purchase_order_items", "purchase_order_revisions"],
    testHints: ["purchase-order", "procurement-flow", "po-"],
    professionalProof:
      "POs should lock supplier defaults, tax, currency/FX, approvals, receipt state, revision history, and supplier documents.",
  },
  {
    name: "Suppliers",
    routes: ["/procurement/suppliers"],
    pageHints: ["suppliers"],
    apiHints: ["/api/suppliers", "/api/contracts", "/api/mdm/supplier"],
    tableHints: ["suppliers", "supplier_contracts", "mdm_supplier_contacts", "mdm_supplier_bank_accounts", "mdm_supplier_items"],
    testHints: ["supplier"],
    professionalProof:
      "Supplier profile data should drive requisitions, POs, AP, logistics, diagnostics, exports, and risk/compliance checks.",
  },
  {
    name: "Inventory Catalogue",
    routes: ["/inventory"],
    pageHints: ["inventory"],
    apiHints: ["/api/inventory", "/api/categories", "/api/barcodes"],
    tableHints: ["inventory_items", "categories", "barcodes", "mdm_item_categories"],
    testHints: ["inventory", "custom-reports"],
    professionalProof:
      "Item creation should validate SKU uniqueness, catalogue defaults, UOM/tax/category, stock settings, and reporting dimensions.",
  },
  {
    name: "Warehouse Operations",
    routes: ["/inventory/warehouses", "/inventory/warehouse-ops", "/operations/warehouse"],
    pageHints: ["warehouse"],
    apiHints: ["/api/warehouses", "/api/warehouse-inventory", "/api/stock-movements"],
    tableHints: ["warehouses", "warehouse_inventory", "stock_movements", "inventory_batches", "inventory_serials"],
    testHints: ["master-data", "functional-inventory", "logistics"],
    professionalProof:
      "Setup belongs in MDM; receiving, putaway, transfers, movements, batches, serials, and storage belong in operations.",
  },
  {
    name: "Goods Receipt",
    routes: ["/procurement/orders/:id/receive"],
    pageHints: ["receive", "orders"],
    apiHints: ["/receive", "/api/ap/receipts", "/api/purchase-orders"],
    tableHints: ["ap_receipts", "ap_receipt_items", "stock_movements", "warehouse_inventory"],
    testHints: ["receive", "ap-workflow", "po-receive"],
    professionalProof:
      "Receipts should update inventory, receipt records, AP match state, logistics closure, and audit history transactionally.",
  },
  {
    name: "Accounts Payable",
    routes: ["/finance/accounts-payable", "/finance/invoices"],
    pageHints: ["accounts-payable", "invoices"],
    apiHints: ["/api/ap", "/api/invoices", "/api/payments"],
    tableHints: ["invoices", "invoice_items", "ap_invoice", "payments", "ap_payment"],
    testHints: ["ap-", "invoice"],
    professionalProof:
      "AP should consume PO/GRN/supplier defaults, enforce match tolerances, approval controls, payment batches, and audit trails.",
  },
  {
    name: "Logistics",
    routes: ["/operations/logistics", "/analytics/logistics"],
    pageHints: ["logistics"],
    apiHints: ["/api/logistics", "/api/shipments", "/api/carriers"],
    tableHints: ["carriers", "shipments", "purchase_orders"],
    testHints: ["logistics"],
    professionalProof:
      "Shipments should inherit suppliers/carriers, track inbound/outbound movement, update analytics, and flag orphan records.",
  },
  {
    name: "Approvals & Policies",
    routes: ["/finance/approval-policies", "/admin/user-roles"],
    pageHints: ["approval", "user-roles"],
    apiHints: ["/api/approval", "/api/rbac", "/api/user/permissions"],
    tableHints: ["approval_policies", "approval_history", "mdm_approval_rules", "permissions", "custom_roles"],
    testHints: ["rbac", "approval", "permissions"],
    professionalProof:
      "Policy and RBAC must be server-backed, data-driven, auditable, and shared across requisitions, POs, AP, exports, and admin.",
  },
  {
    name: "Reporting & Export Centre",
    routes: ["/analytics/reports", "/analytics/export-center"],
    pageHints: ["reports", "export-center", "analytics"],
    apiHints: ["/api/export", "/api/export-center", "/api/analytics"],
    tableHints: ["purchase_orders", "suppliers", "inventory_items", "stock_movements", "invoices"],
    testHints: ["exports", "reports", "custom-reports"],
    professionalProof:
      "Reports should use tenant-scoped operational data, preview columns/rows, compress large exports, and reconcile PO vs delivery data.",
  },
  {
    name: "Documents & Contracts",
    routes: ["/admin/documents", "/procurement/contracts"],
    pageHints: ["documents", "contracts"],
    apiHints: ["/api/documents", "/api/contracts"],
    tableHints: ["documents", "retention_policies", "supplier_contracts", "mdm_document"],
    testHints: ["documents", "contracts"],
    professionalProof:
      "Contracts and supplier documents should use managed versioned documents instead of freeform links wherever workflows rely on them.",
  },
  {
    name: "Diagnostics & Notifications",
    routes: ["/admin/system-diagnostics"],
    pageHints: ["diagnostics"],
    apiHints: ["/api/diagnostics", "/api/startup-diagnostics", "/api/ready", "/health"],
    tableHints: ["notifications", "mdm_data_quality_issues", "audit_logs"],
    testHints: ["diagnostics", "codespaces", "local"],
    professionalProof:
      "Diagnostics must expose startup state, data consistency, actionable guidance, notification creation, and route/API health.",
  },
  {
    name: "Mobile Stock Counts",
    routes: ["/m/counts", "/m/counts/:id", "/m/scan"],
    pageHints: ["mobile-counts", "mobile"],
    apiHints: ["/api/mobile/counts", "/api/mobile/scan/resolve", "/api/sync/batch"],
    tableHints: ["stock_count_sessions", "stock_count_lines", "stock_count_variances", "inventory_adjustments", "mobile_sync_events"],
    testHints: ["invtrack-upgrade", "sync", "mobile"],
    professionalProof:
      "Mobile counts should be scan-first, idempotent, offline-aware, plan-gated, and post inventory adjustments atomically.",
  },
  {
    name: "Subscription & Billing Entitlements",
    routes: ["/finance/billing", "/admin/settings"],
    pageHints: ["billing", "settings"],
    apiHints: ["/api/subscription", "/api/billing-settings", "/api/org/features"],
    tableHints: ["plan_definitions", "billing_customers", "billing_subscriptions", "entitlement_overrides", "usage_counters"],
    testHints: ["subscription", "billing", "org-feature"],
    professionalProof:
      "Plan limits and feature access must be backend-enforced, surfaced in UI, and driven by local entitlement state.",
  },
  {
    name: "Audit, Security & Compliance",
    routes: ["/admin/audit-logs", "/admin/settings"],
    pageHints: ["audit-logs", "settings"],
    apiHints: ["/api/audit", "/api/admin/access-logs", "/api/user/permissions"],
    tableHints: ["audit_logs", "activity_logs", "user_access_logs", "permissions", "sessions"],
    testHints: ["security", "rbac", "audit"],
    professionalProof:
      "High-risk writes need authentication, permissions, 2FA where required, redacted audit logs, and tamper-evident history.",
  },
];

function anyIncludes(value, hints) {
  const lower = value.toLowerCase();
  return hints.some((hint) => lower.includes(String(hint).toLowerCase()));
}

function matchingPages(definition) {
  return pageFiles.filter((file) => anyIncludes(toPosix(file), definition.pageHints));
}

function matchingRoutes(definition) {
  return routeFiles.filter((file) => anyIncludes(toPosix(file), definition.pageHints));
}

function matchingEndpoints(definition) {
  return endpoints.filter((endpoint) => anyIncludes(endpoint.path, definition.apiHints));
}

function matchingTables(definition) {
  return tables.filter(
    (table) => anyIncludes(table.table, definition.tableHints) || anyIncludes(table.symbol, definition.tableHints),
  );
}

function matchingTests(definition) {
  return testFiles.filter((file) => anyIncludes(toPosix(file), definition.testHints));
}

function matchingRisks(definition) {
  const hints = [...definition.pageHints, ...definition.apiHints, ...definition.tableHints, ...definition.testHints];
  return riskHits.filter((hit) => anyIncludes(toPosix(hit.file), hints) || anyIncludes(hit.text, hints));
}

function unique(values) {
  return [...new Set(values)];
}

function shortList(values, limit = 4) {
  const list = unique(values);
  if (!list.length) return "None found";
  const clipped = list.slice(0, limit);
  return clipped.join("<br>") + (list.length > limit ? `<br>+${list.length - limit} more` : "");
}

function statusFor({ pages, apis, data, tests, risks }) {
  if (!pages.length && !apis.length && !data.length) return "Missing";
  if (pages.length && !apis.length && !data.length) return "Cosmetic only";
  if (pages.length && (!apis.length || !data.length)) return "Disconnected";
  if (apis.length && data.length && tests.length && risks.length === 0) return "Professional";
  if (apis.length && data.length && tests.length) return "Mostly connected";
  if (apis.length && data.length) return "Needs tests";
  return "Needs wiring";
}

const rows = modules.map((definition) => {
  const pages = matchingPages(definition);
  const routeMeta = matchingRoutes(definition);
  const apis = matchingEndpoints(definition);
  const data = matchingTables(definition);
  const tests = matchingTests(definition);
  const risks = matchingRisks(definition);
  const status = statusFor({ pages, apis, data, tests, risks });
  return { definition, pages, routeMeta, apis, data, tests, risks, status };
});

const scoreWeights = {
  Professional: 6,
  "Mostly connected": 5,
  "Needs tests": 4,
  "Needs wiring": 3,
  Disconnected: 2,
  "Cosmetic only": 1,
  Missing: 0,
};

const score = Math.round(
  (rows.reduce((total, row) => total + scoreWeights[row.status], 0) / (rows.length * scoreWeights.Professional)) * 100,
);

const statusCounts = rows.reduce((counts, row) => {
  counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}, {});

const topRisks = riskHits.slice(0, 40);
const generatedAt = new Date().toISOString();

const markdown = `# ISSSourcing Professional App Audit

Generated: ${generatedAt}

This report is generated by \`npm run audit:professional\`. It checks whether each business module has the minimum professional backbone expected from the current product brief: visible screen, API surface, persisted data model, tests, and no obvious stub/degraded behavior.

## Readiness Snapshot

- Professional readiness score: **${score}%**
- Modules assessed: **${rows.length}**
- Backend endpoints discovered: **${endpoints.length}**
- Schema tables discovered: **${tables.length}**
- Test/spec files discovered: **${testFiles.length}**
- Risk markers discovered in source: **${riskHits.length}**

${Object.entries(statusCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([status, count]) => `- ${status}: **${count}**`)
  .join("\n")}

## Module Inventory

| Module | User Routes | UI Evidence | API Evidence | Data Evidence | Test Evidence | Status | Required Professional Proof |
|---|---|---|---|---|---|---|---|
${rows
  .map((row) => {
    const apis = row.apis.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    const data = row.data.map((table) => table.table);
    const tests = row.tests.map(toPosix);
    const pages = [...row.pages, ...row.routeMeta].map(toPosix);
    return `| ${row.definition.name} | ${row.definition.routes.join("<br>")} | ${shortList(pages)} | ${shortList(apis, 6)} | ${shortList(data, 6)} | ${shortList(tests, 4)} | **${row.status}** | ${row.definition.professionalProof} |`;
  })
  .join("\n")}

## Highest-Priority Gaps

${rows
  .filter((row) => row.status !== "Professional")
  .slice(0, 10)
  .map((row, index) => {
    const missing = [];
    if (!row.pages.length) missing.push("screen/page");
    if (!row.apis.length) missing.push("API route");
    if (!row.data.length) missing.push("schema table");
    if (!row.tests.length) missing.push("test coverage");
    if (row.risks.length) missing.push(`${row.risks.length} source risk marker(s)`);
    return `${index + 1}. **${row.definition.name}**: ${row.status}. Missing or weak: ${missing.join(", ") || "professional proof trace"}.`;
  })
  .join("\n")}

## Source Risk Markers

These are not all defects. They are prompts for review where the code may still contain degraded, stubbed, demo-only, or unfinished behavior.

| File | Line | Marker | Source |
|---|---:|---|---|
${topRisks
  .map((hit) => `| ${toPosix(hit.file)} | ${hit.line} | ${hit.label} | \`${hit.text.replaceAll("|", "\\|")}\` |`)
  .join("\n")}
${riskHits.length > topRisks.length ? `\n\nAdditional risk markers omitted: ${riskHits.length - topRisks.length}. Run the script locally to inspect the full source list.` : ""}

## Professional Completion Rule

For any new feature or module, do not mark it complete unless the implementation can prove:

1. What data it creates or updates.
2. Where that data appears in the next workflow.
3. Which Master Data or policy rule validates it.
4. Which transaction it affects downstream.
5. Which report, dashboard, export, diagnostic, or audit log reflects the change.
6. Which automated test proves the path.
`;

mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, markdown, "utf8");

console.log(`Professional readiness score: ${score}%`);
for (const [status, countValue] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`${status}: ${countValue}`);
}
console.log(`Report written to ${path.relative(root, reportPath)}`);

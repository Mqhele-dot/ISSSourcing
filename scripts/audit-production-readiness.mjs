#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportFile = path.join(root, "docs", "production-readiness-audit.md");
const ignored = new Set([".git", "node_modules", "dist", "build", "uploads", "tmp", "output", ".cache"]);
const statuses = [
  "Production-ready",
  "Partially working",
  "Cosmetic only",
  "Mock/demo only",
  "Disconnected",
  "Broken",
  "Missing",
];

const coreWorkflowRoutePatterns = [
  /^\/admin\/master-data/,
  /^\/procurement\/requisitions/,
  /^\/procurement\/orders/,
  /^\/procurement\/suppliers/,
  /^\/procurement\/contracts/,
  /^\/inventory(\/|$)/,
  /^\/operations\/logistics/,
  /^\/operations\/exceptions/,
  /^\/finance\/accounts-payable/,
  /^\/finance\/invoices/,
  /^\/analytics\/reports/,
  /^\/analytics\/export-center/,
  /^\/admin\/system-diagnostics/,
  /^\/admin\/user-roles/,
  /^\/m\/counts/,
];

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function walk(relativeDir) {
  const absolute = path.join(root, relativeDir);
  if (!existsSync(absolute)) return [];
  const out = [];
  for (const entry of readdirSync(absolute)) {
    if (ignored.has(entry)) continue;
    const absoluteEntry = path.join(absolute, entry);
    const relativeEntry = path.relative(root, absoluteEntry);
    const stat = statSync(absoluteEntry);
    if (stat.isDirectory()) out.push(...walk(relativeEntry));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|md|json)$/i.test(entry)) out.push(relativeEntry);
  }
  return out;
}

function read(relativeFile) {
  return readFileSync(path.join(root, relativeFile), "utf8");
}

function readIf(relativeFile) {
  const file = path.join(root, relativeFile);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function list(values, limit = 4) {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return "None found";
  const visible = unique.slice(0, limit);
  return visible.join("<br>") + (unique.length > limit ? `<br>+${unique.length - limit} more` : "");
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .slice(0, 240);
}

const files = ["client/src", "server", "shared", "scripts", "e2e"].flatMap(walk);
const codeFiles = files.filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
const serverFiles = codeFiles.filter((file) => toPosix(file).startsWith("server/"));
const clientFiles = codeFiles.filter((file) => toPosix(file).startsWith("client/src/"));
const testFiles = codeFiles.filter((file) => {
  const normalized = toPosix(file);
  return normalized.startsWith("scripts/test-") || normalized.startsWith("e2e/") || normalized.endsWith(".test.ts");
});

const appRoutesText = readIf("client/src/lib/routes/app-routes.ts");
const routerText = readIf("client/src/router.tsx");
const schemaText = readIf("shared/schema.ts");
const packageJson = JSON.parse(readIf("package.json") || "{}");

function parseLazyImports() {
  const imports = new Map();
  const regex = /const\s+(\w+)\s*=\s*lazy\(\(\)\s*=>\s*import\(["'`]@\/pages\/([^"'`]+)["'`]\)\)/g;
  for (const match of routerText.matchAll(regex)) {
    imports.set(match[1], `client/src/pages/${match[2]}.tsx`);
  }
  imports.set("AuthPage", "client/src/pages/auth-page.tsx");
  return imports;
}

function parseStaticAppRouteMap() {
  const map = new Map();
  const stack = [];
  for (const rawLine of appRoutesText.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const objectMatch = line.match(/^(\s*)([A-Za-z0-9_]+):\s*\{\s*$/);
    if (objectMatch) {
      stack.push({ key: objectMatch[2], indent });
      continue;
    }
    const stringMatch = line.match(/^\s*([A-Za-z0-9_]+):\s*["'`]([^"'`]+)["'`]/);
    if (stringMatch && stringMatch[2].startsWith("/")) {
      const qualified = ["APP_ROUTES", ...stack.map((item) => item.key), stringMatch[1]].join(".");
      map.set(qualified, stringMatch[2]);
    }
  }
  return map;
}

const lazyImports = parseLazyImports();
const staticRoutes = parseStaticAppRouteMap();
const staticRouteFallbacks = new Map([
  ["APP_ROUTES.operations.logistics", "/operations/logistics"],
  ["APP_ROUTES.operations.exceptions", "/operations/exceptions"],
  ["APP_ROUTES.inventory.root", "/inventory"],
  ["APP_ROUTES.procurement.orders", "/procurement/orders"],
]);
const helperRouteBases = new Map([
  ["APP_ROUTES.inventory.warehouse", "/inventory/warehouses"],
  ["APP_ROUTES.procurement.order", "/procurement/orders"],
  ["APP_ROUTES.procurement.requisition", "/procurement/requisitions"],
  ["APP_ROUTES.procurement.supplier", "/procurement/suppliers"],
  ["APP_ROUTES.admin.settingsSection", "/admin/settings"],
  ["APP_ROUTES.admin.masterDataSection", "/admin/master-data"],
  ["APP_ROUTES.admin.documentExtractorMode", "/admin/document-extractor"],
]);

function resolveRouteExpression(raw) {
  const expression = raw.trim();
  const normalizedExpression = expression
    .replace("${APP_ROUTES.operations.logistics}", "/operations/logistics")
    .replace("${APP_ROUTES.operations.exceptions}", "/operations/exceptions")
    .replace("${APP_ROUTES.inventory.root}", "/inventory")
    .replace("${APP_ROUTES.procurement.orders}", "/procurement/orders");
  const quoted = expression.match(/^["'`]([^"'`]+)["'`]$/);
  if (quoted) {
    return quoted[1]
      .replace("${APP_ROUTES.operations.logistics}", "/operations/logistics")
      .replace("${APP_ROUTES.operations.exceptions}", "/operations/exceptions")
      .replace("${APP_ROUTES.inventory.root}", "/inventory")
      .replace("${APP_ROUTES.procurement.orders}", "/procurement/orders");
  }
  if (staticRoutes.has(expression)) return staticRoutes.get(expression);
  if (staticRouteFallbacks.has(expression)) return staticRouteFallbacks.get(expression);
  const helper = expression.match(/^(APP_ROUTES\.[A-Za-z0-9_.]+)\(["'`](:[^"'`]+)["'`]\)$/);
  if (helper && helperRouteBases.has(helper[1])) return `${helperRouteBases.get(helper[1])}/${helper[2]}`;
  const template = expression.match(/^`\$\{(APP_ROUTES\.[A-Za-z0-9_.]+)\}(.*)`$/);
  if (template && staticRoutes.has(template[1])) return `${staticRoutes.get(template[1])}${template[2]}`;
  if (template && staticRouteFallbacks.has(template[1])) return `${staticRouteFallbacks.get(template[1])}${template[2]}`;
  return normalizedExpression.replaceAll("`", "");
}

function parseRoutes() {
  const routes = [];
  const routeRegex = /<(ProtectedRoute|Route)\s+([^>]*?)\/?>/gms;
  for (const match of routerText.matchAll(routeRegex)) {
    const attrs = match[2];
    if (attrs.includes("rule.path")) continue;
    const templatePathMatch = attrs.match(/\bpath=\{(`[^`]+`)\}/);
    const pathMatch = templatePathMatch ?? attrs.match(/\bpath=(?:\{([^}]+)\}|["'`]([^"'`]+)["'`])/);
    const componentMatch = attrs.match(/\bcomponent=\{?([A-Za-z0-9_]+)\}?/);
    if (!pathMatch) continue;
    const pathValue = resolveRouteExpression(pathMatch[1] ?? `"${pathMatch[2]}"`);
    const component = componentMatch?.[1] ?? "inline";
    routes.push({
      route: pathValue,
      component,
      file: lazyImports.get(component) ?? "client/src/router.tsx",
      protected: match[1] === "ProtectedRoute",
    });
  }
  return routes;
}

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
          endpoints.push({ method, endpoint: routeMatch[1], file });
        }
      } else if (match[3]) {
        endpoints.push({ method, endpoint: match[3], file });
      }
    }
  }
  return endpoints;
}

function parseTables() {
  const tables = [];
  const tableStart = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*pgTable\s*\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of schemaText.matchAll(tableStart)) {
    const start = match.index ?? 0;
    const next = schemaText.slice(start + 1).search(/\nexport\s+const\s+[A-Za-z0-9_]+\s*=\s*pgTable\s*\(/);
    const block = next === -1 ? schemaText.slice(start) : schemaText.slice(start, start + 1 + next);
    const columnMatches = [...block.matchAll(/^\s*([A-Za-z0-9_]+):\s/mg)].map((column) => column[1]);
    tables.push({ symbol: match[1], table: match[2], block, columns: columnMatches });
  }
  return tables;
}

const routes = parseRoutes();
const endpoints = parseEndpoints();
const tables = parseTables();

const moduleRules = [
  ["Master Data", ["master-data", "mdm", "currencies", "departments", "warehouses", "carriers", "payment-terms", "tax"]],
  ["Requisition", ["requisition", "requisitions"]],
  ["Purchase Order", ["purchase-order", "purchase-orders", "orders"]],
  ["Supplier", ["supplier", "suppliers", "contracts"]],
  ["Inventory", ["inventory", "sku", "barcode", "categories", "stock"]],
  ["Warehouse", ["warehouse", "warehouses", "stock-movements", "batches", "serials"]],
  ["Logistics", ["logistics", "shipment", "shipments", "carrier"]],
  ["Accounts Payable", ["accounts-payable", "/api/ap", "ap-", "invoice", "invoices", "payment"]],
  ["Analytics & Reports", ["analytics", "reports", "export", "saved-reports"]],
  ["Security & Admin", ["auth", "user", "permissions", "roles", "settings", "audit", "diagnostics"]],
  ["Mobile", ["/m/", "mobile", "sync", "counts", "scan"]],
  ["Documents", ["documents", "document-extractor", "uploads"]],
  ["Learning", ["get-educated", "training"]],
];

function detectModule(value) {
  const lower = String(value).toLowerCase();
  for (const [module, hints] of moduleRules) {
    if (hints.some((hint) => lower.includes(hint))) return module;
  }
  return "Platform";
}

function fileText(relativeFile) {
  return existsSync(path.join(root, relativeFile)) ? read(relativeFile) : "";
}

function routeEvidenceFiles(route) {
  const files = new Set([route.file]);
  const normalized = toPosix(route.file);
  if (route.route.startsWith("/procurement/requisitions/new") || route.route.startsWith("/procurement/requisitions/:")) {
    [
      "client/src/pages/requisition-form.tsx",
      "client/src/pages/requisitions/use-requisition-form.ts",
      "client/src/pages/requisitions/requisition-lines-editor.tsx",
      "client/src/pages/requisitions/requisition-form-header.tsx",
      "client/src/pages/requisitions/requisition-form-lines.tsx",
    ].forEach((file) => files.add(file));
  }
  if (route.route === "/procurement/requisitions" || normalized.endsWith("purchase-page.tsx")) {
    [
      "client/src/pages/purchase-page.tsx",
      "client/src/pages/requisitions.tsx",
      "client/src/pages/requisitions/use-requisition-form.ts",
      "client/src/pages/requisitions/requisition-lines-editor.tsx",
    ].forEach((file) => files.add(file));
  }
  if (route.route.startsWith("/procurement/orders") || normalized.endsWith("orders.tsx")) {
    [
      "client/src/pages/orders.tsx",
      "client/src/pages/orders/purchase-orders-list.tsx",
      "client/src/pages/orders/purchase-order-detail-view.tsx",
      "client/src/pages/orders/use-purchase-orders.ts",
    ].forEach((file) => files.add(file));
  }
  if (route.route.startsWith("/admin/master-data")) {
    [
      "client/src/pages/master-data.tsx",
      "client/src/pages/master-data/master-data-table.tsx",
      "client/src/pages/master-data/use-master-data.ts",
    ].forEach((file) => files.add(file));
  }
  return [...files].filter((file) => existsSync(path.join(root, file)));
}

function routeEvidenceText(route) {
  return routeEvidenceFiles(route).map(fileText).join("\n\n");
}

function findApiUseForRoute(route) {
  const text = routeEvidenceText(route);
  const matches = [...text.matchAll(/["'`]((?:\/api\/)[^"'`? )]+)/g)].map((match) => match[1]);
  return [...new Set(matches)];
}

function isCoreWorkflowRoute(route) {
  return coreWorkflowRoutePatterns.some((pattern) => pattern.test(route.route));
}

function routeTestEvidence(route) {
  const module = detectModule(`${route.route} ${route.file}`).toLowerCase().split(" ")[0];
  const routeSlug = route.route
    .replace(/^\/+/, "")
    .replace(/\/:.+$/, "")
    .split("/")[0];
  return testFiles.filter((file) => {
    const normalized = toPosix(file).toLowerCase();
    return normalized.includes(module) || normalized.includes(routeSlug);
  });
}

function routeRequiredFixes(route, apiUses, text) {
  const fixes = [];
  const hasMock = /\b(mock|demo|sample|stub|fake|coming soon)\b/i.test(text);
  const hasApi = apiUses.length || /useQuery|useMutation|apiRequest|fetch\(/.test(text);
  const hasLoading = /isLoading|loading|Skeleton|Loading/.test(text);
  const hasError = /isError|error|PanelInlineError|catch|toast/.test(text);
  const hasValidation = /zod|schema|validate|resolver|FormMessage|required/i.test(text);
  const hasPermission = /<Can|useCan|usePermissions|permission|ProtectedRoute/i.test(text);
  if (!existsSync(path.join(root, route.file))) fixes.push("component file missing");
  if (hasMock) fixes.push("mock/demo/static markers present");
  if (!hasApi && route.protected) fixes.push("no clear backend data integration");
  if (!hasLoading) fixes.push("loading state not proven");
  if (!hasError) fixes.push("error handling not proven");
  if (!hasValidation) fixes.push("validation not proven");
  if (!hasPermission) fixes.push("permission-aware UX not proven");
  if (isCoreWorkflowRoute(route) && routeTestEvidence(route).length === 0) {
    fixes.push("core route lacks focused test evidence");
  }
  return fixes;
}

function routeStatus(route, apiUses, text) {
  const fixes = routeRequiredFixes(route, apiUses, text);
  const hasMock = fixes.includes("mock/demo/static markers present");
  if (!existsSync(path.join(root, route.file))) return "Broken";
  if (hasMock) return "Mock/demo only";
  if (fixes.includes("no clear backend data integration")) return "Cosmetic only";
  if (fixes.length > 0) return "Partially working";
  return "Production-ready";
}

function endpointStatus(endpoint) {
  const text = fileText(endpoint.file);
  const start = text.indexOf(endpoint.endpoint);
  const block = start === -1 ? text : text.slice(Math.max(0, start - 1000), start + 2500);
  const auth = /ensureAuthenticated|ensureAdmin|ensurePermission|requirePermission|auth\./.test(block);
  const validation = /safeParse|parse\(|zod|validate|schema|validator/.test(block);
  const audit = /audit|activity|log[A-Z]|record.*history/i.test(block);
  const mock = /\b(mock|demo|stub|fake|placeholder|degraded)\b/i.test(block);
  if (mock) return "Mock/demo only";
  if (!auth && endpoint.endpoint.startsWith("/api/")) return "Partially working";
  if (!validation && /POST|PUT|PATCH|DELETE/.test(endpoint.method)) return "Partially working";
  if (!audit && /(payment|supplier|invoice|purchase|requisition|warehouse|mdm|settings|roles)/i.test(endpoint.endpoint)) {
    return "Partially working";
  }
  return "Production-ready";
}

function endpointAuth(endpoint) {
  const text = fileText(endpoint.file);
  const start = text.indexOf(endpoint.endpoint);
  const block = start === -1 ? text : text.slice(Math.max(0, start - 500), start + 1800);
  return /ensureAuthenticated|ensureAdmin|ensurePermission|requirePermission|auth\./.test(block) ? "Yes" : "No/unclear";
}

function endpointValidation(endpoint) {
  const text = fileText(endpoint.file);
  const start = text.indexOf(endpoint.endpoint);
  const block = start === -1 ? text : text.slice(Math.max(0, start - 500), start + 1800);
  return /safeParse|parse\(|zod|validate|schema|validator/.test(block) ? "Yes" : "No/unclear";
}

function endpointFrontendUsed(endpoint) {
  const needle = endpoint.endpoint.replace(/:\w+/g, "");
  return clientFiles.some((file) => fileText(file).includes(needle)) ? "Yes" : "No/unclear";
}

function endpointTests(endpoint) {
  const module = detectModule(endpoint.endpoint).toLowerCase().split(" ")[0];
  return testFiles.filter((file) => toPosix(file).toLowerCase().includes(module));
}

function tablePurpose(table) {
  const lower = table.table.toLowerCase();
  if (lower.startsWith("mdm_")) return "Master Data/control centre domain";
  if (lower.includes("purchase_requisition")) return "Purchase requisition workflow";
  if (lower.includes("purchase_order")) return "Purchase order workflow";
  if (lower.includes("invoice") || lower.includes("payment") || lower.includes("ap_")) return "Finance/AP workflow";
  if (lower.includes("warehouse") || lower.includes("stock") || lower.includes("inventory")) return "Inventory and warehouse execution";
  if (lower.includes("supplier")) return "Supplier management";
  if (lower.includes("audit") || lower.includes("activity")) return "Audit and history";
  if (lower.includes("billing") || lower.includes("subscription") || lower.includes("plan")) return "Subscription and entitlement";
  return "Platform/supporting data";
}

function tableStatus(table) {
  const columns = table.columns.map((column) => column.toLowerCase());
  const hasTenant = columns.some((column) => ["organizationid", "organization_id", "orgid", "org_id", "tenantid", "tenant_id"].includes(column));
  const hasAudit = columns.some((column) => ["createdat", "created_at", "updatedat", "updated_at", "createdby", "created_by", "updatedby", "updated_by"].includes(column));
  const hasStatus = columns.some((column) => column.includes("status") || column === "active" || column === "isactive");
  if (/organizations|sessions|permissions|currencies|units_of_measure|tax_codes|departments|carriers/.test(table.table)) {
    return hasAudit || hasStatus ? "Partially working" : "Disconnected";
  }
  if (!hasTenant && !table.table.startsWith("mdm_")) return "Partially working";
  if (!hasAudit) return "Partially working";
  return "Production-ready";
}

function tableGap(table) {
  const columns = table.columns.map((column) => column.toLowerCase());
  const gaps = [];
  if (!columns.some((column) => column.includes("status") || column === "active")) gaps.push("status/active lifecycle");
  if (!columns.some((column) => column.includes("created"))) gaps.push("created audit field");
  if (!columns.some((column) => column.includes("updated"))) gaps.push("updated audit field");
  if (!columns.some((column) => column.includes("organization") || column.includes("tenant")) && !table.table.startsWith("mdm_")) {
    gaps.push("tenant/company field");
  }
  return gaps.length ? gaps.join(", ") : "None obvious from schema";
}

const riskTerms = [
  ["mock", /\bmock\b/i],
  ["demo", /\bdemo\b/i],
  ["sample", /\bsample\b/i],
  ["placeholder", /\bplaceholder\b/i],
  ["TODO", /\bTODO\b/i],
  ["FIXME", /\bFIXME\b/i],
  ["stub", /\bstub\b/i],
  ["fake", /\bfake\b/i],
  ["hardcoded", /\bhardcoded\b/i],
  ["static", /\bstatic\b/i],
  ["coming soon", /coming soon/i],
  ["localStorage", /localStorage/i],
];

function riskRows() {
  const rows = [];
  for (const file of codeFiles) {
    if (toPosix(file) === "scripts/audit-production-readiness.mjs") continue;
    const lines = fileText(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const [label, regex] of riskTerms) {
        if (regex.test(line)) {
          rows.push({
            file: toPosix(file),
            line: index + 1,
            area: detectModule(file),
            type: label,
            description: line.trim().slice(0, 180),
          });
          break;
        }
      }
    });
  }
  return rows;
}

function isProductionCodeFile(file) {
  const normalized = toPosix(file);
  if (normalized.startsWith("scripts/test-") || normalized.startsWith("e2e/") || normalized.endsWith(".test.ts")) return false;
  return normalized.startsWith("client/src/") || normalized.startsWith("server/") || normalized.startsWith("shared/");
}

function riskSeverity(risk) {
  if (!isProductionCodeFile(risk.file)) return "False positive";
  const lower = `${risk.file} ${risk.description}`.toLowerCase();
  const core =
    /purchase|requisition|supplier|inventory|warehouse|logistics|invoice|payment|accounts-payable|master-data|mdm|export|diagnostic|role|permission/.test(
      lower,
    );
  if (core && /\b(mock|stub|fake|placeholder)\b/i.test(risk.type)) return "Critical";
  if (core && /\b(demo|todo|fixme|degraded|coming soon)\b/i.test(risk.type)) return "High";
  if (/\b(localstorage|hardcoded|static|sample)\b/i.test(risk.type)) return core ? "Medium" : "Low";
  return core ? "High" : "Low";
}

function riskRowsBySeverity() {
  return riskRows().map((risk) => ({ ...risk, severity: riskSeverity(risk) }));
}

const mdmDomains = [
  ["Legal entities", ["mdm_legal_entities"], "registration, tax, default currency, country, active state, sites"],
  ["Sites/branches", ["mdm_sites"], "legal entity, warehouse, address, site type, delivery defaults"],
  ["Departments", ["departments"], "owner, cost centres, approval policy, budget controls"],
  ["Cost centres", ["mdm_cost_centres"], "department, GL account, owner, active state"],
  ["Suppliers", ["suppliers"], "risk, status, currency, terms, tax, contacts, banking, compliance, carrier defaults"],
  ["Supplier contacts", ["mdm_supplier_contacts"], "contact type, role, primary flag, phone/email, active state"],
  ["Supplier banking", ["mdm_supplier_bank_accounts"], "masked account, method, currency, verification, default flag"],
  ["Supplier compliance", ["mdm_supplier_documents"], "document type, expiry, required-for-PO, status"],
  ["Items/services", ["inventory_items"], "SKU, category, UOM, tax, GL, stock controls, supplier items"],
  ["Categories/commodities", ["categories", "commodity_codes", "mdm_item_categories"], "commodity/category hierarchy, tax and GL defaults"],
  ["UOMs", ["units_of_measure"], "class, precision, base unit, active state"],
  ["UOM conversions", ["mdm_uom_conversions"], "from/to unit, factor, item-specific overrides"],
  ["Currencies", ["currencies"], "code, symbol, region, active state, ZAR default"],
  ["FX rates", ["mdm_exchange_rates"], "from/to currency, rate, source, effective date, lock rules"],
  ["Tax codes", ["tax_codes"], "rate, country, type, active state"],
  ["Payment terms", ["payment_terms"], "net days, discount, default flag"],
  ["Warehouses", ["warehouses"], "site, address, bins, contact, default flag"],
  ["Bins", ["warehouses", "warehouse_inventory"], "aisle, bin, shelf/location details"],
  ["Delivery locations", ["mdm_sites", "warehouses"], "site and warehouse delivery defaults"],
  ["Approval rules", ["mdm_approval_rules", "approval_policies"], "entity, value bands, department, role, risk, approver level"],
  ["Procurement policies", ["mdm_procurement_policies"], "quote rules, GRN requirement, tolerance, once-off controls"],
  ["Document numbering", ["mdm_document_sequences", "mdm_document_templates"], "prefix, year, legal entity/site, terms, footer, logo"],
  ["Finance/GL mappings", ["mdm_gl_mappings"], "mapping type, source, GL account, cost centre"],
];

const workflowLinks = [
  ["Master Data", "Requisition", "legal entity, site, supplier, item, UOM, currency, tax, cost centre, approval route"],
  ["Requisition", "Approval", "requester, department, local value, category, policy result"],
  ["Approval", "Purchase Order", "approved demand lines, supplier, item, quantity, delivery need"],
  ["RFQ/Quote", "Purchase Order", "supplier quotes, selected price, terms, compliance"],
  ["Purchase Order", "Goods Receipt", "PO header, lines, UOM, tolerances, warehouse/bin rules"],
  ["Goods Receipt", "Inventory", "received quantity, batch/serial/bin, stock movement, on-hand update"],
  ["Goods Receipt", "Invoice/AP", "GRN/receipt evidence for three-way match"],
  ["Purchase Order", "Invoice/AP", "supplier, PO lines, tax, currency, payment terms, totals"],
  ["Invoice/AP", "Payment", "approved invoices, supplier banking, payment batch controls"],
  ["Transactions", "Reports", "spend, inventory, logistics, AP, exceptions, exports"],
  ["Transactions", "Audit", "old/new values, user, timestamp, reason, sensitive writes"],
];

const validationRules = [
  "Creating a PO with a blocked supplier",
  "Creating a PO with an inactive item",
  "Creating a PO with missing UOM conversion",
  "Creating a PO with missing tax code",
  "Creating a PO with missing GL account",
  "Creating a PO with missing FX rate where required",
  "Receiving against a cancelled PO",
  "Receiving above tolerance",
  "Invoicing above tolerance",
  "Paying an unmatched invoice",
  "Paying a disputed invoice",
  "Disabling master data used in open transactions",
  "Approving your own request where policy forbids it",
];

const roles = [
  "System admin",
  "Master-data admin",
  "Requester",
  "Buyer/procurement officer",
  "Procurement manager",
  "Warehouse receiver",
  "Inventory controller",
  "Finance/AP user",
  "Finance approver",
  "Executive/view-only user",
  "Auditor",
];

const auditAreas = [
  "Master data changes",
  "Supplier changes",
  "Supplier bank changes",
  "Item changes",
  "Requisition changes",
  "Approval decisions",
  "PO changes",
  "Receipt changes",
  "Invoice changes",
  "Payment changes",
  "User role changes",
  "System setting changes",
];

const diagnosticsAreas = [
  "Health check endpoint",
  "Database status",
  "API status",
  "Auth/session status",
  "Environment variable validation",
  "Migration status",
  "Seed data status",
  "Build version",
  "Last deployment marker",
  "Standard API error format",
  "User-friendly frontend errors",
  "Loading states",
  "Empty states",
  "Retry states",
  "No endless loading screens",
];

function routeRows() {
  return routes.map((route) => {
    const text = routeEvidenceText(route);
    const apiUses = findApiUseForRoute(route);
    const status = routeStatus(route, apiUses, text);
    const module = detectModule(`${route.route} ${route.file}`);
    const dataSource = apiUses.length ? "Backend API" : /localStorage|sessionStorage/.test(text) ? "Browser storage" : "Static/component state";
    const fixes = routeRequiredFixes(route, apiUses, text);
    const gap =
      status === "Production-ready"
        ? "No major static gap detected"
        : status === "Mock/demo only"
          ? "Contains mock/demo/static fallback markers"
          : status === "Cosmetic only"
            ? "No clear backend data integration in component"
            : fixes.length
              ? fixes.join("; ")
              : "Needs stronger loading/error/validation/permission/audit proof";
    return `| ${esc(route.route)} | ${esc(route.file)} | ${module} | ${isCoreWorkflowRoute(route) ? "Yes" : "No"} | ${dataSource} | ${list(apiUses, 5)} | ${status} | ${gap} | Connect to real data, backend validation, permissions, audit/reporting evidence, and a focused test. |`;
  });
}

function coreRouteRows() {
  return routes
    .filter(isCoreWorkflowRoute)
    .map((route) => {
      const text = routeEvidenceText(route);
      const apiUses = findApiUseForRoute(route);
      const status = routeStatus(route, apiUses, text);
      const fixes = routeRequiredFixes(route, apiUses, text);
      const tests = routeTestEvidence(route);
      return `| ${esc(route.route)} | ${esc(route.file)} | ${detectModule(`${route.route} ${route.file}`)} | ${list(apiUses, 4)} | ${list(tests.map(toPosix), 3)} | ${status} | ${fixes.length ? fixes.join("; ") : "No required fixes detected by static audit"} |`;
    });
}

function apiRows() {
  return endpoints.map((endpoint) => {
    const module = detectModule(`${endpoint.endpoint} ${endpoint.file}`);
    const status = endpointStatus(endpoint);
    const tests = endpointTests(endpoint);
    const tableHits = tables.filter((table) => endpoint.file.includes(table.symbol) || endpoint.file.includes(table.table));
    const gap =
      status === "Production-ready"
        ? "No major static gap detected"
        : status === "Mock/demo only"
          ? "Remove degraded/mock behavior or label endpoint as non-production"
          : "Strengthen auth, validation, audit logging, or tests";
    return `| ${endpoint.method} | ${esc(endpoint.endpoint)} | ${toPosix(endpoint.file)} | ${module} | ${endpointAuth(endpoint)} | ${endpointValidation(endpoint)} | ${list(tableHits.map((table) => table.table), 5)} | ${endpointFrontendUsed(endpoint)} | ${list(tests.map(toPosix), 3)} | ${status} | ${gap} |`;
  });
}

function schemaRows() {
  return tables.map((table) => {
    const columns = table.columns;
    const keys = /references\(\(\s*=>/.test(table.block) ? "Has Drizzle references" : "No/unclear";
    const statusFields = columns.filter((column) => /status|active/i.test(column));
    const auditFields = columns.filter((column) => /created|updated|approved|deleted/i.test(column));
    const tenantFields = columns.filter((column) => /organization|tenant|company|org/i.test(column));
    return `| ${table.table} | ${tablePurpose(table)} | ${detectModule(table.table)} | ${keys} | ${list(statusFields, 3)} | ${list(auditFields, 4)} | ${list(tenantFields, 2)} | ${tableGap(table)} | Add missing lifecycle, tenant, relation, and audit fields where this table stores production transactions. |`;
  });
}

function workflowRows() {
  return workflowLinks.map(([from, to, data]) => {
    const evidence = endpoints
      .filter((endpoint) => detectModule(endpoint.endpoint) === to || detectModule(endpoint.endpoint) === from)
      .slice(0, 4)
      .map((endpoint) => `${endpoint.method} ${endpoint.endpoint}`);
    const currentlyFlows = evidence.length ? "Partially/yes" : "No evidence";
    const gap = from === "RFQ/Quote" ? "RFQ/quote workflow is not yet a first-class module" : "Needs transaction-level end-to-end proof";
    return `| ${from} | ${to} | ${data} | ${currentlyFlows} | ${list(evidence, 4)} | ${gap} | Add or verify service-level handoff, validation, audit event, and integration test. |`;
  });
}

function mockRows() {
  return riskRowsBySeverity()
    .slice(0, 160)
    .map((risk) => {
      const productionRisk =
        /mock|demo|fake|stub|placeholder|TODO|FIXME/.test(risk.type)
          ? "May hide incomplete behavior or disconnected workflow"
          : "May create local-only or static production behavior";
      return `| ${risk.severity} | ${risk.file}:${risk.line} | ${risk.area} | ${risk.type} | ${esc(risk.description)} | ${productionRisk} | Replace with real backend data, formal demo flag, or tracked backlog item. |`;
    });
}

function mdmRows() {
  return mdmDomains.map(([domain, hints, required]) => {
    const matching = tables.filter((table) => hints.some((hint) => table.table.includes(hint)));
    const currentFields = matching.flatMap((table) => table.columns).slice(0, 12);
    const usedInTransactions = endpoints.some((endpoint) => hints.some((hint) => endpoint.endpoint.includes(hint.replace("mdm_", "")))) ? "Yes/partial" : "Indirect/unclear";
    const dataQuality = endpoints.some((endpoint) => endpoint.endpoint.includes("/api/mdm/data-quality")) ? "Yes, central scan" : "No";
    const audit = matching.some((table) => /created|updated/.test(table.columns.join(" "))) ? "Partial" : "No/unclear";
    const status = matching.length ? "Partially working" : "Missing";
    return `| ${domain} | ${list(currentFields, 10)} | ${required} | ${usedInTransactions} | ${dataQuality} | ${audit} | ${status} | Expand domain-specific UI, where-used checks, validation, and transaction defaults. |`;
  });
}

function validationRows() {
  return validationRules.map((rule) => {
    const lower = rule.toLowerCase();
    const backend = serverFiles.some((file) => fileText(file).toLowerCase().includes(lower.split(" ").slice(-2).join(" ")));
    const frontend = clientFiles.some((file) => fileText(file).toLowerCase().includes(lower.split(" ").slice(-2).join(" ")));
    const dbConstraint = /duplicate|unique|required/.test(lower) ? "Partial via schema" : "No/unclear";
    return `| ${rule} | ${frontend ? "Partial evidence" : "No/unclear"} | ${backend ? "Partial evidence" : "No/unclear"} | ${dbConstraint} | Invalid transaction may slip through if service-level guard is absent. | Add authoritative backend rule, structured error, frontend hint, and regression test. |`;
  });
}

function permissionRows() {
  return roles.map((role) => {
    const currentAccess = /admin/i.test(role)
      ? "Admin/manager/custom roles exist"
      : /auditor|view/i.test(role)
        ? "Auditor/viewer roles exist"
        : "Mapped through generic role/custom permission model";
    const requiredAccess = `${role} should receive least-privilege access to only its workflow actions.`;
    const sensitive = /admin|finance|approver|procurement manager|auditor/i.test(role) ? "Yes, with controls" : "Limited/role-specific";
    return `| ${role} | ${currentAccess} | ${requiredAccess} | ${sensitive} | Role taxonomy is broader than current enum labels. | Add role templates backed by /api/user/permissions and endpoint-level ensurePermission tests. |`;
  });
}

function auditTrailRows() {
  return auditAreas.map((area) => {
    const lower = area.toLowerCase().split(" ")[0];
    const hasAudit = serverFiles.some((file) => /audit|activity|history/i.test(fileText(file)) && fileText(file).toLowerCase().includes(lower));
    return `| ${area} | ${hasAudit ? "Partial evidence" : "No/unclear"} | Partial/unclear | Partial/yes | Partial/yes | No/unclear | Ensure old/new values, actor, timestamp, reason, and tamper-evident chain for sensitive changes. | Add standardized audit service call and focused test for this area. |`;
  });
}

function diagnosticsRows() {
  return diagnosticsAreas.map((area) => {
    const lower = area.toLowerCase();
    const exists = [...clientFiles, ...serverFiles].some((file) => fileText(file).toLowerCase().includes(lower.split(" ")[0]));
    const quality = exists ? "Partial/available" : "No/unclear";
    return `| ${area} | ${exists ? "Yes/partial" : "No/unclear"} | ${quality} | Production evidence may be incomplete. | Surface status in /admin/system-diagnostics and add smoke coverage. |`;
  });
}

function testRows() {
  const required = [
    ["npm run check", "TypeScript validation"],
    ["npm run lint", "Static linting"],
    ["npm run build", "Production build"],
    ["npm run test", "Generic test alias"],
    ["npm run test:master-data-propagation", "Master-data dependency refresh"],
    ["npm run test:purchase-order-endpoints", "PO API coverage"],
    ["npm run test:ap-workflow", "AP workflow coverage"],
    ["npm run test:diagnostics", "Diagnostics self-checks"],
    ["npm run release:gate:delta", "Focused release gate"],
  ];
  return required.map(([script, purpose]) => {
    const name = script.replace("npm run ", "");
    const exists = Boolean(packageJson.scripts?.[name]);
    return `| ${script} | ${exists ? "Yes" : "No"} | ${purpose} | Not executed by this audit generator | ${exists ? "Needs latest run evidence in PR/check logs" : "Missing standard alias"} | ${exists ? "Run before release and paste evidence into PR" : "Create alias or document closest equivalent"} |`;
  });
}

const topFixes = [
  ["1", "Replace operations degraded fallbacks with explicit diagnostic-backed failures or real queries", "Operations/Control Tower", "Audit found repeated degraded fallback responses", "Dashboards can appear healthy while data is missing", "M"],
  ["2", "Finish requisition line-count API contract", "Requisitions", "TODO indicates list data does not reliably include line counts", "Approvers and buyers may act on incomplete demand data", "S"],
  ["3", "Add first-class RFQ/quote workflow or explicitly gate it as planned", "Procurement", "Workflow map has RFQ/Quote gap", "POs skip quote/compliance controls", "L"],
  ["4", "Strengthen MDM domain-specific edit screens beyond generic code/name forms", "Master Data", "MDM foundation exists but UI still has compatibility domains", "Setup values may not control transactions deeply enough", "L"],
  ["5", "Add where-used/dependency checks before disabling master data", "Master Data", "Business validation requires blocking unsafe disable/delete", "Open transactions can reference inactive setup records", "M"],
  ["6", "Add service-level validation tests for blocked supplier, inactive item, missing tax/GL/FX/UOM", "Procurement", "Validation table still has partial/unclear evidence", "Invalid POs can enter procurement flow", "M"],
  ["7", "Expand payment approval and supplier banking permission tests", "Finance/AP", "Sensitive actions need role-specific proof", "Unauthorized users may view or trigger sensitive finance actions", "M"],
  ["8", "Prove mobile offline sync replay with end-to-end count mutation tests", "Mobile Counts", "Module is mostly connected, not fully production-ready", "Offline queues can appear successful without real stock updates", "M"],
  ["9", "Standardize audit service calls with old/new values and reason capture", "Audit/Security", "Audit trail evidence is partial across domains", "Compliance review cannot reconstruct business decisions", "L"],
  ["10", "Keep production smoke and audit baseline checks in the release gate", "Release Gates", "Audit is generated and should remain wired into the release gate", "Regressions can ship without route/API proof", "S"],
];

const md = `# Production Readiness Audit

Generated: ${new Date().toISOString()}

This document is generated by \`npm run audit:production\`. It is intentionally stricter than a UI review: a route or module is only considered ready when it uses real data, connects to workflow, validates on the backend, respects permissions, handles errors, records audit history where needed, and has tests or a verification path.

Allowed status labels: ${statuses.map((status) => `\`${status}\``).join(", ")}.

## Executive Summary

- Frontend routes inspected: **${routes.length}**
- API endpoints inspected: **${endpoints.length}**
- Schema tables inspected: **${tables.length}**
- Test/spec files discovered: **${testFiles.length}**
- Mock/demo/static risk markers found: **${riskRows().length}**
- Core workflow routes inspected: **${routes.filter(isCoreWorkflowRoute).length}**
- Mock/demo/static severity split: **Critical ${riskRowsBySeverity().filter((risk) => risk.severity === "Critical").length}**, **High ${riskRowsBySeverity().filter((risk) => risk.severity === "High").length}**, **Medium ${riskRowsBySeverity().filter((risk) => risk.severity === "Medium").length}**, **Low ${riskRowsBySeverity().filter((risk) => risk.severity === "Low").length}**, **False positive ${riskRowsBySeverity().filter((risk) => risk.severity === "False positive").length}**
- Baseline comparison: **Wave 1 baseline**. Future production audits should compare these counts and risk markers so new or worsened production gaps are visible before release.

The app now has a real production foundation across MDM, procurement, inventory, AP, logistics, reporting, diagnostics, subscriptions, and mobile stock counts. The biggest remaining risk is not absence of screens; it is inconsistent production proof in handoffs, degraded fallback behavior, business-rule enforcement, and audit evidence.

## 1. Route Audit

| Route | Component/File | Module | Core Workflow? | Data Source | API Used | Status | Main Gap | Required Fix |
|---|---|---|---|---|---|---|---|---|
${routeRows().join("\n")}

## 2. Core Workflow Routes

Core workflow routes are stricter than supporting pages. They cannot be marked \`Production-ready\` unless static analysis finds real data access, validation, permissions, loading/error handling, and focused test evidence.

| Route | Component/File | Module | API Used | Test Evidence | Status | Required Fixes |
|---|---|---|---|---|---|---|
${coreRouteRows().join("\n")}

## 3. API Audit

| Method | Endpoint | Handler File | Module | Auth Required | Validation | Tables Used | Frontend Used | Tests | Status | Gap |
|---|---|---|---|---|---|---|---|---|---|---|
${apiRows().join("\n")}

## 4. Database And Schema Audit

| Table | Purpose | Used By | Keys/Relations | Status Fields | Audit Fields | Tenant/Company Field | Main Gap | Required Fix |
|---|---|---|---|---|---|---|---|---|
${schemaRows().join("\n")}

## 5. Workflow Connectivity Audit

| From | To | Data That Should Flow | Currently Flows? | Evidence | Gap | Required Fix |
|---|---|---|---|---|---|---|
${workflowRows().join("\n")}

## 6. Mock, Demo, Placeholder, And Static Data Audit

| Severity | File | Area | Type | Description | Production Risk | Required Fix |
|---|---|---|---|---|---|---|
${mockRows().join("\n")}

Severity definitions:

- **Critical**: mock/static/placeholder behavior in a core production workflow.
- **High**: demo/degraded/TODO/FIXME behavior that can affect a core workflow.
- **Medium**: local-only or hardcoded behavior that may affect production decisions.
- **Low**: supporting/static behavior outside core transaction paths.
- **False positive**: test, fixture, script, or non-production context that still contains a marker.

## 7. Master Data Audit

| Domain | Current Fields | Required Fields | Used In Transactions? | Data Quality Checks? | Audit? | Status | Required Fix |
|---|---|---|---|---|---|---|---|
${mdmRows().join("\n")}

## 8. Business Validation Audit

| Rule | Frontend Validation? | Backend Validation? | Database Constraint? | Current Risk | Required Fix |
|---|---|---|---|---|---|
${validationRows().join("\n")}

## 9. Permissions And Security Audit

| Role | Current Access | Required Access | Sensitive Actions Allowed? | Gap | Required Fix |
|---|---|---|---|---|---|
${permissionRows().join("\n")}

## 10. Audit Trail Audit

| Area | Audit Exists? | Old/New Values? | User Captured? | Timestamp Captured? | Reason Captured? | Gap | Required Fix |
|---|---|---|---|---|---|---|---|
${auditTrailRows().join("\n")}

## 11. Diagnostics And Error Handling Audit

| Area | Exists? | Quality | Gap | Required Fix |
|---|---|---|---|---|
${diagnosticsRows().join("\n")}

## 12. Testing And Release Gate Audit

| Script/Test | Exists? | Purpose | Passes? | Gap | Required Fix |
|---|---|---|---|---|---|
${testRows().join("\n")}

## 13. Required Next Build Waves

1. **Stabilise and expose app truth**: fix broken routes/APIs, standardize API errors, make diagnostics authoritative, label demo-only behavior, and keep check/lint/build green.
2. **Build the real data backbone**: continue the MDM rebuild, domain-specific fields, where-used relationships, data-quality scans, backend validation, and audit history.
3. **Wire procurement-to-payment flow**: prove MDM defaults into requisitions, approval policy into approval decisions, PO defaults, GRN inventory updates, AP matching, payments, reports, and audit.
4. **Add controls and security**: protect supplier banking, payments, approval rules, tax/GL setup, master-data changes, user roles, and sensitive exports.
5. **Add production release gates**: route/API/schema readiness, workflow smoke, permission tests, data-quality tests, dependency checks, and deployment evidence.

## 14. Immediate Acceptance Criteria

- \`docs/production-readiness-audit.md\` exists and is generated by \`npm run audit:production\`.
- Frontend routes are listed and classified.
- API endpoints are listed and classified.
- Database tables/models are listed and classified.
- Mock/demo/disconnected features are identified.
- Core workflow data flow is mapped.
- Validation, permission, audit-trail, diagnostics, and release-gate gaps are documented.
- The top 10 fixes are listed below in priority order.

## 15. Top 10 Fixes

| Priority | Fix | Module | Reason | Risk if Not Fixed | Estimated Size |
|---|---|---|---|---|---|
${topFixes.map((row) => `| ${row.map(esc).join(" | ")} |`).join("\n")}

## 16. Non-Negotiable Standard

Do not mark a feature complete because it renders. A production-ready feature must prove that it uses real data, connects to the workflow, has backend validation, respects permissions, records audit history where needed, handles errors, has tests or verification, and does not break existing modules.
`;

mkdirSync(path.dirname(reportFile), { recursive: true });
writeFileSync(reportFile, md, "utf8");

console.log(`Production readiness audit written to ${path.relative(root, reportFile)}`);
console.log(`Routes: ${routes.length}`);
console.log(`Endpoints: ${endpoints.length}`);
console.log(`Tables: ${tables.length}`);
console.log(`Risk markers: ${riskRows().length}`);

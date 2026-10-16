import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const ROOT = path.resolve(import.meta.dirname, "..");
const MUTATING = new Set(["post", "put", "patch", "delete"]);

function walkFiles(directory, extensions) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", ".playwright-cli"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(absolute, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) result.push(absolute);
  }
  return result;
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function literalStrings(node) {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(literalStrings);
  return [];
}

function endpointText(node) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return `${node.head.text}${node.templateSpans.map((span) => `:param${span.literal.text}`).join("")}`;
}

function normalizedCapability(method, route) {
  const value = route.toLowerCase();
  const action = /approve/.test(value) ? "approve"
    : /release/.test(value) ? "release"
    : /dispatch|send/.test(value) ? "dispatch"
    : /match/.test(value) ? "match"
    : /receive|receipt/.test(value) ? "receive"
    : /convert/.test(value) ? "convert_to_po"
    : /export|download/.test(value) ? "export"
    : method === "delete" ? "delete"
    : method === "post" ? "create"
    : ["put", "patch"].includes(method) ? "update"
    : "read";
  const subject = /supplier/.test(value) ? (/bank/.test(value) ? "supplier_bank" : "supplier")
    : /requisition|reorder-request/.test(value) ? "requisition"
    : /purchase-order|\/orders/.test(value) ? "purchase_order"
    : /receipt|goods-receipt/.test(value) ? "goods_receipt"
    : /invoice/.test(value) ? "invoice"
    : /payment/.test(value) ? "payment"
    : /report|export/.test(value) ? "report"
    : /setting/.test(value) ? "settings"
    : /warehouse-inventory|inventory/.test(value) ? "inventory"
    : /tax/.test(value) ? "tax"
    : /discount/.test(value) ? "discount"
    : route.split("/").filter(Boolean).filter((part) => part !== "api" && !part.startsWith(":"))[0]?.replaceAll("-", "_") ?? "system";
  return `${subject}.${action}`;
}

function inferMiddleware(text) {
  return [...new Set([
    ...text.matchAll(/(?:auth\.)?(ensureAuthenticated|requireAuthenticated|ensureAdmin|ensureTwoFactorAuthenticated)/g),
    ...text.matchAll(/ensureRole\(\[([^\]]+)\]\)/g),
    ...text.matchAll(/ensurePermission\(([^)]+)\)/g),
    ...text.matchAll(/\.\.\.([A-Za-z][A-Za-z0-9]*(?:Access|Read|Write|Guards?))/g),
  ].map((match) => match[0]))];
}

function inferNames(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))].sort();
}

export function collectServerRoutes() {
  const routes = [];
  for (const file of walkFiles(path.join(ROOT, "server"), [".ts", ".tsx"])) {
    const sourceText = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text.toLowerCase();
        if (["get", "post", "put", "patch", "delete"].includes(method) && node.arguments.length) {
          for (const route of literalStrings(node.arguments[0]).filter((item) => item.startsWith("/"))) {
            const text = node.getText(sf);
            const middlewareText = node.arguments.slice(1, -1).map((arg) => arg.getText(sf)).join(", ");
            routes.push({
              method: method.toUpperCase(),
              route,
              capability: normalizedCapability(method, route),
              file: relative(file),
              line: lineOf(sf, node),
              middleware: inferMiddleware(middlewareText),
              validator: inferNames(text, /([A-Za-z0-9_]+Schema)\.(?:parse|safeParse)\(/g),
              services: inferNames(text, /(?:await\s+)?([A-Za-z0-9_]+(?:Service|Repo|storage|Workflow|Engine))(?:\.|\()/g),
              tables: inferNames(text, /\.(?:from|insert|update|delete)\(([A-Za-z0-9_]+)\)/g),
              statusChanges: inferNames(text, /status\s*:\s*["'`]([A-Z_]+)["'`]/g),
              auditEvidence: /appendAuditEvent|createActivityLog|auditLog|activityLog/.test(text),
              cacheInvalidation: /invalidateQueries|cache.*(?:delete|invalidate)|publish.*(?:updated|changed)/i.test(text),
              transaction: /\.transaction\(/.test(text),
              idempotency: /idempoten/i.test(text),
              mutating: MUTATING.has(method),
            });
          }
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "registerMasterDataCrud" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const basePath = node.arguments[0].text;
        for (const [method, suffix, middleware] of [
          ["GET", "", ["...masterRead"]],
          ["POST", "", ["...masterWrite"]],
          ["GET", "/:id", ["...masterRead"]],
          ["PATCH", "/:id", ["...masterWrite"]],
          ["DELETE", "/:id", ["...masterWrite"]],
        ]) {
          routes.push({
            method,
            route: `${basePath}${suffix}`,
            capability: normalizedCapability(method.toLowerCase(), `${basePath}${suffix}`),
            file: relative(file),
            line: lineOf(sf, node),
            middleware,
            validator: node.arguments[2] ? [node.arguments[2].getText(sf)] : [],
            services: ["registerMasterDataCrud"],
            tables: node.arguments[1] ? [node.arguments[1].getText(sf)] : [],
            statusChanges: [],
            auditEvidence: true,
            cacheInvalidation: false,
            transaction: false,
            idempotency: false,
            mutating: method !== "GET",
            generatedFromHelper: true,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
}

export function collectClientConnections() {
  const connections = [];
  for (const file of walkFiles(path.join(ROOT, "client", "src"), [".ts", ".tsx"])) {
    const sourceText = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        const endpoint = endpointText(node);
        if (endpoint?.startsWith("/api/")) {
          let owner = node;
          while (owner.parent && !ts.isCallExpression(owner) && !ts.isVariableStatement(owner) && !ts.isJsxAttribute(owner)) owner = owner.parent;
          const context = owner.getText(sf).slice(0, 500);
          connections.push({
            endpoint,
            file: relative(file),
            line: lineOf(sf, node),
            mutation: /mutationFn|(?:apiRequest|requestJson)\(\s*["'`](POST|PUT|PATCH|DELETE)|method\s*:\s*["'`](POST|PUT|PATCH|DELETE)/i.test(context),
            invalidates: /invalidateQueries/.test(sourceText.slice(node.pos, Math.min(sourceText.length, node.pos + 2500))),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return connections;
}

export function collectUiRoutes() {
  const file = path.join(ROOT, "client", "src", "router.tsx");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = [];
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "path" && node.initializer) {
      const value = ts.isStringLiteral(node.initializer)
        ? node.initializer.text
        : ts.isJsxExpression(node.initializer) && node.initializer.expression
          ? node.initializer.expression.getText(sf)
          : node.initializer.getText(sf);
      const element = node.parent;
      const componentAttribute = element.attributes?.properties?.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sf) === "component",
      );
      routes.push({
        path: value,
        component: componentAttribute?.initializer?.getText(sf) ?? "unknown",
        file: relative(file),
        line: lineOf(sf, node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return routes;
}

export function collectTables() {
  const files = walkFiles(path.join(ROOT, "shared"), [".ts"]);
  const tables = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/export const\s+(\w+)\s*=\s*pgTable\(["']([^"']+)["']/g)) {
      tables.push({ symbol: match[1], table: match[2], file: relative(file), line: text.slice(0, match.index).split(/\r?\n/).length });
    }
  }
  return tables;
}

export const findings = [
  {
    id: "LOGIC-001", severity: "info", classification: "resolved control", capability: "tax.update",
    entryPoints: ["Settings/Tax via governed Master Data routes", "POST/PATCH/DELETE /api/tax-rates and POST /api/tax-rates/:id/set-default"],
    locations: ["server/modules/master-data/register-master-data-routes.ts:161", "server/routes.ts:2422", "server/routes.ts:2432", "server/routes.ts:2452", "server/routes.ts:2482"],
    routes: ["/api/mdm/:domain", "/api/tax-rates", "/api/tax-rates/:id", "/api/tax-rates/:id/set-default"], permissions: ["tax:manage / MDM governance", "authenticated admin plus 2FA on retired legacy mutations"], services: ["MDM change request service", "rejectLegacyTaxMutation"], tables: ["tax_codes", "tax_rates"],
    expectedRule: "Tax master data changes require authentication, tenant scope, validation, audit evidence, and governed change requests for controlled fields.",
    actualBehavior: "Legacy reads require authentication; legacy mutations require an authenticated 2FA admin and return a structured 410 directing callers to governed Tax Codes Master Data.",
    rationale: "The compatibility read surface remains available while all writes have one maker-checker control plane.", impact: "The direct financial-configuration bypass is closed.",
    reproduction: ["POST /api/tax-rates without a session and expect 401", "Call with a 2FA admin and expect GOVERNED_TAX_WORKFLOW_REQUIRED"], testEvidence: ["test:cross-path-invariants: legacy governed mutation guard"], canonicalPath: "/api/mdm/change-requests followed by approve/apply", disposition: "resolved; retain authenticated compatibility reads and retire legacy writes"
  },
  {
    id: "LOGIC-002", severity: "info", classification: "resolved control", capability: "inventory.update",
    entryPoints: ["Protected warehouse routes", "POST/PUT/DELETE /api/warehouse-inventory"], locations: ["server/modules/warehouses/register-warehouse-routes.ts:65", "server/modules/warehouses/register-warehouse-routes.ts:229", "server/modules/warehouses/register-warehouse-routes.ts:245", "server/modules/warehouses/register-warehouse-routes.ts:292"],
    routes: ["/api/warehouses", "/api/warehouse-inventory", "/api/warehouse-inventory/:id"], permissions: ["warehouseRead on balance reads", "warehouseWrite on put-away metadata"], services: ["warehouseRepo", "controlled stock-movement workflows"], tables: ["warehouse_inventory", "stock_movements"],
    expectedRule: "Inventory quantity changes require authenticated inventory permission, tenant-bound lookup, stock-movement evidence, and atomic balance updates.", actualBehavior: "Warehouse balance reads require authentication, direct create/delete return 410, and PUT rejects every field except location, aisle, and bin metadata.", rationale: "Put-away metadata remains editable without exposing the derived quantity balance to CRUD mutation.", impact: "Anonymous disclosure and direct balance manipulation are closed while warehouse put-away remains functional.", reproduction: ["PUT /api/warehouse-inventory/:id with quantity and expect STOCK_MOVEMENT_REQUIRED", "PUT location metadata with warehouse permission and expect success"], testEvidence: ["test:cross-path-invariants: tenant and permission guard matrix"], canonicalPath: "authenticated receipt/issue/adjustment workflow with stock movement", disposition: "resolved; retain metadata-only put-away and controlled stock movements"
  },
  {
    id: "LOGIC-003", severity: "info", classification: "resolved control", capability: "settings.update",
    entryPoints: ["GET /api/settings", "PUT /api/settings"], locations: ["server/routes.ts:883", "server/routes.ts:888", "server/routes.ts:898"], routes: ["GET /api/settings", "PUT /api/settings"], permissions: ["authenticated read", "admin write"], services: ["storage.getAppSettings", "storage.updateAppSettings"], tables: ["app_settings"],
    expectedRule: "Reads are side-effect free; tenant settings are created or changed only by authenticated, audited admin mutations.", actualBehavior: "GET requires authentication and returns the stored settings or an empty object without writing; PUT remains admin-only, validated, and audited.", rationale: "Default creation belongs to explicit tenant bootstrap rather than a read handler.", impact: "Anonymous and unaudited settings creation is closed.", reproduction: ["GET /api/settings without a session and expect 401", "Read an empty database and verify no settings row is created"], testEvidence: ["test:cross-app-logic: authenticated read-only settings contract"], canonicalPath: "explicit authenticated bootstrap/settings service", disposition: "resolved; retain authenticated read-only GET and audited admin PUT"
  },
  {
    id: "LOGIC-004", severity: "info", classification: "resolved control", capability: "diagnostics.update",
    entryPoints: ["Admin diagnostics summary/probes", "GET /api/diagnostics/scan and POST /api/diagnostics/fix"], locations: ["server/routes.ts:954", "server/routes.ts:1036", "server/routes.ts:1170"], routes: ["/api/diagnostics/summary", "/api/diagnostics/scan", "/api/diagnostics/fix"], permissions: ["authenticated admin on reads", "authenticated admin plus 2FA on repair"], services: ["diagnosticsService", "repair handlers"], tables: ["application and filesystem diagnostics"],
    expectedRule: "Diagnostics disclosure and repair actions require authenticated admin authorization and audit evidence.", actualBehavior: "Summary, snapshot, findings, probes, and legacy scan require an authenticated admin; the mutating legacy fix route additionally requires a 2FA-authenticated admin.", rationale: "Equivalent diagnostics paths retain the same authorization boundary, with stronger assurance for repair.", impact: "The confirmed anonymous diagnostics disclosure and repair bypass is closed.", reproduction: ["Call diagnostics routes without a session and expect 401", "Call as a non-admin and expect 403", "Call fix without a 2FA session and expect 403"], testEvidence: ["test:cross-path-invariants: diagnostic permission comparison"], canonicalPath: "/api/diagnostics/summary, /findings, /probes/run", disposition: "resolved; keep legacy scan/fix protected while clients migrate"
  },
  {
    id: "LOGIC-005", severity: "info", classification: "harmless alias", capability: "invoice.match",
    entryPoints: ["/api/ap/invoices/:id/match", "/api/invoices/:id/match"], locations: ["server/modules/accounts-payable/register-ap-routes.ts:343", "server/modules/accounts-payable/register-ap-routes.ts:686"], routes: ["/api/ap/invoices/:id/match", "/api/invoices/:id/match"], permissions: ["apWrite on both"], services: ["matchInvoice"], tables: ["invoices", "ap_invoice_match_results"], expectedRule: "Aliases use identical authentication, permission, validation, tenant scope, workflow service, and audit behavior.", actualBehavior: "Both routes use apWrite and the same matching service; the non-/ap path is a compatibility alias.", rationale: "The duplication is acceptable while clients migrate because the control path is shared.", impact: "No confirmed bypass; maintenance risk if wrappers diverge later.", reproduction: ["Inspect both route registrations", "Compare middleware and called service"], testEvidence: ["test:cross-path-invariants: alias middleware equality"], canonicalPath: "/api/ap/invoices/:id/match", disposition: "retain temporarily; deprecate compatibility alias with a removal date"
  },
  {
    id: "LOGIC-006", severity: "medium", classification: "intentional shared path", capability: "report.export",
    entryPoints: ["POST /api/reports/preview", "POST /api/export-center/custom-export"], locations: ["server/modules/exports/register-export-center-routes.ts:306", "server/modules/exports/register-export-center-routes.ts:369"], routes: ["/api/reports/preview", "/api/export-center/custom-export"], permissions: ["reports:read", "reports:export"], services: ["buildCustomDatasetRows"], tables: ["tenant-scoped dataset registry tables"], expectedRule: "Preview and export share dataset/filter logic and tenant scope; export may require stronger permission.", actualBehavior: "Both paths call buildCustomDatasetRows; export uses the stronger reports:export permission and a larger bounded window.", rationale: "Different presentation and permission are intentional, while the shared row builder prevents report/export drift.", impact: "No confirmed contradiction; the 10,000-row export cap must remain visible to product owners.", reproduction: ["Run preview and export with identical filters on a disposable tenant fixture", "Compare the preview prefix with decompressed export rows"], testEvidence: ["test:cross-app-logic: shared report builder contract"], canonicalPath: "buildCustomDatasetRows through export-center routes", disposition: "retain"
  },
  {
    id: "LOGIC-007", severity: "info", classification: "resolved control", capability: "supplier_bank.change",
    entryPoints: ["Suppliers edit sheet -> PATCH /api/suppliers/:id", "Master Data supplier-banks change-request workflow"], locations: ["client/src/pages/suppliers.tsx:410", "server/modules/suppliers/register-supplier-routes.ts:296", "server/modules/suppliers/register-supplier-routes.ts:324", "server/modules/master-data/mdm-domain-registry.ts:104"],
    routes: ["POST/PATCH /api/suppliers/:id", "/api/mdm/change-requests"], permissions: ["supplierWrite rejects governed fields", "master-data:read + supplier-bank:manage / maker-checker"], services: ["supplierService.update", "MDM change request service"], tables: ["suppliers", "mdm_supplier_bank_accounts", "mdm_change_requests"],
    expectedRule: "Supplier bank changes use the governed supplier-bank domain with independent approval, verification state, masked account data, tenant scope, and audit evidence.", actualBehavior: "Generic supplier create/update returns SUPPLIER_BANK_GOVERNANCE_REQUIRED when bank fields are present; the supplier form omits those fields and links to governed supplier-bank Master Data.", rationale: "Supplier profile maintenance and payment-destination governance now have separate, explicit control planes.", impact: "Generic supplier editing can no longer redirect supplier payments.", reproduction: ["Submit bankName through generic supplier create/update and expect 409", "Use the supplier-bank Master Data maker-checker workflow"], testEvidence: ["test:cross-path-invariants: supplier-bank direct-write contract"], canonicalPath: "supplier-banks MDM change request -> approve -> apply", disposition: "resolved; generic profile rejects bank fields and UI redirects to governed workflow"
  },
  {
    id: "LOGIC-008", severity: "info", classification: "resolved control", capability: "settings.update",
    entryPoints: ["Admin Control Panel -> Security Policy -> GET/PATCH /api/admin/security-policy", "registered authentication and company-settings routes"], locations: ["client/src/components/admin/security-policy-panel.tsx:61", "client/src/components/admin/security-policy-panel.tsx:89", "client/src/pages/admin-control-panel.tsx:161", "server/auth.ts:946"], routes: ["GET /api/admin/security-policy", "PATCH /api/admin/security-policy", "/api/2fa/verify"], permissions: ["admin UI visibility", "no matching backend route"], services: ["none connected"], tables: ["app_settings / users expected, none reached"],
    expectedRule: "A visible security-policy control reads and writes the authoritative backend policy under admin permission and records audit evidence.", actualBehavior: "The disconnected policy editor was removed and the legacy control panel now redirects administrators to the authoritative Security Settings surface.", rationale: "Security defaults are no longer presented as persisted policy.", impact: "The misleading 404-backed security editor is no longer exposed.", reproduction: ["Open the legacy control panel Security tab", "Follow Open Security Settings"], testEvidence: ["test:cross-app-logic: removed unmatched security-policy mutation"], canonicalPath: "/admin/settings/security", disposition: "resolved by redirecting to the canonical settings surface"
  },
  {
    id: "LOGIC-009", severity: "info", classification: "resolved control", capability: "settings.update",
    entryPoints: ["Settings -> Billing -> POST /api/settings/billing", "registered /api/settings control plane"], locations: ["client/src/pages/settings.tsx:331", "client/src/components/settings/billing-settings-form.tsx:208", "server/routes.ts:883", "server/routes.ts:898"], routes: ["GET/POST /api/settings/billing", "GET/PUT /api/settings"], permissions: ["admin settings UI", "no matching billing backend route; admin on PUT /api/settings"], services: ["none connected", "storage.updateAppSettings"], tables: ["app_settings expected"],
    expectedRule: "Every visible Settings tab persists through an authoritative, validated, tenant-scoped service.", actualBehavior: "The disconnected billing form was removed; the tab now routes SaaS billing to Subscription and operational billing to Accounts Payable.", rationale: "The UI no longer claims to persist an unsupported combined billing document.", impact: "Administrators are directed to the two authoritative billing domains.", reproduction: ["Open Settings -> Billing", "Use the Subscription or Accounts Payable links"], testEvidence: ["test:cross-app-logic: removed unmatched billing mutation"], canonicalPath: "/admin/subscription and /finance/accounts-payable", disposition: "resolved by redirecting each billing concern to its owner"
  },
  {
    id: "LOGIC-010", severity: "info", classification: "resolved control", capability: "profile.update",
    entryPoints: ["Profile/Security forms -> /api/user/profile, /api/user/security-preferences, /api/user/change-password", "registered /api/change-password and /api/profile/picture routes"], locations: ["client/src/pages/profile.tsx:68", "client/src/pages/profile.tsx:168", "client/src/pages/profile.tsx:192", "client/src/pages/profile.tsx:213", "server/auth.ts:1071", "server/routes.ts:2792"], routes: ["PATCH /api/user/profile", "GET/PATCH /api/user/security-preferences", "POST /api/user/change-password", "POST /api/change-password"], permissions: ["authenticated profile UI", "no matching backend routes for three /api/user paths"], services: ["none connected", "authentication password-change handler"], tables: ["users expected"],
    expectedRule: "Profile, 2FA/security preferences, and password controls call authenticated backend routes with matching validation and persisted outcomes.", actualBehavior: "Profile and security-preference routes are implemented with validation and safe responses; password changes use the existing authenticated /api/change-password route; 2FA status is read-only outside the verified setup flow.", rationale: "Client and server now share one route contract without silent security fallbacks.", impact: "Profile, preferences, and password changes reach authoritative handlers.", reproduction: ["Open Profile", "Save profile and preferences", "Change password through /api/change-password"], testEvidence: ["test:cross-app-logic: matched profile/security routes"], canonicalPath: "/api/user/profile, /api/user/security-preferences, /api/change-password", disposition: "resolved"
  },
  {
    id: "LOGIC-011", severity: "info", classification: "resolved control", capability: "logic_audit.verify",
    entryPoints: ["npm run audit:logic-connections", "npm run verify:logic-connections"], locations: ["scripts/logic-audit-lib.mjs:315", "scripts/verify-logic-connections.mjs:7"],
    routes: ["generated releaseStatus", "verification release-status assertion"], permissions: ["not applicable; build-time verification"], services: ["buildAudit", "verify-logic-connections"], tables: ["artifacts/cross-app-logic-audit.json"],
    expectedRule: "The verifier requires BLOCKED while unresolved critical/high findings exist and accepts PASS only after both counts reach zero.", actualBehavior: "The verifier now derives the expected status from the generated critical/high counts instead of unconditionally requiring BLOCKED.", rationale: "A hard-coded BLOCKED assertion contradicted the audit generator after all release-blocking findings were resolved and produced a false release failure.", impact: "The logic gate now fails on both unsafe false passes and stale false blocks.", reproduction: ["Generate an audit with zero critical/high findings", "Run node scripts/verify-logic-connections.mjs", "Expect PASS; add a critical fixture and expect BLOCKED"], testEvidence: ["test:cross-app-logic: release-status/count equivalence", "verify:logic-connections: generated artifact verification"], canonicalPath: "buildAudit releaseStatus derived from unresolved critical/high counts", disposition: "resolved; retain the bidirectional status invariant"
  },
  {
    id: "LOGIC-012", severity: "info", classification: "resolved control", capability: "goods_receipt.receive",
    entryPoints: ["Mobile Receive queue -> fetchPurchaseOrdersPageEnvelope", "release core-screen workflow contract"], locations: ["client/src/pages/mobile-receive.tsx:24", "client/src/pages/mobile-receive.tsx:46", "scripts/test-core-screen-workflow-contracts.mjs:22"],
    routes: ["GET /api/v2/procurement/purchase-orders?statuses=approved,sent,partially_received", "/m/receive"], permissions: ["authenticated mobile receive surface", "release-time source contract"], services: ["fetchPurchaseOrdersPageEnvelope", "v2 purchase-order list service"], tables: ["purchase_orders"],
    expectedRule: "The mobile receive queue and its release contract identify the same canonical paginated purchase-order query and the complete set of receivable statuses.", actualBehavior: "The queue correctly migrated to the paginated v2 query, but the release contract still required the retired fetchPurchaseOrdersEnvelope symbol and failed after all runtime workflow checks passed. The contract now asserts fetchPurchaseOrdersPageEnvelope plus approved, sent, and partially_received filters.", rationale: "A release guard tied to an obsolete implementation symbol reports a broken workflow even when the visible action is connected to the newer, bounded query path; the guard must verify the canonical connection and business-status scope.", impact: "The stale guard blocked release verification and could encourage reverting pagination, while the runtime receive path itself remained connected and governed.", reproduction: ["Run npm run verify:release", "Observe test:core-screen-workflow-contracts reject /m/receive for missing fetchPurchaseOrdersEnvelope", "Inspect mobile-receive.tsx and confirm the paginated v2 query with all receivable statuses"], testEvidence: ["verify:release: stale mobile receive contract reproduced", "test:core-screen-workflow-contracts: canonical paginated connection"], canonicalPath: "fetchPurchaseOrdersPageEnvelope -> GET /api/v2/procurement/purchase-orders with receivable statuses", disposition: "resolved; retain paginated v2 path and update the release contract when the canonical client abstraction changes"
  },
  {
    id: "LOGIC-013", severity: "info", classification: "resolved control", capability: "master_data.govern",
    entryPoints: ["Admin Master Data page header and governance expander", "release control-plane screen contract"], locations: ["client/src/pages/master-data.tsx:1705", "client/src/pages/master-data.tsx:1747", "scripts/test-control-plane-screen-contracts.mjs:57"],
    routes: ["/admin/master-data", "/api/mdm/control-centre/health", "/api/mdm/data-quality/issues"], permissions: ["master-data read/steward/approver/admin controls", "release-time source contract"], services: ["MasterDataPage", "MDM control-centre and data-quality services"], tables: ["mdm_change_requests", "master-data domain tables"],
    expectedRule: "The control-plane release contract verifies stable governance behavior and connections without requiring obsolete presentation copy.", actualBehavior: "The page title was simplified from Master Data & Control Centre to Master Data while the governed controls remained available under the explicit Governance and data quality expander. The stale contract rejected the removed heading; it now verifies both the current page title and the still-visible governance entry point.", rationale: "A copy-only assertion does not prove the control plane is connected and can falsely block a safe information-architecture improvement; the contract should anchor the governance affordance and API evidence.", impact: "The stale assertion blocked release verification despite the maker-checker, dependency, quality, permission, and invalidation evidence remaining present.", reproduction: ["Run npm run verify:release after the Master Data header simplification", "Observe test:control-plane-screen-contracts require the retired heading", "Confirm the Governance and data quality expander and MDM API connections remain in the page"], testEvidence: ["verify:release: stale Master Data heading contract reproduced", "test:control-plane-screen-contracts: current title plus governance entry point"], canonicalPath: "/admin/master-data -> Governance and data quality -> governed /api/mdm routes", disposition: "resolved; retain the simplified page title and behavior-oriented contract"
  }
];

export function buildAudit() {
  const serverRoutes = collectServerRoutes();
  const clientConnections = collectClientConnections();
  const uiRoutes = collectUiRoutes();
  const tables = collectTables();
  const serverRouteKeys = new Set(serverRoutes.map((route) => route.route.replace(/:\w+/g, ":param")));
  const unmatchedClientConnections = clientConnections.filter((connection) => {
    const normalized = connection.endpoint.split("?")[0].replace(/\$\{[^}]+\}/g, ":param");
    return !serverRouteKeys.has(normalized);
  });
  const grouped = Object.values(serverRoutes.reduce((acc, route) => {
    (acc[route.capability] ??= { capability: route.capability, entryPoints: [] }).entryPoints.push(route);
    return acc;
  }, {}));
  const supplierUpdate = grouped.find((entry) => entry.capability === "supplier.update");
  if (supplierUpdate) {
    grouped.push({
      capability: "supplier_bank.change",
      entryPoints: supplierUpdate.entryPoints.filter((route) => route.route === "/api/suppliers/:id"),
      semanticProjection: "Generic supplier updates reject governed bank fields; see resolved LOGIC-007.",
    });
  }
  for (const group of grouped) {
    const routeKeys = new Set(group.entryPoints.map((route) => route.route.replace(/:\w+/g, ":param")));
    group.clientEntryPoints = clientConnections.filter((connection) => routeKeys.has(connection.endpoint.split("?")[0]));
  }
  const runtimeEvidencePath = path.join(ROOT, "artifacts", "cross-app-logic-runtime-evidence.json");
  const runtimeEvidence = fs.existsSync(runtimeEvidencePath)
    ? JSON.parse(fs.readFileSync(runtimeEvidencePath, "utf8"))
    : { passed: false, reason: "test:cross-path-invariants has not completed against a disposable database" };
  const critical = findings.filter((finding) => finding.severity === "critical").length;
  const high = findings.filter((finding) => finding.severity === "high").length;
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), releaseStatus: critical || high ? "BLOCKED" : "PASS", summary: { uiRoutes: uiRoutes.length, serverRoutes: serverRoutes.length, mutatingRoutes: serverRoutes.filter((route) => route.mutating).length, clientConnections: clientConnections.length, schemaTables: tables.length, findings: findings.length, critical, high }, uiRoutes, capabilityMap: grouped, clientConnections, unmatchedClientConnections, tables, findings, runtimeEvidence };
}

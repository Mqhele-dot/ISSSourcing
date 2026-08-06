import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const routes = read("server/routes.ts");
const routeDiagnostics = read("client/src/lib/diagnostics/route-diagnostics.ts");
const extractorController = read("server/controllers/document-extractor-controller.ts");
const extractorService = read("server/services/document-extractor-service.ts");
const extractorPage = read("client/src/pages/document-extractor-page.tsx");
const queryClient = read("client/src/lib/queryClient.ts");
const recognitionController = read("server/controllers/image-recognition-controller.ts");
const recognitionUpload = read("client/src/components/inventory/image-recognition-upload.tsx");
const documentRoutes = read("server/modules/documents/register-document-routes.ts");
const documentsPage = read("client/src/pages/documents.tsx");
const integrationRoutes = read("server/operations-routes.ts");
const integrationsPage = read("client/src/pages/integrations.tsx");
const auditLogsPage = read("client/src/pages/audit-logs.tsx");
const router = read("client/src/router.tsx");
const sectionMetadata = read("client/src/lib/routes/section-metadata.ts");

assert.match(routes, /organization_id::text = \$1::text/, "diagnostics must compare fixture tenant IDs safely");
assert.match(routeDiagnostics, /training-lesson-page/, "lesson routes need their own render marker");
assert.match(routeDiagnostics, /path === "\/get-educated"/, "the education root must retain its root marker");

assert.match(extractorController, /REMOTE_DOCUMENT_EXTRACTION_DISABLED/);
assert.match(extractorController, /SERVER_PATH_EXTRACTION_DISABLED/);
assert.match(extractorController, /ensureRole\(\['admin'\]\)/);
assert.match(extractorController, /\['inventory', 'suppliers', 'categories'\]\.includes\(targetSchema\)/);
assert.doesNotMatch(extractorService, /rejectUnauthorized\s*:\s*false/);
assert.doesNotMatch(extractorService, /processFromUrls/);
assert.doesNotMatch(extractorPage, /value="url"/);
assert.match(extractorPage, /formData\.append\('data', JSON\.stringify\(extractionResult\.data\)\)/);

assert.match(queryClient, /data instanceof FormData/);
assert.match(queryClient, /isFormData \? data : JSON\.stringify\(data\)/);
assert.match(recognitionController, /ensurePermission\('inventory', 'read'\)/);
assert.match(recognitionController, /ensurePermission\('inventory', 'create'\)/);
assert.match(recognitionUpload, /Create Item Unavailable/);
assert.match(recognitionUpload, /sample match, not an AI identification/);
assert.doesNotMatch(recognitionUpload, /<Sheet/);

assert.match(documentRoutes, /fileAvailable/);
assert.match(documentRoutes, /\/api\/documents\/:id\/download/);
assert.match(documentRoutes, /documentEntityExists/);
assert.match(documentsPage, /File unavailable/);
assert.doesNotMatch(documentsPage, /processingReference|processingNotes/);

assert.match(integrationRoutes, /INTEGRATION_CONNECTOR_NOT_CONFIGURED/);
assert.doesNotMatch(integrationRoutes, /runOperationalConnector/);
assert.match(integrationsPage, /did not exchange data with an external system/);
assert.doesNotMatch(integrationsPage, /Run now/);

assert.doesNotMatch(auditLogsPage, /Run reminders/);
assert.match(auditLogsPage, /Export current page CSV/);
assert.match(auditLogsPage, /summary\.details/);

assert.match(router, /path=\{APP_ROUTES\.admin\.downloads\}[\s\S]*?Redirect to=\{APP_ROUTES\.analytics\.exportCenter\}/);
assert.doesNotMatch(sectionMetadata, /label: "Downloads"/);

console.log("Admin tools reliability contracts passed.");

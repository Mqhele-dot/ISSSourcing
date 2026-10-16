import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");

const masterDataUi = read("client/src/pages/master-data.tsx");
const masterDataApi = read("server/modules/master-data/register-master-data-routes.ts");
const approvalUi = read("client/src/pages/approval-policies.tsx");
const approvalApi = read("server/modules/master-data/register-master-data-routes.ts");
const reportsApi = read("server/modules/exports/register-export-center-routes.ts");
const header = read("client/src/components/layout/header.tsx");
const notificationsApi = read("server/modules/notifications/register-notification-routes.ts");
const notificationEmitter = read("server/services/notification-emitter.ts");
const router = read("client/src/router.tsx");
const onboardingHint = read("client/src/components/tutorial/tutorial-page-hint.tsx");

assert.match(masterDataUi, /const pageSize = 25/);
assert.match(masterDataUi, /`Showing \$\{/);
assert.match(masterDataUi, /sticky top-0/);
assert.match(masterDataApi, /Math\.min\(100/);

assert.match(approvalUi, /const pageSize = 25/);
assert.match(approvalUi, /Page \{page\} of \{totalPages\}/);
assert.match(approvalApi, /APPROVAL_POLICY_OVERLAP/);
assert.match(approvalApi, /pageSize/);

assert.match(reportsApi, /\/api\/reports\/preview/);
assert.match(reportsApi, /pageSize:\s*z\.coerce\.number\(\).*max\(100\)/);
assert.match(reportsApi, /CUSTOM_REPORT_EXPORT_FAILED/);

assert.match(header, /unreadCount > 99 \? "99\+"/);
assert.match(header, /pageSize=8/);
assert.match(header, /Mark all read/);
assert.match(notificationsApi, /organization_id = \$1 AND user_id = \$2/);
assert.match(notificationsApi, /\/api\/notifications\/mark-all-read/);
assert.match(notificationEmitter, /occurrenceCount:\s*sql/);
assert.match(notificationEmitter, /entityTypeCondition/);
assert.match(notificationEmitter, /entityIdCondition/);

assert.match(router, /path=\{APP_ROUTES\.finance\.billing\}/);
assert.match(router, /<Redirect to=\{APP_ROUTES\.finance\.invoices\}/);
assert.doesNotMatch(onboardingHint, /sticky\s+top-/);

console.log("High-volume UI, export, notification, and route stability contracts passed.");

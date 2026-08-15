import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const schema = read("shared/schema.ts");
const workflow = read("server/services/approval-workflow-service.ts");
const rbac = read("server/modules/rbac/register-rbac-routes.ts");
const profiles = read("client/src/pages/employee-profiles.tsx");
const userRoutes = read("server/routes.ts");
const migration = read("migrations/20260815143000_employee_governance_tracker.sql");

assert.match(schema, /userApprovalLimits/);
assert.match(schema, /user_approval_limits_org_user_entity_uidx/);
assert.match(workflow, /APPROVAL_LIMIT_EXCEEDED/);
assert.match(workflow, /userApprovalLimits\.organizationId/);
assert.match(rbac, /\/api\/rbac\/users\/:id\/approval-limits/);
assert.match(rbac, /\/api\/rbac\/users\/:id\/governance-events/);
assert.match(rbac, /FROM audit_logs/);
assert.match(rbac, /UNION ALL/);
assert.match(rbac, /FROM approval_history/);
assert.match(rbac, /USER_APPROVAL_LIMITS_UPDATED/);
assert.match(rbac, /appendAuditEventWithClient\(client/);
assert.match(profiles, /Governance and approval tracker/);
assert.match(profiles, /Reason for authority change/);
assert.match(profiles, /View before and after evidence/);
assert.ok(!profiles.includes('"/api/activity-logs?limit=100"'), "employee tracker must use its bounded governance endpoint");
assert.match(userRoutes, /USER_CHANGE_REASON_REQUIRED/);
assert.match(migration, /approver_amount_limit/);

console.log("Employee governance tracker and approval authority contracts passed.");

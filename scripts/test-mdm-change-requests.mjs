import { readFileSync } from "node:fs";

const service = readFileSync("server/modules/master-data/mdm-change-request-service.ts", "utf8");
const routes = readFileSync("server/modules/master-data/register-master-data-routes.ts", "utf8");
const initDb = readFileSync("server/init-db.ts", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(initDb, "CREATE TABLE IF NOT EXISTS mdm_change_requests", "change request table");
assertIncludes(initDb, "CREATE TABLE IF NOT EXISTS mdm_change_request_steps", "change request step table");
assertIncludes(initDb, "CREATE TABLE IF NOT EXISTS mdm_change_request_comments", "change request comment table");
assertIncludes(service, "MDM_MAKER_CANNOT_APPROVE", "maker-checker self-approval block");
assertIncludes(service, "pending_approval", "high-risk pending approval status");
assertIncludes(service, "approved_by", "approval actor persistence");
assertIncludes(service, "decided_at", "approval timestamp persistence");
assertIncludes(routes, '"/api/mdm/change-requests"', "change request list/create route");
assertIncludes(routes, '"/api/mdm/change-requests/:id/approve"', "change request approval route");

console.log("MDM change request contracts passed.");

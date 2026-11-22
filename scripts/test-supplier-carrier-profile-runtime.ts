import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import express from "express";
import { getTableConfig } from "drizzle-orm/pg-core";
import "dotenv/config";
import type { Supplier } from "../shared/schema";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

if (!process.argv.includes("--local-disposable")) throw new Error("Use --local-disposable; no database was created.");
const configured = process.env.DATABASE_URL || (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD
  ? `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/postgres` : undefined);
assert.ok(configured);
const url = new URL(configured);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)); url.pathname = "/postgres";
const name = `iss_supplier_test_${randomUUID().replaceAll("-", "")}`;
const owner = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
let created = false, pool: pg.Pool | undefined;
let server: ReturnType<express.Express["listen"]> | undefined;
let uploads: string | undefined;
console.log(JSON.stringify({ kind: "supplier-carrier-test-identity", database: name }));
try {
  await owner.connect(); await owner.query(`CREATE DATABASE "${name}"`); created = true;
  url.pathname = `/${name}`; assertDisposableDatabaseUrl(url.toString());
  process.env.TEST_DATABASE_URL = url.toString(); process.env.DATABASE_URL = url.toString(); process.env.NODE_ENV = "test";
  uploads = await mkdtemp(path.join(os.tmpdir(), "iss-supplier-compliance-"));
  process.env.TEST_UPLOADS_DIR = uploads;
  pool = (await import("../server/db")).pool;
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, name);
  await pool.query(`CREATE TABLE carriers(id serial PRIMARY KEY, organization_id int NOT NULL, supplier_id int,
    code text NOT NULL, name text NOT NULL, contact text, active boolean DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), UNIQUE(organization_id,code));
    INSERT INTO carriers(organization_id,supplier_id,code,name)
    SELECT 2,n,'FOREIGN-'||n,'Foreign carrier '||n FROM generate_series(1,5000)n;`);
  const { syncCarrierProfile } = await import("../server/modules/suppliers/carrier-profile");
  const supplier = (id: number, overrides: Partial<Supplier> = {}) => ({ id, organizationId: 1, name: `Synthetic supplier ${id}`,
    supplierType: "goods", supplierCode: null, status: "prospective", onboardingStatus: "prospective",
    logisticsContactName: null, email: null, phone: null, ...overrides } as Supplier);
  const foreignDigest = async () => (await pool!.query("SELECT md5(string_agg(row_to_json(c)::text,',' ORDER BY id)) digest FROM carriers c WHERE organization_id=2")).rows[0].digest;
  const before = await foreignDigest();
  for (const supplierType of ["goods", "service", "contractor", "fuel", null]) {
    await syncCarrierProfile(1, supplier(1, { supplierType }));
  }
  assert.equal((await pool.query("SELECT count(*) FROM carriers WHERE organization_id=1")).rows[0].count, "0", "A non-carrier without a linked profile is a no-op, not a failure or invented carrier.");
  await pool.query("INSERT INTO carriers(organization_id,supplier_id,code,name,active) VALUES(1,2,'ACTIVE','Active',true),(1,3,'INACTIVE','Inactive',false),(1,4,'UNKNOWN','Unknown',null)");
  const inactiveBefore = (await pool.query("SELECT updated_at FROM carriers WHERE organization_id=1 AND supplier_id=3")).rows[0].updated_at;
  for (const id of [2, 3, 4]) await syncCarrierProfile(1, supplier(id));
  assert.deepEqual((await pool.query("SELECT active FROM carriers WHERE organization_id=1 ORDER BY supplier_id")).rows.map(row => row.active), [false, false, false]);
  assert.deepEqual((await pool.query("SELECT updated_at FROM carriers WHERE organization_id=1 AND supplier_id=3")).rows[0].updated_at, inactiveBefore, "An already inactive profile is unchanged.");
  await syncCarrierProfile(1, supplier(5, { supplierType: " CARRIER ", supplierCode: "road", logisticsContactName: "Dispatch" }));
  await syncCarrierProfile(1, supplier(5, { supplierType: "carrier", supplierCode: "road", logisticsContactName: "Dispatch", status: "active", onboardingStatus: "approved" }));
  assert.deepEqual((await pool.query("SELECT code,contact,active FROM carriers WHERE organization_id=1 AND supplier_id=5")).rows, [{ code: "ROAD", contact: "Dispatch", active: true }]);
  assert.equal((await pool.query("SELECT count(*) FROM carriers WHERE organization_id=1 AND supplier_id=5")).rows[0].count, "1", "Sequential replay updates the existing projection.");
  await syncCarrierProfile(1, supplier(6, { supplierType: "logistics_provider", status: "active", onboardingStatus: "prospective", email: "synthetic@example.test" }));
  assert.deepEqual((await pool.query("SELECT code,active,contact FROM carriers WHERE organization_id=1 AND supplier_id=6")).rows, [{ code: "CAR-6", active: false, contact: "synthetic@example.test" }]);
  await pool.query("INSERT INTO carriers(organization_id,code,name) VALUES(1,'LEGACY',' Adoptable '),(1,'CLASH','Another party')");
  const legacyId = (await pool.query("SELECT id FROM carriers WHERE organization_id=1 AND code='LEGACY'")).rows[0].id;
  await syncCarrierProfile(1, supplier(7, { supplierType: "carrier", supplierCode: "LEGACY", name: "adoptable" }));
  assert.equal((await pool.query("SELECT id FROM carriers WHERE organization_id=1 AND supplier_id=7")).rows[0].id, legacyId);
  await syncCarrierProfile(1, supplier(8, { supplierType: "carrier", supplierCode: "CLASH" }));
  assert.equal((await pool.query("SELECT code FROM carriers WHERE organization_id=1 AND supplier_id=8")).rows[0].code, "CLASH-8");
  assert.equal((await pool.query("SELECT supplier_id FROM carriers WHERE organization_id=1 AND code='CLASH'")).rows[0].supplier_id, null);
  assert.equal(await foreignDigest(), before, "All 5,000 foreign-tenant projections remain unchanged.");
  const { suppliers } = await import("../shared/schema");
  const columns = getTableConfig(suppliers).columns.map(column => `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`);
  await pool.query(`CREATE TABLE suppliers(${columns.join(",")});
    CREATE TABLE organizations(id int PRIMARY KEY,country_code text,active boolean);
    INSERT INTO organizations VALUES(1,'US',true),(2,'US',true);
    CREATE TABLE audit_logs(id serial PRIMARY KEY, organization_id int, user_id int, action text, resource_type text, resource_id int, details jsonb, reason text, previous_hash text, event_hash text, hash_version int, request_id text, ip_address text, user_agent text, created_at timestamp);
    CREATE TABLE mdm_supplier_documents(id serial PRIMARY KEY, organization_id int, supplier_id int, document_type text, document_id int, status text, expiry_date timestamp, required_for_po boolean, created_at timestamp, updated_at timestamp);
    CREATE TABLE users(id int PRIMARY KEY,active boolean,warehouse_id int);
    INSERT INTO users VALUES(1,true,null),(3,true,null);
    CREATE TABLE organization_members(id int PRIMARY KEY,organization_id int,user_id int,active boolean,status text,application_role text);
    INSERT INTO organization_members VALUES(1,1,1,true,'active','admin'),(3,1,3,true,'active','admin');
    CREATE TABLE documents(id int PRIMARY KEY, organization_id int, entity_type text, entity_id int, file_name text, file_url text, mime_type text, file_size int, checksum text, version int, uploaded_at timestamp, archived_at timestamp, last_verified_at timestamp);
    CREATE TABLE mdm_change_requests(id serial PRIMARY KEY,organization_id int,domain text,entity_id int,action text,proposed_patch jsonb,before_state jsonb,risk_level text,status text,submitted_by int,approved_by int,decided_at timestamp,reason text,target_version int,created_at timestamp);
    CREATE TABLE mdm_change_request_steps(organization_id int,change_request_id int,step text,status text,actor_id int,reason text,before_state jsonb,after_state jsonb,created_at timestamp);
    INSERT INTO suppliers(organization_id,name,supplier_type,status,onboarding_status,created_by_user_id,updated_at) VALUES
      (1,'Owned fixture','goods','prospective','prospective',1,'2026-01-01'),(2,'Foreign fixture','goods','prospective','prospective',2,'2026-01-01');`);
  const migration = await readFile("migrations/20261108090000_supplier_observations.sql", "utf8");
  await pool.query(migration); await pool.query(migration);
  const { registerSupplierRoutes } = await import("../server/modules/suppliers/register-supplier-routes");
  const { runWithTenantContext } = await import("../server/organization-context");
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    const userId = req.get("Test-Independent-Approver") ? 3 : 1;
    Object.assign(req, { user: { id: userId, role: "manager" } });
    runWithTenantContext({ organizationId: 1, membershipId: userId, userId, userRole: "manager", membershipRole: "admin", effectivePermissions: [], correlationId: "supplier-command-test" }, next);
  });
  const allow: express.RequestHandler = (_req, _res, next) => next();
  registerSupplierRoutes(app, { ensureAuthenticated: allow, ensureTwoFactorAuthenticated: allow, ensureRole: () => allow,
    ensurePermission: (resource, action) => (req, res, next) => {
      if (req.get("Test-Deny-Permission") === `${resource}:${action}`) { res.sendStatus(403); return; }
      next();
    } });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => server!.once("listening", resolve).once("error", reject));
  const call = async (method: string, path: string, body: object, deny?: string, independent = false) => fetch(`http://127.0.0.1:${(server!.address() as { port: number }).port}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(deny ? { "Test-Deny-Permission": deny } : {}), ...(independent ? { "Test-Independent-Approver": "1" } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  const snapshot = async () => (await pool!.query("SELECT * FROM suppliers ORDER BY id")).rows;
  const original = await snapshot();
  const attemptedMove = await call("PATCH", "/api/suppliers/1", { organizationId: 2 });
  const movedRow = (await snapshot())[0];
  assert.equal(attemptedMove.status, 409, `Tenant move must be denied (stored organization: ${movedRow.organization_id}).`);
  for (const method of ["PUT", "PATCH", "POST"]) {
    const path = method === "POST" ? "/api/suppliers" : "/api/suppliers/1";
    for (const body of [{ organizationId: 2 }, { organization_id: 2 }, { createdByUserId: 2 }, { approvedByUserId: 2 }, { approvedAt: null }, { onboardingStatus: "approved" }, { complianceStatus: "compliant" }]) {
      assert.equal((await call(method, path, { name: "Must not write", ...body })).status, 409);
    }
    for (const field of ["bankName", "bankAccountNumber", "bankSwift", "bank_name", "bank_account_number", "bank_swift"]) {
      const rejected = await call(method, path, { name: "Must not write", [field]: "Synthetic forbidden banking detail" });
      assert.equal(rejected.status, 409);
      assert.equal((await rejected.json()).error.code, "SUPPLIER_BANK_GOVERNANCE_REQUIRED");
    }
  }
  for (const [method, path, permission] of [["POST", "/api/suppliers", "create"], ["PUT", "/api/suppliers/1", "update"], ["PATCH", "/api/suppliers/1", "update"], ["POST", "/api/suppliers/1/approve", "update"]]) {
    assert.equal((await call(method, path, { name: "Must not write", reason: "Test reason" }, `suppliers:${permission}`)).status, 403);
  }
  assert.equal((await call("PATCH", "/api/suppliers/2", { name: "Foreign write" })).status, 404);
  assert.deepEqual(await snapshot(), original);
  assert.equal((await pool.query("SELECT count(*) FROM audit_logs")).rows[0].count, "0");
  const approvalPath = "/api/suppliers/1/approve";
  const profile = await fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/suppliers/1`);
  assert.equal(profile.status, 200);
  const reason = "Independent onboarding fixture", expectedRevision = (await profile.json()).updatedAt;
  const approval = { reason, expectedRevision };
  assert.equal((await call("POST", approvalPath, approval)).status, 403);
  assert.equal((await call("POST", "/api/suppliers/2/approve", approval, undefined, true)).status, 404);
  await pool.query(`UPDATE suppliers SET supplier_type='carrier',default_currency_code='USD',payment_terms_id=1,tax_code_id=1 WHERE id=1;
    INSERT INTO mdm_supplier_documents(organization_id,supplier_id,document_type,status,expiry_date) VALUES
      (1,1,'taxForm','approved',now()+interval '1 day'),(1,1,'bankVerification','approved',now()+interval '1 day'),
      (1,1,'businessRegistration','approved',now()-interval '1 day'),(2,1,'businessRegistration','approved',now()+interval '1 day');`);
  assert.equal((await call("POST", approvalPath, approval, undefined, true)).status, 409, "Mutable legacy labels cannot satisfy approval.");
  assert.equal((await call("POST", approvalPath, { ...approval, expectedRevision: "2025-01-01T00:00:00.000Z" }, undefined, true)).status, 409);
  const { documentsDir } = await import("../server/http/upload-config");
  const { appendAuditEventWithClient } = await import("../server/services/audit-chain-service");
  const { createMdmChangeRequest, approveMdmChangeRequest, applyMdmChangeRequest } = await import("../server/modules/master-data/mdm-change-request-service");
  const { readPublishedSupplierCompliance } = await import("../server/modules/master-data/governed-supplier-compliance");
  assert.equal(path.dirname(documentsDir), uploads);
  await mkdir(documentsDir, { recursive: true });
  const filename = "synthetic-compliance.txt", bytes = Buffer.from("test evidence only"), sha256 = createHash("sha256").update(bytes).digest("hex"), fileUrl = `/uploads/documents/${filename}`;
  await writeFile(path.join(documentsDir, filename), bytes);
  await pool.query(`INSERT INTO documents VALUES(100,1,'supplier',1,$1,$2,'text/plain',$3,$4,1,now(),null,null),(200,2,'supplier',2,$1,$2,'text/plain',$3,$4,1,now(),null,null)`, [filename, fileUrl, bytes.length, sha256]);
  const proofClient = await pool.connect();
  try { await proofClient.query("BEGIN"); await appendAuditEventWithClient(proofClient, { organizationId: 1, actor: { userId: 1 }, action: "DOCUMENT_FILE_STORED_V1", resourceType: "document", resourceId: 100, details: { fileName: filename, fileUrl, fileSize: bytes.length, sha256, entityType: "supplier", entityId: 1, mimeType: "text/plain" } }); await proofClient.query("COMMIT"); }
  finally { proofClient.release(); }
  const as = <T>(userId: number, callback: () => Promise<T>) => runWithTenantContext({ organizationId: 1, membershipId: userId, userId, userRole: "admin", membershipRole: "admin", effectivePermissions: [], correlationId: "supplier-compliance-test" }, callback);
  const submit = async (documentType: string, documentId = 100) => {
    const row = await createMdmChangeRequest({ organizationId: 1, domain: "supplier-documents", action: "create", submittedBy: 1, proposedPatch: { supplierId: 1, documentType, documentId, expiryDate: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(row.status, "pending_approval"); return Number(row.id);
  };
  const command = (id: number, actorId = 3) => ({ organizationId: 1, id, actorId, reason });
  const foreignRequest = await submit("taxForm", 200);
  await assert.rejects(() => as(3, () => approveMdmChangeRequest(command(foreignRequest))), { code: "SUPPLIER_COMPLIANCE_SOURCE_UNVERIFIED" });
  for (const type of ["taxForm", "bankVerification", "businessRegistration"]) {
    const id = await submit(type);
    await assert.rejects(() => as(1, () => approveMdmChangeRequest(command(id, 1))), { code: "SUPPLIER_COMPLIANCE_INDEPENDENT_APPROVAL" });
    await assert.rejects(() => as(3, () => approveMdmChangeRequest({ ...command(id), allowAdminOverride: true })), { code: "SUPPLIER_COMPLIANCE_OVERRIDE_DENIED" });
    await as(3, () => approveMdmChangeRequest(command(id)));
    await pool.query("UPDATE documents SET version=2 WHERE id=100");
    await assert.rejects(() => as(3, () => applyMdmChangeRequest(command(id))), { code: "SUPPLIER_COMPLIANCE_STALE" });
    await pool.query("UPDATE documents SET version=1 WHERE id=100");
    await pool.query("ALTER TABLE audit_logs ADD CONSTRAINT force_compliance_failure CHECK(action <> 'SUPPLIER_COMPLIANCE_PUBLISHED') NOT VALID");
    await assert.rejects(() => as(3, () => applyMdmChangeRequest(command(id))), { code: "23514" });
    assert.equal((await pool.query("SELECT count(*) FROM supplier_compliance_publications WHERE change_request_id=$1", [id])).rows[0].count, "0");
    assert.equal((await pool.query("SELECT status FROM mdm_change_requests WHERE id=$1", [id])).rows[0].status, "approved");
    await pool.query("ALTER TABLE audit_logs DROP CONSTRAINT force_compliance_failure");
    const published = await as(3, () => applyMdmChangeRequest(command(id)));
    assert.deepEqual(await as(3, () => applyMdmChangeRequest(command(id))), published);
  }
  const complianceClient = await pool.connect();
  try { assert.ok((await readPublishedSupplierCompliance(complianceClient, 1, 1, new Date(Date.now() + 172800000))).every(row => row.state === "expired")); }
  finally { complianceClient.release(); }
  await assert.rejects(() => pool!.query("UPDATE supplier_compliance_publications SET withdrawn=true"), /immutable/);
  await pool.query("ALTER TABLE audit_logs ADD CONSTRAINT force_approval_failure CHECK(action <> 'SUPPLIER_ONBOARDING_APPROVED')");
  const beforeApproval = await snapshot();
  const carrierSnapshot = async () => (await pool!.query("SELECT * FROM carriers WHERE organization_id=1 ORDER BY id")).rows;
  const beforeCarriers = await carrierSnapshot();
  const rejected = await call("POST", approvalPath, approval, undefined, true);
  assert.equal(rejected.status, 500, await rejected.text());
  assert.deepEqual(await snapshot(), beforeApproval, "Failed audit must roll back supplier activation.");
  assert.deepEqual(await carrierSnapshot(), beforeCarriers, "Failed audit must roll back carrier publication.");
  assert.equal((await pool.query("SELECT count(*) FROM audit_logs WHERE action='SUPPLIER_ONBOARDING_APPROVED'")).rows[0].count, "0");
  await pool.query("ALTER TABLE audit_logs DROP CONSTRAINT force_approval_failure");
  const approvals = await Promise.all([call("POST", approvalPath, approval, undefined, true), call("POST", approvalPath, approval, undefined, true)]);
  assert.deepEqual(approvals.map(reply => reply.status), [200, 200], "Equivalent concurrent approval replays must be safe.");
  assert.equal((await call("POST", approvalPath, { ...approval, reason: "Different approval" }, undefined, true)).status, 409);
  assert.equal((await snapshot())[0].approved_by_user_id, 3);
  assert.deepEqual((await pool.query("SELECT active FROM carriers WHERE organization_id=1 AND supplier_id=1")).rows, [{ active: true }]);
  assert.equal((await pool.query("SELECT count(*) FROM audit_logs WHERE organization_id=1 AND action='SUPPLIER_ONBOARDING_APPROVED'")).rows[0].count, "1");
  const beforeProfile = await snapshot();
  const beforeProfileCarriers = await carrierSnapshot();
  await pool.query(`ALTER TABLE audit_logs ADD CONSTRAINT force_profile_failure CHECK(action NOT IN ('SUPPLIER_ONBOARDING_STARTED','SUPPLIER_PROFILE_UPDATED'));`);
  assert.equal((await call("POST", "/api/suppliers", { name: "Failed carrier create", supplierType: "carrier" })).status, 500);
  assert.equal((await call("PATCH", "/api/suppliers/1", { name: "Failed carrier update" })).status, 500);
  assert.deepEqual(await snapshot(), beforeProfile, "Both profile writes roll back on audit failure.");
  assert.deepEqual(await carrierSnapshot(), beforeProfileCarriers, "Both carrier projections roll back on audit failure.");
  await pool.query("ALTER TABLE audit_logs DROP CONSTRAINT force_profile_failure");
  const imported = await runWithTenantContext({ organizationId: 1, membershipId: 1, userId: 1, userRole: "manager", membershipRole: "admin", effectivePermissions: [], correlationId: "supplier-import-test" }, async () => {
    const { storage } = await import("../server/storage");
    await assert.rejects(() => storage.createSupplier({ name: "Foreign legacy create", organizationId: 2 }), /governed workflow/);
    await assert.rejects(() => storage.updateSupplier(1, { approvedByUserId: 2 }), /governed workflow/);
    const bankError = { code: "SUPPLIER_BANK_GOVERNANCE_REQUIRED" };
    await assert.rejects(() => storage.createSupplier({ name: "Forbidden banking import", bankName: "Synthetic bank" }), bankError);
    await assert.rejects(() => storage.updateSupplier(1, { name: "Forbidden profile change", bankAccountNumber: "Synthetic account" }), bankError);
    const snakePatch = { name: "Forbidden alias change", bank_swift: "Synthetic SWIFT" };
    await assert.rejects(() => storage.updateSupplier(1, snakePatch), bankError);
    assert.deepEqual(await snapshot(), beforeProfile, "Compatibility banking attempts cannot change the profile.");
    return storage.createSupplier({ name: "Mapped import fixture", status: "active" });
  });
  assert.equal(imported.status, "prospective");
  assert.equal(imported.createdByUserId, 1);
  assert.equal(imported.organizationId, 1);
  assert.equal((await pool.query("SELECT count(*) FROM audit_logs WHERE resource_id=$1 AND action='SUPPLIER_ONBOARDING_STARTED'", [imported.id])).rows[0].count, "1");
  assert.equal((await pool.query("SELECT count(*) FROM audit_logs WHERE action='SUPPLIER_PROFILE_UPDATED'")).rows[0].count, "0");
  const sourceId = (await pool.query("SELECT source_record_id FROM supplier_compliance_publications WHERE organization_id=1 AND supplier_id=1 AND document_type='taxForm'")).rows[0].source_record_id;
  const withdrawal = Number((await createMdmChangeRequest({ organizationId: 1, domain: "supplier-documents", entityId: sourceId, action: "deactivate", submittedBy: 1, proposedPatch: {} })).id);
  await as(3, () => approveMdmChangeRequest(command(withdrawal)));
  await as(3, () => applyMdmChangeRequest(command(withdrawal)));
  const listed = await fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/v2/suppliers/1/compliance-evidence`);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).data.items.find((item: {documentType: string}) => item.documentType === "taxForm").state, "withdrawn");
  assert.equal(await foreignDigest(), before);
  console.log(JSON.stringify({ status: "passed", database: name, foreignRecords: 5000, evidence: "Independent dated publication, stale document, expiry, withdrawal, access denial and atomic onboarding verified." }));
} finally {
  try {
    try { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); }
    finally { await pool?.end(); }
  }
  finally {
    try {
      if (created) {
        assert.match(name, /^iss_supplier_test_[a-f0-9]{32}$/);
        await owner.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [name]);
        await owner.query(`DROP DATABASE "${name}"`);
        console.log(JSON.stringify({ kind: "supplier-carrier-test-cleanup", database: name, removed: true }));
      }
    } finally { try { await owner.end(); } finally {
      if (uploads && path.dirname(uploads) === path.resolve(os.tmpdir()) && path.basename(uploads).startsWith("iss-supplier-compliance-")) await rm(uploads, { recursive: true });
    } }
  }
}

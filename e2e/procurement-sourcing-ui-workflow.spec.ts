import { expect, test, type Page } from "@playwright/test";
import { pool } from "../server/db";

let fixture: { eventId: number; title: string; supplierName: string };
const userIds = new Map<string, number>();

async function login(page: Page, username: string) {
  const userId = userIds.get(username);
  if (!userId) throw new Error(`Missing sourcing E2E identity for ${username}.`);
  await page.addInitScript((id) => {
    window.localStorage.setItem(`invtrack:first-run-coach:v1:${id}`, "done");
  }, userId);
  await page.context().clearCookies();
  await page.goto("/auth", { waitUntil: "load" });
  await page.getByPlaceholder("Enter your username").fill(username);
  await page.getByPlaceholder("Enter your password").fill("Admin123!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 20_000 });
}

test.beforeAll(async () => {
  const suffix = Date.now().toString().slice(-9);
  const users = await pool.query<{ id: number; username: string; role: string }>("SELECT id, username, role::text FROM users WHERE username IN ('admin', 'planner', 'supplierdemo')");
  const admin = users.rows.find((row) => row.username === "admin");
  const planner = users.rows.find((row) => row.username === "planner");
  const supplierUser = users.rows.find((row) => row.username === "supplierdemo");
  if (!admin || !planner || !supplierUser) throw new Error("admin, planner, and supplierdemo seed users are required for sourcing E2E");
  for (const user of [admin, planner, supplierUser]) {
    userIds.set(user.username, user.id);
    await pool.query("INSERT INTO organization_members (organization_id, user_id, role, application_role, active, status) VALUES (1, $1, $2, $3, TRUE, 'active') ON CONFLICT (organization_id, user_id) DO UPDATE SET application_role = EXCLUDED.application_role, active = TRUE, status = 'active'", [user.id, user.username === "admin" ? "owner" : "member", user.role]);
    await pool.query("UPDATE users SET default_organization_id = 1 WHERE id = $1", [user.id]);
  }
  const supplierName = `E2E Sourcing Supplier ${suffix}`;
  const supplier = await pool.query<{ id: number }>("INSERT INTO suppliers (organization_id, name, status, onboarding_status, compliance_status, contact_name, email, default_currency_code, approved_at, approved_by_user_id, updated_at) VALUES (1, $1, 'active', 'APPROVED', 'compliant', 'E2E Supplier', $2, 'ZAR', NOW(), $3, NOW()) RETURNING id", [supplierName, `e2e-sourcing-${suffix}@example.com`, admin.id]);
  await pool.query("UPDATE users SET supplier_id = $1 WHERE id = $2", [supplier.rows[0].id, supplierUser.id]);
  await pool.query("INSERT INTO supplier_portal_mappings (organization_id, user_id, supplier_id, active, created_by_user_id) VALUES (1, $1, $2, TRUE, $3) ON CONFLICT (organization_id, user_id) DO UPDATE SET supplier_id = EXCLUDED.supplier_id, active = TRUE, updated_at = NOW()", [supplierUser.id, supplier.rows[0].id, admin.id]);
  const title = `E2E Controlled RFQ ${suffix}`;
  const event = await pool.query<{ id: number }>("INSERT INTO sourcing_events (organization_id, event_number, title, description, status, owner_user_id, reporting_currency_code, deadline, minimum_responses, competition_required, published_at, updated_at) VALUES (1, $1, $2, 'Browser supplier quote proof', 'OPEN', $3, 'ZAR', NOW() + INTERVAL '3 days', 1, TRUE, NOW(), NOW()) RETURNING id", [`E2E-RFQ-${suffix}`, title, admin.id]);
  const line = await pool.query<{ id: number }>("INSERT INTO sourcing_event_lines (organization_id, event_id, line_number, description, quantity, target_unit_price, target_currency_code) VALUES (1, $1, 1, 'Managed endpoint security service', 2, 200, 'ZAR') RETURNING id", [event.rows[0].id]);
  await pool.query("INSERT INTO sourcing_evaluation_criteria (organization_id, event_id, name, criterion_type, weight, sort_order) VALUES (1, $1, 'Landed cost', 'commercial', 70, 0), (1, $1, 'Service delivery', 'delivery', 30, 1)", [event.rows[0].id]);
  await pool.query("INSERT INTO sourcing_invitations (organization_id, event_id, supplier_id, status, invited_by_user_id) VALUES (1, $1, $2, 'INVITED', $3)", [event.rows[0].id, supplier.rows[0].id, admin.id]);
  fixture = { eventId: event.rows[0].id, title, supplierName };
  expect(line.rows[0].id).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await pool.end().catch(() => undefined);
});

test("supplier submits a structured quote and buyer sees it for evaluation", async ({ page }) => {
  await login(page, "supplierdemo");
  await page.goto("/procurement/supplier-portal", { waitUntil: "load" });
  await page.getByTestId("supplier-portal-sourcing-tab").click();
  await expect(page.getByTestId("supplier-sourcing-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`supplier-rfq-invitation-${fixture.eventId}`)).toContainText(fixture.title);
  await expect(page.getByTestId("supplier-rfq-quote-editor")).toBeVisible();
  await page.getByLabel("Unit price for line 1").fill("180");
  await page.getByLabel("Tax for line 1").fill("54");
  await page.getByLabel("Freight for line 1").fill("12");
  await page.getByTestId("supplier-quote-submit").click();
  await expect(page.getByText("Quote submitted", { exact: true })).toBeVisible({ timeout: 20_000 });

  await login(page, "admin");
  await page.goto(`/procurement/sourcing/${fixture.eventId}`, { waitUntil: "load" });
  await expect(page.getByTestId("sourcing-event-detail")).toContainText(fixture.title);
  await expect(page.getByTestId("sourcing-event-detail")).toContainText(fixture.supplierName);
  await page.getByRole("button", { name: "Close for evaluation" }).click();
  await expect(page.getByTestId("sourcing-evaluation-award-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/Landed cost/).fill("92");
  await page.getByLabel(/Service delivery/).fill("86");
  await page.getByRole("button", { name: "Save evaluation" }).click();
  await expect(page.getByText("Evaluation saved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Award justification").fill("Best compliant landed cost with a strong service delivery score.");
  await page.getByRole("button", { name: "Submit award" }).click();
  await expect(page.getByText("Award submitted", { exact: true })).toBeVisible({ timeout: 20_000 });

  await login(page, "planner");
  await page.goto(`/procurement/sourcing/${fixture.eventId}`, { waitUntil: "load" });
  await expect(page.getByTestId("sourcing-evaluation-award-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Independent approval reason").fill("Independent commercial review completed and approved.");
  await page.getByRole("button", { name: "Approve award" }).click();
  await expect(page.getByText("Award approved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Convert award to PO" }).click();
  await expect(page.getByText("Purchase order created", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("This award has been converted to controlled purchase order records.")).toBeVisible();
});

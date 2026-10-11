import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";
import { pool } from "../server/db";
import { requireDisposableE2eDatabase } from "./wave7-helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function isPoCriticalApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const p = u.pathname;
    return (
      p.includes("/api/procurement/purchase-orders") ||
      p.includes("/api/purchase-orders") ||
      p.includes("/api/activity")
    );
  } catch {
    return /\/api\/(purchase\/orders|procurement\/purchase-orders|purchase-orders|activity)/i.test(url);
  }
}

/**
 * PO approve / send / commercial terms / activity — resets FQA via `seed:functional-qa`
 * before the serial flow so order of specs does not matter.
 */
test.describe.configure({ mode: "serial" });
let actionPolicyId: number | undefined;

test.beforeAll(async () => {
  requireDisposableE2eDatabase();
  // Idempotent; global E2E setup also seeds — rerun here so this file alone always gets fresh PO-FQA-* rows.
  const seed = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm run seed:functional-qa"] : ["run", "seed:functional-qa"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: { ...process.env },
  });
  if (seed.status !== 0) {
    throw new Error(`seed:functional-qa failed with exit code ${seed.status ?? "unknown"}`);
  }
  await pool.query(
    "UPDATE purchase_orders SET approval_status='PENDING' WHERE organization_id=1 AND order_number='PO-FQA-001'",
  );
  const policy = await pool.query<{ id: number }>(`INSERT INTO approval_policies (
    organization_id, name, entity_type, amount_min, amount_max, approval_level,
    approver_role, is_active, version, created_at, updated_at
  ) VALUES (1, 'FQA PO action approval', 'purchase_order', 1000, 1000, 1,
    'admin', TRUE, 1, NOW(), NOW()) RETURNING id`);
  actionPolicyId = policy.rows[0].id;
});

test.afterAll(async () => {
  if (actionPolicyId === undefined) return;
  requireDisposableE2eDatabase();
  await pool.query("UPDATE approval_policies SET is_active=FALSE WHERE organization_id=1 AND id=$1", [actionPolicyId]);
});

test.describe("Purchase order actions (FQA)", () => {
  test("approve, require dispatch recipient, commercial save, locked PO, activity panel, diagnostics marker", async ({ page }) => {
    test.setTimeout(120_000);

    const consoleWarnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") {
        const text = msg.text();
        if (/useAsyncResource/i.test(text) || /fetcher changed many times/i.test(text)) {
          consoleWarnings.push(text);
        }
      }
    });

    const serverErrors: { url: string; status: number }[] = [];
    page.on("response", (res) => {
      const status = res.status();
      if (status >= 500 && isPoCriticalApiUrl(res.url())) {
        serverErrors.push({ url: res.url(), status });
      }
    });

    await gotoAuthed(page, "/procurement/orders/PO-FQA-001");
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("po-detail-title")).toContainText("PO-FQA-001", { timeout: 20_000 });
    if (await page.getByTestId("po-approve-button").getByText("Submit for approval").isVisible()) {
      await expect(page.getByTestId("po-approve-button")).toBeEnabled({ timeout: 15_000 });
      await page.getByTestId("po-approve-button").click();
      await expect(page.getByTestId("po-approve-button")).toContainText("Approve", { timeout: 15_000 });
    }
    await expect(page.getByTestId("po-send-button")).toBeDisabled({ timeout: 15_000 });
    await page.getByRole("textbox", { name: "Purchase order approval reason" }).fill("Independent FQA approval review");
    await expect(page.getByTestId("po-approve-button")).toBeEnabled({ timeout: 15_000 });

    let approvePostCount = 0;
    const onApproveRequest = (req: { method: () => string; url: () => string }) => {
      if (req.method() !== "POST") return;
      try {
        const { pathname } = new URL(req.url());
        if (/\/api\/purchase-orders\/\d+\/approve$/.test(pathname)) {
          approvePostCount += 1;
        }
      } catch {
        /* ignore malformed URL */
      }
    };
    page.on("request", onApproveRequest);
    const approvalResponse = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/purchase-orders\/\d+\/approve$/.test(new URL(response.url()).pathname));
    await page.getByTestId("po-approve-button").click();
    const approvalResult = await approvalResponse;
    expect(approvalResult.status(), `PO approval response: ${await approvalResult.text()}`).toBe(200);
    await expect(page.getByTestId("po-detail-status")).toContainText(/approved/i, { timeout: 20_000 });
    expect(approvePostCount, "exactly one approve POST per approval action").toBe(1);
    page.off("request", onApproveRequest);

    await expect(page.getByTestId("po-approve-button")).toBeDisabled({ timeout: 15_000 });
    // Approval is not delivery. Without an explicitly verified recipient, dispatch stays blocked.
    // Provider success/failure is verified separately with a mock transport; never send live email here.
    await expect(page.getByRole("textbox", { name: "Purchase order dispatch email" })).toHaveValue("");
    await expect(page.getByTestId("po-send-button")).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByTestId("po-detail-status")).toContainText(/approved/i);
    await expect(page.getByTestId("po-approve-button")).toBeDisabled({ timeout: 15_000 });

    await page.goto("/procurement/orders/PO-FQA-002", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("po-commercial-save-button")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("po-commercial-save-button").click();
    await expect(page.getByTestId("po-commercial-error")).toBeHidden({ timeout: 15_000 });

    await page.goto("/procurement/orders/PO-FQA-003", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await expect(page.getByTestId("po-detail-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("po-commercial-save-button")).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByTestId("po-commercial-disabled-message")).toBeVisible();

    await expect(page.getByTestId("entity-activity-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("entity-activity-panel-disabled")).toHaveCount(0);

    await gotoAuthed(page, "/admin/system-diagnostics");
    await expect(page.getByTestId("system-diagnostics-page")).toBeVisible({ timeout: 30_000 });

    expect(
      consoleWarnings,
      "PO detail should not emit useAsyncResource or unstable fetcher warnings",
    ).toEqual([]);

    expect(serverErrors, "PO approve/send/commercial/activity APIs must not return 5xx").toEqual([]);
  });
});

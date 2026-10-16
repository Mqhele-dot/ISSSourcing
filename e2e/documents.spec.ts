import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";
import { pool } from "../server/db";
import { requireDisposableE2eDatabase } from "./wave7-helpers";

test.describe("Documents workspace", () => {
  test("uploads and archives a document through the governed workflow", async ({ page }) => {
    const stamp = Date.now();
    requireDisposableE2eDatabase();
    const order = await pool.query<{ id: number }>("SELECT id FROM purchase_orders WHERE organization_id=1 ORDER BY id LIMIT 1");
    expect(order.rows[0]).toBeTruthy();
    const entityId = String(order.rows[0].id);
    const fileName = `playwright-doc-${stamp}.txt`;

    await gotoAuthed(page, "/admin/documents");
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible();

    await page.getByLabel("Entity ID").first().fill(entityId);
    await page.getByLabel("File").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`Document workflow proof ${stamp}`, "utf8"),
    });

    await page.getByRole("button", { name: /^Upload\.\.\.$/ }).click();
    await expect(page.getByRole("dialog", { name: /process document/i })).toBeVisible();
    await page.getByRole("button", { name: /confirm upload/i }).click();

    await expect(page.getByText(/document version was saved successfully/i)).toBeVisible();

    await page.getByText("Filter by entity type", { exact: true }).locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Purchase order" }).click();
    await page.getByLabel("Entity ID").nth(1).fill(entityId);
    await page.getByRole("textbox", { name: "Search", exact: true }).fill(fileName);

    const row = page.getByText(fileName, { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByText(/Active/).first()).toBeVisible();

    await page.getByRole("button", { name: /archive/i }).click();
    await page.getByRole("dialog", { name: "Archive document?" }).getByRole("button", { name: "Archive document" }).click();
    await expect(page.getByText("Document archived", { exact: true })).toBeVisible();
    await expect(row).toHaveCount(0);

    await page.getByRole("dialog", { name: "Archive document?" }).getByRole("button", { name: "Close" }).click();
    await page.getByText("Archive state", { exact: true }).locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Archived only" }).click();
    await expect(page.getByText(fileName)).toBeVisible();
    await expect(page.getByText(/Archived/).first()).toBeVisible();
  });
});

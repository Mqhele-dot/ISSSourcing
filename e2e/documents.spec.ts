import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("Documents workspace", () => {
  test("uploads and archives a document through the governed workflow", async ({ page }) => {
    const stamp = Date.now();
    const entityId = String(800000 + (stamp % 100000));
    const fileName = `playwright-doc-${stamp}.txt`;

    await gotoAuthed(page, "/admin/documents");
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible();

    await page.getByLabel("Entity ID").fill(entityId);
    await page.getByLabel("File").setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(`Document workflow proof ${stamp}`, "utf8"),
    });

    await page.getByRole("button", { name: /^Upload\.\.\.$/ }).click();
    await expect(page.getByRole("dialog", { name: /process document/i })).toBeVisible();
    await page.getByLabel(/Reference \/ tracking ID/i).fill(`PO-${stamp}`);
    await page.getByRole("button", { name: /confirm upload/i }).click();

    await expect(page.getByText(/document version was saved successfully/i)).toBeVisible();

    await page.getByLabel("Filter by entity type").click();
    await page.getByRole("option", { name: "Purchase order" }).click();
    await page.getByLabel("Entity ID").nth(1).fill(entityId);
    await page.getByLabel("Search").fill(fileName);

    const row = page.getByText(fileName);
    await expect(row).toBeVisible();
    await expect(page.getByText(/Active/).first()).toBeVisible();

    await page.getByRole("button", { name: /archive/i }).click();
    await expect(page.getByText(/document archived/i)).toBeVisible();
    await expect(row).toHaveCount(0);

    await page.getByLabel("Archive state").click();
    await page.getByRole("option", { name: "Archived only" }).click();
    await expect(page.getByText(fileName)).toBeVisible();
    await expect(page.getByText(/Archived/).first()).toBeVisible();
  });
});

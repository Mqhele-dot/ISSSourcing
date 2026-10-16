import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

test.describe("Blanket purchase agreements", () => {
  test("renders the governed agreement workspace and lifecycle tabs", async ({ page }) => {
    await gotoAuthed(page, "/procurement/contracts");
    await expect(page.getByTestId("blanket-agreements-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Blanket purchase agreements" })).toBeVisible();
    for (const name of ["Agreements", "Lines", "Releases", "Renewals", "Activity"]) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByText(/approved-request releases/i)).toBeVisible();
  });
});

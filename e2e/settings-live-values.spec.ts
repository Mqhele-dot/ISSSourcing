import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

type SettingsPayload = {
  companyName?: string | null;
  primaryColor?: string | null;
  currencySymbol?: string | null;
  currencyCode?: string | null;
  lowStockDefaultThreshold?: number | null;
  allowNegativeInventory?: boolean | null;
  requireLocationForItems?: boolean | null;
  realTimeUpdatesEnabled?: boolean | null;
  lowStockAlertFrequency?: number | null;
  autoReorderEnabled?: boolean | null;
  forecastingEnabled?: boolean | null;
  forecastDays?: number | null;
  seasonalAdjustmentEnabled?: boolean | null;
  enableVat?: boolean | null;
  defaultVatCountry?: string | null;
  showPricesWithVat?: boolean | null;
};

const TAX_REGION_LABELS: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  JP: "Japan",
  CN: "China",
  IN: "India",
  BR: "Brazil",
  MX: "Mexico",
  ZA: "South Africa",
  SG: "Singapore",
  AE: "United Arab Emirates",
};

async function readLiveSettings(page: Parameters<typeof test>[0]["page"]): Promise<SettingsPayload> {
  return page.evaluate(async () => {
    const response = await fetch("/api/settings", { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Failed to load /api/settings: ${response.status}`);
    }
    const payload = await response.json();
    if (payload && typeof payload === "object" && "data" in payload) {
      return payload.data as SettingsPayload;
    }
    return payload as SettingsPayload;
  });
}

test.describe("Settings live values", () => {
  test("settings tabs reflect persisted organization values after async load", async ({ page }) => {
    await gotoAuthed(page, "/admin/settings/general");
    const settings = await readLiveSettings(page);

    await expect(page.getByRole("link", { name: "Open Company Setup" })).toHaveAttribute("href", /\/admin\/company-setup$/);
    await expect(page.getByRole("textbox", { name: "Primary color hex value" })).toHaveValue(settings.primaryColor ?? "#0f766e");

    await page.getByRole("tab", { name: /operational policy/i }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/inventory$/);
    await expect(page.getByTestId("settings-control-low-stock")).toHaveValue(
      String(settings.lowStockDefaultThreshold ?? 10),
    );
    await expect(page.getByTestId("settings-control-negative-stock")).toBeChecked({ checked: settings.allowNegativeInventory ?? false });
    await expect(page.getByTestId("settings-control-require-location")).toBeChecked({ checked: settings.requireLocationForItems ?? true });

    await page.getByRole("tab", { name: /live updates/i }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/realtime$/);
    await expect(page.getByTestId("realtime-settings-alert-frequency")).toHaveValue(
      String(settings.lowStockAlertFrequency ?? 30),
    );
    await expect(page.getByTestId("realtime-settings-enabled")).toHaveAttribute(
      "data-state",
      (settings.realTimeUpdatesEnabled ?? true) ? "checked" : "unchecked",
    );
    await expect(page.getByTestId("realtime-settings-auto-reorder")).toHaveAttribute(
      "data-state",
      (settings.autoReorderEnabled ?? false) ? "checked" : "unchecked",
    );

    await page.getByRole("tab", { name: /planning/i }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/forecasting$/);
    await expect(page.getByTestId("forecasting-settings-days")).toHaveValue(String(settings.forecastDays ?? 30));
    await expect(page.getByTestId("forecasting-settings-enabled")).toHaveAttribute(
      "data-state",
      (settings.forecastingEnabled ?? true) ? "checked" : "unchecked",
    );
    await expect(page.getByTestId("forecasting-settings-seasonal-adjustment")).toHaveAttribute(
      "data-state",
      (settings.seasonalAdjustmentEnabled ?? true) ? "checked" : "unchecked",
    );

    await expect(page.getByRole("tab", { name: /workflow controls/i })).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";
import { gotoAuthed } from "./test-helpers";

const CONTROL_TOWER = "/operations/control-tower";

test.describe("Control Tower dashboard", () => {
  test("executive dashboard loads with charts and filters", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoAuthed(page, CONTROL_TOWER);
    await expect(page.getByTestId("control-tower-page")).toBeVisible({ timeout: 60_000 });

    await expect(page.getByTestId("dashboard-kpi-inventory-value")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dashboard-kpi-low-stock")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-open-requisitions")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-open-pos")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-delayed-shipments")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-ap-due")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-exceptions")).toBeVisible();
    await expect(page.getByTestId("dashboard-kpi-supplier-risk")).toBeVisible();

    await expect(page.getByTestId("dashboard-procurement-pipeline-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-inventory-health-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-stock-value-category-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-ap-aging-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-logistics-risk-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-supplier-performance-chart")).toBeVisible();
    await expect(page.getByTestId("dashboard-operations-trend-chart")).toBeVisible();

    await expect(page.getByTestId("dashboard-needs-attention-panel")).toBeVisible();
    await expect(page.getByTestId("dashboard-recent-activity-panel")).toBeVisible();

    const supplierSpotlight = page.getByTestId("control-tower-spotlight-supplier-risks");
    if ((await supplierSpotlight.count()) > 0) {
      await expect(supplierSpotlight).toBeVisible();
    }

    await page.getByTestId("dashboard-business-area-filter").click();
    await page.getByRole("option", { name: /^inventory$/i }).click();
    await expect(page.getByTestId("dashboard-procurement-pipeline-chart")).not.toBeVisible({ timeout: 25_000 });

    await page.getByTestId("dashboard-business-area-filter").click();
    await page.getByRole("option", { name: /all areas/i }).click();
    await expect(page.getByTestId("dashboard-procurement-pipeline-chart")).toBeVisible({ timeout: 25_000 });

    await page.getByTestId("dashboard-refresh-button").click();
    await expect(page.getByTestId("control-tower-page")).toBeVisible();

    await page.getByTestId("dashboard-date-range-filter").click();
    await page.getByRole("option", { name: /last 30 days/i }).click();
    await expect(page.getByTestId("dashboard-procurement-pipeline-chart")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("control-tower-page")).toBeVisible();
  });

  test("shows controlled degraded guidance when some dashboard feeds fall back", async ({ page }) => {
    await page.route("**/api/dashboard/control-tower**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            generatedAt: "2026-08-02T09:00:00.000Z",
            meta: {
              organizationId: 1,
              trendDays: 7,
              valueBasisLabel: "Estimated value",
              businessArea: "all",
              dataFreshness: {
                inventory: "2026-08-02T08:55:00.000Z",
                shipments: "2026-08-02T08:54:00.000Z",
              },
              partialFailures: [
                {
                  area: "spotlight_shipments",
                  code: "QUERY_FAILED",
                  message: "Delayed shipments spotlight failed",
                  fallbackUsed: true,
                },
              ],
              filtersApplied: {
                trendDays: 7,
                businessArea: "all",
              },
            },
            kpis: {
              inventoryValue: 125000,
              inventoryValueTrendPct: 5.2,
              lowStockItems: 3,
              openRequisitions: 4,
              openPurchaseOrders: 6,
              delayedShipments: 2,
              apInvoicesDueOrOverdue: 1,
              operationalExceptions: 2,
              supplierRiskAlerts: 1,
            },
            procurementPipeline: [],
            inventoryHealth: [],
            stockValueByCategory: [],
            apAging: [],
            logisticsRisk: [],
            supplierPerformance: [],
            operationsTrend: [],
            needsAttention: [],
            recentActivity: [],
            spotlight: {
              delayedShipments: [],
              oldestOpenExceptions: [],
              supplierRisks: [],
            },
          },
        }),
      });
    });

    await gotoAuthed(page, CONTROL_TOWER);
    await expect(page.getByTestId("control-tower-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("control-tower-partial-failures-banner")).toContainText(
      "Some control tower feeds are degraded",
    );
    await expect(page.getByTestId("control-tower-partial-failures-list")).toContainText(
      "spotlight_shipments: Delayed shipments spotlight failed",
    );
    await expect(page.getByTestId("control-tower-data-freshness")).toContainText("Inventory:");
    await expect(page.getByRole("link", { name: /open diagnostics/i })).toBeVisible();
  });
});

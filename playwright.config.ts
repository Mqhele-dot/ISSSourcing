import { defineConfig, devices } from "@playwright/test";

/**
 * When `scripts/run-playwright-e2e.mjs` starts (or reuses) the dev server, it sets this so we do not
 * spawn a second `npm run dev` from Playwright (avoids flaky ERR_CONNECTION_REFUSED in some environments).
 * Direct `npx playwright test -c playwright.config.ts` still uses `webServer` below.
 */
const externalDevServer = process.env.PLAYWRIGHT_EXTERNAL_DEV_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    /* Prefer 127.0.0.1 — dev server binds there; localhost can differ on some Windows setups. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5000",
    trace: "on-first-retry",
    headless: true,
    launchOptions: {
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  ...(!externalDevServer
    ? {
        /**
         * Used when invoking Playwright directly (without the npm `test:e2e` wrapper).
         * `npm run test:e2e` uses `run-playwright-e2e.mjs` + PLAYWRIGHT_EXTERNAL_DEV_SERVER=1 instead.
         */
        webServer: {
          command: "npm run dev",
          url: "http://127.0.0.1:5000/api/ready",
          reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1",
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      }
    : {}),
  /** Cold Vite compile on first SPA navigation can exceed 15s on slower disks / Windows. */
  timeout: 30_000,
  expect: { timeout: 5000 },
});

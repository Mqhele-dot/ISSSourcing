import { defineConfig, devices } from "@playwright/test";

/**
 * Two ways to run browser E2E:
 *
 * 1) `npm run test:e2e` (recommended) — `scripts/run-playwright-e2e.mjs` starts or reuses `npm run dev`,
 *    waits for BOTH `http://127.0.0.1:PORT/api/ready` and `/auth` with Node `fetch`, then runs Playwright
 *    with PLAYWRIGHT_EXTERNAL_DEV_SERVER=1 so **no** `webServer` block is active (avoids connection-refused races).
 *
 * 2) Direct `npx playwright test -c playwright.config.ts` — uses the `webServer` option below to spawn `npm run dev`.
 *    Set PLAYWRIGHT_REUSE_EXISTING_SERVER=1 if port 5000 is already in use.
 *
 * The wrapper never sets PLAYWRIGHT_EXTERNAL_DEV_SERVER until probes pass; do not set it manually unless
 * you are sure the app is already listening on `use.baseURL`.
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

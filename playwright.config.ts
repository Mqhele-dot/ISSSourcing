import { defineConfig, devices } from "@playwright/test";

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
  /**
   * Start the API + Vite dev server when it is not already listening (e.g. lone `npm run test:e2e`).
   * CI / release-gate that pre-starts `npm run dev` reuses the existing process (`reuseExistingServer`).
   */
  webServer: {
    command: "npm run dev",
    /** Wait for API + DB readiness; root `/` can answer before Vite is warm enough for first `/auth` navigation. */
    url: "http://127.0.0.1:5000/api/ready",
    /**
     * Default false: always start `npm run dev` for `npm run test:e2e` so port 5000 is not empty (avoids ERR_CONNECTION_REFUSED).
     * Set PLAYWRIGHT_REUSE_EXISTING_SERVER=1 when a dev server is already running (e.g. CI release-gate, or terminal A: npm run dev).
     */
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1",
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  /** Cold Vite compile on first SPA navigation can exceed 15s on slower disks / Windows. */
  timeout: 30_000,
  expect: { timeout: 5000 },
});

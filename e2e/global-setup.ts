import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Align DB with seeded/demo expectation (gate allows full app navigation).
 * Skip with SKIP_E2E_PRODUCT_ONBOARDING_PREP=1.
 */
export default function globalSetup() {
  const repoRoot = path.resolve(__dirname, "..");
  const result = spawnSync("npm", ["run", "e2e:prep"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`e2e global-setup failed with exit code ${result.status ?? "unknown"}`);
  }
}

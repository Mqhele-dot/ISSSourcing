import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDisposableDatabaseUrl } from "../server/config/database-safety";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Align DB with seeded/demo expectation (gate allows full app navigation).
 * Skip onboarding prep with SKIP_E2E_PRODUCT_ONBOARDING_PREP=1.
 * Skip functional QA seed with SKIP_E2E_FUNCTIONAL_QA_SEED=1 (not recommended — deep E2E expects FQA rows).
 */
export default function globalSetup() {
  const repoRoot = path.resolve(__dirname, "..");
  const env = { ...process.env };

  const skipOnboardingPrep = env.SKIP_E2E_PRODUCT_ONBOARDING_PREP === "1";
  const skipFunctionalSeed = env.SKIP_E2E_FUNCTIONAL_QA_SEED === "1";
  if (!skipOnboardingPrep || !skipFunctionalSeed) {
    assertDisposableDatabaseUrl(env.TEST_DATABASE_URL);
  }

  if (!skipOnboardingPrep) {
    const prep = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm run e2e:prep"] : ["run", "e2e:prep"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env,
    });
    if (prep.status !== 0) {
      throw new Error(`e2e global-setup (e2e:prep) failed with exit code ${prep.status ?? "unknown"}`);
    }
  } else {
    console.log("e2e global-setup: product onboarding prep skipped (SKIP_E2E_PRODUCT_ONBOARDING_PREP=1)");
  }

  if (skipFunctionalSeed) {
    console.log("e2e global-setup: seed:functional-qa skipped (SKIP_E2E_FUNCTIONAL_QA_SEED=1)");
    return;
  }

  const seed = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/s", "/c", "npm run seed:functional-qa"] : ["run", "seed:functional-qa"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env,
  });
  if (seed.status !== 0) {
    throw new Error(`e2e global-setup (seed:functional-qa) failed with exit code ${seed.status ?? "unknown"}`);
  }
}

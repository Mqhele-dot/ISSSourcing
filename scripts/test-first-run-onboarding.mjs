import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const coach = readFileSync(
  new URL("../client/src/components/onboarding/first-run-onboarding-coach.tsx", import.meta.url),
  "utf8",
);
const routes = readFileSync(new URL("../client/src/lib/routes/app-routes.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

assert.match(app, /FirstRunOnboardingCoach/);
assert.match(coach, /invtrack:first-run-coach/);
assert.match(coach, /APP_ROUTES\.setup\.product/);
assert.match(coach, /APP_ROUTES\.admin\.masterData/);
assert.match(coach, /APP_ROUTES\.procurement\.suppliers/);
assert.match(coach, /APP_ROUTES\.procurement\.orders/);
assert.match(coach, /APP_ROUTES\.operations\.logistics/);
assert.match(coach, /APP_ROUTES\.operations\.mobileHub/);
assert.match(coach, /APP_ROUTES\.analytics\.root/);
assert.match(coach, /adminOnly/);
assert.match(coach, /userCanUseStep/);
assert.match(coach, /localStorage\.setItem/);
assert.match(routes, /product: "\/setup"/);
assert.equal(
  packageJson.scripts["test:first-run-onboarding"],
  "node scripts/test-first-run-onboarding.mjs",
);

console.log("test-first-run-onboarding: all checks passed.");

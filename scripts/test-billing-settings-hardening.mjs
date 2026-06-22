import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const billingFormPath = path.join(repoRoot, "client", "src", "components", "settings", "billing-settings-form.tsx");
const subscriptionRoutePath = path.join(
  repoRoot,
  "server",
  "modules",
  "organization",
  "register-organization-routes.ts",
);

const billingFormSource = fs.readFileSync(billingFormPath, "utf8");
const subscriptionRouteSource = fs.readFileSync(subscriptionRoutePath, "utf8");

const failures = [];

for (const forbidden of ["stripeSecretKey", "paypalClientSecret"]) {
  if (billingFormSource.includes(forbidden)) {
    failures.push(`Billing settings form still references forbidden secret field "${forbidden}".`);
  }
}

for (const required of [
  'queryKey: ["/api/subscription/current"]',
  "Frontend settings now expose readiness instead of editable secret fields.",
  "Keep PayPal credentials in deployment secrets.",
]) {
  if (!billingFormSource.includes(required)) {
    failures.push(`Billing settings form is missing expected hardening marker: ${required}`);
  }
}

for (const required of [
  "type BillingProviderStatus",
  "function getBillingProviderStatuses()",
  "billingProviders,",
  "priceMappingsConfigured",
]) {
  if (!subscriptionRouteSource.includes(required)) {
    failures.push(`Subscription snapshot route is missing expected billing readiness marker: ${required}`);
  }
}

if (failures.length > 0) {
  console.error("Billing settings hardening regression check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Billing settings hardening regression check passed.");

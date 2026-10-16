import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("server/modules/organization/register-organization-routes.ts", "utf8");
const docs = readFileSync("docs/subscription-plans.md", "utf8");

for (const code of [
  "BILLING_PROVIDER_NOT_CONFIGURED",
  "BILLING_PRICE_NOT_CONFIGURED",
  "BILLING_PROVIDER_ACTION_REQUIRED",
  "STRIPE_WEBHOOK_SIGNATURE_INVALID",
  "STRIPE_WEBHOOK_EVENT_ID_REQUIRED",
]) {
  assert.ok(source.includes(code), `subscription routes must return ${code}`);
}

assert.match(source, /stripe\.webhooks\.constructEvent/, "Stripe webhook route must verify signatures when webhook secret is configured");
assert.match(source, /STRIPE_WEBHOOK_SECRET/, "Stripe webhook secret must be read from the environment");
assert.match(source, /STRIPE_SECRET_KEY/, "Stripe secret key must be environment-only");
assert.match(source, /STRIPE_PRICE_STARTER/, "Starter price id must be configured through env");
assert.match(source, /STRIPE_PRICE_STANDARD/, "Standard price id must be configured through env");
assert.match(source, /STRIPE_PRICE_GROWTH/, "Growth price id must be configured through env");
assert.match(source, /STRIPE_PRICE_ENTERPRISE/, "Enterprise price id must be configured through env");

assert.match(
  source,
  /!canUseLocalBillingAdapter\(\)[\s\S]{0,500}BILLING_PROVIDER_ACTION_REQUIRED/,
  "production local billing adapter must return provider-action-required instead of faking lifecycle success",
);
assert.match(
  source,
  /signatureState:\s*"rejected"/,
  "invalid webhook signature attempts must be stored or marked rejected",
);
assert.match(
  source,
  /providerEventId:\s*eventId/,
  "valid webhook events must be persisted by provider event id",
);

for (const envName of [
  "STRIPE_SECRET_KEY",
  "VITE_STRIPE_PUBLIC_KEY",
  "STRIPE_PUBLIC_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_STANDARD",
  "STRIPE_PRICE_GROWTH",
  "STRIPE_PRICE_ENTERPRISE",
]) {
  assert.ok(docs.includes(envName), `docs/subscription-plans.md must document ${envName}`);
}

console.log("Stripe billing readiness contract passed.");

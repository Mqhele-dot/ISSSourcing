import { readFileSync } from "node:fs";

const billingForm = readFileSync("client/src/components/settings/billing-settings-form.tsx", "utf8");
const orgRoutes = readFileSync("server/modules/organization/register-organization-routes.ts", "utf8");

const forbiddenClientTokens = [
  "stripeSecretKey",
  "paypalClientSecret",
  "stripePublicKey",
  "paypalClientId",
  "sk_test_",
  "pk_test_",
  "Client Secret",
];

for (const token of forbiddenClientTokens) {
  if (billingForm.includes(token)) {
    throw new Error(`Billing settings form must not expose credential field/token: ${token}`);
  }
}

const requiredClientTokens = [
  "billingProviders",
  "stripeReadiness",
  "paypalReadiness",
  "Stripe credentials are configured by environment variables",
  "Webhook signing",
  "runtime billing will not use",
];

for (const token of requiredClientTokens) {
  if (!billingForm.includes(token)) {
    throw new Error(`Billing settings form is missing hardened provider UI marker: ${token}`);
  }
}

const requiredServerTokens = [
  "billingProviderReadiness",
  "billingProviders: billingProviderReadiness()",
  "secretKeyConfigured",
  "webhookConfigured",
  "priceMappingsConfigured",
  "supported: false",
];

for (const token of requiredServerTokens) {
  if (!orgRoutes.includes(token)) {
    throw new Error(`Subscription snapshot is missing provider readiness marker: ${token}`);
  }
}

console.log("billing settings hardening checks passed");

import { readFileSync } from "node:fs";

const source = readFileSync("server/modules/organization/register-organization-routes.ts", "utf8");

const checks = [
  {
    name: "usage events increment existing monthly counters",
    ok: /value:\s*sql`\$\{usageCounters\.value\}\s*\+\s*\$\{parsed\.value\}`/.test(source),
  },
  {
    name: "usage events validate counter key format",
    ok: /regex\(\/\^\[a-z0-9_.-]\+\$\/i/.test(source),
  },
  {
    name: "usage endpoint returns plan limits and summary",
    ok: /limits:\s*subscription\.limits/.test(source) && /summary:\s*buildUsageSummary\(subscription\.limits,\s*rows\)/.test(source),
  },
  {
    name: "usage event response returns applied delta summary",
    ok: /appliedDelta:\s*parsed\.value/.test(source) && /summary,\s*\n\s*},\s*\n\s*201,\s*\n\s*\)/.test(source),
  },
];

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  console.error("Subscription usage hardening regression check failed:");
  for (const check of failed) {
    console.error(`- ${check.name}`);
  }
  process.exit(1);
}

for (const check of checks) {
  console.log(`ok ${check.name}`);
}

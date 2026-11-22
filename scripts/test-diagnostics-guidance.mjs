import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/system-diagnostics-page.tsx", "utf8");
const routes = readFileSync("server/routes.ts", "utf8");

const checks = [
  {
    name: "diagnostics guidance model exists",
    ok: page.includes("DIAGNOSTICS_GUIDANCE"),
  },
  {
    name: "data guidance names supplier default currency repair",
    ok: page.includes("Set missing supplier default currencies from the active Master Data currency list."),
  },
  {
    name: "data guidance links to supplier and carrier setup",
    ok:
      page.includes('href: "/procurement/suppliers"') &&
      page.includes('href: "/admin/master-data/carriers"'),
  },
  {
    name: "diagnostics dialog shows current findings",
    ok: page.includes("Current findings") && page.includes("Automatic repair") && page.includes("Manual follow-up"),
  },
  {
    name: "backend repairs missing supplier currencies",
    ok: routes.includes("UPDATE suppliers") && routes.includes("default_currency_code"),
  },
  {
    name: "backend repairs active inbound shipment carriers",
    ok:
      routes.includes("UPDATE shipments AS shipment") &&
      routes.includes("supplier.default_carrier_id") &&
      routes.includes("COALESCE(shipment.direction, 'inbound') = 'inbound'"),
  },
  {
    name: "supplier diagnostic notifications are throttled",
    ok: routes.includes("created_at > now() - interval '2 hours'"),
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`ok ${check.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`Diagnostics guidance checks failed: ${failed}/${checks.length}`);
  process.exit(1);
}

console.log(`Diagnostics guidance checks passed: ${checks.length}/${checks.length}`);

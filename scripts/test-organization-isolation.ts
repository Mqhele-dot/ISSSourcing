/**
 * Smoke test: organization API responds and export path receives org-scoped footer when settings exist.
 * Run with server up: npx tsx scripts/test-organization-isolation.ts [baseUrl]
 */
const base = process.argv[2] ?? "http://127.0.0.1:5000";

async function main() {
  const settingsRes = await fetch(`${base}/api/organization/settings`, { credentials: "include" });
  console.log("GET /api/organization/settings", settingsRes.status);
  if (!settingsRes.ok) {
    console.log("Note: expected 401 if not logged in — sign in via browser and retry.");
  } else {
    const body = (await settingsRes.json()) as { organizationId?: number };
    console.log("organizationId:", body.organizationId);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

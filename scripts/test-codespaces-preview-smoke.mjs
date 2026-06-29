const baseUrl = (process.env.CODESPACES_PREVIEW_URL || process.env.PLAYWRIGHT_BASE_URL || process.argv[2] || "").replace(/\/$/, "");

if (!baseUrl) {
  console.log("Skipping Codespaces preview smoke test: set CODESPACES_PREVIEW_URL or pass a base URL.");
  process.exit(0);
}

const paths = [
  "/",
  "/auth",
  "/health",
  "/api/ready",
  "/api/user",
  "/m/home",
  "/m/tasks",
  "/m/counts",
  "/m/scan",
  "/m/approvals",
  "/m/receive",
  "/m/pick",
  "/m/more",
  "/inventory/cycle-counts",
  "/admin/settings",
];

const allowed = new Map([
  ["/api/user", new Set([200, 401])],
  ["/m/home", new Set([200, 302, 401])],
  ["/m/tasks", new Set([200, 302, 401])],
  ["/m/counts", new Set([200, 302, 401])],
  ["/m/scan", new Set([200, 302, 401])],
  ["/m/approvals", new Set([200, 302, 401])],
  ["/m/receive", new Set([200, 302, 401])],
  ["/m/pick", new Set([200, 302, 401])],
  ["/m/more", new Set([200, 302, 401])],
  ["/inventory/cycle-counts", new Set([200, 302, 401])],
  ["/admin/settings", new Set([200, 302, 401])],
]);

let failed = 0;
for (const path of paths) {
  const url = `${baseUrl}${path}`;
  try {
    const res = await fetch(url, { redirect: "manual" });
    const ok = allowed.get(path)?.has(res.status) ?? (res.status >= 200 && res.status < 400);
    if (ok) {
      console.log(`ok ${path} -> ${res.status}`);
    } else {
      failed += 1;
      console.error(`FAIL ${path} -> ${res.status}`);
    }
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${path} -> ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed > 0) {
  console.error(`Codespaces preview smoke failed: ${failed}/${paths.length}`);
  process.exit(1);
}

console.log(`Codespaces preview smoke passed: ${paths.length}/${paths.length}`);

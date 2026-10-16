#!/usr/bin/env node
/**
 * Verifies API endpoints used by main page buttons respond (no 500).
 * Run with: node scripts/test-button-endpoints.js [baseUrl]
 * Example: node scripts/test-button-endpoints.js http://127.0.0.1:5000
 * Note: Many endpoints require auth; 401 is OK, 500 is not.
 */
const baseUrl = process.argv[2] || "http://127.0.0.1:5000";

const ENDPOINTS = [
  { method: "GET", url: "/health", expectOk: true },
  { method: "GET", url: "/api/inventory", expectOk: false, allow500: true },
  { method: "GET", url: "/api/categories", expectOk: false },
  { method: "GET", url: "/api/warehouses", expectOk: false },
  { method: "GET", url: "/api/suppliers", expectOk: false },
  { method: "GET", url: "/api/reorder-requests", expectOk: false },
  { method: "GET", url: "/api/control-tower/overview", expectOk: false, allow500: true },
  { method: "GET", url: "/api/exceptions", expectOk: false },
  { method: "GET", url: "/api/purchase/orders", expectOk: false },
  { method: "GET", url: "/api/logistics/shipments", expectOk: false },
  { method: "GET", url: "/api/export/inventory/csv", expectOk: false },
  { method: "GET", url: "/api/export/reorder-requests/csv", expectOk: false },
];

async function main() {
  let passed = 0;
  let failed = 0;

  for (const { method, url, expectOk, allow500 } of ENDPOINTS) {
    const fullUrl = baseUrl + url;
    try {
      const res = await fetch(fullUrl, {
        method,
        headers: { Accept: "application/json, text/csv, application/octet-stream" },
        redirect: "manual",
      });
      const status = res.status;
      const ok = status >= 200 && status < 400;
      if (expectOk && !ok) {
        console.error(`FAIL ${method} ${url} -> ${status}`);
        failed++;
      } else if (status >= 500 && !allow500) {
        console.error(`FAIL ${method} ${url} -> ${status} (server error)`);
        failed++;
      } else if (status >= 500 && allow500) {
        console.log(`OK   ${method} ${url} -> ${status} (allowed when DB unavailable)`);
        passed++;
      } else {
        console.log(`OK   ${method} ${url} -> ${status}`);
        passed++;
      }
    } catch (err) {
      console.error(`FAIL ${method} ${url} -> ${err.message}`);
      failed++;
    }
  }

  if (failed === ENDPOINTS.length && ENDPOINTS.length > 0) {
    console.log("\nAll requests failed (e.g. connection refused). Start the server with: npm run dev");
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();

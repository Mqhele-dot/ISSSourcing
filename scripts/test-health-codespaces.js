#!/usr/bin/env node
/**
 * Quick test for Codespaces-related behavior:
 * - GET /health returns 200 and JSON with status "ok" (no DB dependency)
 * - GET /health/deep returns 200 when DB ok, 503 when degraded
 * Run with: node scripts/test-health-codespaces.js [baseUrl]
 * Default baseUrl: http://127.0.0.1:5000
 */
const baseUrl = process.argv[2] || "http://127.0.0.1:5000";

async function main() {
  let passed = 0;
  let failed = 0;

  // 1. /health must return 200 and JSON with status "ok"
  try {
    const r = await fetch(`${baseUrl}/health`);
    const body = await r.json();
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    if (body.status !== "ok") throw new Error(`Expected status "ok", got ${body.status}`);
    console.log("OK /health -> 200, status ok");
    passed++;
  } catch (e) {
    console.error("FAIL /health:", e.message);
    failed++;
  }

  // 2. /health/deep returns 200 or 503; when DB down we expect 503
  try {
    const r = await fetch(`${baseUrl}/health/deep`);
    const body = await r.json();
    if (r.status !== 200 && r.status !== 503) throw new Error(`Expected 200 or 503, got ${r.status}`);
    if (body.status !== "ok" && body.status !== "degraded") throw new Error(`Unexpected status ${body.status}`);
    console.log(`OK /health/deep -> ${r.status}, status ${body.status}`);
    passed++;
  } catch (e) {
    console.error("FAIL /health/deep:", e.message);
    failed++;
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main();

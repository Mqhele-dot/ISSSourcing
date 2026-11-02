import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { assertUnusedLocalTestPort } from "./e2e-port-preflight.mjs";

for (const value of ["", "0", "-1", "1.1", "65536", "NaN", "5000/other", "5091;anything"]) {
  await assert.rejects(assertUnusedLocalTestPort({ PORT: value }), error => error.code === "E2E_INVALID_TEST_PORT");
}
let requests = 0;
const unrelated = http.createServer((_req, res) => { requests++; res.end("unrelated synthetic listener"); });
await new Promise(resolve => unrelated.listen(0, "127.0.0.1", resolve));
const port = unrelated.address().port;
let rejectionMs;
try {
  await assert.rejects(assertUnusedLocalTestPort({ PORT: String(port) }), error => error.code === "E2E_TEST_PORT_IN_USE");
  const before = requests;
  const artifactRoot = path.resolve("artifacts/release-runs");
  const artifactsBefore = existsSync(artifactRoot) ? readdirSync(artifactRoot).sort() : [];
  // Exercise the production runner with NO skip-build switch. A wrong ordering
  // would attempt a build/database setup rather than fail at the occupied port.
  const rejectionStartedAt=Date.now();
  const child = spawn(process.execPath, ["scripts/run-disposable-small-business-e2e.mjs", "--full", "e2e/system-diagnostics.spec.ts"], {
    env: { ...process.env, PORT: String(port), DISPOSABLE_E2E_BUILD_READY: "", DISPOSABLE_E2E_LOCK_TOKEN: "", DISPOSABLE_E2E_LOCK_PID: "" },
    stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true,
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk.toString()).slice(-16000); });
  let timer;
  const result = await Promise.race([
    new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); }),
    new Promise((_, reject) => { timer = setTimeout(() => { child.kill(); reject(new Error("Occupied-port rejection did not complete before setup")); }, 15000); }),
  ]).finally(() => clearTimeout(timer));
  rejectionMs=Date.now()-rejectionStartedAt;
  assert.notEqual(result, 0); assert.match(output, /E2E_TEST_PORT_IN_USE/);
  assert.doesNotMatch(output, /Created test-owned database|vite v.*building|db:push:force/);
  assert.deepEqual(existsSync(artifactRoot) ? readdirSync(artifactRoot).sort() : [], artifactsBefore, "Refusal creates neither build evidence nor a database-run journal");
  assert.equal(existsSync(path.resolve("test-results/.disposable-e2e-run.lock")), false, "Refused runner releases only its own lock");
  assert.equal(requests, before, "Preflight cannot contact or mutate the unrelated server");
  assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200, "The unrelated listener remains running");
} finally { await new Promise(resolve => unrelated.close(resolve)); }
const chosen = await assertUnusedLocalTestPort({ PORT: String(port) }); assert.equal(chosen.port, port);
const reuse = net.createServer();
await new Promise(resolve => reuse.listen(port, "127.0.0.1", resolve));
await new Promise(resolve => reuse.close(resolve));
console.log(JSON.stringify({ status: "passed", rejectionMs, deadlineMs:15000, checks: ["invalid ports rejected", "occupied listener denied before runner build/database/seeding", "no requests sent to unrelated listener", "unrelated process remains running", "reservation released for owned server startup"], workspace: path.basename(process.cwd()) }));

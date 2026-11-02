import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireE2eWorkspaceLock } from "./e2e-workspace-lock.mjs";

const directory = mkdtempSync(path.join(os.tmpdir(), "iss-runner-lock-test-"));
try {
  const ownerEnv = {};
  const release = acquireE2eWorkspaceLock(directory, ownerEnv);
  assert.ok(ownerEnv.DISPOSABLE_E2E_LOCK_TOKEN);
  assert.equal(ownerEnv.DISPOSABLE_E2E_LOCK_PID, String(process.pid));
  assert.throws(() => acquireE2eWorkspaceLock(directory, {}), /Another application build or disposable browser run/);
  const childRelease = acquireE2eWorkspaceLock(directory, { ...ownerEnv });
  childRelease();
  assert.ok(readFileSync(path.join(directory, ".disposable-e2e-run.lock"), "utf8"));
  assert.throws(() => acquireE2eWorkspaceLock(directory, { ...ownerEnv, DISPOSABLE_E2E_LOCK_TOKEN: "wrong" }), /ownership/);
  assert.throws(() => acquireE2eWorkspaceLock(directory, { ...ownerEnv, DISPOSABLE_E2E_LOCK_PID: "0" }), /ownership/);
  release();
  assert.equal(ownerEnv.DISPOSABLE_E2E_LOCK_TOKEN, undefined);
  const nextRelease = acquireE2eWorkspaceLock(directory, {});
  nextRelease();
  console.log("Workspace lock checks passed: independent runs excluded, viewport inheritance validated, ownership-safe release and reuse.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

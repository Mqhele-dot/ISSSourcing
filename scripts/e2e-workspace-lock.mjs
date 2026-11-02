import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Hold across build, both viewport children, server shutdown and DB cleanup. */
export function acquireE2eWorkspaceLock(directory, env = process.env) {
  mkdirSync(directory, { recursive: true });
  const lockPath = path.join(directory, ".disposable-e2e-run.lock");
  const inherited = env.DISPOSABLE_E2E_LOCK_TOKEN;
  if (inherited) {
    const owner = JSON.parse(readFileSync(lockPath, "utf8"));
    if (owner.token !== inherited || String(owner.pid) !== env.DISPOSABLE_E2E_LOCK_PID) {
      throw new Error("Disposable browser runner lock ownership does not match.");
    }
    process.kill(owner.pid, 0);
    return () => {};
  }
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  try {
    writeFileSync(lockPath, JSON.stringify(owner), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Another application build or disposable browser run owns ${lockPath}. Wait for it to finish. After a crash, verify its recorded PID has stopped before removing only this lock file.`);
  }
  env.DISPOSABLE_E2E_LOCK_TOKEN = owner.token;
  env.DISPOSABLE_E2E_LOCK_PID = String(owner.pid);
  return () => {
    if (JSON.parse(readFileSync(lockPath, "utf8")).token !== owner.token) {
      throw new Error("Refusing to remove another browser run's lock.");
    }
    unlinkSync(lockPath);
    delete env.DISPOSABLE_E2E_LOCK_TOKEN;
    delete env.DISPOSABLE_E2E_LOCK_PID;
  };
}

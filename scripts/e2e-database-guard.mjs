import "dotenv/config";
import { createHash } from "node:crypto";

const disposableName = /(?:^|[_-])(test|testing|ci|rehearsal|temp|tmp)(?:$|[_-])/i;

export function databaseIdentity(databaseUrl) {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return createHash("sha256").update([url.hostname.toLowerCase(), url.port || "5432", name, url.username].join("|")).digest("hex");
}

export function assertDisposableE2eEnvironment(env = process.env) {
  if (!env.DATABASE_URL || !env.TEST_DATABASE_URL) throw new Error("E2E mutation gate requires DATABASE_URL and TEST_DATABASE_URL.");
  const name = decodeURIComponent(new URL(env.TEST_DATABASE_URL).pathname.replace(/^\//, ""));
  if (!disposableName.test(name) || /(prod|production|live)/i.test(name)) throw new Error(`E2E refused non-disposable database "${name}".`);
  if (databaseIdentity(env.DATABASE_URL) !== databaseIdentity(env.TEST_DATABASE_URL)) throw new Error("DATABASE_URL and TEST_DATABASE_URL must identify the same disposable database.");
  return databaseIdentity(env.TEST_DATABASE_URL);
}

export async function assertDisposableE2eServer(readyUrl, expectedIdentity) {
  const response = await fetch(readyUrl, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok || response.headers.get("x-test-database-mode") !== "disposable" || response.headers.get("x-test-database-identity") !== expectedIdentity) {
    throw new Error(`E2E refused ${readyUrl}: running server did not prove the configured disposable database identity.`);
  }
}

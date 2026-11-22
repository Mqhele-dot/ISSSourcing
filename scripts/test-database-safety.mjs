import "dotenv/config";

export function assertDisposableTestDatabase(databaseUrl = process.env.TEST_DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error(
      "Mutation test database safety check failed: TEST_DATABASE_URL is not set. Use a disposable database such as isssourcing_test.",
    );
  }

  let databaseName = "";
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("Mutation test database safety check failed: DATABASE_URL is invalid.");
  }

  if (!/(?:^|[_-])(test|testing|ci|rehearsal|temp|tmp)(?:$|[_-])/i.test(databaseName)) {
    throw new Error(
      `Mutation tests refused database "${databaseName}". Use a disposable database whose name contains test, ci, rehearsal, temp, or tmp.`,
    );
  }
  if (/(prod|production|live)/i.test(databaseName)) {
    throw new Error(`Mutation tests refused production-like database "${databaseName}".`);
  }
  return databaseName;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  console.log(`Mutation test database safety check passed: ${assertDisposableTestDatabase()}`);
}

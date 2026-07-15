const DISPOSABLE_DATABASE_NAME = /(?:^|[_-])(test|testing|ci|rehearsal|temp|tmp)(?:$|[_-])/i;
const PRODUCTION_DATABASE_NAME = /(prod|production|live)/i;

export function getDatabaseName(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("Mutation test database safety check failed: database URL is invalid.");
  }
}

export function isDisposableDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  const databaseName = getDatabaseName(databaseUrl);
  return DISPOSABLE_DATABASE_NAME.test(databaseName) && !PRODUCTION_DATABASE_NAME.test(databaseName);
}

export function assertDisposableDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error(
      "Mutation test database safety check failed: TEST_DATABASE_URL is not set. Use a disposable database such as isssourcing_test.",
    );
  }

  const databaseName = getDatabaseName(databaseUrl);
  if (!DISPOSABLE_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      `Mutation tests refused database "${databaseName}". Use a disposable database whose name contains test, ci, rehearsal, temp, or tmp.`,
    );
  }
  if (PRODUCTION_DATABASE_NAME.test(databaseName)) {
    throw new Error(`Mutation tests refused production-like database "${databaseName}".`);
  }
  return databaseName;
}

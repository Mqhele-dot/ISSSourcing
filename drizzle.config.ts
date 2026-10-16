import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Same rule as server/config/env.ts: never override Compose/Codespaces-injected DB vars.
config({ path: ".env", override: false });

/** Match `server/db.ts`: allow PG* vars when DATABASE_URL is unset. */
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL;
  }
  const host = process.env.PGHOST;
  const port = process.env.PGPORT || "5432";
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;

  if (!host || !database || !user || !password) {
    throw new Error(
      "Set DATABASE_URL or PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (see .env.example)",
    );
  }

  let url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  if (process.env.PGSSLMODE === "disable") {
    url += url.includes("?") ? "&sslmode=disable" : "?sslmode=disable";
  }
  return url;
}

const databaseUrl = resolveDatabaseUrl();

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});

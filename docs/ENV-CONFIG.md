# Environment configuration

Separate configuration for development and production.

## Development

1. Copy **`.env.example`** to **`.env`** in the repo root (`.env` is loaded automatically via `dotenv` in `server/db.ts` and `drizzle.config.ts`).
2. Set **`DATABASE_URL`** to your local Postgres (and **`SESSION_SECRET`**). On local Postgres without SSL, set **`PGSSLMODE=disable`** or add **`?sslmode=disable`** to the URL.
3. Run **`npm run dev`**. With an empty DB, demo data is seeded automatically if `AUTO_SEED_ON_EMPTY_DB` is not set to `false`.

**Windows:** step-by-step setup is in **[`WINDOWS-LOCAL-SETUP.md`](./WINDOWS-LOCAL-SETUP.md)**.

See **`.env.example`** for supported variables.

## Production

1. Do **not** copy `.env` from the repo. Set variables in your host (e.g. Docker env, systemd, or platform env).
2. Required: `DATABASE_URL`, `SESSION_SECRET`. Use a long random value for `SESSION_SECRET`.
3. Set `NODE_ENV=production` and `AUTO_SEED_ON_EMPTY_DB=false` (or omit; production defaults to no auto-seed).

See `.env.production.example` for a checklist.

## Summary

| Variable              | Development      | Production        |
|-----------------------|------------------|-------------------|
| NODE_ENV              | development      | production        |
| DATABASE_URL          | local DB         | production DB     |
| SESSION_SECRET        | any (e.g. dev)   | long random       |
| AUTO_SEED_ON_EMPTY_DB | true (default)   | false (default)   |

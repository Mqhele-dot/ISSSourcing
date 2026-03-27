# GitHub Codespaces Setup

> **Running on your own Windows PC instead?** Use **[`docs/WINDOWS-LOCAL-SETUP.md`](docs/WINDOWS-LOCAL-SETUP.md)** and the root **[`README.md`](README.md)** — no devcontainer required.

> **Dev container folder name:** If this clone has **`.devcontainer.disabled`** instead of **`.devcontainer`**, Dev Containers were turned off to avoid **Docker / WSL** prompts on Windows. **GitHub Codespaces** still needs **`.devcontainer`** at the repo root. Rename the folder back (see **`.devcontainer.disabled/WHY-DISABLED.md`**) before relying on Codespaces, or restore that name on `main` in your team repo.

This repository includes a devcontainer configuration (under **`.devcontainer`** when present) so it can boot in GitHub Codespaces with the required services:

- Node.js 20
- PostgreSQL 16
- Native build dependencies for packages like `canvas`, `sharp`, and `sqlite3`

## Quick start

1. Open the repository in GitHub Codespaces.
2. Wait for the container to finish building.
3. The post-create script will:
   - install dependencies with `npm ci`
   - wait for PostgreSQL
   - run `npm run db:push` to initialize the schema
4. Start the app with one command:

```bash
npm run codespaces:up
```

5. **If the browser shows HTTP 502:** In VS Code, open the **PORTS** tab (next to Terminal), find port **5000**, click the visibility dropdown, set it to **Public**, then reload the page. The app is only reachable from your browser when the port is Public.

The command will:
- verify you are in the repository root
- install dependencies
- wait for PostgreSQL readiness
- apply schema (`npm run db:push`)
- start the development server
- warm both `/health` and `/` before reporting ready
- check forwarded URL reachability in Codespaces

On first boot, the server auto-seeds demo data when the database is empty.
You can also seed manually with:

```bash
npm run db:seed
```

For a full QA-ready seeded environment (core + operational datasets), use:

```bash
npm run demo:reset
```

## Full Validation Workflow

Run this exact sequence in Codespaces to verify the latest branch and ensure exports + procurement flow are healthy:

```bash
git fetch origin
git checkout cursor/project-codespace-compatibility-b14c
git pull --ff-only origin cursor/project-codespace-compatibility-b14c
npm ci
npm run db:push
npm run demo:reset
```

If `npm ci` fails with lockfile sync errors (for example `Missing: bufferutil@... from lock file`), run:

```bash
npm install
npm ci
```

If `npm run dev` fails with `Cannot find package 'docx'`, run:

```bash
npm install
```

Then re-run:

```bash
npm run dev
```

Start the app in terminal A:

```bash
npm run dev
```

In terminal B, run verification checks:

```bash
npm run check
npm run lint
npm run test:api
```

**Windows PowerShell:** prefix env vars instead of `BASE_URL=...`:

```powershell
$env:BASE_URL="http://127.0.0.1:5000"; npm run test:api
$env:BASE_URL="http://127.0.0.1:5000"; npm run test:procurement-flow
```

**Error UX smoke (toasts + diagnostics):** after logging in, trigger a failed save or a blocked action. You should see a **visible toast** (Radix) and, when a request fails through the shared client, the **Action Failed** diagnostics affordance when applicable. The top **readiness banner** appears when the database, schema, session store, or upload path is not ready (does not use the global error center so it stays quiet on health polling).

**Power-user navigation:** press **Ctrl+K** (Windows/Linux) or **⌘K** (macOS), or use **Jump to…** in the header, to open the **command palette** and jump to any module without using the sidebar. This mirrors patterns used in modern SCM and collaboration tools.

**Performance:** route modules are **lazy-loaded** so initial load stays smaller; list data uses tuned React Query defaults (`staleTime`, `gcTime`, refetch on reconnect).

Reliability contract checks (request IDs + readiness):

```bash
curl -i http://127.0.0.1:5000/api/health
curl -i http://127.0.0.1:5000/api/ready
curl -i http://127.0.0.1:5000/health/deep
```

Expected:
- `X-Request-Id` header is present on API responses.
- `/api/ready` payload includes `dbReady`, `schemaReady`, `sessionStoreReady`, and `websocketReady`.

`test:api` includes:
- RBAC authorization checks
- purchase requisition API flow tests
- end-to-end procurement flow smoke test
- export smoke tests for `pdf`, `csv`, `excel`, and `docx`

## Ports and URLs

| Service | Port | Notes |
|---|---:|---|
| Server | 5000 | Express + Vite middleware |
| Client | 5000 | Same URL as server in development |
| PostgreSQL | 5432 | `db` service in devcontainer |

If you open the forwarded URL in an external browser session, set port **5000** visibility to **Public** in the Codespaces **Ports** tab.
`codespaces:up` will also attempt to make port 5000 public automatically (best-effort). Disable this with `CODESPACES_AUTO_PUBLIC_PORT=false`.

## Troubleshooting (502 / app not reachable)

**Most common fix:** If you see **HTTP 502** when opening the `*.app.github.dev` URL in your browser, the port is likely not Public. In VS Code, open the **PORTS** tab (beside the Terminal), find **5000**, set visibility to **Public**, then reload the page.

1. Keep the dev server terminal running (do not close it).
2. If 502 persists: verify the server is listening and the health endpoint responds:
   - `lsof -i :5000` (or your `PORT`) to confirm the process is bound.
   - `curl http://127.0.0.1:5000/health` — should return 200 JSON.
3. Set port visibility to **Public** in the Codespaces **Ports** tab (required for `*.app.github.dev`).
4. Restart the dev server with explicit binding: `HOST=0.0.0.0 PORT=5000 npm run dev`.
5. In the **Ports** tab, confirm port `5000` exists and open it from that row (avoid stale browser tabs).

**401 Unauthorized on APIs after login (walkthrough, notifications, warehouses):** The app must trust the Codespaces HTTPS proxy so session cookies are marked `Secure` correctly. Ensure the dev container passes `CODESPACES` / `CODESPACE_NAME` / `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` into the app service (see `.devcontainer/docker-compose.yml`). Restart the dev server after updating. If you run the server **outside** Docker in a Codespace terminal, set `TRUST_PROXY=1` or rely on those same env vars being present in the shell.

**Database / “Loading…” forever:** If the Control Tower, Purchase Orders, Shipments, or Exceptions pages never load:

- Ensure the Postgres service is running (`db` in the devcontainer).
- Run `npm run codespaces:up` so that schema and seed run; the app expects `DATABASE_URL=postgresql://postgres:postgres@db:5432/inventory_dev` (or equivalent) so it does not fall back to `localhost:5432`, which does not exist in Codespaces.
- Operational API calls time out after 8 seconds and return empty data so the UI can show “No results” instead of spinning indefinitely.

Health endpoint for smoke tests:

```text
GET /health
GET /health/deep
```

**Test core API endpoints** (each should return JSON quickly; 200 with body, not 502):

```bash
curl -i http://localhost:5000/api/inventory
curl -i http://localhost:5000/api/purchase/orders
curl -i http://localhost:5000/api/logistics/shipments
curl -i http://localhost:5000/api/exceptions
curl -i http://localhost:5000/api/integrations/runs
curl -i http://localhost:5000/api/suppliers
curl -i http://localhost:5000/api/warehouses
```

If any hang or return 502, check server logs; list endpoints are stubbed to return `200` with `[]` when the backend fails so the UI can show "No results" instead of spinning.

Development-only demo reset endpoint:

```text
POST /admin/demo/reset
```

## Default environment

Inside Codespaces, these DB values are preconfigured for the app container:

- `DATABASE_URL=postgresql://postgres:postgres@db:5432/inventory_dev`
- `PGHOST=db`
- `PGPORT=5432`
- `PGDATABASE=inventory_dev`
- `PGUSER=postgres`
- `PGPASSWORD=postgres`

**Important:** The app must use the `db` host (the Postgres service in the devcontainer). If `DATABASE_URL` is unset, the server falls back to `db:5432` when running in Codespaces so that operational routes (inventory, purchase orders, shipments, exceptions, connectors) can connect. Without a working database, those pages will show empty lists or time out after ~8 seconds and then show empty state.

For local non-Codespaces development, copy `.env.example` to `.env` and adjust values as needed.

## Build and static assets

- **Vite** (client) builds to **`dist/public`** (see `vite.config.ts`: `build.outDir`).
- **Express** in production serves static files from **`server/public`** when the server runs from the repo root, or from **`dist/public`** when the server runs from `dist/` (e.g. `node dist/index.js`). The `serveStatic` function in `server/vite.ts` uses `path.resolve(__dirname, "public")`, so the executable’s directory must contain a `public` folder with the built client (e.g. run from project root after copying client build into `server/public`, or run from `dist/` so `dist/public` is used). Do not change Vite’s `outDir` without updating the server’s static path so both stay in sync.

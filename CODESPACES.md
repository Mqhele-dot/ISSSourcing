# GitHub Codespaces Setup

This repository now includes a `.devcontainer` configuration so it can boot in GitHub Codespaces with the required services:

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
4. Start the app with one command (the script now auto-switches to repo root when needed):

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

## First verify you are in the correct repo folder

If you get errors like `No such file or directory: /workspace/ISSSourcing`, your workspace folder name is different from what a prior message assumed.

Use these commands to detect the actual path and switch to it (no hardcoded folder name):

```bash
pwd
git rev-parse --show-toplevel
cd "$(git rev-parse --show-toplevel)"
```

To confirm you are running the latest branch changes (and not an older branch/tab):

```bash
git branch --show-current
git log --oneline -n 3
```

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

If updates still do not appear after a successful start, it is usually one of these:

- stale process/cache (now auto-fixed by `npm run codespaces:up`, which stops old listeners and clears Vite cache), or
- browser/VS Code is still pointed at a different branch/workspace.

Verify branch + commit in your active terminal:

```bash
git branch --show-current
git log --oneline -n 1
```

**Tailwind IntelliSense errors (e.g. `Can't resolve 'tailwindcss-animate'` or SyntaxError in `node_modules/.../package.json`):**

1. Make sure VS Code is opened at the repo root (the folder containing `package.json` and `tailwind.config.ts`).
2. Run exactly one bootstrap process: `npm run codespaces:up`.
   - Do **not** start a second `codespaces:up` while one is already running; concurrent installs can leave partial module folders and trigger false Tailwind resolution errors.
3. If errors persist, clean and reinstall dependencies:
   - `rm -rf node_modules`
   - `npm ci`
4. Reload window: **Developer: Reload Window**.

**`ERR_PACKAGE_PATH_NOT_EXPORTED` during `npm run codespaces:up`** (for example, on `drizzle-kit/package.json`):

- Pull the latest branch changes to ensure your local `scripts/codespaces-up.sh` includes the package-export-safe dependency check.
- Re-run bootstrap once: `npm run codespaces:up`.
- If you still see the same error, verify your script does **not** call `require.resolve('<pkg>/package.json')` in dependency validation; it should read from `node_modules/<pkg>/package.json` directly.

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

## Codex PR update limitation

If you see this error in Codex:

> `Codex does not currently support updating PRs that are updated outside of Codex. For now, please create a new PR.`

Use this workflow:

1. Keep working on the same branch and commit your latest fixes.
2. Open a **new** PR from that branch instead of trying to update the old Codex-managed PR.
3. Link the new PR to the previous one and briefly note it replaces the prior PR because of Codex update limitations.
4. Continue review and follow-up changes on the new PR thread.

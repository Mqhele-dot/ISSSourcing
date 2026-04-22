# GitHub Codespaces Setup

> **Running on your own Windows PC instead?** Use **[`docs/WINDOWS-LOCAL-SETUP.md`](docs/WINDOWS-LOCAL-SETUP.md)** and the root **[`README.md`](README.md)** — no devcontainer required.

> **GitHub Codespaces:** the repo includes **`.devcontainer/`** (Docker Compose: app + Postgres on host **`db`**). Create or **rebuild** the Codespace so that configuration is applied; otherwise the workspace has no `db` DNS name and database commands fail with `ENOTFOUND db` or `ECONNREFUSED` to localhost.
>
> **Windows desktop without Docker:** use **`docs/WINDOWS-LOCAL-SETUP.md`**. If the editor prompts **Reopen in Container**, choose **Reopen locally**. See **`.devcontainer.disabled/README.md`** for context.

This repository includes a devcontainer configuration under **`.devcontainer/`** so it can boot in GitHub Codespaces with the required services:

- Node.js 20
- PostgreSQL 16
- Native build dependencies for packages like `canvas`, `sharp`, and `sqlite3`

## Quick start

1. Open the repository in GitHub Codespaces **with the devcontainer** (`.devcontainer/`). If you opened a “plain” Codespace earlier, use **Command Palette → Codespaces: Rebuild Container** so Docker Compose starts the **`db`** Postgres service.
2. Wait for the container to finish building.
3. The post-create script will:
   - install dependencies with `npm ci`
   - wait for PostgreSQL
   - run `npm run db:push` to initialize the schema
4. Start the app with one command:

```bash
npm run codespaces:up
```

5. **If the browser shows HTTP 502, 401, or “Failed to fetch dynamically imported module”:** The forwarded port is almost certainly **Private**. Open **PORTS** → port **5000** → set visibility to **Public** → hard-reload. HTTP **401** on `https://<codespace>-5000.app.github.dev/health` is GitHub’s proxy, not the Express `/health` handler (which always returns JSON 200). Private ports also break **Vite** lazy-loaded routes because `.tsx` chunk requests are blocked the same way.
6. **Rebuild the devcontainer** after pulling the latest `.devcontainer/devcontainer.json` so **5000** defaults to **Public** (`portsAttributes.visibility`).

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

**Slow or stuck page load (lazy chunks):** If a route never leaves “Loading workspace…”, wait ~12s — you should see a **“taking longer than expected”** message with **Reload**. Chunk or render errors show **Try again** / **Reload app** (no infinite spinner). Prefer **Ports → 5000 → Public** if the tab shows 502.

**Procurement suppliers:** In-app links use **`/procurement/suppliers`** and **`/procurement/suppliers/:id`** (legacy `/suppliers/:id` may still redirect, but bookmarks should use the canonical paths).

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

### Ports tab (next to Terminal)

1. In the Codespace, open the **bottom panel** (same area as **Terminal**).
2. Click the **PORTS** tab (if you do not see it: **View → Open View… → Ports**, or use the Command Palette and run **“Ports: Focus on Ports View”**).
3. Confirm **5000** appears while `npm run dev` (or `npm run codespaces:up`) is running. If it is missing, click **Forward a Port**, enter `5000`, and press Enter.
4. For the **5000** row, open the **visibility** (lock/globe) menu and choose **Public** if you open the app in a normal browser tab (required to avoid **502** on `*.app.github.dev`).
5. Use **Open in Browser** on that row to launch the forwarded URL, or copy the **Local Address** / forwarded link.

If you open the forwarded URL in an external browser session, set port **5000** visibility to **Public** in the Codespaces **Ports** tab.
`codespaces:up` will also attempt to make port 5000 public automatically (best-effort). Disable this with `CODESPACES_AUTO_PUBLIC_PORT=false`.

### CSRF / “Invalid or expired form submission” on setup

The app uses **sessions** and **CSRF** on mutating API calls. Behind GitHub’s HTTPS proxy, the server must trust **`X-Forwarded-Proto`** so `express-session` can set cookies consistently with your browser URL.

- Ensure the devcontainer passes **`CODESPACES`**, **`CODESPACE_NAME`**, **`GITHUB_CODESPACES`**, and **`GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`** into the app container (see `.devcontainer/docker-compose.yml`).
- Or set **`TRUST_PROXY=1`** in `.env` when running the server behind a reverse proxy.
- After pulling fixes, **restart the dev server** and do a **hard refresh** (or log out and back in). The client also **retries once** after refreshing the CSRF token on `CSRF_TOKEN_INVALID`.

## Troubleshooting (502 / app not reachable)

**Tailwind CSS IntelliSense / Output: `Can't resolve 'tailwindcss-animate'`:** The config uses ESM plugin imports and `.vscode/settings.json` sets `tailwindCSS.experimental.configFile` so the extension resolves from the repo root. After `npm ci`, run **Developer: Reload Window**. Open the **single-folder** workspace **`…/ISSSourcing`** (not a parent directory-only root) so `node_modules` is found. Verify with `test -d node_modules/tailwindcss-animate && echo ok`.

**`codespaces:up` prints “Port 5000 not reachable from proxy”:** The dev server **stays running**; only the public URL probe failed. Open **Ports** → forward **5000** if missing → set visibility to **Public** → reload `https://<codespace>-5000.*.app.github.dev`. The repo sets **`remote.autoForwardPorts`: true** in `.vscode/settings.json` so forwarding is not suppressed by editor settings.

**Git LFS hook warnings:** Install in the container if you use LFS assets: `sudo apt-get update && sudo apt-get install -y git-lfs && git lfs install`.

**`.env: line N: EOF: command not found` when running `npm run codespaces:up`:** Older versions of `codespaces-up.sh` used `source .env`, so any non–`KEY=value` line (for example a stray `EOF` from a bad paste or a heredoc) was executed as a shell command. The script now only loads lines that look like `KEY=value`. You should still remove junk lines from `.env` or recreate it from `.env.example`.

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

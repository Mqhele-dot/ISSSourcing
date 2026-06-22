# Run ISS Sourcing locally on Windows

Use this guide when developing **on your PC** (not GitHub Codespaces). Codespaces docs remain in [`CODESPACES.md`](../CODESPACES.md).

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Windows 10/11** | 64-bit |
| **Node.js 22.12+** | [nodejs.org](https://nodejs.org/) LTS - verify: `node -v` |
| **npm** | Bundled with Node — verify: `npm -v` |
| **PostgreSQL 14+** | Local install or Docker — app expects Postgres, not SQLite, for full features |
| **Build tools (if `npm install` fails)** | **Visual Studio Build Tools** with “Desktop development with C++” — needed for native modules (`canvas`, `sharp`, `sqlite3`, `bufferutil`) |

Optional: **Git** for Windows, **pgAdmin** for DB GUI.

## 1. Install PostgreSQL on Windows

**The app requires PostgreSQL before login and most APIs work.** If you skip this step, `npm run dev` may still listen on port 5000, but you will see `ECONNREFUSED` in the terminal and **login returns HTTP 503**.

1. Download from [postgresql.org](https://www.postgresql.org/download/windows/) (installer) or run Postgres in **Docker**:
   ```powershell
   docker run --name iss-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=inventory_dev -p 5432:5432 -d postgres:16
   ```
2. Create a database if needed (installer often creates `postgres`; you can add `inventory_dev` or `iss_sourcing` in pgAdmin / `psql`):
   ```sql
   CREATE DATABASE inventory_dev;
   ```

## 2. Clone and install dependencies

```powershell
cd C:\path\to\ISSSourcing
npm install
```

If install fails on **node-gyp** / **canvas** / **sharp**:

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. In the installer, select **Desktop development with C++**.
3. Close and reopen the terminal, then run `npm install` again.

## 3. Environment file

The app loads **`.env`** automatically via `dotenv` when `server/db.ts` runs (and for `drizzle.config.ts` when you run `db:push`).

```powershell
copy .env.example .env
notepad .env
```

Set at minimum:

| Variable | Example (local) |
|----------|------------------|
| `DATABASE_URL` | `postgresql://postgres:YOUR_PASSWORD@localhost:5432/inventory_dev` |
| `SESSION_SECRET` | Long random string (any value is fine in dev) |

**Local Postgres often has SSL disabled.** If you see *“The server does not support SSL connections”*, add either:

- `PGSSLMODE=disable` in `.env`, or  
- `?sslmode=disable` on `DATABASE_URL`

See also [`DATABASE_SETUP.md`](../DATABASE_SETUP.md).

Other useful defaults for local desktop:

```env
HOST=127.0.0.1
PORT=5000
CLIENT_PORT=5000
```

You do **not** need Codespaces-specific variables (`CODESPACES`, forwarded URLs, etc.).

## 4. Database schema

With Postgres running and `.env` correct:

```powershell
npm run db:push
```

## 5. Demo data (optional)

Empty DB auto-seeds in development unless `AUTO_SEED_ON_EMPTY_DB=false`.

To reset and load full demo + operational data:

```powershell
npm run demo:reset
```

Or core seed only:

```powershell
npm run db:seed
```

## 6. Start the app

```powershell
npm run dev
```

When the server is ready, the terminal prints a **banner** with the exact **browser URL** and **port** (from `PORT` in `.env`, default **5000**). A file **`.local-dev-url`** is also written in the repo root (gitignored) with `APP_URL` and `PORT` so you can open it in the editor if the console scrolls past the banner.

Open **http://127.0.0.1:5000** (or whatever `PORT` you set).

- **Port in use:** change `PORT` in `.env` (e.g. `5001`) and restart.
- **Firewall:** allow Node on private networks if prompted.

### Cursor — Ports / `code-tunnel.exe ENOENT`

Cursor’s **Forward Port** action uses **`code-tunnel.exe`**. On many Windows installs that executable is **missing** (`ENOENT`) — this is a **Cursor packaging bug**, not this repo.

**Workaround (local dev):** do **not** use the Ports panel. With `npm run dev` running, open **Chrome or Edge** to **http://127.0.0.1:5000** (or your `PORT`).

This workspace sets **`remote.autoForwardPorts": false`** in **`.vscode/settings.json`** to reduce automatic tunnel attempts. You can still try **Cursor → Check for Updates** or a reinstall if you need built-in forwarding.

### VS Code / remote — Ports tab (optional)

On **Remote SSH, Dev Containers, or Codespaces**, forwarding may be required. Use the **PORTS** view and forward the same number as **`PORT`** in `.env` (default **5000**). **Codespaces:** set the forwarded port to **Public** if the site won’t load.

## 7. Production build on Windows

```powershell
npm run build
npm run start
```

`npm run start` uses **`cross-env`** so `NODE_ENV=production` works in PowerShell and cmd.

## 8. Quick health check

```powershell
npm run doctor:win
```

## If Windows keeps offering to install Linux (WSL / Ubuntu)

Common causes on a dev PC:

| Source | What happens | What to do |
|--------|----------------|-------------|
| **Docker Desktop** | First-time setup enables **WSL 2** and a **Linux kernel** (Microsoft’s VM stack). | If you don’t need Docker, uninstall Docker Desktop from *Settings → Apps*. Use a local PostgreSQL installer instead of `docker run` for the DB. |
| **Cursor / VS Code Dev Containers** | The repo ships **`.devcontainer/`** for **GitHub Codespaces** (Postgres in Docker). Locally, the editor may offer **“Reopen in Container”** → Linux image via Docker → often WSL on Windows. | Choose **Reopen locally** and follow this doc for a normal Windows Postgres install, or use GitHub Codespaces in the browser. See **`.devcontainer.disabled/README.md`** for context. |
| **Running `bash` from PowerShell** | Some `npm` scripts call `bash`; Windows may suggest **WSL** or **Ubuntu** if Git Bash isn’t installed. | Prefer **`npm run doctor:win`** and **`npm run dev`**. Install [Git for Windows](https://git-scm.com/download/win) if you need `bash scripts/*.sh`. |
| **Optional Windows features** | “Windows Subsystem for Linux” can be turned on manually or by an installer. | *Settings → Apps → Optional features* — remove **Windows Subsystem for Linux** if you don’t use it (only after you know nothing you need depends on it). |

This project does **not** install Linux by itself; something above triggers Microsoft’s WSL/Docker stack.

## Scripts that use Bash

`npm run docs:validate` is Windows-safe and uses Node (`scripts/validate-readme.mjs`).

These expect **Git Bash**, **WSL**, or another Unix shell:

- `npm run doctor` → `bash scripts/doctor.sh`
- `npm run codespaces:up`
- `npm run test:runtime`

On Windows-only shells, use **`npm run doctor:win`** and start the app with **`npm run dev`** instead of `codespaces:up`. Integration tests that use `tsx` (`npm run test:login`, `test:procurement-flow`, etc.) work from PowerShell once the server is running.

## OneDrive / long paths

If the repo lives under **OneDrive**, very long paths can break native builds. Prefer cloning to a short path, e.g. `C:\dev\ISSSourcing`.

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| `ECONNREFUSED` to Postgres | Start PostgreSQL service (services.msc) or Docker container; check `DATABASE_URL` host/port. |
| `password authentication failed` | Match `DATABASE_URL` user/password to your Postgres role. |
| Port **5000** taken (Windows) | `netstat -ano \| findstr :5000` then Task Manager → Details → end PID, or use another `PORT` in `.env`. |
| `drizzle-kit` / `DATABASE_URL` error | Ensure `.env` exists in repo root; `db:push` loads it via `drizzle.config.ts`. |
| **`ECONNREFUSED` / `127.0.0.1:5432`** | PostgreSQL is not running. Start the **postgresql-x64-…** Windows service (`services.msc`) or start your Docker container, then `npm run db:push` and restart `npm run dev`. |
| **Login HTTP 503** | Almost always **no DB**: fix Postgres + `db:push` first; session store needs PostgreSQL. |
| Blank page / API errors | Check terminal for Vite/Express errors; confirm you use one terminal with `npm run dev` (serves API + client). |

## Related docs

- [`DATABASE_SETUP.md`](../DATABASE_SETUP.md) — DB variables, SSL, schema
- [`docs/ENV-CONFIG.md`](./ENV-CONFIG.md) — dev vs production env
- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — smoke checks
- [`CODESPACES.md`](../CODESPACES.md) — cloud devcontainer flow

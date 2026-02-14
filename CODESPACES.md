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
4. Start the app with one command:

```bash
npm run codespaces:up
```

The command will:
- verify you are in the repository root
- install dependencies
- wait for PostgreSQL readiness
- apply schema (`npm run db:push`)
- start the development server

On first boot, the server auto-seeds demo data when the database is empty.
You can also seed manually with:

```bash
npm run db:seed
```

## Ports and URLs

| Service | Port | Notes |
|---|---:|---|
| Server | 5000 | Express + Vite middleware |
| Client | 5000 | Same URL as server in development |
| PostgreSQL | 5432 | `db` service in devcontainer |

If you open the forwarded URL in an external browser session, set port **5000** visibility to **Public** in the Codespaces **Ports** tab.

## Troubleshooting (502 / app not reachable)

1. Keep the dev server terminal running (do not close it).
2. Verify in-container health:

```bash
curl http://127.0.0.1:5000/health
```

3. In the **Ports** tab, confirm port `5000` exists and open it from that row (avoid stale browser tabs).
4. For external browser access, ensure visibility is **Public**.

Health endpoint for smoke tests:

```text
GET /health
GET /health/deep
```

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

For local non-Codespaces development, copy `.env.example` to `.env` and adjust values as needed.

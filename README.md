# ISS Sourcing

Supply-chain and inventory management app: **Express** API, **PostgreSQL**, **React** + **Vite** client, **Drizzle** ORM.

## Local development

### Windows (this machine / desktop)

Follow **[`docs/WINDOWS-LOCAL-SETUP.md`](docs/WINDOWS-LOCAL-SETUP.md)** — PostgreSQL, `.env`, `npm install`, `npm run db:push`, `npm run dev`.

Quick sequence:

```powershell
copy .env.example .env
# Edit .env: DATABASE_URL, SESSION_SECRET, PGSSLMODE=disable if needed
npm install
npm run db:push
npm run dev
```

→ **http://127.0.0.1:5000** (or the port in your `.env` `PORT=`)

After `npm run dev`, look for the **ASCII banner** in the terminal (URL + port). A **`.local-dev-url`** file is also created in the repo root with `APP_URL` and `PORT` for copy/paste (gitignored).

```powershell
npm run doctor:win   # optional environment check
```

### GitHub Codespaces

See **[`CODESPACES.md`](CODESPACES.md)** and `npm run codespaces:up`.

## Common commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (API + Vite middleware) |
| `npm run build` | Production client + server bundle |
| `npm run start` | Run built server (uses `cross-env` on Windows) |
| `npm run check` | TypeScript (`tsc`) |
| `npm run db:push` | Apply Drizzle schema to Postgres |
| `npm run db:seed` / `npm run demo:reset` | Seed data |

## Requirements

- **Node.js 20+** ([`package.json`](package.json) `engines`)
- **PostgreSQL** for full functionality

## Documentation

- [`docs/WINDOWS-LOCAL-SETUP.md`](docs/WINDOWS-LOCAL-SETUP.md) — **Windows**
- [`DATABASE_SETUP.md`](DATABASE_SETUP.md) — database & SSL
- [`docs/ENV-CONFIG.md`](docs/ENV-CONFIG.md) — environment variables
- [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) — API shapes

## License

MIT

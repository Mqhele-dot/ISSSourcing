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
| `npm run release:gate` | Full production-readiness validation gate |
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
- [`docs/PERMISSION_MATRIX.md`](docs/PERMISSION_MATRIX.md) — route auth/RBAC overview
- [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) — deployment, security, runbook, rollback, UI vs `/api/ready`
- [`docs/CHANGELOG-ROUTING.md`](docs/CHANGELOG-ROUTING.md) — canonical routes, legacy redirects, procurement UI ownership

## Production Notes

- Production startup now requires a real `DATABASE_URL` and strong `SESSION_SECRET`.
- Runtime schema/bootstrap helpers are for local/dev only; production should be migration-first.
- A production Docker example is provided in [`docker-compose.production.yml`](docker-compose.production.yml).

## Accounts Payable (AP) Controls

- **Status model:** invoice transitions are constrained (`DRAFT` -> `PENDING_APPROVAL` -> `APPROVED` -> payment states), and payment batches move through `DRAFT`/`PENDING_APPROVAL`/`APPROVED`/`RELEASED` with legal-transition checks.
- **Approval flow:** AP approvals use org-scoped `approval_policies` by entity type (`invoice`, `payment_batch`) and amount band. Approval is rejected when no valid policy/approver is present.
- **Segregation of duties:** creator self-approval and creator self-release are blocked unless explicit admin override + reason is provided; release also checks approver/releaser separation.
- **Batch release safety:** release runs transactionally with row locking, idempotent re-entry handling, invoice payable revalidation, and due-amount overpayment checks.
- **Receipt/match assumptions:** AP receipt lines must map to PO lines and cannot exceed remaining receivable quantity; matching writes structured mismatch outcomes and a recommended next workflow state instead of silently advancing approval state.

Production rollout should use checked-in SQL migration files under [`migrations/`](migrations/) as the source of truth; startup AP DDL bootstrap remains as local/dev safety.

## License

MIT

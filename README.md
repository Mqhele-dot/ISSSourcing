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

For automation worktrees and Windows/OneDrive checkouts, prefer:

```powershell
npm run ci:workspace
```

If `npm install` or `npm ci` fails on Windows with `EPERM` under `%LOCALAPPDATA%\electron\Cache` or the default npm cache, run:

```powershell
npm run repair:win-install
```

That repair path forces npm cache, temp/app-data folders, and Electron/Electron Builder caches into repo-local directories before reinstalling, which avoids the locked `%LOCALAPPDATA%` cache paths that often break OneDrive and automation worktrees.

`npm run ci:workspace` now routes Windows installs through that repair flow automatically.

If PowerShell blocks `npm.ps1` on this machine, use `npm.cmd` (for example `npm.cmd run check`) or open `cmd.exe`.

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
| `npm run verify:core` | `check` + client stabilization + diagnostics self-checks + **`test:functional-audit`** + Playwright E2E (local “core” bar; needs DB) |
| `npm run release:gate` | Full production-readiness validation gate (includes stabilization + functional audit + E2E in CI) |
| `npm run local:up` | Start or reuse the local app, wait for `/api/ready` and `/auth`, then hold the dev server open |
| `npm run local:doctor` | Probe an already running local app and fail fast if `/api/ready` or `/auth` is unhealthy |
| `npm run test:local:url` | Log in and smoke-test a single route such as `/operations/control-tower` or `/m/counts` |
| `npm run db:push` | Apply Drizzle schema to Postgres |
| `npm run db:seed` / `npm run demo:reset` | Seed data |
| `npm run seed:functional-qa` | Deterministic QA dataset (inventory/AP/PO/reports); used by **`test:functional-audit`** and E2E global setup |
| `npm run test:diagnostics` | Runtime-safe calculation/filter self-checks used by System Diagnostics |
| `npm run test:functional-audit` | **FQA seed** + functional calculations/filters + inventory DB/API parity script (needs `DATABASE_URL`) |
| `npm run test:functional-e2e` | **FQA seed** + **`test:e2e`** (explicit re-seed before Playwright) |
| `npm run test:e2e` | Playwright `e2e/` tests; wrapper ensures `/api/ready` + `/auth` on 127.0.0.1:5000 before Playwright (needs DB). Global setup runs **`seed:functional-qa`** unless `SKIP_E2E_FUNCTIONAL_QA_SEED=1` |
| `npm run test:e2e:preflight` | With `npm run dev` running: checks `/api/ready` and `/auth` reachability |
| `npm run playwright:install-deps` | Linux: Playwright OS deps for Chromium, Firefox, WebKit (use `sudo` if apt fails) |
| `npm run security:lifecycle` | Report dependencies with **`hasInstallScript`** (lockfile-derived; hooks not executed here) |
| `npm run security:lifecycle:enforce` | Fail if new lockfile installers are outside curated allowlist |
| `npm run security:audit` | `npm audit --audit-level=high` (**commonly exits 1 pending dependency upgrades**) |
| `npm run security:audit:signatures` | **`npm audit signatures`** registry signature verification |
| `npm run security:sbom` | CycloneDX SBOM to `./sbom.cdx.json` (gitignored locally) |
| `npm run security:supply-chain` | Runs enforce + SBOM + signatures + audit in series (`audit` may exit non‑zero) |

## Requirements

- **Node.js 22.12+** ([`package.json`](package.json) `engines`)
- **PostgreSQL** for full functionality

## Documentation

### Security supply chain / hardening

- [`docs/security/EVIDENCE-2026-05-19.md`](docs/security/EVIDENCE-2026-05-19.md) — baseline evidence capture
- [`docs/security/npm-registry-policy.md`](docs/security/npm-registry-policy.md) — registry & confusion guidance
- [`docs/security/ai-code-security-checklist.md`](docs/security/ai-code-security-checklist.md) — AI-assisted change review
- [`docs/security/github-actions-pinning.md`](docs/security/github-actions-pinning.md) — Action pinning TODO inventory
- [`docs/security/CSP_AND_FRONTEND_NOTES.md`](docs/security/CSP_AND_FRONTEND_NOTES.md) — Helmet CSP + frontend notes
- [`docs/security/artifact-attestation.md`](docs/security/artifact-attestation.md) — optional OIDC attestations
- [`docs/security/SECURITY_VERIFICATION_RESULTS.md`](docs/security/SECURITY_VERIFICATION_RESULTS.md) — CLI verification logs (post-rollout)

### Platform docs

- [`DATABASE_SETUP.md`](DATABASE_SETUP.md) — database & SSL
- [`docs/ENV-CONFIG.md`](docs/ENV-CONFIG.md) — environment variables
- [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) — API shapes
- [`docs/PERMISSION_MATRIX.md`](docs/PERMISSION_MATRIX.md) — route auth/RBAC overview
- [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) — deployment, security, runbook, rollback, UI vs `/api/ready`
- [`docs/SYSTEM-DIAGNOSTICS.md`](docs/SYSTEM-DIAGNOSTICS.md) — System Diagnostics command center, report export, and redaction rules
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

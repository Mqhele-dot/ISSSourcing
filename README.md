# SupplyChain Control Tower (MVP Scaffold)

## Repository layout
- `apps/desktop` — Tauri desktop shell + React/TypeScript UI
- `services/api` — FastAPI local backend + SQLite + APScheduler
- `packages/shared` — shared contracts (JSON schema, TS types, pydantic model)
- `docs/execution` — execution planning documents
- `scripts` — local helper scripts

## Stack
- Desktop: Tauri + React + TypeScript
- Local backend: FastAPI + SQLite
- Jobs: APScheduler with connector run tracking

## MVP implemented
- Login + RBAC guard primitives (Planner/Ops/Admin)
- Connector framework + CSV drop-folder + ERP export connector
- Job runtime with retry and dead-letter queue
- Staging/canonical/audit schema in SQLite
- Exception rules for stockout risk, late confirmation, shipment delay
- Case endpoints + audit hash-chain verification
- Demo seed data + demo mode toggle endpoint

## Run backend
```bash
cd services/api
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --reload
```

## Run backend tests
```bash
cd services/api
.venv/bin/python -m pip install -e ".[dev]"
PYTHONPATH=. .venv/bin/python -m pytest -q
```

> Codespaces guardrail: always use `services/api/.venv/bin/python` and `services/api/.venv/bin/pip` for backend installs and test runs.
> Backend installs use `services/api/constraints.txt`; if your org blocks public indexes, place prebuilt wheels in `services/api/vendor/` and scripts will auto-retry from local wheels.

## Run in GitHub Codespaces

Open in Codespaces

Wait for postCreate to finish (it runs once automatically)

Then run:

```bash
./scripts/preview.sh
```

Alternative manual flow:

```bash
./scripts/smoke-codespaces.sh
./scripts/dev-codespaces.sh
```

API-only preview (no UI needed):

```bash
./services/api/scripts/preview_api.sh
```

In Codespaces preview, the UI calls the API via `/api` (Vite proxy), not direct port URLs in browser code.

## If installs fail

1. Wait for Codespaces provisioning/postCreate to finish, then retry.
2. Check whether your org enforces a restricted npm/pip proxy/index policy.
3. Run API-only first:

```bash
./services/api/scripts/preview_api.sh
```

4. Then launch full preview:

```bash
./scripts/dev-codespaces.sh
```

5. If needed, set mirrors:
   - `PIP_INDEX_URL` for pip
   - npm registry to your org mirror (`npm config set registry <url>`)

6. Backend fallback command (if your mirror supports it):

```bash
cd services/api
.venv/bin/python -m pip install -e ".[dev]" --no-use-pep517
```

If you refresh and get redirected to /login, click Login again.

Expected ports:

- API: 8000
- UI: 5173

Quick checks:

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/health/deep
```

## Phase 2 preview walkthrough (Operational Workflows)

1. Login as Planner/Ops/Admin on `/login` (demo password is `demo`).
2. Open **Inventory**:
   - Click an SKU to open detail.
   - Submit an adjustment (location, delta, reason).
   - Detail refetches and the movement log updates immediately.
3. Open **Purchase**:
   - Click a PO to open lines and status.
   - Update status (`open -> approved -> sent -> received`).
4. Open **Logistics**:
   - Filter shipments by status on list page.
   - Click a shipment for detail and update status.

All operational endpoints require auth and show a **Not logged in** prompt on 401 in the UI.


## Preview fallback (no Node required)

If frontend install is blocked, you can still verify backend operational flow:

```bash
cd services/api
PYTHONPATH=. .venv/bin/python scripts/demo_walkthrough.py
```

This walkthrough performs login, exception detection, PO receive, and inventory movement validation via HTTP calls.


## Docs-first Codespaces flow

```bash
./scripts/docs-flow-codespaces.sh
```

This validates README commands, runs smoke checks, and then launches the preview. If smoke exits `2`, the script explains proxy/index limitations and still starts the dev flow.

## Single-command Codespaces preview

```bash
./scripts/dev-codespaces.sh
```

This script starts API first, waits for `/health`, then starts UI.
API is proxied to the UI as `/api` in Codespaces.
It also prints reviewer steps: open port 5173 in the Ports tab and use `/api` for backend calls.


## Codespaces verification checklist

Run one script to validate backend + frontend prerequisites and health checks:

```bash
./scripts/verify-codespaces.sh
```

If dependency install is blocked by proxy/index restrictions, run backend-only fallback:

```bash
cd services/api
PYTHONPATH=. .venv/bin/python scripts/smoke_no_deps.py
PYTHONPATH=. .venv/bin/python scripts/demo_walkthrough.py
```

Sample connector CSV files for demos are in `services/api/sample_drop/`.


## Demo reset endpoint

`POST /demo/reset` requires a valid `Authorization: Bearer <token>` header and returns seeded counts:

```json
{ "ok": true, "message": "Demo data reloaded", "seeded": { "canonical": 0, "exceptions": 0, "movements": 0, "users": 0 } }
```

UI "Load demo data" buttons call this endpoint and refetch list data after success.

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
PYTHONPATH=. pytest -q
```

## Run in GitHub Codespaces

Open in Codespaces

Wait for postCreate to finish (it runs once automatically)

Then run:

```bash
./scripts/smoke-codespaces.sh
./scripts/dev-codespaces.sh
```

If installs fail due to corporate proxy, fallback:

```bash
cd services/api
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .[dev] --no-build-isolation || pip install -e .[dev] --use-pep517=false || true
PYTHONPATH=. pytest -q
```

```bash
cd apps/desktop/frontend
npm config set fund false
npm config set audit false
npm install
npm run build
```

Expected ports:

- API: 8000
- UI: 5173

Quick checks:

```bash
curl -s http://127.0.0.1:8000/health
curl -s http://127.0.0.1:8000/health/deep
```

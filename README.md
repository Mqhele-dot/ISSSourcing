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

After the Codespace finishes building:

### Start backend + frontend
```bash
./scripts/dev-codespaces.sh
```

Backend tests
```bash
cd services/api
source .venv/bin/activate
PYTHONPATH=. pytest -q
```

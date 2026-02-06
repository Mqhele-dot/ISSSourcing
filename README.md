# SupplyChain Control Tower (MVP Scaffold)

## Stack
- Desktop: Tauri + React + TypeScript
- Local backend: FastAPI + SQLite
- Jobs: APScheduler with connector run tracking

## MVP delivered in this scaffold
- Login + RBAC guard primitives (Planner/Ops/Admin)
- Connector framework + CSV drop-folder + ERP export connector
- Job runtime with retry and dead-letter queue
- Canonical/staging/audit schema in SQLite
- Exception rule engine for stockout risk, late confirmation, shipment delay
- Case endpoints + audit hash-chain verification
- Demo seed data + demo mode toggle endpoint

## Run backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
uvicorn app.main:app --reload
```

## Run tests
```bash
cd backend
pytest
```

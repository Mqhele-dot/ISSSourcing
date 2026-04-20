# Manual stabilization matrix (live verification)

Run against the **same environment** where you validate production behavior (local, Codespaces, or hosted). Fill in **Result** and **Notes** per row.

## Automated checks (2026-04-20)

| Check | Result |
|-------|--------|
| `npm run check` | Pass |
| `npm run test:stabilization-client` | Pass |
| `npm run test:smoke` | Run locally with server + seeded DB when validating API contract |

Per-route cells below remain for **human** verification in your deployment.

Columns: **Route** | **Loads** | **False setup banner** | **Global error FAB** | **Local errors actionable** | **Notes**

## Global / shell

| Route | Loads | Setup banner OK | FAB OK | Local OK | Notes |
|-------|-------|-----------------|--------|----------|-------|
| App boot | | | | | |
| Home | | | | | |
| `/setup` wizard | | | | | |
| `/admin/system-diagnostics` | | | | | |
| Readiness banner behavior | | | | | |

## Operations

| Route | Loads | Setup banner OK | FAB OK | Local OK | Notes |
|-------|-------|-----------------|--------|----------|-------|
| Control tower | | | | | |
| Logistics | | | | | |
| Exceptions | | | | | |
| Mobile hub | | | | | |

## Inventory

| Route | Loads | Setup banner OK | FAB OK | Local OK | Notes |
|-------|-------|-----------------|--------|----------|-------|
| Inventory | | | | | |
| Warehouses | | | | | |
| Warehouse operations | | | | | |
| Cycle counts | | | | | |
| Reorder | | | | | |
| Barcode scanner | | | | | |

## Procurement

| Route | Loads | Setup banner OK | FAB OK | Local OK | Notes |
|-------|-------|-----------------|--------|----------|-------|
| Purchase orders | | | | | |
| Requisitions | | | | | |
| Suppliers | | | | | |
| Supplier detail | | | | | |
| Contracts | | | | | |

## Finance

| Route | Loads | Setup banner OK | FAB OK | Local OK | Notes |
|-------|-------|-----------------|--------|----------|-------|
| AP intake | | | | | |
| AP approvals | | | | | |
| AP exceptions | | | | | |
| AP payments | | | | | |
| Invoices | | | | | |

## Analytics / admin

| Route | Loads | Setup banner OK | FAB OK | Local OK | Notes |
|-------|-------|-----------------|--------|----------|-------|
| Reports | | | | | |
| Saved reports | | | | | |
| Export center | | | | | |
| Settings | | | | | |
| Master data | | | | | |
| Document extractor | | | | | |
| Integrations | | | | | |
| Audit logs | | | | | |
| Billing (if enabled) | | | | | |

## When something fails

1. Open **System diagnostics** and use **Copy diagnostics JSON** (includes client readiness snapshot and last probe errors).
2. In the browser **Network** tab, capture `GET /api/setup/status` and `GET /api/ready` (status, response body).
3. On the server, search logs for `[SETUP_STATUS]` / `[READY]` lines for the same **request id** (`X-Request-Id` header).

## Known limitations (fill after pass)

- 
- 

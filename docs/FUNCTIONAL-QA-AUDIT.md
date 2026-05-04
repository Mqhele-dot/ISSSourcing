# InvTrack — Functional QA audit

**Last updated:** 2026-04-20  

**Business correctness confidence (0–3)**  
0 = shell visible only · 1 = one filter/action · 2 = several paths or API checks · 3 = **exact** FQA numbers, row sets, or CSV parity proven against **`seed:functional-qa`** (`SKU-A`–`D`, `PO-FQA-*`, `INV-FQA-*`, `REQ-FQA-001`).

**Pass rule:** A module is **pass** in the matrix only where the **Pass criteria** column is satisfied by current automation. Otherwise **partial** or **not covered**.

**Commands**

- `npm run verify:core` — **`check`** + **`test:stabilization-client`** + **`test:functional-audit`** + **`test:e2e`** (local “core” verification; needs DB + Playwright where applicable).
- `npm run test:functional-audit` — runs **`seed:functional-qa`**, `test:functional-calculations`, `test:functional-filters`, and **`test:functional-inventory-api`** (operational list vs seed, same path as GET `/api/inventory`). Requires **`DATABASE_URL`** (or configured dev DB).
- E2E: `e2e/global-setup.ts` runs **`seed:functional-qa`** after `e2e:prep` unless **`SKIP_E2E_FUNCTIONAL_QA_SEED=1`**.
- Local explicit: **`npm run test:functional-e2e`** = seed + Playwright.

---

## Deliverables (this audit revision)

| Area | Finding |
|------|---------|
| **Broken filters found** | None in paths under test: inventory UI + **`listOperationalInventory`**, PO list client filter + API list, requisitions `PENDING` + `REQ-FQA-001`, reports inventory **category → preview** (fixed to respect `categoryId` + `search`). |
| **Wrong calculations found** | **Documented product gap (not a failing test):** `/api/inventory/stats` / master **quantity** vs operational **available** for low-stock semantics. Analytics `/api/reports/analytics` spend uses **Number** sums on PO totals (cent drift risk) — date-window test asserts **zero spend** for a far-future window, not cent parity. |
| **Pages that do not function** | None observed in **`verify:core`** for routes exercised; partial modules may still hide defects outside smoke/deep-smoke actions. |
| **Fixes applied** | Reports **inventory preview** now filters by **`categoryId` + `search`** to align with export filters; preview shows up to **25** rows; **`data-testid`** on preview table, rows, category filter; merged **business E2E** into **`functional-audit.spec.ts`**; added **DB API parity** script for inventory; **`test:functional-audit`** chains **seed + inventory API** checks. |
| **Tests added** | `scripts/test-functional-inventory-api.ts`; expanded **`e2e/functional-audit.spec.ts`** (serial, exact stock attrs, CSV FQA low-stock subset, AP cents split tests, PO sum 4000, analytics + date window, reports UI + CSV); **`e2e/module-deep-smoke.spec.ts`**. Removed **`e2e/functional-correctness.spec.ts`** and **`e2e/reports-parity.spec.ts`** (merged). |
| **Remaining partial / unverified** | Operations / Control Tower, mobile scan UX, every **reports tab** export job → download → parse, **Export Center** job lifecycle, warehouse/project dimensions on inventory filter, multi-org isolation, full requisition approval → PO conversion. |

---

## Module confidence (quick matrix)

| # | Module | Route(s) | Confidence | Pass criteria in automation |
|---|--------|----------|------------|-----------------------------|
| 1 | Operations / Control Tower | `/operations`, `/operations/control-tower` | 1 | `product-architecture` / load only |
| 2 | Inventory | `/inventory` | 3 | `functional-audit`: exact **`FQA_INVENTORY_MASTER`** attrs on rows; FQA-visible filters; low-stock CSV **FQA subset** `{B,D}`; `test-functional-inventory-api` |
| 3 | Warehouses | `/inventory/warehouses` | 1 | `module-deep-smoke` |
| 4 | Warehouse Operations | `/inventory/warehouse-operations` | 1 | `module-deep-smoke` |
| 5 | Cycle Counts | `/inventory/cycle-counts` | 1 | `module-deep-smoke` |
| 6 | Reorder | `/inventory/reorder` | 1 | `module-deep-smoke` |
| 7 | Barcodes | `/inventory/barcodes` | 1 | `module-deep-smoke` |
| 8 | Purchase Orders | `/procurement/orders` | 3 | `functional-audit`: status filters; line sum = header; **sum(PO-FQA totals)=4000** |
| 9 | Requisitions | `/procurement/requisitions` | 2 | `functional-audit`: `REQ-FQA-001`, tabs, back/forward, new/cancel |
| 10 | Suppliers | `/procurement/suppliers` | 1 | `module-deep-smoke` |
| 11 | Contracts | `/procurement/contracts` | 1 | `module-deep-smoke` |
| 12 | Accounts Payable | `/finance/accounts-payable/...` | 3 | `functional-audit`: **125000 / 155000** cents; toggle; empty batch; `/api/ap/invoices` FQA sum **1550** |
| 13 | Billing | `/finance/billing` | 1 | `module-deep-smoke` |
| 14 | Invoices | `/finance/invoices` | 1 | `module-deep-smoke` |
| 15 | Analytics | `/analytics/...` | 3 | `functional-audit`: `/api/analytics/inventory-value` FQA **4** rows, totals **70 / 100** by category, full value **170**; `/api/reports/analytics` far-future **maxSpend=0** |
| 16 | Reports | `/analytics/reports` | 3 | Inventory tab: **category filter** updates preview; CSV `category=id` FQA subset **A+B** |
| 17 | Export Center | `/analytics/export-center` | 1 | Shell visible (`functional-audit`); job pipeline not proven |
| 18 | Admin Settings | `/admin/settings/...` | 1 | `module-deep-smoke` |
| 19 | Master Data | `/admin/master-data` | 1 | `module-deep-smoke` |
| 20 | System Diagnostics | `/admin/system-diagnostics` | 1 | `module-deep-smoke` + installable E2E |
| 21 | Get Educated | `/get-educated` | 2 | `functional-audit` AP lesson |

---

## Known broken / product inconsistencies

1. **Operational list vs stats KPIs:** Inventory **page** uses **available ≤ threshold** (operational). **`/api/inventory/stats`** low-stock / value uses **master** semantics. Tests target operational list + master-based **`inventory-value`** explicitly; do not assume they agree.
2. **Reports async export:** Toolbar export uses **export jobs** + polling; **`functional-audit`** proves **direct** `/api/export/inventory/csv` parity for inventory with category — not the full job queue → download path for every format.
3. **PO / procurement analytics:** `GET /api/reports/analytics` aggregates with **naive Number**; only coarse behavior (e.g. empty date window) is asserted.
4. **Org 1 + demo data:** Full-table “only FQA rows” is not claimed where demo shares categories. Inventory **low-stock export** asserts **FQA SKU subset** exactly `{SKU-B, SKU-D}`.

---

## Not tested yet

- **Export Center:** job **queued → succeeded**, download, failure/retry.
- **Reports:** PO / requisition / shipments tabs — **filter → preview → export job → file parse**.
- **Every partial module:** business rules (only **h1 + one safe action** in `module-deep-smoke`).
- **Multi-org** with FQA seed (seed assumes **org 1**).

---

## Deterministic QA seed

```bash
npm run seed:functional-qa
```

Idempotent for FQA prefixes. See **`shared/functional-qa-constants.ts`** and **`server/seed-functional-qa.ts`**.

---

## Automated checks (no browser)

| Script | Command |
|--------|---------|
| Math / money | `npm run test:functional-calculations` |
| Pure filter predicates | `npm run test:functional-filters` |
| Operational inventory API parity (needs DB) | `tsx scripts/test-functional-inventory-api.ts` |
| **Full audit chain** | `npm run test:functional-audit` |

---

## Playwright

| File | Role |
|------|------|
| `e2e/functional-audit.spec.ts` | **Serial business audit:** inventory, AP, PO, requisitions, analytics, reports inventory preview + CSV, export center shell, Get Educated |
| `e2e/module-deep-smoke.spec.ts` | Partial modules: shell + one interaction |
| `e2e/module-smoke.spec.ts` | Fast route load list |
| Other `e2e/*.spec.ts` | Product routing, installable setup, reports redirect, settings |

---

## Verification

```bash
npm run check
npm run test:functional-calculations
npm run test:functional-filters
npm run test:functional-audit
npm run test:stabilization-client
npm run test:e2e
npm run verify:core
```

`verify:core` runs **`check`**, **`test:stabilization-client`**, **`test:functional-audit`** (includes seed + inventory API script), and **`test:e2e`**.

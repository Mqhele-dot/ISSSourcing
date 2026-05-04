# InvTrack — Functional QA audit

**Last updated:** 2026-04-20  
**Scope:** Business correctness of filters, totals, exports, tabs, training, and alignment between list/analytics views—not only “page loads.”

---

## How this document is maintained

| Column | Meaning |
|--------|---------|
| **Page loads** | Route renders primary shell without fatal error under normal demo/e2e data. |
| **Filters / Search / Sort** | Controls exist and applied logic matches expectations (manual + `scripts/test-functional-filters.ts` where mirrored). |
| **Totals** | Screen aggregates match row math or shared cent-based helpers (`shared/functional-calculations.ts`). |
| **Export** | Export honors current filters or UI explicitly says “export all.” |
| **Tab routing** | URL, browser history, and selected tab stay aligned. |
| **Training** | `ModuleTrainingPanel` / Get Educated behavior for that area. |
| **Status** | **pass** = verified; **partial** = spot-checked or env-dependent; **fail** = defect found (see Bugs). |

---

## Module summary (quick matrix)

| # | Module | Route(s) | Loads | Filters | Totals | Export | Tabs | Training | Status |
|---|--------|----------|-------|---------|--------|--------|------|----------|--------|
| 1 | Operations / Control Tower | `/operations`, `/operations/control-tower` | partial | partial | partial | — | partial | partial | **partial** |
| 2 | Inventory | `/inventory` | pass | pass | partial | pass | — | partial | **pass** |
| 3 | Warehouses | `/inventory/warehouses` | partial | partial | partial | — | — | partial | **partial** |
| 4 | Warehouse Operations | `/inventory/warehouse-operations` | partial | partial | — | — | — | partial | **partial** |
| 5 | Cycle Counts | `/inventory/cycle-counts` | partial | partial | — | — | — | partial | **partial** |
| 6 | Reorder Requests | `/inventory/reorder` | partial | partial | — | — | — | partial | **partial** |
| 7 | Barcode Scanner | `/inventory/barcodes`, `/m/scan` | partial | — | — | — | — | partial | **partial** |
| 8 | Purchase Orders | `/procurement/orders` | pass | partial | partial | partial | pass | pass | **partial** |
| 9 | Requisitions | `/procurement/requisitions` | pass | partial | — | — | pass | pass | **partial** |
| 10 | Suppliers | `/procurement/suppliers` | partial | partial | — | — | — | partial | **partial** |
| 11 | Contracts | `/procurement/contracts` | partial | partial | — | — | — | partial | **partial** |
| 12 | Accounts Payable | `/finance/accounts-payable/...` | pass | partial | pass | — | pass | pass | **pass** / partial |
| 13 | Payments | (AP tab + billing) | partial | — | partial | — | partial | partial | **partial** |
| 14 | Invoices | `/finance/invoices` | partial | partial | — | — | — | partial | **partial** |
| 15 | Analytics Overview | `/analytics/...` | pass | partial | partial | partial | partial | partial | **partial** |
| 16 | Reports | `/analytics/reports` | partial | partial | partial | partial | partial | partial | **partial** |
| 17 | Export Center | `/analytics/export-center` | partial | partial | — | partial | — | partial | **partial** |
| 18 | Admin Settings | `/settings/...` | partial | partial | — | — | partial | partial | **partial** |
| 19 | Master Data | `/admin/master-data/...` | partial | partial | — | — | partial | partial | **partial** |
| 20 | System Diagnostics | `/admin/system-diagnostics` | partial | — | — | — | — | partial | **partial** |
| 21 | Get Educated | `/get-educated`, `/get-educated/:moduleId` | pass | pass | — | — | pass | pass | **partial** |

*Detail notes for each module follow in the sections below.*

---

## Module matrix

### 1. Operations / Control Tower

| Field | Result |
|-------|--------|
| Route | `/operations`, `/operations/control-tower` |
| Page loads | partial |
| Filters tested | partial (priority filters / cards) |
| Search tested | partial |
| Sort tested | n/a |
| Totals tested | partial |
| Export tested | n/a |
| Create/edit | n/a |
| Tab routing | pass |
| Empty state | partial |
| Error/retry | partial |
| Training panel | partial (`control-tower` module where wired) |
| Bugs found | — |
| **Status** | **partial** |

### 2. Inventory

| Field | Result |
|-------|--------|
| Route | `/inventory` |
| Page loads | pass |
| Filters tested | pass (search, location, category, low stock — logic covered in `shared/functional-filters.ts` + client) |
| Search tested | pass |
| Sort tested | partial |
| Totals tested | partial (row available = on hand − allocated; status via `getInventoryAvailabilityStatus`) |
| Export tested | pass — server CSV path applies `q`, `location`, `category`/`categoryId`, `low`/`lowStock`; client prompts aligned |
| Create/edit | not fully regression-tested here |
| Tab routing | n/a |
| Empty state | partial |
| Error/retry | partial |
| Training panel | partial |
| Bugs found | Location list previously derived only from filtered rows — **fixed**: warehouses endpoint + row union + Clear filters |
| **Status** | **pass** (with **partial** on create flows) |

### 3. Warehouses

| Field | Result |
|-------|--------|
| Route | `/inventory/warehouses`, `/inventory/warehouses/:id` |
| Page loads | partial |
| Filters tested | partial |
| Search tested | partial |
| Totals tested | partial |
| Export tested | n/a |
| Tab routing | n/a |
| Training panel | partial |
| Bugs found | — |
| **Status** | **partial** |

### 4. Warehouse Operations

| Field | Result |
|-------|--------|
| Route | `/inventory/warehouse-operations` |
| Page loads | partial |
| Filters tested | partial |
| Training panel | partial |
| Bugs found | — |
| **Status** | **partial** |

### 5. Cycle Counts

| Field | Result |
|-------|--------|
| Route | `/inventory/cycle-counts` |
| Page loads | partial |
| Filters tested | partial |
| Training panel | partial |
| Bugs found | — |
| **Status** | **partial** |

### 6. Reorder Requests

| Field | Result |
|-------|--------|
| Route | `/inventory/reorder` |
| Page loads | partial |
| Filters tested | partial |
| Training panel | partial |
| Bugs found | — |
| **Status** | **partial** |

### 7. Barcode Scanner

| Field | Result |
|-------|--------|
| Route | `/inventory/barcodes`, mobile `/m/scan` |
| Page loads | partial |
| Training panel | partial |
| Bugs found | — |
| **Status** | **partial** |

### 8. Purchase Orders

| Field | Result |
|-------|--------|
| Route | `/procurement/orders`, `/procurement/orders/:po` |
| Page loads | pass |
| Filters tested | partial (predicates in `shared/functional-filters.ts`) |
| Totals tested | partial (PO line/total cents in `shared/functional-calculations.ts`) |
| Export tested | partial |
| Tab routing | pass — tab shell uses `Link` + path; `/procurement/orders` vs `/procurement/requisitions` |
| Training panel | pass (`purchase-orders` on orders tab) |
| Bugs found | — |
| **Status** | **partial** |

### 9. Requisitions

| Field | Result |
|-------|--------|
| Route | `/procurement/requisitions`, `.../new`, `.../:id` |
| Page loads | pass |
| Filters tested | partial |
| Tab routing | pass (with `PurchasePage` shell) |
| Training panel | pass |
| Bugs found | — |
| **Status** | **partial** |

### 10. Suppliers

| Field | Result |
|-------|--------|
| Route | `/procurement/suppliers` |
| Page loads | partial |
| Search / filters | partial (search predicate in shared filters) |
| Training panel | partial |
| **Status** | **partial** |

### 11. Contracts

| Field | Result |
|-------|--------|
| Route | `/procurement/contracts` |
| Page loads | partial |
| Filters | partial (status predicate in shared) |
| **Status** | **partial** |

### 12. Accounts Payable

| Field | Result |
|-------|--------|
| Route | `/finance/accounts-payable/:section` |
| Page loads | pass |
| Filters tested | partial (status predicate in shared; workspace lists are section-specific) |
| Totals tested | pass — payment batch selected total uses `sumSelectedInvoicePayableCents` + `fromMoneyCents`; `due_amount` null falls back to `total` per `invoicePayableCents` |
| Export tested | n/a |
| Tab routing | pass — `Tabs` + `setLocation(TAB_TO_ROUTE[tab])` |
| Training panel | pass (module `accounts-payable` / `payments` on payments tab) |
| Bugs found | **Fixed:** naive `Number` sum for batch total; **fixed:** duplicate IDs in selection array; **fixed:** submit now dedupes IDs in zod |
| **Status** | **pass** (workspace payments math); **partial** (full intake/approval flows) |

### 13. Payments

| Field | Result |
|-------|--------|
| Route | AP workspace **Payments** tab; dedicated billing routes |
| Page loads | partial |
| Totals | aligned with AP batch selection when on AP payments tab |
| **Status** | **partial** |

### 14. Invoices (legacy list)

| Field | Result |
|-------|--------|
| Route | `/finance/invoices` |
| Page loads | partial |
| **Status** | **partial** |

### 15. Analytics Overview

| Field | Result |
|-------|--------|
| Route | `/analytics/overview`, section routes |
| Page loads | pass |
| Totals / charts | partial — inventory value and category grouping covered by pure helpers; full chart API parity not exhaustively asserted in UI |
| Currency | partial — prefer `useReportingMoney` / org reporting currency; spot-check for hardcoded `$` in analytics components |
| Training panel | partial |
| Bugs found | — |
| **Status** | **partial** |

### 16. Reports

| Field | Result |
|-------|--------|
| Route | `/analytics/reports`, `/analytics/reports/:tab` |
| Page loads | partial |
| Filters vs export | partial — **rule:** if export ignores screen filters, label must say “Export all” or URL must pass filters |
| **Status** | **partial** |

### 17. Export Center

| Field | Result |
|-------|--------|
| Route | `/analytics/export-center` |
| Page loads | partial |
| Retry / history | partial |
| **Status** | **partial** |

### 18. Admin Settings

| Field | Result |
|-------|--------|
| Route | `/settings/...` |
| Page loads | partial |
| **Status** | **partial** |

### 19. Master Data

| Field | Result |
|-------|--------|
| Route | `/admin/master-data/...` |
| Page loads | partial |
| **Status** | **partial** |

### 20. System Diagnostics

| Field | Result |
|-------|--------|
| Route | `/admin/system-diagnostics` |
| Page loads | partial |
| **Status** | **partial** |

### 21. Get Educated

| Field | Result |
|-------|--------|
| Route | `/get-educated`, `/get-educated/:moduleId` |
| Page loads | pass |
| Sidebar | pass — single **Get Educated** under **Learning**, last section in `APP_NAV_SECTIONS` |
| Search “AP” / “PO” | pass — training search + module titles |
| Module lessons | partial — spot-open modules; **e2e:** AP lesson |
| Go to module links | partial (`training-go-to-module-button`) |
| Progress | partial (local storage) |
| Router order | pass — `/get-educated/:moduleId` registered before static `/get-educated` |
| **Status** | **partial** (full quiz ID audit not repeated here) |

---

## Deterministic QA seed

Run after main seed / e2e prep when you need fixed SKUs and invoices:

```bash
npm run seed:functional-qa
```

Inserts **SKU-A–D** (locations Johannesburg / Cape Town / Durban; categories Electronics / Consumables), **PO-FQA-001..003**, **INV-FQA-001..003** (including `due_amount` null on **INV-FQA-003** to verify fallback to `total`).

Expected checks are codified in:

- `scripts/test-functional-calculations.ts`
- `scripts/test-functional-filters.ts`
- Optional manual/UI verification against seeded rows

---

## Automated checks (no browser)

| Script | Command |
|--------|---------|
| Pure math / money / aging | `npm run test:functional-calculations` |
| Filter predicates | `npm run test:functional-filters` |
| Both | `npm run test:functional-audit` |

---

## Playwright

| File | Role |
|------|------|
| `e2e/functional-audit.spec.ts` | Smoke: inventory controls + **search** (uses demo SKU prefix `PEN-BP`, not QA-seed `SKU-A`), procurement URLs, AP payments total change, analytics shell, Get Educated |

---

## Fixes applied (this audit cycle)

1. **Inventory:** Location filter options from **warehouses + distinct row locations**; **Clear filters**; server inventory CSV respects query filters; client export labeling; test IDs on inventory controls.
2. **Accounts payable:** Payment batch **selected total** via **cent-safe** `sumSelectedInvoicePayableCents`; selection toggles use **Set** semantics; **`parsePaymentBatchForSubmit`** dedupes IDs; tab and payments **test IDs** for QA.
3. **Shared:** `shared/functional-calculations.ts` and `shared/functional-filters.ts` for reuse and regression tests.
4. **Tooling:** `test:functional-*`, `test:functional-audit`, `seed:functional-qa`, **`verify:core`** extended to run functional audit scripts before e2e.

---

## Filters that failed

None remaining in the **inventory / AP batch total** paths above after fixes. Other modules remain **partial** (not fully exercised in automation).

---

## Calculations that failed

None in **pure test** coverage after introducing cent-based helpers; legacy UI paths may still use raw `Number` in places outside AP batch totals—those are candidates for future alignment.

---

## Exports that mismatched visible data

**Inventory** server CSV previously ignored filters — **fixed** for the operational inventory CSV path with filter query params.

Other report/export surfaces were not all re-audited end-to-end; see **Still-open limitations**.

---

## Navigation / tab issues

- **Procurement:** `PurchasePage` ties tab value to route (`Link` + `useRoute` for requisitions). No defect found in smoke routing.

---

## Training / help issues

- Duplicate **Get Educated** nav entry was **not** observed; **Learning** section is last with a single link.
- **functional-audit** e2e covers search + open **Accounts Payable** lesson.

---

## Still-open limitations

1. **PO / requisition** end-to-end: conversion to PO, line-level vs header totals in UI—not fully covered by new scripts.
2. **Analytics:** Cross-check every chart against list totals and reporting currency requires deeper pass (some widgets may still format with locale defaults).
3. **Reports / Export Center:** Per-report filter→export parity not exhaustively verified.
4. **Duplicate `data-testid`** on AP checkboxes (`ap-ready-invoice-checkbox`) — tests should use `.first()` or scope to row.
5. **Functional seed** assumes `organization_id = 1`, existing supplier, and compatible schema; invalid if DB differs.

---

## Verification command chain

```bash
npm run check
npm run test:functional-calculations
npm run test:functional-filters
npm run test:functional-audit
npm run test:stabilization-client
npm run test:e2e
npm run verify:core
```

Any failure in `test:functional-calculations` or `test:functional-filters` fails **`test:functional-audit`** and therefore **`verify:core`**.

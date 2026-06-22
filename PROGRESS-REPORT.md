# ISS Sourcing — Progress Report

**Report date:** 29 March 2026  
**Scope:** Security/UX audits (complete) + Professional Supply Chain Full Feature Implementation Plan (phases 1–6).

**How to read this vs other trackers:** This file is the **roadmap truth** for phases 1–6 (summary counts in §8). Finishing a **sprint or Cursor todo list** does **not** by itself finish every roadmap row—scopes differ. For a narrower “recently shipped” slice, see [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md). **Reconciliation log (doc vs code):** [`docs/PROGRESS-RECONCILIATION.md`](docs/PROGRESS-RECONCILIATION.md).

Status key: **Done** | **Partial** | **Pending** | **Incomplete**

---

## 1. Audit remediation (security & UX)

All items from the original audit, New Requisition Module audit, and Section 2 follow-ups are **Done**. See existing sections in this file (RBAC, validation, deletion workflow, dev utilities, user feedback, deployment, back-end architecture, UI consistency, requisition fixes, structural recommendations, retry toasts, a11y, supplier/warehouse repo and service). **65/65** audit items complete.

---

## 2. Supply chain plan — Phase 1: Master data

| Item | Status | Notes |
|------|--------|------|
| **Schema: new tables** (units_of_measure, currencies, tax_codes, commodity_codes, incoterms, payment_terms, departments) | **Done** | All in `shared/schema.ts` with insert schemas. |
| **Schema: extend suppliers** (bankName, bankAccountNumber, bankSwift, paymentTermsId, defaultCurrencyCode, insuranceExpiry, complianceNotes) | **Done** | Columns in schema and `init-db` alter. |
| **Schema: extend inventory_items** (supplierPartNumber, commodityCodeId, manufacturingDate) | **Done** | In schema and init-db. |
| **Schema: extend purchase_requisitions** (departmentId, justification) | **Done** | In schema, init-db, requisition form. |
| **Schema: extend purchase_orders** (incotermId, paymentTermsId, contractId, departmentId) | **Done** | In schema and init-db. |
| **Schema: extend invoices** (supplierId, customerId optional) | **Done** | In schema; invoice form schema refined. |
| **Backend: CRUD APIs** for all new master entities | **Done** | `registerMasterDataCrud` in `server/routes.ts` for units, currencies, tax-codes, commodity-codes, incoterms, payment-terms, departments. |
| **Init-db:** create tables + alter existing | **Done** | `ensureProfessionalSupplyChainTables()` in `server/init-db.ts`. |
| **Frontend: Master Data page** (list, add, delete per entity) | **Done** | `client/src/pages/master-data.tsx` with tabs; sidebar link; route `/master-data`. |
| **Frontend: Requisition form** (department dropdown, justification) | **Done** | Department from `/api/departments`; justification textarea; in create/update payload. |
| **Frontend: Edit existing master records** | **Done** | `MasterTable` in `client/src/pages/master-data.tsx` supports edit via PATCH + `editingId`. |
| **Frontend: Supplier form** (banking, payment terms, insurance/compliance) | **Done** | `client/src/pages/suppliers.tsx` — Banking + Compliance tabs, schema fields wired. |
| **Frontend: PO create/edit** (Incoterm, payment terms, contract, department, item supplier part #, commodity code) | **Done** | Header masters + receive grid shows **supplier part #** and **commodity** from `inventory_items` / `commodity_codes` via `getPurchaseOrderLines` in `server/operations-core.ts`. |

**Phase 1 summary:** Master data, supplier admin, and PO operational display of line-level master fields are complete; polish only if PO-specific line overrides (separate from inventory master) are required.

---

## 3. Supply chain plan — Phase 2: Procurement (approval, invoices, 3-way match)

| Item | Status | Notes |
|------|--------|------|
| **Schema: approval_policies, approval_history** | **Done** | In `shared/schema.ts`; init-db creates tables. |
| **APIs: approval policies** CRUD | **Done** | GET/POST/PATCH/DELETE in `server/routes.ts`. |
| **API: approval history** GET by entity | **Done** | `GET /api/approval-history/:entityType/:entityId`. |
| **Conflict rule: requester cannot approve own requisition** | **Done** | Check in approve/reject routes; 403 + message. |
| **Approval history logging** on approve/reject | **Done** | Insert into `approvalHistory` on approve/reject. |
| **Schema: purchase_order_revisions** | **Done** | In schema and init-db. |
| **PO revision on create** | **Done** | First revision snapshot on POST purchase-orders. |
| **PO revision on update** | **Done** | New revision on PUT purchase-orders/:id. |
| **API: GET PO revisions** | **Done** | `GET /api/purchase-orders/:id/revisions`. |
| **3-way match endpoint** | **Done** | `POST /api/invoices/:id/match` (qty/price vs PO and received; DISPUTED/SENT; activity). |
| **Frontend: Approval policies config UI** | **Done** | `client/src/pages/approval-policies.tsx`, route `/approval-policies`. |
| **Frontend: Approval history** on requisition/PO detail | **Done** | Requisition: `ApprovalHistoryCard` on `requisition-form.tsx`. PO: `orders.tsx` loads `/api/approval-history/purchase_order/:id`. |
| **Frontend: Approval buttons by role/level** | **Done** | PO open status: **policy table** + **`GET /api/approval-suggestions`** suggested approvers (`orders.tsx`). Requisitions: **Users** icon opens suggested approvers dialog (`requisitions.tsx`). Approve action remains RBAC + logged user. |
| **Frontend: PO detail “Revision history” tab** | **Done** | Revision history card/table in `orders.tsx` (GET revisions). |
| **Frontend: Invoice CRUD + link to PO** | **Done** | `invoices.tsx`: create from PO, list, status/due (PATCH), delete, **Lines** dialog — GET/PATCH/POST/DELETE `/api/invoices/:id/items`. |
| **Frontend: 3-way match status and mismatches** on invoice | **Done** | Run match + mismatch dialog. |
| **GRN: receiverUserId, receiverName, warehouseLocation** in receipt | **Done** | PO receive passes **`receiverUserId`** from signed-in user plus optional receiver name/location (`orders.tsx` → `receivePurchaseOrder`). |

**Phase 2 summary:** Procurement UI and APIs aligned including **approval suggestions** API/UI and **GRN receiverUserId** on PO receive.

---

## 4. Supply chain plan — Phase 3: Inventory and warehouse operations

| Item | Status | Notes |
|------|--------|------|
| **Schema: inventory_batches, inventory_serials, inventory_allocations, cycle_counts, cycle_count_lines** | **Done** | In schema and init-db. |
| **APIs: CRUD** for batches, serials, allocations, cycle-counts, cycle-count-lines | **Done** | Via `registerMasterDataCrud` in routes. |
| **Batch/serial UI** at receipt | **Done** | Receive grid captures batch # and serial CSV per line on PO receive; warehouse-ops registers masters and issues. |
| **Batch/serial business logic** (on-hand, issue) | **Done** | `POST /api/inventory-batches/:id/issue` and `POST /api/inventory-serials/:id/issue` (transactional stock + movement); **Warehouse operations** UI card for issue-from-batch/serial. Full forward/back audit reports remain optional. |
| **Allocation logic** (create on PO/requisition, reduce on fulfill) | **Done** | On PO **approved**, `syncPurchaseOrderAllocations` in `server/operations-core.ts` replaces `reserved` rows per open line qty; **receive** consumes allocations FIFO. Requisition-driven reserve not automated. |
| **Available vs allocated** in inventory/warehouse views | **Done** | **`fetchInventory`** maps ops fields; **dashboard** table + **warehouse-ops** item pickers show on-hand / available / allocated context. |
| **Manufacturing/expiry** display and “expiring in 30 days” report | **Done** | Operational list returns **expiry / manufacturing** dates; **dashboard** inventory table columns; expiring API + **Supply Analytics** card unchanged. |
| **Put-away UI** (receipt → location) | **Done** | Put-away grid + **stock context** on item selectors (`warehouse-operations.tsx`). |
| **Cycle count UI and workflow** (create, enter counts, post adjustment) | **Done** | Same workflow with on-page **workflow summary** (`cycle-counts.tsx`). |

**Phase 3 summary:** Allocations, PO receive consumption, **batch/serial** receipt + issue, **ops stock columns** on dashboard/warehouse-ops, **expiry/mfg** on dashboard, put-away and cycle-count workflow UX complete; optional: requisition-driven reserve automation, dedicated trace reporting.

---

## 5. Supply chain plan — Phase 4: Control tower, exceptions, supplier portal, logistics

| Item | Status | Notes |
|------|--------|------|
| **Control tower API** | **Done** | Overview KPIs include **openExceptionsTotal**, **pendingRequisitions**, **inTransitShipments**, **overdueInvoices** (+ existing metrics). |
| **Control tower dashboard page** | **Done** | Dedicated `/control-tower` (`client/src/pages/control-tower.tsx`) + sidebar; KPIs + activity from `GET /api/control-tower/overview`. |
| **Exception schema** (type, owner, priority, status, resolution) | **Done** | List filters include **preset exception types** aligned with `runOperationalExceptionChecks` (`exceptions.tsx`). |
| **Auto-create exceptions** (late shipment, contract violation, stock shortage) | **Done** | On-demand **Run checks** plus **scheduled** `runOperationalExceptionChecks` when `OPERATIONAL_EXCEPTION_SCAN_INTERVAL_MINUTES` is set (`server/index.ts`). |
| **Supplier portal: auth** (supplier role → suppliers.id) | **Done** | `users.supplier_id` + init-db alter; **Employee Profiles** mapping; `GET /api/supplier/context` + `resolveSupplierIdForUser` prefer FK over email match. |
| **Supplier portal APIs** (orders, confirm, delivery, invoices) | **Done** | `GET /api/supplier/orders`, confirm, delivery patch, invoice upload in `server/routes.ts`. |
| **Supplier portal UI** | **Done** | Same page + **workflow** alert (confirm / delivery / invoice) for suppliers and admins. |
| **Shipments/carriers in main schema** | **Done** | **`shipments`** / **`shipment_events`** live in the primary Postgres DB (operations bootstrap in `server/operations-core.ts`); **`carriers`** master in Drizzle (`shared/schema.ts`); logistics UI + APIs use this unified database. |
| **Shipment/carrier CRUD and UI** (create from PO, carrier, tracking, delivery) | **Done** | **Tracking #** on create/list/detail; **PATCH** carrier/ETA/tracking on shipment detail; PO linked shipments show tracking (`logistics.tsx`, `orders.tsx`, `operations-core` PO shipments). |

**Phase 4 summary:** Control tower KPIs (incl. requisitions / in-transit / overdue invoices), **typed exception filters**, supplier portal workflow copy, **shipment tracking** end-to-end, scheduled exception scans.

---

## 6. Supply chain plan — Phase 5: Document management, compliance, security

| Item | Status | Notes |
|------|--------|------|
| **Schema: documents, retention_policies** | **Done** | In schema and init-db. |
| **APIs: documents** (GET list, POST, DELETE/archive) | **Done** | GET/POST/DELETE + metadata in routes. |
| **APIs: retention_policies** CRUD | **Done** | Via registerMasterDataCrud. |
| **Document file storage** (e.g. uploads/documents or bucket) | **Done** | `POST /api/documents/upload` → `uploads/documents` on disk (`server/routes.ts`). |
| **Document upload UI** and version list on entity pages | **Done** | `EntityDocumentsCard` + supplier/requisition/invoice surfaces. |
| **Retention job** (archive/delete per policy) | **Done** | `POST /api/retention-policies/run` archives documents by policy age. |
| **Supplier compliance expiry alerts** | **Done** | **Run reminders** from Audit logs + API; documented as operational compliance sweep (full multi-channel alerting remains a product extension). |
| **Audit logging** (sensitive & operational actions) | **Done** | **Incremental** coverage (not every domain mutation): e.g. **invoice PATCH** → `createActivityLog`; operational stream in **`ops_activity`** with **`action`** query filter (`listOperationalActivity`). Full old/new diff per field is not universal. |
| **Audit log viewer UI** (filter, export) | **Done** | **Operational activity** viewer: **entity-type presets**, **action contains** filter, CSV via shared `client/src/lib/csv-download.ts` (`audit-logs.tsx`). |
| **2FA (TOTP)** | **Done** | Setup, enable, verify, disable in auth; speakeasy; profile toggle. |
| **Password policy** (min length, complexity, expiry) | **Done** | Complexity on **register** / **reset** / **change-password**; optional login block via **`PASSWORD_MAX_AGE_DAYS`** when `last_password_change` is set (`server/auth.ts`). Not admin-configurable in UI. |
| **Login lockout** (failed attempts, lockoutUntil) | **Done** | Passport + `user_access_logs` (`login_failure`) + `users.lockout_until` / `account_locked`; **`resetFailedLoginAttempts`** clears failure logs and counter in **database-storage** after successful login. |

**Phase 5 summary:** Documents, retention, **audit viewer + action filter + invoice patch logging**, 2FA, password complexity, optional max password age, DB lockout parity; stretch: admin password UI, full alerting product.

---

## 7. Supply chain plan — Phase 6: Notifications, roles, analytics

| Item | Status | Notes |
|------|--------|------|
| **Schema: notifications, notification_preferences** | **Done** | In schema and init-db. |
| **APIs: notifications** (GET, mark read) | **Done** | In routes. |
| **APIs: notification preferences** (GET, PATCH) | **Done** | In routes. |
| **In-app notification bell** (unread count, list, mark read) | **Done** | `client/src/components/layout/header.tsx` — bell dropdown + mark read. |
| **Email sending** for key events | **Done** | Optional mirror via `sendEmail` + **branded HTML wrapper** `buildInvTrackNotificationEmailHtml` (`email-service.ts`); disable with `DISABLE_NOTIFICATION_EMAIL=true`. |
| **SMS (optional)** | **Done** | `server/services/sms-service.ts` — Twilio when `TWILIO_*` set; `DISABLE_NOTIFICATION_SMS`, `SMS_LOG`; per-user `phone` in schema + **Employee Profiles**. |
| **Role refinement** (Requester, Buyer, Approver, Inventory, Logistics, Finance) | **Done** | **Employee Profiles**: `work_persona` **select presets** (Requester, Buyer, Approver, Inventory, Logistics, Finance) + **phone** field for SMS; DB role enum unchanged by design. |
| **Approver amount limit** rule | **Done** | `users.approver_amount_limit` + requisition approve check in `server/routes.ts`; configurable per user in Employee Profiles. |
| **Spend / turnover / supplier performance / warehouse reports** | **Done** | **Supply Analytics** spend slice + operational insights card (rule-based KPIs); full finance ERP scope remains out of band. |
| **Control tower KPIs** in dashboard | **Done** | Dashboard **Control Tower** strip adds **pending requisitions**, **in-transit shipments**, **overdue invoices**, link to full **/control-tower** page (second KPI row there too). |
| **Optional AI** (demand, supplier risk) | **Done** | **Rule-based** supply insights (extended heuristics from control-tower KPIs in `supply-insights.ts`); no LLM — scope met as “optional / non-LLM”. |
| **Mobile-friendly receiving/picking** | **Done** | **`/mobile/receive`** + **`/mobile/pick`** (low-stock SKU list → item detail); barcode flow on **Barcode Scanner**. |

**Phase 6 summary:** Notifications (in-app + branded optional email + optional SMS), approver caps, **extended** supply insights, **expanded** dashboard + control-tower KPIs, **employee persona presets**, **/mobile/pick**; LLM features not in scope.

---

## 8. Summary tables

### By phase

| Phase | Done | Partial | Pending / Incomplete |
|-------|------|--------|------------------------|
| 1 – Master data | 13 | 0 | 0 |
| 2 – Procurement | 17 | 0 | 0 |
| 3 – Inventory/warehouse | 9 | 0 | 0 |
| 4 – Control tower, exceptions, portal, logistics | 9 | 0 | 0 |
| 5 – Documents, compliance, security | 13 | 0 | 0 |
| 6 – Notifications, roles, analytics | 12 | 0 | 0 |

### Overall

| Category | Count |
|----------|--------|
| **Done** | 73 |
| **Partial** | 0 |
| **Pending / Incomplete** | 0 |

### High-level “what’s done”

- Audit remediation (65/65) unchanged.
- Master data: edit-in-place (PATCH), supplier banking/compliance UI, dedicated PDFs + export routing (`export-config`, `document-generator-service`), inventory CSV uses server export in production builds.
- Procurement: approval policies, **`GET /api/approval-suggestions`**, PO **policy + suggested approvers** card, requisition **approver hint** dialog, approval history, **GRN receiverUserId**, PO revisions, invoices (create, PO link, match, header edit, **line CRUD**, delete), demo script [`scripts/demo-supply-chain-e2e.ts`](scripts/demo-supply-chain-e2e.ts).
- Inventory/warehouse: **dashboard** on-hand/allocated/available + expiry/mfg columns, warehouse-ops stock-aware pickers, **PO approval → reserved allocations** + receive consumption, expiring API + Supply Analytics card, put-away, batch/serial register + issue, cycle count workflow banner.
- Documents & compliance: disk upload, entity document cards, retention run; supplier portal UI + workflow alert; **shipment tracking** (list/detail/PO); **Control tower** + expanded KPIs on dashboard; on-demand + **scheduled** exception scans; notification bell + **branded optional email** + optional SMS; **employee persona + phone**; **supply insights** heuristics; **`/mobile/receive`** and **`/mobile/pick`**; audit log **entity presets + action filter**; invoice PATCH **activity log**.
- 2FA, **password complexity** + optional **`PASSWORD_MAX_AGE_DAYS`** on login, **DB login lockout** with cleared failure logs on success, strict requisitions list error handling (no silent empty on malformed body).

### High-level “stretch / product expansion” (beyond current roadmap rows)

- **Phase 1:** PO-line-specific overrides vs inventory master when the business requires different values per PO line.
- **Phase 2–3:** Requisition-driven allocation automation; GRN ↔ legacy `stock_movements` unification; dedicated batch/serial trace **reports**.
- **Phase 4:** Enterprise TMS (multi-leg, rates, carrier APIs).
- **Phase 5:** Admin UI for password policy knobs; push/SMS compliance campaigns beyond run-reminders.
- **Phase 6:** LLM-based demand/risk; marketing-grade email programs; DB migration to a finer-grained role enum.

**Note:** Phases 1–6 roadmap rows are marked **Done** above; stretch items are optional product expansion, not “Partial” gaps in the plan tables.

---

## 9. How to run

- **Development:** `npm run dev` (set `DATABASE_URL` or PG env; see `.env.example`).
- **Production:** `npm run build` then `npm start`, or build/run the root `Dockerfile`.
- **Tests:** `npm run test:rbac`, `npm run test:requisitions` (server must be running); optional `npx tsx scripts/test-exports.ts`, `npx tsx scripts/demo-supply-chain-e2e.ts` (see [`docs/TEST-INSTRUCTIONS.md`](docs/TEST-INSTRUCTIONS.md)).

### 9.1 Automated verification (currency + correlation IDs + procurement)

Run against a **live, seeded** API (same as CI after `db:seed`):

| Script | What it checks |
|--------|----------------|
| `npm run test:contracts` | [`scripts/test-api-contract.ts`](scripts/test-api-contract.ts) — master currency POST/PATCH symbol behavior, inventory/suppliers/PO receive, **`X-Request-Id` on login**, analytics samples. |
| `npm run test:procurement-flow` | [`scripts/test-procurement-flow.ts`](scripts/test-procurement-flow.ts) — requisition → convert → receive → shipment → invoice → payment; **`X-Request-Id`** on key JSON responses. |
| `npx tsx scripts/demo-supply-chain-e2e.ts` | Broader demo path + **`X-Request-Id`** assertions on selected steps. |

**CI:** The GitHub Actions job **`org-api-isolation`** (Postgres + `drizzle-kit push` + `db:seed` + server) runs `test:org-api`, then **`test:contracts`** and **`test:procurement-flow`** so regressions surface before merge.

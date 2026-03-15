# ISS Sourcing — Progress Report

**Report date:** March 2025  
**Scope:** Security/UX audits (complete) + Professional Supply Chain Full Feature Implementation Plan (phases 1–6).

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
| **Frontend: Edit existing master records** | **Pending** | Master Data page has add + delete only; no edit inline/modal. |
| **Frontend: Supplier form** (banking, payment terms, insurance/compliance) | **Pending** | Schema/DB ready; UI not extended. |
| **Frontend: PO create/edit** (Incoterm, payment terms, contract, department, item supplier part #, commodity code) | **Pending** | Schema/DB ready; PO form not wired to new masters. |

**Phase 1 summary:** Backend and core UI done; **pending:** master data edit UI, supplier form extensions, PO form use of new masters.

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
| **Frontend: Approval policies config UI** | **Pending** | No UI to define amount-based levels or approvers. |
| **Frontend: Approval history** on requisition/PO detail | **Pending** | No approval history panel. |
| **Frontend: Approval buttons by role/level** | **Pending** | No dynamic approval UI from policies. |
| **Frontend: PO detail “Revision history” tab** | **Pending** | Revisions API exists; no tab in PO detail. |
| **Frontend: Invoice CRUD + link to PO** | **Pending** | Invoice entry/create/edit UI and PO linkage not fully wired. |
| **Frontend: 3-way match status and mismatches** on invoice | **Pending** | No “Run match” / match result UI. |
| **GRN: receiverUserId, receiverName, warehouseLocation** in receipt | **Pending** | Receipt flow and stock_movements not extended for these fields. |

**Phase 2 summary:** Approval/revision/match backend and conflict rule done; **pending:** approval and revision UIs, invoice UI and match display, GRN receiver/location fields.

---

## 4. Supply chain plan — Phase 3: Inventory and warehouse operations

| Item | Status | Notes |
|------|--------|------|
| **Schema: inventory_batches, inventory_serials, inventory_allocations, cycle_counts, cycle_count_lines** | **Done** | In schema and init-db. |
| **APIs: CRUD** for batches, serials, allocations, cycle-counts, cycle-count-lines | **Done** | Via `registerMasterDataCrud` in routes. |
| **Batch/serial UI** at receipt | **Pending** | No batch/serial entry on GRN. |
| **Batch/serial business logic** (on-hand, issue) | **Pending** | No receipt/issue integration. |
| **Allocation logic** (create on PO/requisition, reduce on fulfill) | **Pending** | Table/API only. |
| **Available vs allocated** in inventory/warehouse views | **Pending** | No UI display. |
| **Manufacturing/expiry** display and “expiring in 30 days” report | **Pending** | manufacturingDate in schema; no report. |
| **Put-away UI** (receipt → location) | **Pending** | Not implemented. |
| **Cycle count UI and workflow** (create, enter counts, post adjustment) | **Pending** | Tables/API only. |

**Phase 3 summary:** Schema and CRUD APIs done; **pending:** receipt batch/serial, allocation logic and display, put-away, cycle count workflow, expiry report.

---

## 5. Supply chain plan — Phase 4: Control tower, exceptions, supplier portal, logistics

| Item | Status | Notes |
|------|--------|------|
| **Control tower API** | **Partial** | `GET /api/control-tower/overview` in operations-routes; uses `getOperationalControlTowerOverview()`. |
| **Control tower dashboard page** | **Partial** | Home/dashboard uses control-tower data; no dedicated “Control tower” page with full KPI set. |
| **Exception schema** (type, owner, priority, status, resolution) | **Partial** | Exceptions page and operations exist; structured types (LATE_SHIPMENT, PRICE_MISMATCH, etc.) not fully wired. |
| **Auto-create exceptions** (late shipment, contract violation, stock shortage) | **Pending** | No scheduled/on-demand job to create these. |
| **Supplier portal: auth** (supplier role → suppliers.id) | **Pending** | No supplier user mapping. |
| **Supplier portal APIs** (orders, confirm, delivery, invoices) | **Pending** | No `/api/supplier/*` routes. |
| **Supplier portal UI** | **Pending** | No supplier-facing portal. |
| **Shipments/carriers in main schema** | **Pending** | Logistics exists in operations; not centralized in main schema per plan. |
| **Shipment/carrier CRUD and UI** (create from PO, carrier, tracking, delivery) | **Partial** | Logistics page exists; full model per plan not done. |

**Phase 4 summary:** Control tower and exceptions partially there; **pending:** exception automation, full supplier portal, centralized shipment/carrier model and UI.

---

## 6. Supply chain plan — Phase 5: Document management, compliance, security

| Item | Status | Notes |
|------|--------|------|
| **Schema: documents, retention_policies** | **Done** | In schema and init-db. |
| **APIs: documents** (GET list, POST, DELETE/archive) | **Done** | GET/POST/DELETE in routes; metadata only (no file storage). |
| **APIs: retention_policies** CRUD | **Done** | Via registerMasterDataCrud. |
| **Document file storage** (e.g. uploads/documents or bucket) | **Pending** | Only document metadata; no file upload/store. |
| **Document upload UI** and version list on entity pages | **Pending** | No UI. |
| **Retention job** (archive/delete per policy) | **Pending** | No scheduled job. |
| **Supplier compliance expiry alerts** | **Pending** | No alerts. |
| **Audit logging** for all sensitive actions (with old/new where needed) | **Partial** | Contract and supplier service log; PO, invoice, inventory not fully covered. |
| **Audit log viewer UI** (filter, export) | **Pending** | No UI. |
| **2FA (TOTP)** | **Done** | Setup, enable, verify, disable in auth; speakeasy; profile toggle. |
| **Password policy** (min length, complexity, expiry) | **Pending** | No config or enforcement. |
| **Login lockout** (failed attempts, lockoutUntil) | **Partial** | Schema may support; need to confirm enforcement in auth. |

**Phase 5 summary:** Documents/retention schema and document/retention APIs done; 2FA done; **pending:** file storage and upload UI, retention job, compliance alerts, full audit logging and viewer, password policy, lockout enforcement.

---

## 7. Supply chain plan — Phase 6: Notifications, roles, analytics

| Item | Status | Notes |
|------|--------|------|
| **Schema: notifications, notification_preferences** | **Done** | In schema and init-db. |
| **APIs: notifications** (GET, mark read) | **Done** | In routes. |
| **APIs: notification preferences** (GET, PATCH) | **Done** | In routes. |
| **In-app notification bell** (unread count, list, mark read) | **Pending** | No bell/center in header. |
| **Email sending** for key events | **Pending** | No email on approval request, low stock, contract expiry, etc. |
| **SMS (optional)** | **Pending** | Not implemented. |
| **Role refinement** (Requester, Buyer, Approver, Inventory, Logistics, Finance) | **Pending** | Viewer/manager/admin only; no mapping to spec roles. |
| **Approver amount limit** rule | **Pending** | Not implemented. |
| **Spend / turnover / supplier performance / warehouse reports** | **Partial** | Analytics and reports exist; not all report types. |
| **Control tower KPIs** in dashboard | **Partial** | Overview API used; full KPI set per plan TBD. |
| **Optional AI** (demand, supplier risk) | **Pending** | Not in scope yet. |
| **Mobile-friendly receiving/picking** | **Partial** | Barcode scanner; no dedicated mobile flow. |

**Phase 6 summary:** Notifications schema and APIs done; **pending:** in-app bell, email/SMS, role matrix, approval limits, full analytics/reports, optional AI.

---

## 8. Summary tables

### By phase

| Phase | Done | Partial | Pending / Incomplete |
|-------|------|--------|------------------------|
| 1 – Master data | 10 | 0 | 3 |
| 2 – Procurement | 10 | 0 | 7 |
| 3 – Inventory/warehouse | 2 | 0 | 7 |
| 4 – Control tower, exceptions, portal, logistics | 0 | 3 | 6 |
| 5 – Documents, compliance, security | 5 | 2 | 6 |
| 6 – Notifications, roles, analytics | 2 | 2 | 8 |

### Overall

| Category | Count |
|----------|--------|
| **Done** | 29 |
| **Partial** | 7 |
| **Pending / Incomplete** | 37 |

### High-level “what’s done”

- Audit remediation (RBAC, validation, deletion UX, dev utilities, feedback, deployment, repos/services, requisition fixes, a11y, retry toasts).
- Master data: full schema, init-db, CRUD APIs, Master Data page (add/delete), requisition department + justification.
- Procurement: approval policies + history APIs, “cannot approve own” rule, PO revisions (create/update + GET), 3-way match endpoint.
- Inventory/warehouse: schema and CRUD APIs for batches, serials, allocations, cycle counts.
- Documents, retention, notifications: schema and APIs (documents metadata, retention CRUD, notifications + preferences).
- 2FA (TOTP) and control tower overview API (operations).

### High-level “what’s pending / incomplete”

- **Phase 1:** Master data edit UI; supplier form (banking, terms, compliance); PO form (Incoterm, payment terms, contract, department, item line extras).
- **Phase 2:** Approval policies and history UI; PO revision history tab; invoice UI and 3-way match display; GRN receiver/location.
- **Phase 3:** Batch/serial at receipt and in logic; allocation logic and “available vs allocated”; put-away; cycle count workflow; expiry report.
- **Phase 4:** Exception automation; supplier portal (auth, APIs, UI); centralized shipments/carriers and full logistics UI.
- **Phase 5:** Document file storage and upload UI; retention job; compliance alerts; full audit logging and viewer; password policy; lockout.
- **Phase 6:** In-app notification bell; email (and optional SMS); role refinement and approver limits; full spend/turnover/supplier/warehouse reports; optional AI.

---

## 9. How to run

- **Development:** `npm run dev` (set `DATABASE_URL` or PG env; see `.env.example`).
- **Production:** `npm run build` then `npm start`, or build/run the root `Dockerfile`.
- **Tests:** `npm run test:rbac`, `npm run test:requisitions` (server must be running).

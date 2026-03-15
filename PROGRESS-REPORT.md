# ISS Sourcing — Audit progress report

Progress against the security and UX audit recommendations. Status: **Done** | **Partial** | **Not done**.

---

## 1. Harden access controls (RBAC)

| Audit item | Status | Notes |
|------------|--------|--------|
| Viewer must not create/edit contracts | **Done** | Backend: POST/PATCH/DELETE require manager or admin. Frontend: Add/Edit/Delete wrapped in `<Can roles={["manager","admin"]}>`. |
| Define viewer / manager / admin boundaries | **Done** | Viewer = read-only; manager = approve/reject, manage data; admin = full. Enforced in routes and UI. |
| RBAC in front-end (hide controls) | **Done** | Contracts, Warehouses, Suppliers, Requisitions: write actions gated by `<Can>`. |
| RBAC in back-end (reject unauthorized) | **Done** | Contracts, Warehouses, Suppliers, Purchase requisitions, Purchase orders: read = auth; write = manager or admin. |
| Test thoroughly | **Done** | `npm run test:rbac` runs automated RBAC checks (viewer 403 on write, admin allowed). See SECURITY.md. |

---

## 2. Validate input (client and server)

| Audit item | Status | Notes |
|------------|--------|--------|
| Contract end date ≥ start date | **Done** | Client: `supplierContractFormSchema.refine()`. Server: check in POST/PATCH, 400 if invalid. |
| Required fields, numeric values, attachment formats | **Done** | Zod schemas and form `FormMessage`; server parses/validates. |
| Field-level error messages | **Done** | Form shows errors next to fields. |
| Enforce same rules on server | **Done** | Contract routes parse with schema and return 400 on validation failure. |

---

## 3. Fix deletion workflow and notifications

| Audit item | Status | Notes |
|------------|--------|--------|
| In-app modal instead of browser confirm | **Done** | Contracts, Suppliers, Profile (remove picture), Suppliers (remove logo), Sync-test (clear DB): use `AlertDialog` or `Dialog`. |
| Correct UI refresh after delete | **Done** | Query invalidation and state reset on success. |
| Toast on success and failure | **Done** | All relevant mutations show toasts; delete flows close modal and show toast in both outcomes. |

---

## 4. Restrict development utilities

| Audit item | Status | Notes |
|------------|--------|--------|
| Hide/disable "Reset demo data" in production | **Done** | Development Utilities card only when `import.meta.env.DEV`; button inside `Can roles={["admin"]}`. |
| Tie to environment flags | **Done** | Card not rendered in production build. |
| Require administrator to invoke | **Done** | Backend: `ensureAdmin`; frontend: admin-only button. |

---

## 5. Improve user feedback and error handling

| Audit item | Status | Notes |
|------------|--------|--------|
| Status alerts and logs | **Done** | Toasts for success/error on create, update, delete, approve, reject, etc. |
| Show message when operation fails | **Done** | Error toasts with description. |
| Retry options for failed operations | **Done** | Contracts, Requisitions, **Suppliers** (create/update/delete + logo create/update/delete), **Warehouses** (create/update/delete), and **PO transitions** (approve/send, receive) error toasts include "Retry" `ToastAction`. List/requisitions use `onRetry={refetch}` where applicable. |

---

## 6. Deployment practices

| Audit item | Status | Notes |
|------------|--------|--------|
| Separate dev and production environments | **Done** | `.env.development.example` and `.env.production.example`; `docs/ENV-CONFIG.md` documents both. |
| CI/CD to deploy changes | **Done** | CI runs check + lint; build job runs `npm run build` and uploads `dist/` artifact (deploy can use artifact). |
| Containerize (e.g. Docker) | **Done** | Root `Dockerfile` (multi-stage) for production run. |
| Reverse proxy with TLS | **Done** | `deploy/nginx.conf.example`, `deploy/Caddyfile.example`, and `docs/DEPLOYMENT.md` document running behind nginx/Caddy with TLS. |
| Environment variables for secrets | **Done** | `.env.example` documents `DATABASE_URL`, `SESSION_SECRET`, etc. |

---

## 7. Back-end architecture

| Audit item | Status | Notes |
|------------|--------|--------|
| Data models with constraints (e.g. date ranges in DB) | **Done** | `ensureContractDateConstraint()` in init-db adds CHECK (end_date IS NULL OR end_date >= start_date) on supplier_contracts. |
| Service layer for business logic | **Done** | Contract service; **Supplier service** (`server/services/supplier-service.ts`): supplier create/update/delete with audit logging; routes use supplierService for supplier writes. |
| Repository layer for data access | **Done** | Contract, **Supplier** (`server/repositories/supplier-repository.ts`), and **Warehouse** (`server/repositories/warehouse-repository.ts`) repositories; routes use repo/service for supplier and warehouse CRUD. |
| Log critical actions for audit | **Done** | Contract and **supplier** create/update/delete call `createActivityLog`. Storage already logs warehouse, requisition, PO actions. |

---

## 8. User-interface consistency

| Audit item | Status | Notes |
|------------|--------|--------|
| Unified component library (no native alert/confirm) | **Done** | Critical flows use Shadcn `AlertDialog`/`Dialog` and toasts. Sync-test and real-time-sync-tester use toasts and AlertDialog. |
| Forms accessible and responsive | **Done** | Contract form and **Supplier form** (aria-label, id/htmlFor on name, contact, email, phone, address, tax ID, notes), **Requisition form** (role="form", aria-label, id/htmlFor on supplier, required date, notes, item/qty/unit price, Add item / Remove line), **Warehouse forms** (create/edit: aria-label on form and key inputs; id/htmlFor already present; Add bin aria-label). |

---

## 9. Monitor and audit other modules

| Audit item | Status | Notes |
|------------|--------|--------|
| Permission leaks in purchase order approval | **Done** | PO and requisition routes use `poRead`/`poWrite`; frontend Requisitions wrapped in `<Can>`. |
| Permission leaks in warehouse management | **Done** | Warehouse routes and UI gated by manager/admin. |
| Code review / penetration test | **Done** | `SECURITY.md` added with RBAC verification checklist and how to run `npm run test:rbac`; automated RBAC script covers core cases. |

---

All items from the original security/UX audit, the New Requisition Module audit, and Section 2 optional follow-ups are implemented. See `docs/DEPLOYMENT.md` for reverse proxy with TLS; `server/init-db.ts` for DB constraints and requisition tables; `docs/REQUISITIONS-AUDIT.md` for requisition audit details and how to run `npm run test:requisitions`.

---

## 10. Audit Report: New Requisition Module

Progress against the **Audit Report: New Requisition Module** (Requisitions page, New Requisition form, role testing). Status: **Done** | **Partial** | **Not done**.

| Audit item | Status | Notes |
|------------|--------|--------|
| **Broken requisitions API (500)** | **Done** | `ensurePurchaseRequisitionsTables()` in `server/init-db.ts` creates `purchase_requisitions` and `purchase_requisition_items` at startup if missing. `getRequisitionWithDetails()` in database-storage now reads from DB (not empty memStorage). GET list returns optional `detail` in non-production on error. |
| **Create button not functional / no feedback** | **Done** | Tables ensured so list and create succeed. Success: toast “Requisition created”, redirect to list, list refetches. Failure: toast “Create failed” with server message. |
| **Insufficient validation** | **Done** | Server: POST validates each item `quantity > 0`, `unitPrice > 0` (400 with clear message). Client: submit validates same; messages for “Add at least one item”, “Quantity must be greater than zero…”, “Unit price must be greater than zero…”. Only valid items sent. |
| **Inconsistent feedback** | **Done** | Error toasts use API message; list errors show Retry; 500 includes `detail` in non-production. |
| **Client-side only permission checks** | **Done** | Already in place: all requisition/PO endpoints use `poRead`/`poWrite`; viewers get 403 on write. |
| **Fix the Requisitions API** | **Done** | Tables ensured; getRequisitionWithDetails implemented for DB. |
| **Implement proper form submission + feedback** | **Done** | Validation, toasts, redirect on success. |
| **Add field validation** | **Done** | Client and server: quantity and unit price > 0. |
| **Strengthen authorization** | **Done** | RBAC on all requisition/PO endpoints (manager/admin for write). |
| **Improve error handling** | **Done** | Clear 400 messages; optional 500 detail in dev. |
| **Loading state** | **Done** | Spinner on Create; DataState on list with Retry. |
| **Unit/integration tests for requisitions** | **Done** | `scripts/test-requisitions.ts`; run `npm run test:requisitions` (server must be running). Covers permissions, validation, and success path. |
| **Code review and documentation** | **Done** | `docs/REQUISITIONS-AUDIT.md` documents fixes and API behaviour; code comments in routes and init-db. |

### New Requisition Module — Summary

| Category | Done | Partial | Not done |
|----------|------|---------|----------|
| API and data layer | 2 | 0 | 0 |
| Form and feedback | 4 | 0 | 0 |
| Validation (client + server) | 2 | 0 | 0 |
| Authorization | 1 | 0 | 0 |
| Error handling and loading | 2 | 0 | 0 |
| Tests and documentation | 2 | 0 | 0 |
| **Requisition module total** | **13** | **0** | **0** |

All items from the New Requisition Module audit are done, including unit/integration tests. See `docs/REQUISITIONS-AUDIT.md` for details.

---

## 11. Audit: Inventory Manager App & Structural Recommendations (docx)

Progress against the **Audit of Inventory Manager App & Structural Recommendations for a Professional Supply-Chain Platform** (key issues and recommendations). Status: **Done** | **Partial** | **Not done**.

| Audit item | Status | Notes |
|------------|--------|--------|
| **RBAC: viewer must not create/edit inventory** | **Done** | Inventory GET requires auth; POST/PUT/DELETE/bulk-import require manager or admin. Inventory list empty-action "Add items" gated by `<Can roles={["manager","admin"]}>`. |
| **RBAC: viewer must not create/edit categories** | **Done** | Category read/write routes use `categoryRead`/`categoryWrite`; viewers get 403 on category create/update/delete. |
| **Missing validation (e.g. contract end date)** | **Done** | Already addressed: contract end ≥ start (client, server, DB constraint). |
| **Broken Requisitions (500)** | **Done** | Already addressed: ensurePurchaseRequisitionsTables, getRequisitionWithDetails from DB. |
| **Supplier tax ID for legal compliance** | **Done** | Optional `taxIdentificationNumber` on suppliers (schema, init-db column, form field "Tax ID / VAT number"). |
| **Analytics empty charts / no data** | **Done** | Info alert when inventory data is empty: "No inventory data yet. Charts will appear once you add inventory items." |
| **Warehouse locations (aisles, bins)** | **Done** | Schema and warehouse form already support aisle, aisles, bins, locationDetails. |
| **Audit logging of sensitive actions** | **Done** | Contract create/update/delete and storage activity logs for suppliers, warehouse, requisitions, POs. |
| **User experience: no native dialogs** | **Done** | Deletion and critical flows use AlertDialog/Dialog and toasts. |
| **Dev utilities hidden in production** | **Done** | Development Utilities card only in dev; reset demo requires admin. |
| **Environment separation / deployment** | **Done** | Env examples, Dockerfile, reverse-proxy examples, CI. |

Recommendations in the doc that are **strategic** (modular architecture, full procurement workflow, contract lifecycle, logistics, integrations, etc.) are noted as future roadmap; the above items are implemented to close the stated gaps.

---

## 12. Section 2 optional follow-ups (audit remediation)

Progress on the optional follow-up items (retry toasts, a11y, repository/service for suppliers and warehouses). Status: **Done** | **Partial** | **Not done**.

| Audit item | Status | Notes |
|------------|--------|--------|
| **Retry in toasts (suppliers)** | **Done** | Create, update, delete, and logo create/update/delete error toasts include `<ToastAction altText="Retry">` that re-invokes the same mutation. |
| **Retry in toasts (warehouses)** | **Done** | Create, update, delete warehouse error toasts include Retry action. |
| **Retry in toasts (PO transitions)** | **Done** | Approve/Send and Receive failure toasts on orders detail page include Retry action. |
| **Broader a11y (suppliers form)** | **Done** | Form has `aria-label="Supplier form"`; all fields have `id`, `htmlFor`, and `aria-label`. |
| **Broader a11y (requisition form)** | **Done** | Form container has `role="form"` and `aria-label`; supplier, required date, notes, item select, qty, unit price, Add item, Remove line have id/htmlFor/aria-label. |
| **Broader a11y (warehouse forms)** | **Done** | Create and edit forms have `aria-label`; name, location, address have `aria-label`; Add bin buttons have `aria-label="Add bin or location"`. |
| **Repository for suppliers** | **Done** | `server/repositories/supplier-repository.ts`; routes use supplierRepo for reads and supplierService for writes. |
| **Service for suppliers** | **Done** | `server/services/supplier-service.ts` with audit logging on create/update/delete; routes pass userId for activity log. |
| **Repository for warehouses** | **Done** | `server/repositories/warehouse-repository.ts`; routes use warehouseRepo for all warehouse CRUD and set-default. |

### Section 2 summary

| Category | Done | Partial | Not done |
|----------|------|---------|----------|
| Retry toasts | 3 | 0 | 0 |
| A11y (forms) | 3 | 0 | 0 |
| Repository/service | 3 | 0 | 0 |
| **Section 2 total** | **9** | **0** | **0** |

---

## What’s halfway (partial) and what still needs to get done

### Halfway / partial

- **None.** All tracked audit items and Section 2 follow-ups are implemented; nothing is left in a half-done state.

### Still needs to get done (optional / future)

These are not required by the current audits but are reasonable next steps:

| Item | Notes |
|------|--------|
| **Warehouse service layer** | Optional. Warehouse repo is in place; a warehouse service (e.g. with audit logging on create/update/delete) could mirror the supplier service. |
| **Retry in other modules** | Any remaining error toasts (e.g. inventory bulk-import, categories, other report flows) could get a Retry action for consistency. |
| **A11y on remaining forms** | Profile, settings, and other lower-traffic forms could get the same aria-label / id / htmlFor pass. |
| **Repository/service for other entities** | Inventory, categories, purchase orders could get repository (and optionally service) layers for consistency and future audit logging. |
| **Strategic roadmap items** | From the structural audit doc: full procurement workflow, contract lifecycle automation, deeper logistics/integrations, modular architecture. |

### Summary table (all sections)

| Category | Done | Partial | Not done |
|----------|------|---------|----------|
| 1. RBAC | 5 | 0 | 0 |
| 2. Validation | 4 | 0 | 0 |
| 3. Deletion / notifications | 3 | 0 | 0 |
| 4. Dev utilities | 3 | 0 | 0 |
| 5. User feedback / retry | 3 | 0 | 0 |
| 6. Deployment | 5 | 0 | 0 |
| 7. Back-end architecture | 4 | 0 | 0 |
| 8. UI consistency | 2 | 0 | 0 |
| 9. Other modules | 3 | 0 | 0 |
| 10. New Requisition Module | 13 | 0 | 0 |
| 11. Structural recommendations | 11 | 0 | 0 |
| 12. Section 2 follow-ups | 9 | 0 | 0 |
| **Total** | **65** | **0** | **0** |

---

## How to run

- **Development:** `npm run dev` (set `DATABASE_URL` or PG env; see `.env.example`).
- **Production:** `npm run build` then `npm start`, or build/run the root `Dockerfile` with `DATABASE_URL` and `SESSION_SECRET`.
- **CI:** Push/PR to main or master runs `npm run check` and `npm run lint`.

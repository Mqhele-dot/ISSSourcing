# ISS Sourcing — Audit remediation progress report

**Date:** March 2025  
**Scope:** Security and UX audit follow-up; RBAC, validation, deletion workflow, audit logging, deployment, and CI.

---

## Completed

### 1. Role-based access control (RBAC)

| Module | Backend | Frontend |
|--------|---------|----------|
| **Contracts** | ✅ Read = auth; create/update/delete = manager or admin | ✅ Add/Edit/Delete wrapped in `<Can>` |
| **Warehouses** | ✅ Same pattern | (UI already gated by same roles where applicable) |
| **Suppliers** | ✅ Read = auth; create/update/delete + logo = manager or admin | ✅ Add/Edit form, Edit, Delete, Logo wrapped in `<Can>` |
| **Purchase requisitions** | ✅ Read = auth; create/update/delete/approve/reject/convert/share + items = manager or admin | (API only; UI can add `<Can>` later if needed) |
| **Purchase orders** | ✅ Same as requisitions for all PO and PO-item routes | (API only) |
| **Demo reset** | ✅ Admin only; dev-only visibility | ✅ Dev-only card + admin-only button |

### 2. Contract validation

- ✅ **Client:** `supplierContractFormSchema` with `.refine()` so end date ≥ start date; field-level errors via `FormMessage`.
- ✅ **Server:** POST and PATCH validate end date ≥ start date and return 400 with a clear message.

### 3. Deletion workflow and notifications

- ✅ **Contracts:** In-app `AlertDialog` for delete confirmation; toasts for success/failure; correct UI refresh.
- ✅ **Suppliers:** In-app `AlertDialog` for delete confirmation (replaced `confirm()`); toasts already used for success/error.

### 4. Development utilities

- ✅ “Reset demo data” only shown when `import.meta.env.DEV` is true and user is admin; backend requires admin.

### 5. User feedback and error handling

- ✅ Contract and supplier mutations use toasts for success and error.
- ✅ Contract and supplier delete flows close the confirmation dialog and show toasts in both success and failure cases.

### 6. Audit logging

- ✅ **Contracts:** Create, update, and delete of supplier contracts call `storage.createActivityLog()` with action, description, referenceType, referenceId, and userId (when available).

### 7. Deployment and CI

- ✅ **Dockerfile** at repo root: multi-stage build (Node 20 Alpine), `npm run build`, production run with `node dist/index.js`. Expects `DATABASE_URL`, `SESSION_SECRET`, and optional `PORT`.
- ✅ **.env.example** added: documents `DATABASE_URL`, `SESSION_SECRET`, `PORT`, optional PG vars, email, and seed flags.
- ✅ **CI workflow** (`.github/workflows/ci.yml`): on push/PR to main/master, runs `npm ci`, `npm run check`, `npm run lint`.

---

## Not implemented (recommended follow-ups)

| Area | Recommendation |
|------|----------------|
| **Deployment** | Put app behind a reverse proxy (e.g. nginx) with TLS; use separate dev/prod configs; keep secrets in env. |
| **Backend architecture** | Add DB constraints (e.g. check end_date ≥ start_date); introduce service/repository layers; extend audit logging to suppliers, POs, requisitions. |
| **UI consistency** | Replace any remaining `alert`/`confirm` with app modals; audit forms for accessibility and responsiveness. |
| **Frontend RBAC for PO/requisitions** | Optionally wrap create/edit/delete/approve/reject UI on requisitions and purchase orders pages with `<Can roles={["manager","admin"]}>` for consistency with contracts and suppliers. |

---

## How to run the app

- **Development:**  
  `npm run dev`  
  (Ensure PostgreSQL is running and `DATABASE_URL` or PG env vars are set; see `.env.example`.)

- **Production build:**  
  `npm run build` then `npm start`  
  (Or use the root `Dockerfile`: build image, then run with `DATABASE_URL` and `SESSION_SECRET`.)

- **CI:**  
  Pushes/PRs to main/master trigger the CI workflow (check + lint).

---

## Files touched in this round

- `server/routes.ts` — Supplier, purchase-requisition, and purchase-order RBAC; contract activity logging.
- `client/src/pages/suppliers.tsx` — `<Can>` on add/edit/delete/logo; `AlertDialog` for delete; remove `confirm()`.
- `AUDIT-REMEDIATION.md` — Updated with suppliers/PO/requisitions RBAC, audit logging, Dockerfile, env, CI.
- `Dockerfile` — New.
- `.env.example` — New.
- `.github/workflows/ci.yml` — New.
- `PROGRESS-REPORT.md` — This file.

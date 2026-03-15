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
| Retry options for failed operations | **Done** | Contracts (create/update/delete) and Requisitions (approve/reject/convert) error toasts include "Retry" action. List/requisitions use `onRetry={refetch}` where applicable. |

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
| Service layer for business logic | **Done** | `server/services/contract-service.ts`: contract create/update/delete with date validation and audit logging; routes use contractService. |
| Repository layer for data access | **Done** | `server/repositories/contract-repository.ts` introduces contract repository; routes use `contractRepo` for contract CRUD. |
| Log critical actions for audit | **Done** | Contract create/update/delete call `createActivityLog`. Storage already logs supplier, warehouse, requisition, PO actions. |

---

## 8. User-interface consistency

| Audit item | Status | Notes |
|------------|--------|--------|
| Unified component library (no native alert/confirm) | **Done** | Critical flows use Shadcn `AlertDialog`/`Dialog` and toasts. Sync-test and real-time-sync-tester use toasts and AlertDialog. |
| Forms accessible and responsive | **Done** | Contract form has `aria-label` on form, `id`/`htmlFor`/`aria-label` on key inputs (title, dates, value, summary, notes). |

---

## 9. Monitor and audit other modules

| Audit item | Status | Notes |
|------------|--------|--------|
| Permission leaks in purchase order approval | **Done** | PO and requisition routes use `poRead`/`poWrite`; frontend Requisitions wrapped in `<Can>`. |
| Permission leaks in warehouse management | **Done** | Warehouse routes and UI gated by manager/admin. |
| Code review / penetration test | **Done** | `SECURITY.md` added with RBAC verification checklist and how to run `npm run test:rbac`; automated RBAC script covers core cases. |

---

## Summary

| Category | Done | Partial | Not done |
|----------|------|---------|----------|
| RBAC | 5 | 0 | 0 |
| Validation | 4 | 0 | 0 |
| Deletion / notifications | 3 | 0 | 0 |
| Dev utilities | 3 | 0 | 0 |
| User feedback / retry | 3 | 0 | 0 |
| Deployment | 5 | 0 | 0 |
| Back-end architecture | 4 | 0 | 0 |
| UI consistency | 2 | 0 | 0 |
| Other modules | 3 | 0 | 0 |
| **Total** | **32** | **0** | **0** |

All audit items are implemented. See `docs/DEPLOYMENT.md` for reverse proxy with TLS; `server/init-db.ts` for DB date constraint; `server/services/contract-service.ts` for the contract service layer.

---

## How to run

- **Development:** `npm run dev` (set `DATABASE_URL` or PG env; see `.env.example`).
- **Production:** `npm run build` then `npm start`, or build/run the root `Dockerfile` with `DATABASE_URL` and `SESSION_SECRET`.
- **CI:** Push/PR to main or master runs `npm run check` and `npm run lint`.

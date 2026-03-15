# Audit Remediation Summary

This document summarizes changes made in response to the security and UX audit.

## 1. Role-based access control (RBAC)

**Principle:** Viewer = read-only; Manager = approve/reject and manage data (no system settings); Admin = full authority.

### Backend
- **Contracts** (`/api/contracts`): All routes require `ensureAuthenticated`. GET (list, by id) allowed for any authenticated user. POST, PATCH, DELETE require `ensureRole(["manager", "admin"])` — viewers receive 403.
- **Warehouses** (`/api/warehouses`): Same pattern. Read = authenticated; create/update/delete/set-default = manager or admin only.
- **Demo reset** (`/admin/demo/reset`, `/api/admin/demo/reset`): Already protected with `ensureAuthenticated` and `ensureAdmin`.

### Frontend
- **Contracts page**: Add Contract, Edit, and Delete are wrapped in `<Can roles={["manager", "admin"]}>` so viewers see disabled buttons with tooltip "Requires Manager or Admin".
- **Warehouses page**: Add Warehouse, Add Your First Warehouse, and the row actions dropdown (Edit, Delete) are wrapped in `<Can roles={["manager", "admin"]}>`. Delete already uses an in-app Dialog (no browser confirm).
- **Requisitions page**: New Requisition (header and empty state), Edit, Approve, Reject, Convert, and Share are wrapped in `<Can roles={["manager", "admin"]}>`. Rejection reason uses an in-app Dialog with optional reason input instead of `window.prompt`.
- **Settings**: "Reset demo data" is inside `Can roles={["admin"]}` and the whole "Development Utilities" card is shown only when `import.meta.env.DEV` is true (hidden in production build).

## 2. Contract validation (client + server)

- **End date vs start date**: Schema `supplierContractFormSchema` now has a `.refine()` so that `endDate` must be on or after `startDate`. Same rule enforced on the server in POST and PATCH (return 400 with message "End date must be on or after start date").
- **Required fields and types**: Handled by existing Zod schema (`supplierContractFormSchema`). Form uses `FormMessage` so validation errors appear next to each field.

## 3. Contract deletion workflow

- **Before:** `confirm("Delete this contract?")` (browser dialog); no in-app modal; risk of blank page on redirect.
- **After:** Delete is triggered from a table or view dialog; confirmation uses an in-app `<AlertDialog>` with title "Delete contract?", description including contract title, and Cancel / Delete buttons. On success: toast "Contract deleted", query invalidation, view and delete-dialog state cleared. On failure: toast "Delete failed" with error message, delete dialog closed.

## 4. Development utilities

- "Reset demo data" is only visible when:
  - Build is development (`import.meta.env.DEV`), and
  - User role is admin (`Can roles={["admin"]}`).
- In production builds the Development Utilities card is not rendered. Backend already requires admin for the reset endpoint.

## 5. User feedback and error handling

- Contract create/update/delete mutations already use `useToast` for success and error.
- Contract delete now has explicit success and error toasts and closes the modal in both cases.

## 6. Other modules (permission audit)

- **Warehouses**: Write operations (POST, PUT, PATCH, DELETE, set-default) now require manager or admin on the server.
- **Suppliers**: RBAC applied. All supplier and supplier-logo routes require `ensureAuthenticated` for read; POST/PUT/PATCH/DELETE require `ensureRole(["manager", "admin"])`. Frontend: Add/Edit form, Edit, Delete, and Logo buttons are wrapped in `<Can roles={["manager", "admin"]}>`; supplier delete uses in-app `AlertDialog` instead of `confirm()`.
- **Purchase orders / requisitions**: RBAC applied. All purchase-requisition and purchase-order routes use `poRead` (authenticated) for GET and `poWrite` (manager or admin) for create, update, delete, approve, reject, convert, share, and item CRUD.

## 7. Audit logging

- **Contracts**: Create, update, and delete of supplier contracts now call `storage.createActivityLog()` with action/description/referenceType/referenceId/userId so these actions appear in activity logs.

## 8. Deployment and CI

- **Dockerfile**: Root `Dockerfile` added for production build (multi-stage: builder runs `npm run build`, runner runs `node dist/index.js`). Requires `DATABASE_URL` and `SESSION_SECRET` (and optional `PORT`).
- **Environment**: `.env.example` documents `DATABASE_URL`, `SESSION_SECRET`, `PORT`, and optional email/seed variables.
- **CI**: `.github/workflows/ci.yml` runs on push/PR to main/master: `npm ci`, `npm run check`, `npm run lint`.

## 9. UI consistency (native dialogs replaced)

- **Suppliers:** Remove-logo confirmation uses in-app `AlertDialog` (no `confirm()`).
- **Profile:** Remove profile picture uses in-app `AlertDialog` (no `confirm()`).
- **Requisitions:** Reject reason uses in-app `Dialog` with optional reason input (no `window.prompt()`).
- **Contracts, Suppliers, Warehouses:** Delete confirmations use in-app `AlertDialog` or `Dialog`.
- **Sync-test page:** Clear local DB uses in-app `AlertDialog` for confirmation; desktop-only and success/error use toasts (no `alert`/`confirm`).
- **Real-time-sync-tester:** Send-message failure uses toast (no `alert`).

## 10. Retry on failure

- **Contracts:** Create, update, and delete error toasts include a "Retry" action that re-invokes the same mutation with the same parameters.
- **Requisitions:** Approve, reject, and convert error toasts include a "Retry" action. List view already has `onRetry={refetch}` for load errors.

## 11. Phase two (partial items completed)

- **RBAC testing:** `scripts/test-rbac.ts` and `npm run test:rbac` verify viewer gets 403 on write, admin can write. Documented in `SECURITY.md`.
- **Dev/prod config:** `.env.development.example`, `.env.production.example`, and `docs/ENV-CONFIG.md` document separate dev vs production env.
- **CI build:** `.github/workflows/ci.yml` has a `build` job that runs `npm run build` and uploads the `dist/` artifact.
- **Repository layer:** `server/repositories/contract-repository.ts` provides a contract data-access layer; routes use `contractRepo` for contract CRUD.
- **Forms a11y:** Contract form has `aria-label` on form and key inputs, plus `id`/`htmlFor` for label association.
- **Security checklist:** `SECURITY.md` describes RBAC, how to run `test:rbac`, and a manual verification checklist.

## 12. Remaining items (completed)

- **Reverse proxy with TLS:** `deploy/nginx.conf.example` and `deploy/Caddyfile.example` provide example configs; `docs/DEPLOYMENT.md` describes running the app behind nginx or Caddy with TLS.
- **DB constraints for date ranges:** `server/init-db.ts` defines `ensureContractDateConstraint()` which adds `CHECK (end_date IS NULL OR end_date >= start_date)` on `supplier_contracts` at startup (idempotent).
- **Service layer:** `server/services/contract-service.ts` implements contract create/update/delete with date validation and audit logging; routes use `contractService` instead of calling the repository and logging inline.

## 13. Optional follow-ups

- **UI:** Add retry actions for other modules (suppliers, warehouses, POs) where applicable; broader a11y audit if needed.
- **Backend:** Extend repository/service pattern to other entities (suppliers, warehouses, etc.) if desired.

# Purchase Requisitions Module – Audit Remediation

This document tracks fixes applied in response to the **Audit Report: New Requisition Module**.

## Issues Addressed

### 1. Broken requisitions API (500 error)

- **Cause:** In environments where `drizzle-kit push` had not been run (e.g. new Codespaces), the `purchase_requisitions` and `purchase_requisition_items` tables could be missing, causing the list endpoint to throw.
- **Fix:**
  - **`server/init-db.ts`:** Added `ensurePurchaseRequisitionsTables()` which runs `CREATE TABLE IF NOT EXISTS` for `purchase_requisitions` and `purchase_requisition_items` on startup. This makes the list endpoint work even when the full Drizzle schema has not been pushed.
  - **`server/database-storage.ts`:** Implemented `getRequisitionWithDetails(id)` to read from the database (requisition, items, inventory items, supplier, requestor, approver) instead of delegating to empty in-memory storage, so single-requisition fetch works when using PostgreSQL.
- **Error handling:** The GET list handler now returns a `detail` field in non-production when an error occurs, to aid debugging.

### 2. Create button not functional / no feedback

- **Fix:**
  - Create flow was already sending a POST and using toast + redirect on success and toast on error. The main blocker was the 500 on the list (table missing) and any 500 on create (same cause). With tables ensured and validation in place, success and error paths are clear.
  - Success: toast “Requisition created”, redirect to list, list refetches.
  - Failure: toast “Create failed” with the server message (e.g. validation or 500 detail in dev).

### 3. Insufficient validation

- **Server (`server/routes.ts`):**
  - POST `/api/purchase-requisitions` now validates each item: `quantity` must be &gt; 0, `unitPrice` must be &gt; 0 (reject zero and negative). Returns 400 with a clear message per item index.
- **Client (`client/src/pages/requisition-form.tsx`):**
  - Submit validates: at least one item with `itemId &gt; 0`, `quantity &gt; 0`, and `unitPrice &gt; 0`.
  - Inline messages: “Add at least one item”, “Quantity must be greater than zero for each item”, “Unit price must be greater than zero for each item”.
  - Only items passing validation are sent in the request body.

### 4. Inconsistent feedback

- Error toasts already use the message from the API response (via `throwIfResNotOk` and mutation `onError`). No change needed beyond ensuring the API returns clear messages (see above).
- List load errors show “Failed to fetch purchase requisitions” and a Retry button (existing behaviour); in non-production the 500 response includes `detail` for debugging.

### 5. Client-side only permission checks

- **Already in place:** All purchase-requisition and purchase-order endpoints use:
  - `poRead = [auth.ensureAuthenticated]` for GET.
  - `poWrite = [auth.ensureAuthenticated, auth.ensureRole(["manager", "admin"])]` for POST, PUT, DELETE, approve, reject, convert, share.
- Viewers calling write endpoints directly receive **403 Forbidden**. No change required.

## Recommendations Status

| Recommendation | Status |
|----------------|--------|
| Fix the Requisitions API | Done (tables ensured, getRequisitionWithDetails implemented for DB) |
| Implement proper form submission + feedback | Done (validation, toasts, redirect) |
| Add field validation | Done (client and server: quantity and unit price &gt; 0) |
| Strengthen authorization | Already done (RBAC on all requisition/PO endpoints) |
| Improve error handling | Done (clear 400 messages, optional 500 detail in dev) |
| Loading state | Existing (spinner on Create, DataState on list) |
| Unit/integration tests | Done: `scripts/test-requisitions.ts`; run with `npm run test:requisitions`. See below. |
| Code review and documentation | This document; API behaviour documented in code comments |

## Running requisitions API tests

The requisitions API is covered by an automated script that runs against a running server.

1. **Start the server** (and ensure the DB is seeded with at least one supplier and one inventory item):
   ```bash
   npm run dev
   ```
   Optionally seed: `npm run db:seed` (or use the in-app “Reset demo data” as admin).

2. **Run the tests** (in another terminal):
   ```bash
   npm run test:requisitions
   ```
   Or with a custom base URL:
   ```bash
   BASE_URL=http://localhost:5000 npm run test:requisitions
   ```

3. **Run all API tests** (RBAC + requisitions):
   ```bash
   npm run test:api
   ```

The script verifies: unauthenticated GET → 401/302/403; viewer can list (200) and cannot create (403); admin gets 400 for no items, quantity ≤ 0, and unit price ≤ 0; admin can create a valid requisition (201) when the DB has supplier and inventory data.

## Git: Resolving local changes before pull

If you have local changes (e.g. in `server/routes.ts`) and pull fails with “would be overwritten by merge”:

1. **Stash your changes**
   ```bash
   git stash push -m "Local Codespaces changes" -- server/routes.ts package-lock.json
   ```
   Or stash everything: `git stash`

2. **Pull the latest**
   ```bash
   git pull origin cursor/project-codespace-compatibility-b14c
   ```

3. **Re-apply your changes (optional)**
   ```bash
   git stash pop
   ```
   If there are conflicts, resolve them in the reported files, then `git add` and commit.

4. If you do **not** need to keep local changes, you can discard them and pull:
   ```bash
   git checkout -- server/routes.ts package-lock.json
   git pull origin cursor/project-codespace-compatibility-b14c
   ```

# Progress report vs codebase (reconciliation)

**Purpose:** Delta between [PROGRESS-REPORT.md](../PROGRESS-REPORT.md) (March 2025 tables) and the repository at reconciliation time. Use this when refreshing §2–§8 in PROGRESS-REPORT.

## Implemented in code but still marked Pending in old tables

| Report row | Evidence |
|------------|----------|
| Phase 1: Master Data **edit** UI | [master-data.tsx](../client/src/pages/master-data.tsx) `MasterTable`: `editingId`, `PATCH` via `updateRecord`. |
| Phase 2: Approval policies config UI | [approval-policies.tsx](../client/src/pages/approval-policies.tsx) + route `/approval-policies`; also policies tab patterns in master-data. |
| Phase 2: Approval history (requisition) | [requisition-form.tsx](../client/src/pages/requisition-form.tsx) + [approval-history-card.tsx](../client/src/components/procurement/approval-history-card.tsx). |
| Phase 2: Approval history (PO) | [orders.tsx](../client/src/pages/orders.tsx) fetches `/api/approval-history/purchase_order/:id`. |
| Phase 2: Invoice create + PO link + 3-way match UI | [invoices.tsx](../client/src/pages/invoices.tsx). |
| Phase 2: GRN metadata (legacy receive) | `POST /api/purchase-order-items/:id/receive` optional fields; [storage.ts](../server/storage.ts) activity log. Operations PO receive may still differ. |
| Phase 3: Put-away / batch / serial / allocations UI (partial) | [warehouse-operations.tsx](../client/src/pages/warehouse-operations.tsx). |
| Phase 3: Cycle count workflow (partial) | [cycle-counts.tsx](../client/src/pages/cycle-counts.tsx) create, lines, Start → in_progress, Post. |
| Phase A (platform): Dedicated PDFs for PO, requisitions, activity, supplier/warehouse profile | [document-generator-service.ts](../server/services/document-generator-service.ts) `generatePdfByLayout`; [export-config.ts](../server/services/export-config.ts) `pdfLayout`. |

## Still genuinely open (high level)

- Supplier **form** banking/compliance vs schema-only.
- PO form **full** master wiring (some fields may exist in orders.tsx — verify).
- Dynamic approval **buttons** purely from policies (server enforces; UI may not surface “next approver”).
- PO **revision history tab** may need explicit UI polish.
- Invoice **full CRUD** (edit/delete) if APIs incomplete.
- Batch/serial **business** integration with stock movements; allocation **automation**.
- Phases 4–6 enterprise items (portal auth, file storage, bell, email, etc.) largely pending or partial.

This file is informational; authoritative counts live in PROGRESS-REPORT after refresh.

## 2026-03-21 follow-up (implemented)

| Item | Evidence |
|------|----------|
| PO lines show supplier part # + commodity | `getPurchaseOrderLines` joins `inventory_items` + `commodity_codes`; `orders.tsx` receive table columns. |
| PO approval policy preview | `orders.tsx` loads `/api/approval-policies`, filters `purchase_order` + active, shows card when PO is open. |
| Invoice line CRUD in UI | `invoices.tsx` **Lines** dialog → `/api/invoices/:id/items` GET/PATCH/POST/DELETE. |
| Password policy row | `server/auth.ts` `validatePasswordPolicy` on register / reset / change-password (not expiry). |

## 2026-03-21 (phase 3–6 push)

| Item | Evidence |
|------|----------|
| PO approve → allocations | `syncPurchaseOrderAllocations` + `transitionOperationalPurchaseOrderStatus` → `approved` in `server/operations-core.ts`. |
| Control tower page | `client/src/pages/control-tower.tsx`, route `/control-tower`, sidebar. |
| Supplier user mapping | `users.supplier_id` / `approver_amount_limit` in `shared/schema.ts`, `init-db.ts`, Employee Profiles, `resolveSupplierIdForUser`, `/api/supplier/context`. |
| Notification email mirror | `emitNotification` → `sendEmail` in `server/routes.ts`; `DISABLE_NOTIFICATION_EMAIL=true` to disable. |
| Requisition approver cap | `POST .../approve` checks `approverAmountLimit` vs `totalAmount`. |

## 2026-03-15 (all §2–§6 “Partial” rows cleared)

| Item | Evidence |
|------|----------|
| Approval suggestions API + UI | `GET /api/approval-suggestions` in `server/routes.ts`; `server/approval-suggestions.ts`; PO card + requisition dialog in `orders.tsx` / `requisitions.tsx`; `fetchApprovalSuggestions` in `client/src/api/client.ts`. |
| GRN receiverUserId | `receivePurchaseOrder` options + `orders.tsx` `useAuth` user id. |
| Inventory ops fields in UI | `fetchInventory` maps expiry/mfg/price; dashboard columns; `warehouse-operations.tsx` uses `fetchInventory`. |
| Shipment tracking | `tracking_number` DDL + list/detail/patch; `logistics.tsx`; `getPurchaseOrderShipments` includes tracking; PO linked shipments table in `orders.tsx`. |
| Control tower KPIs | `getOperationalControlTowerOverview` + dashboard second row + `control-tower.tsx` second grid. |
| Activity / audit filters | `listOperationalActivity` `action` filter; `GET /api/activity?action=`; `audit-logs.tsx` presets. |
| Exception type presets | `exceptions.tsx` `EXCEPTION_TYPE_PRESETS`. |
| Mobile pick | `/mobile/pick`, `mobile-pick.tsx`, sidebar + router. |
| Employee persona + phone UI | `employee-profiles.tsx` `WORK_PERSONA_OPTIONS`, phone input. |
| Invoice patch audit | `PATCH /api/invoices/:id` → `createActivityLog` in `server/routes.ts`. |

## 2026-03-15 (cleanup / audit follow-up)

| Item | Evidence |
|------|----------|
| Shared CSV export helper | `client/src/lib/csv-download.ts` `downloadCsv`; used by `audit-logs.tsx`, `exceptions.tsx`, `inventory.tsx`. |
| Mobile pick error UX | `mobile-pick.tsx`: toast on `fetchInventory` failure; `toastRef` keeps `useAsyncResource` fetcher stable (avoids refetch loops if `toast` identity changes). |
| Inventory API docs | JSDoc on operational `GET /api/inventory` in `server/operations-routes.ts`; note in `server/routes.ts` where a shadow route exists. |

## 2026-05-10 — PO release gate, activity, diagnostics

| Item | Evidence |
|------|----------|
| PO approve/send/update API | `scripts/test-purchase-order-endpoints.ts` (invoked from `scripts/run-playwright-e2e.mjs` after server ready); `shared/purchase-order-status.ts`; `server/modules/operations/operations-core.ts` transitions |
| Commercial-only `PUT` + lock | `server/modules/procurement/register-procurement-routes.ts` `/api/purchase-orders/:id`; 409 `PO_COMMERCIAL_UPDATE_LOCKED`; PO detail UI |
| Activity filtering / performance | `listOperationalActivity` in `operations-core.ts`; `GET /api/activity` in `server/operations-routes.ts` (default 50, max 100); `idx_ops_activity_entity_created` in `operational-ddl.ts`; `entity-activity-panel.tsx` |
| PO action E2E | `e2e/purchase-order-actions.spec.ts`; `npm run verify:release` |
| Diagnostics dedupe + routes | `shared/diagnostics/event-dedupe.ts`, `diagnostics-store.ts`, `queryClient.ts`, `self-checks.ts`; `diagnostics-route-monitor.tsx`; `scripts/test-route-diagnostics.ts` |
| AP batch segregation | `register-ap-routes.ts` 403 `PAYMENT_BATCH_SELF_APPROVAL_BLOCKED`; `ap-payments-panel.tsx` |
| **Remaining gap** | Full ERP partial receiving / GRN accounting and inventory settlement beyond current operational receive + PO progress |

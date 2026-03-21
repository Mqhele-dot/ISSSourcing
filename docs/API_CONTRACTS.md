# API response contracts

## Strategy (Phase 1 decision)

We use **option (b): dual contract** during migration.

| Contract | Shape | Examples |
|----------|--------|----------|
| **Legacy JSON** | Raw arrays or objects, errors as `{ message }` or status + body | `GET /api/inventory` → `InventoryItem[]`, master data `GET /api/currencies` → rows, many `POST`/`PATCH` → entity |
| **Envelope JSON** | `{ ok: true, data, meta? }` / `{ ok: false, error }` | Operational routes using [`server/api-response.ts`](../server/api-response.ts) `sendOk` / `sendError` |
| **Operational wrapper** (degraded / timeout paths) | `{ data: T, meta?: { fallback?, endpoint? } }` without top-level `ok` | Some list routes may return this shape; see warehouses + `unwrapOperationalResponse` |

## Audit conformance — client

| Rule | Implementation |
|------|----------------|
| Envelope unwrap | [`invTrackFetch`](../client/src/lib/queryClient.ts): if body has `ok: boolean`, success returns `.data`; errors throw with server message. |
| Legacy pass-through | Responses without `ok` are returned as `T` unchanged (may be an array or object). |
| List normalization | Use [`normalizeApiList<T>`](../client/src/lib/queryClient.ts) for any `GET` that must behave as an array when the wire shape might be `T[]` **or** `{ data: T[] }` (legacy, no `ok`). |
| `normalizeApiList` caveat | If the server returns **200** with a JSON object that is **not** an array and **not** `{ data: T[] }`, normalization yields **`[]`**. The request still looks like a **successful empty list**, not an error. Use `isError` from React Query for failed requests; for strict body validation, check shape explicitly or prefer envelope responses with `ok: false`. |
| Warehouses + fallback | [`unwrapOperationalResponse`](../client/src/lib/queryClient.ts) after `requestJson` for `/api/warehouses` when the payload may be `Warehouse[]` or `{ data: Warehouse[]; meta? }`. |
| New code | Prefer `requestJson` / `invTrackFetch` over raw `fetch` for consistent unwrap + timeouts. |
| Bootstrap 401 noise | [`shouldSuppressGlobalError`](../client/src/lib/queryClient.ts): suppresses global error center for **GET** **401** on `/api/user`, `/api/me`, `/api/auth/*`, `/auth`, `/auth/*`. |

## Audit conformance — server

| Area | Rule | Location |
|------|------|----------|
| Master data | Currency: if `symbol` missing or blank on **POST** or **PATCH**, set from `code` (first 3 chars) or existing row / `"$"` before `insertCurrencySchema` parse. | [`registerMasterDataCrud`](../server/routes.ts) |
| Master data GET | Returns **JSON array** of rows (or 500 + `{ message }`). | Same |
| Inventory GET | Returns **JSON array** of items (or `[]` on error — soft failure). | [`GET /api/inventory`](../server/routes.ts) |
| Warehouses GET | Returns **JSON array** (or `[]` on error). | [`GET /api/warehouses`](../server/routes.ts) |
| Export | PDF/Excel include **metadata** (UTC export time, row count, filters, `X-Request-Id` when present). | [`generateDocument`](../server/services/document-generator-service.ts) + export route in [`routes.ts`](../server/routes.ts) |
| Client export (web) | [`document-generator.ts`](../client/src/lib/document-generator.ts): PDF always uses `/api/export/.../pdf`. Excel/CSV use `/api/export/.../excel` or `/csv` when `reportType` is passed; browser CSV/Excel **fallback without** `reportType` is **dev-only** (`import.meta.env.DEV`) or **Electron**. |
| Column defs | Per-report columns and PDF orientation live in [`export-config.ts`](../server/services/export-config.ts). |

## Audit conformance — shared schema & UI

| Field | Contract |
|-------|----------|
| `currencies.symbol` | DB **notNull**; server always normalizes before zod on POST/PATCH; UI may omit symbol — client sends `code.slice(0,3)` or `"$"` when blank ([`master-data.tsx`](../client/src/pages/master-data.tsx)). |
| `currencies.decimalPlaces` | Optional on insert in zod; DB default **2** ([`shared/schema.ts`](../shared/schema.ts) `currencies.decimalPlaces`). UI may omit. |

## Endpoint quick reference (success bodies)

| Method | Path | Success shape (typical) |
|--------|------|-------------------------|
| GET | `/api/inventory` | `InventoryItem[]` |
| GET | `/api/inventory/low-stock`, `/out-of-stock` | `InventoryItem[]` |
| GET | `/api/warehouses` | `Warehouse[]` |
| GET | `/api/suppliers` | `Supplier[]` |
| GET | `/api/currencies` (and other master tables) | Row `[]` |
| POST/PATCH | `/api/currencies` | Single currency row |
| POST/PATCH | Master data `registerMasterDataCrud` | Single row |

Operational mutations (PO status, receive, exceptions, etc.) use **envelope** — see `sendOk`/`sendError` in routes.

## Testing

- Contract smoke: [`scripts/test-api-contract.ts`](../scripts/test-api-contract.ts) (inventory dual shape, currencies, warehouses, PO flow).
- Requisitions: [`scripts/test-requisitions.ts`](../scripts/test-requisitions.ts).
- Procurement E2E: [`scripts/test-procurement-flow.ts`](../scripts/test-procurement-flow.ts).
- Add assertions for **both** success shape and error shape when changing an endpoint.

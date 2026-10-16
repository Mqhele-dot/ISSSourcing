# Verifying Dashboard Changes

This document describes how to guarantee the dashboard changes (stock/value charts, Edit/View inventory, Recent Orders) work.

## 1. Build

```bash
npm run build
```

Ensures the client and server compile. Exit code 0 means success.

## 2. API contract tests (backend + new endpoints)

With the **server running** (e.g. `npm run dev` in another terminal):

```bash
npm run test:contracts
```

This script:

- Waits for the server at `http://127.0.0.1:5000` (or `BASE_URL`).
- Logs in and runs a full contract flow.
- **New checks** for dashboard:
  - `GET /api/analytics/stock-usage?limit=5` returns 200 and a body with `byItem` (array; each element has `itemId`, `quantityUsed`).
  - `GET /api/analytics/inventory-value` returns 200 and a body with `items` and `totalValue`.

If the server is not reachable, the script exits with code 0 and a warning (no failure).

## 3. E2E tests (dashboard UI)

With the **app and server running** (e.g. `npm run dev`), and Playwright installed (`npm install`):

```bash
npm run test:e2e -- e2e/dashboard.spec.ts
```

Dashboard tests cover:

- Page loads and "Dashboard" heading is visible.
- Export CSV triggers download.
- **Stock Use & Value**: section heading and "Stock Use" / "Value by Category" are visible.
- **View item**: first "View" in the inventory table opens a dialog with "View Item" and "Edit item" button.
- **Edit item**: first "Edit" opens the edit-inventory dialog ("Edit Inventory Item").
- **Orders & Inventory**: "Recent Orders", "View all", and "Quick actions" are visible.
- **View all orders**: clicking "View all" navigates to `/orders` or `/purchase`.

Run with a **seeded DB** (e.g. after `npm run db:seed` or demo reset) so the inventory table has rows and View/Edit tests can run.

## 4. Manual smoke test

1. Start the app: `npm run dev`.
2. Open the dashboard and log in if required.
3. **Charts**: Confirm "Stock Use & Value" shows "Stock Use" and "Value by Category" (or empty state messages).
4. **Inventory**: In "Inventory Overview", click **View** on a row → read-only dialog opens; click **Edit item** → edit form opens. Click **Edit** on a row → edit form opens with that item.
5. **Orders**: In "Orders & Inventory", confirm "Recent Orders" and "View all" / "View and manage orders" are present; click through to the orders list and a PO detail if data exists.

## Summary

| Check              | Command / action                          | Guarantees                                      |
|--------------------|--------------------------------------------|-------------------------------------------------|
| Compile            | `npm run build`                            | No TypeScript/build errors                       |
| API (new endpoints)| `npm run test:contracts` (server running)  | Stock-usage and inventory-value responses valid |
| UI (dashboard)     | `npm run test:e2e -- e2e/dashboard.spec.ts`| Sections, View/Edit, Orders section, navigation|
| Manual             | Follow §4 above                            | End-to-end behavior in browser                  |

Running **build** and, when the server is up, **test:contracts** and **test:e2e** for the dashboard gives a strong guarantee that these changes work.

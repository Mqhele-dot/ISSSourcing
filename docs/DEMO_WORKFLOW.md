# End-to-end demo: requisition → PO → receipt → invoice → payment → export → audit

This is the **canonical UI path** for stakeholders. An automated API walkthrough that mirrors it lives in **`scripts/demo-supply-chain-e2e.ts`** (run with the dev server and seed data).

## UI walkthrough (happy path)

1. **Requisition** — `/purchase/requisitions` → New → fill supplier, department, required date, lines → save. Submit for approval if your process uses a separate submit step.
2. **Approve** — From the requisitions list or detail, approve (respects **Approval policies** at `/approval-policies` when using Postgres).
3. **Approval history** — On the requisition edit screen, review **Approval history** (and configure policies separately).
4. **Convert to PO** — Convert approved requisition to PO; open PO from `/purchase` or `/orders/:po`.
5. **Receipt / GRN** — On the PO screen, receive lines (receiver name, warehouse location, batch/serial where enabled). Legacy integrators can use `POST /api/purchase-order-items/:id/receive` with optional `receiverName`, `warehouseLocation`, `receivedAt`, `receiverUserId`.
6. **Invoice** — `/invoices` → create from PO → **Run 3-way match** → open **Details** if mismatches appear.
7. **Payment** — `/billing` or invoice payment actions (where exposed in UI).
8. **Export** — `/reports` or PO PDF export as applicable.
9. **Audit / activity** — `/audit-logs` and/or `GET /api/activity-logs?limit=50` for operational activity.

## Known UI / product gaps (non-exhaustive)

Aligned with **`PROGRESS-REPORT.md`** — these may still be thin or missing in the shell UI even when APIs exist:

- **Phase 1:** Full master-data **edit** flows; supplier banking/compliance extensions; PO form fully wired to every master field.
- **Phase 2:** PO-level approval policy enforcement in UI (policies exist for **requisitions** server-side; **purchase_order** policies are configurable for future use); dedicated **invoice edit** screens beyond create/list; rich GRN printing.
- **Phase 3:** Deep **allocation** automation (reservations UI is on **`/warehouse-operations`**); full WMS put-away rules; batch/serial **receipt** UX beyond PO operations path.
- **Phase 4–6:** Supplier portal depth, exception automation, notification bell, email/SMS, mobile ops, full compliance viewer — see **`PROGRESS-REPORT.md`**.

## Automation

```bash
# Server running, DB seeded (e.g. npm run db:seed)
npx tsx scripts/demo-supply-chain-e2e.ts
# or
BASE_URL=http://127.0.0.1:5000 npx tsx scripts/demo-supply-chain-e2e.ts
```

The script prints the same **UI gaps** summary on completion.

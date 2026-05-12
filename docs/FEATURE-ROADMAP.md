# Complete Feature List vs Current State — Professional Supply Chain Application

This document maps the **Complete Feature List for a Professional Supply Chain Application** to the current ISSSourcing/InvTrack codebase. Status: **Implemented** | **Partial** | **Not started**.

---

## 1. Master Data Management (Foundation)

| Feature | Status | Notes |
|--------|--------|------|
| Item / SKU database | **Implemented** | `inventory_items` table; full CRUD, categories, SKU, barcode, unit of measure, reorder point, lead time. |
| Supplier database | **Implemented** | `suppliers` table; CRUD, repository + service, audit logging. |
| Warehouse database | **Implemented** | `warehouses` table; CRUD, aisles/bins/location details, default warehouse, repository. |
| Customer database | **Not started** | No customer entity. Optional per spec. |
| Category management | **Implemented** | `categories` table; CRUD, used by inventory. |
| Unit of measure management | **Partial** | App settings have `availableUnits`, `defaultUnit`; no standalone UoM master table. |
| Currency management | **Partial** | Contract/settings use `currency` / `currencySymbol`; no multi-currency or currency master. |
| Tax codes | **Partial** | `vatRates` table (country-based); `taxable` on items; no generic tax-code master. |
| Commodity codes | **Not started** | No commodity code entity. |
| Incoterms | **Not started** | No Incoterms master or on PO/delivery. |
| Supplier part numbers | **Partial** | Item has `supplierId`; no explicit supplier part number field. |
| Supplier tax numbers | **Implemented** | `taxIdentificationNumber` on suppliers (schema, form, display). |
| Supplier banking details | **Not started** | No bank account / payment details on supplier. |
| Compliance certificates | **Not started** | No compliance/certificate storage. |
| Attachments and documentation | **Partial** | Contract `attachments` (name/url); supplier logo; no generic document store. |

---

## 2. Procurement (Source-to-Pay)

### Purchase Requisitions

| Feature | Status | Notes |
|--------|--------|------|
| Requester | **Implemented** | `requestor_id` on `purchase_requisitions`. |
| Department | **Not started** | No department field on requisitions. |
| Item description, quantity, estimated price | **Implemented** | Requisition items: item, quantity, unit price, notes. |
| Justification | **Partial** | `notes` only; no dedicated justification field. |
| Required delivery date | **Implemented** | `required_date` on requisitions. |

### Approval Workflow

| Feature | Status | Notes |
|--------|--------|------|
| Multi-level / amount-based approval | **Partial** | Single approve/reject; no configurable chains or amount thresholds (e.g. &lt;R10k / R10k–R100k / &gt;R100k). |
| Approval history | **Partial** | `approver_id`, `approval_date`, `rejection_reason`; no full history log. |
| Digital approval records | **Partial** | Status and approver stored; no e-signature or audit trail of approval steps. |

### Purchase Orders

| Feature | Status | Notes |
|--------|--------|------|
| Supplier, item details, quantity, price | **Implemented** | PO and PO items with supplier, items, qty, unit price. |
| Delivery terms | **Partial** | `expectedDeliveryDate`, `deliveryAddress`; no Incoterms. |
| Payment terms | **Partial** | `paymentStatus`, `paymentDate`, `paymentReference`; no structured payment terms master. |
| Contract reference | **Partial** | Contracts exist; no formal link from PO to contract. |
| PO revisions | **Partial** | Update PO/items; no revision history or versioning. |
| PO cancellation | **Implemented** | Status includes CANCELLED. |
| Supplier PO confirmation | **Partial** | Status ACKNOWLEDGED; no dedicated supplier confirmation workflow or portal. |

### Goods Receipt (GRN)

| Feature | Status | Notes |
|--------|--------|------|
| Quantity received, receiver, warehouse, date | **Implemented** | Receive PO items; stock movements and warehouse inventory updated. |
| Auto-update inventory | **Implemented** | Receipt creates stock movement and updates warehouse inventory. |

### Invoice Management

| Feature | Status | Notes |
|--------|--------|------|
| Invoice entry, attachments, supplier invoices | **Partial** | `invoices` and `invoice_items` in schema; billing/invoice UI and PO–invoice linkage not fully wired. |

### 3-Way Matching (PO vs GRN vs Invoice)

| Feature | Status | Notes |
|--------|--------|------|
| Match PO, GRN, Invoice; exceptions on mismatch | **Not started** | No 3-way match engine or exception rules. |

---

## 3. Inventory Management

| Feature | Status | Notes |
|--------|--------|------|
| Stock levels by warehouse | **Implemented** | `warehouse_inventory`; stock by warehouse. |
| Available vs allocated inventory | **Partial** | Quantity tracked; allocation/reservation not explicit. |
| Inventory adjustments | **Implemented** | Stock movements (receipt, issue, transfer, adjustment). |
| Inventory valuation | **Partial** | Cost/price on items; analytics value; no full valuation report. |
| Inventory movement history | **Implemented** | `stock_movements` with type, dates, references. |
| Batch tracking | **Not started** | No batch/lot entity. |
| Serial number tracking | **Not started** | No serial number entity. |
| Manufacturing / expiry date | **Partial** | `expiryDate` on inventory items; no manufacturing date. |

---

## 4. Warehouse Management

| Feature | Status | Notes |
|--------|--------|------|
| Receiving goods | **Implemented** | PO receive; stock receipt movements. |
| Put-away locations | **Partial** | Warehouses have bins/aisles/location details; not yet used in put-away workflow. |
| Picking / packing / dispatch | **Partial** | Issue movements exist; no dedicated pick/pack/ship workflow. |
| Zone management | **Partial** | Aisles/bins/locationDetails on warehouse. |
| Aisle / bin locations | **Implemented** | Warehouse schema and UI (aisles, bins, location details). |
| Barcode / QR scanning | **Implemented** | Barcode on items; barcode scanner page; find-by-barcode API. |
| Cycle counting | **Partial** | `lastCountDate` on item; no formal cycle count process. |
| Stock transfers between warehouses | **Implemented** | Transfer API and logic. |

---

## 5. Logistics & Transportation

| Feature | Status | Notes |
|--------|--------|------|
| Shipment creation, carrier, tracking, ETA, delivery confirmation | **Partial** | Logistics page exists; no full shipment/carrier/tracking model in core schema. |
| Route planning, shipping documents, freight cost, exception alerts | **Not started** | Not implemented. |

---

## 6. Supplier Management

| Feature | Status | Notes |
|--------|--------|------|
| Legal name, contacts, tax number | **Implemented** | Suppliers: name, contactName, email, phone, taxIdentificationNumber. |
| Compliance documents, payment terms, insurance | **Not started** | No compliance docs, payment terms master, or insurance fields. |
| Supplier performance scoring / delivery reliability / risk rating | **Not started** | No scoring or risk model. |

---

## 7. Contract Lifecycle Management

| Feature | Status | Notes |
|--------|--------|------|
| Start/expiry, renewal reminders, pricing, SLA | **Partial** | Start/end date, value, currency, summary; no renewal reminders or SLA fields. |
| Version history, clause libraries, approval workflows, e-signatures | **Not started** | No versioning, clauses, or e-signature. |

---

## 8. Demand Forecasting & Planning

| Feature | Status | Notes |
|--------|--------|------|
| Historical demand, seasonal modeling, forecasting, reorder planning | **Partial** | `demand_forecasts` table; forecast service; reorder points and reorder requests. |
| AI forecasting, lead time prediction, safety stock | **Partial** | Settings for forecasting; lead time on item; no AI/safety-stock engine. |

---

## 9. Inventory Replenishment Automation

| Feature | Status | Notes |
|--------|--------|------|
| Reorder levels, forecast, lead time as triggers | **Partial** | Reorder point on items; reorder requests; convert to requisition; no full automation rules. |
| Stock below threshold → purchase request | **Partial** | Reorder flow and conversion to requisition exist; not fully automated by threshold. |

---

## 10. Supply Chain Control Tower

| Feature | Status | Notes |
|--------|--------|------|
| Dashboard: POs, shipments, stock, supplier performance, exceptions | **Partial** | **`/operations/control-tower`**: KPI cards, procurement pipeline, inventory health & value-by-category charts, AP aging, logistics ETA risk, supplier late snapshot, activity trend, needs-attention + recent activity; **`GET /api/dashboard/control-tower`** (org-scoped aggregates). Does not replace deep ERP analytics or formal supplier scorecards. |

---

## 11. Exception Management

| Feature | Status | Notes |
|--------|--------|------|
| Late shipment, price mismatch, stock shortage, contract violation | **Partial** | Exceptions page exists; no structured exception types (e.g. late shipment, 3-way match). |
| Owner, priority, status, resolution tracking | **Partial** | Schema supports structure; not fully implemented per exception type. |

---

## 12. Supply Chain Analytics

| Feature | Status | Notes |
|--------|--------|------|
| Spend, turnover, supplier performance, trends, warehouse utilization | **Partial** | Analytics page; inventory value, stock use, top items, category value; no full spend or supplier performance. |
| Forecasting dashboards, risk analysis | **Partial** | Some forecasting and reports; no risk dashboard. |

---

## 13. Financial Integration

| Feature | Status | Notes |
|--------|--------|------|
| Purchase cost, tax, invoice posting, inventory valuation | **Partial** | Cost/price on items; VAT settings and rates; invoice schema; no full posting/GL. |
| VAT, regional tax rules | **Partial** | VAT rates by country; app settings for VAT. |

---

## 14. Supplier Portal

| Feature | Status | Notes |
|--------|--------|------|
| Confirm POs, update delivery dates, upload invoices, track payments | **Not started** | No supplier-facing portal; role “supplier” exists in schema but no dedicated UI. |

---

## 15. Integration & Automation

| Feature | Status | Notes |
|--------|--------|------|
| REST API | **Implemented** | Full API for core entities. |
| Webhooks, ERP/shipping integrations | **Partial** | Real-time sync/WebSocket; no webhooks or ERP/shipping connectors. |
| Scheduled sync, automated imports, document extraction | **Partial** | Document extractor; image recognition; no scheduled sync or automated imports. |

---

## 16. Document Management

| Feature | Status | Notes |
|--------|--------|------|
| Contracts, invoices, delivery notes, compliance certs | **Partial** | Contract attachments; invoice schema; no central document store or delivery notes. |
| Version history, search, attachment management | **Partial** | Attachments on contracts; no versioning or global search. |

---

## 17. Compliance & Legal Safeguards

| Feature | Status | Notes |
|--------|--------|------|
| Audit trails, RBAC, document retention, tax/supplier compliance | **Partial** | Activity logs; audit logs table; RBAC; no retention policies or compliance tracking. |
| Retention rules (POs, invoices, contracts) | **Not started** | No configurable retention. |

---

## 18. Security & Data Protection

| Feature | Status | Notes |
|--------|--------|------|
| RBAC | **Implemented** | Viewer / manager / admin; backend and frontend. |
| Two-factor authentication | **Not started** | Not implemented. |
| Password policies, login attempt limits, encryption | **Partial** | Auth in place; no explicit password policy or lockout. |
| POPIA / GDPR / SOC2 | **Not started** | No framework-specific controls. |

---

## 19. Audit Logging

| Feature | Status | Notes |
|--------|--------|------|
| Log actions (adjustments, PO edits, approvals, contract changes) | **Partial** | Activity logs; contract and supplier create/update/delete logged; not every action. |
| Action, user, date | **Implemented** | Activity log and audit log schema support this. |

---

## 20. Notifications & Alerts

| Feature | Status | Notes |
|--------|--------|------|
| Approval requests, low stock, contract expiry, shipment delays | **Partial** | In-app toasts; low-stock in logic; no notification center or email/SMS. |
| In-app, email, SMS | **Partial** | In-app only; no email/SMS. |

---

## 21. User Roles & Permissions

| Feature | Status | Notes |
|--------|--------|------|
| Viewer, Requester, Buyer, Approver, Inventory Manager, etc. | **Partial** | Viewer, manager, admin implemented; custom roles and permissions in schema. |
| Rules (e.g. cannot approve own PO) | **Not started** | No approval conflict rules. |

---

## 22. AI Supply Chain Assistance

| Feature | Status | Notes |
|--------|--------|------|
| AI insights and recommendations | **Partial** | Image recognition / document extraction; no demand or supplier-risk AI. |

---

## 23. Mobile & Operational Tools

| Feature | Status | Notes |
|--------|--------|------|
| Barcode/QR scanning, mobile receiving, picking devices | **Partial** | Barcode scanner page; find-by-barcode; no dedicated mobile receiving/picking app. |

---

## 24. Reporting & Export

| Feature | Status | Notes |
|--------|--------|------|
| PDF, Excel, CSV export | **Implemented** | Export API and document generator; PDF template upload. |
| Inventory valuation, spend, supplier performance reports | **Partial** | Reports and analytics; not all report types. |

---

## Summary Matrix

| # | Area | Implemented | Partial | Not started |
|---|------|-------------|--------|-------------|
| 1 | Master Data | 5 | 6 | 4 |
| 2 | Procurement | 8 | 12 | 2 |
| 3 | Inventory | 4 | 3 | 2 |
| 4 | Warehouse | 4 | 4 | 1 |
| 5 | Logistics | 0 | 1 | 2 |
| 6 | Supplier Management | 1 | 0 | 3 |
| 7 | Contract Lifecycle | 0 | 1 | 3 |
| 8 | Demand Forecasting | 0 | 3 | 1 |
| 9 | Replenishment Automation | 0 | 2 | 0 |
| 10 | Control Tower | 0 | 1 | 0 |
| 11 | Exception Management | 0 | 2 | 0 |
| 12 | Analytics | 0 | 2 | 0 |
| 13 | Financial Integration | 0 | 3 | 0 |
| 14 | Supplier Portal | 0 | 0 | 1 |
| 15 | Integration & Automation | 1 | 2 | 0 |
| 16 | Document Management | 0 | 3 | 0 |
| 17 | Compliance & Legal | 0 | 2 | 1 |
| 18 | Security | 1 | 1 | 2 |
| 19 | Audit Logging | 1 | 1 | 0 |
| 20 | Notifications | 0 | 2 | 0 |
| 21 | Roles & Permissions | 0 | 1 | 1 |
| 22 | AI Assistance | 0 | 1 | 0 |
| 23 | Mobile & Operational | 0 | 1 | 0 |
| 24 | Reporting & Export | 1 | 1 | 0 |

---

## Suggested Implementation Priorities

1. **High impact, foundation**  
   - Department on requisitions; contract reference on PO; 3-way match (PO/GRN/Invoice); configurable approval chains by amount.

2. **Supplier & compliance**  
   - Supplier banking details; compliance certificates; supplier portal (confirm PO, upload invoice).

3. **Finance & control**  
   - Invoice management and PO–invoice link; 3-way match exceptions; spend and supplier performance reports.

4. **UX & operations**  
   - Control tower dashboard; notification center and email alerts; “cannot approve own PO” rule.

5. **Advanced**  
   - Batch/serial tracking; document versioning and retention; 2FA and password policy; AI demand/supplier risk.

This roadmap aligns the application with the full professional supply chain feature set and highlights what is already in place versus what remains to be built.

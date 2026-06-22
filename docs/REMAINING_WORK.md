# Remaining work after export / contracts / shell update

Honest backlog aligned with post-release review. **Done well:** `export-config.ts`, PDF orientation/wrap/metadata foundation, auth/Codespaces handling, `page-shell`, `use-reports-data`, `API_CONTRACTS.md`, `normalizeApiList`, server-first PDF in `document-generator.ts` (web).

**Master supply-chain backlog:** The full phased plan (phases 1–6, pending vs done counts) lives in **[`PROGRESS-REPORT.md`](../PROGRESS-REPORT.md)** at the repo root. This doc focuses on **recent implementation slices** and follow-ups; it does not replace that roadmap.

### Recently landed (plan: close remaining gaps)

- **Dedicated PDFs:** PO + requisition + activity log + single-row supplier/warehouse profile (`pdfLayout` in [`export-config.ts`](../server/services/export-config.ts), generators in [`document-generator-service.ts`](../server/services/document-generator-service.ts)); export route enriches PO/requisition PDF data and activity `userName`.
- **PO PDF:** Extra page per order with **terms & conditions** + **buyer/supplier signature** lines.
- **Requisition PDF:** **`approvalHistoryForPdf`** from export route + **approval trail table** when history exists.
- **Warehouse profile PDF:** **Multi-page bin table** via wrapped table when bins exist.
- **Supplier profile PDF:** **Documents** section noting attachments live in-app.
- **Activity log PDF:** Column tuning + export **redaction** note in subtitle.
- **Four-state lists:** suppliers use [`PageDataState`](../client/src/components/page-shell.tsx); requisitions use typed `isError` + [`DataState`](../client/src/components/ui/data-state.tsx); `normalizeApiListStrict` + dev warnings for malformed list bodies ([`queryClient.ts`](../client/src/lib/queryClient.ts)).
- **Splits:** [`warehouse-table.tsx`](../client/src/pages/warehouses/warehouse-table.tsx), [`use-warehouse-crud.tsx`](../client/src/pages/warehouses/use-warehouse-crud.tsx) + [`warehouse-dialogs.tsx`](../client/src/pages/warehouses/warehouse-dialogs.tsx) (**quick vs full** create), [`use-suppliers-core-queries.ts`](../client/src/pages/suppliers/use-suppliers-core-queries.ts) + [`supplier-form-sheet.tsx`](../client/src/pages/suppliers/supplier-form-sheet.tsx) (**stepped wizard** Next/Previous) + [`suppliers-list-card.tsx`](../client/src/pages/suppliers/suppliers-list-card.tsx), [`po-approval-policy-card.tsx`](../client/src/pages/orders/po-approval-policy-card.tsx), requisition [`use-requisition-form-route.ts`](../client/src/pages/requisitions/use-requisition-form-route.ts) + [`requisition-lines-editor.tsx`](../client/src/pages/requisitions/requisition-lines-editor.tsx) + thin [`requisition-form.tsx`](../client/src/pages/requisition-form.tsx), analytics fetchers + dashboard hash-scroll hook.
- **Client export policy:** [`document-generator.ts`](../client/src/lib/document-generator.ts) — web Excel/CSV via `/api/export` when `reportType` set; dev-only fallback without it. **Grep audit:** [`CLIENT_EXPORT_PATHS.md`](./CLIENT_EXPORT_PATHS.md).
- **UX:** read-only [`/suppliers/:id`](../client/src/pages/supplier-detail.tsx) and [`/warehouses/:id`](../client/src/pages/warehouse-detail.tsx) + list links.
- **Workflow scripts:** [`test-procurement-flow.ts`](../scripts/test-procurement-flow.ts) — **PO line receive** + **`X-Request-Id`** assertions; [`test-http.ts`](../scripts/test-http.ts) returns `requestId` on all `apiJsonRequest` calls.
- **Verify:** post-deploy smoke in [`DEPLOYMENT.md`](DEPLOYMENT.md); PDF checks in [`test-exports.ts`](../scripts/test-exports.ts), [`test-procurement-flow.ts`](../scripts/test-procurement-flow.ts), [`test-requisitions.ts`](../scripts/test-requisitions.ts). Full scripted demo + UI gap notes: [`DEMO_WORKFLOW.md`](DEMO_WORKFLOW.md), [`demo-supply-chain-e2e.ts`](../scripts/demo-supply-chain-e2e.ts).

---

## 1. PDF quality — further polish (optional stretch)

**Done (baseline + backlog slice):** Layouts above; PO terms/signature page; requisition approval trail; warehouse bin table; supplier documents note; audit subtitle.

**Optional next (product):** Richer supplier sections; PO legal blocks from templates; warehouse diagrams; field-level redaction in PDF.

**Where to extend:** [`server/services/document-generator-service.ts`](../server/services/document-generator-service.ts) + [`export-config.ts`](../server/services/export-config.ts).

---

## 2. Currency / symbol — verify deployed runtime

**Code path:** [`server/routes.ts`](../server/routes.ts) `registerMasterDataCrud` POST/PATCH normalization + [`client/.../master-data.tsx`](../client/src/pages/master-data.tsx) + [`shared/schema.ts`](../shared/schema.ts).

**Action:** follow **[DEPLOYMENT.md — Post-deploy verification](DEPLOYMENT.md#post-deploy-verification-smoke)** and [`scripts/test-api-contract.ts`](../scripts/test-api-contract.ts). *(Automated proof requires running server + DB.)*

---

## 3. Large pages — further decomposition

**Progress:** Major splits listed above; requisition form page is already composed of hooks + header + lines editor.

**Still optional:** Further churn on `orders.tsx` detail (e.g. commercial terms card, “what changed” card) if file size becomes painful again.

---

## 4. Browser vs server export

**Current:** Documented in [`CLIENT_EXPORT_PATHS.md`](./CLIENT_EXPORT_PATHS.md).

---

## 5. Warehouse & supplier UX simplification

**Progress:** Read-only detail routes; **quick vs full** warehouse create; **stepped** supplier sheet (tabs + Next/Previous).

---

## 6. Silent degraded states vs `normalizeApiList`

**Progress:** `normalizeApiListStrict` + dev warnings; warehouses hook warns on non-array `data`.

**Optional:** Stricter user-visible banners when `meta.fallback` + malformed body coincide.

---

## 7. Workflow completion

**Progress:** Procurement script includes **receive** + **`X-Request-Id`** checks; global request ID middleware already in [`server/index.ts`](../server/index.ts).

**Optional:** Extend other scripts (`demo-supply-chain-e2e.ts`) with the same header checks.

---

## Suggested priority order (next pass)

1. **Deploy smoke** + `test-api-contract` for currency.  
2. **Optional PDF templates** from admin settings.  
3. **CI job** wiring for `test-procurement-flow.ts` (document env in [`TEST-INSTRUCTIONS.md`](TEST-INSTRUCTIONS.md)).

---

*Scoring note (review): export architecture and auth/codespaces — strong; page foundation and API contracts — good; UX simplification — improved; end-to-end workflow — stronger script coverage.*

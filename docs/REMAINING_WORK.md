# Remaining work after export / contracts / shell update

Honest backlog aligned with post-release review. **Done well:** `export-config.ts`, PDF orientation/wrap/metadata foundation, auth/Codespaces handling, `page-shell`, `use-reports-data`, `API_CONTRACTS.md`, `normalizeApiList`, server-first PDF in `document-generator.ts` (web).

### Recently landed (plan: close remaining gaps)

- **Dedicated PDFs:** PO + requisition + activity log + single-row supplier/warehouse profile (`pdfLayout` in [`export-config.ts`](../server/services/export-config.ts), generators in [`document-generator-service.ts`](../server/services/document-generator-service.ts)); export route enriches PO/requisition PDF data and activity `userName`.
- **Four-state lists:** suppliers use [`PageDataState`](../client/src/components/page-shell.tsx); requisitions use typed `isError` + [`DataState`](../client/src/components/ui/data-state.tsx); `normalizeApiList` caveat documented in [`API_CONTRACTS.md`](API_CONTRACTS.md).
- **Splits:** [`warehouse-table.tsx`](../client/src/pages/warehouses/warehouse-table.tsx), [`use-suppliers-core-queries.ts`](../client/src/pages/suppliers/use-suppliers-core-queries.ts), requisition [`use-requisition-form-route.ts`](../client/src/pages/requisitions/use-requisition-form-route.ts) + [`requisition-lines-editor.tsx`](../client/src/pages/requisitions/requisition-lines-editor.tsx), analytics fetchers + dashboard hash-scroll hook.
- **Client export policy:** [`document-generator.ts`](../client/src/lib/document-generator.ts) — web Excel/CSV via `/api/export` when `reportType` set; dev-only fallback without it.
- **UX:** read-only [`/suppliers/:id`](../client/src/pages/supplier-detail.tsx) and [`/warehouses/:id`](../client/src/pages/warehouse-detail.tsx) + list links.
- **Verify:** post-deploy smoke in [`DEPLOYMENT.md`](DEPLOYMENT.md); PDF checks in [`test-exports.ts`](../scripts/test-exports.ts), [`test-procurement-flow.ts`](../scripts/test-procurement-flow.ts), [`test-requisitions.ts`](../scripts/test-requisitions.ts).

---

## 1. PDF quality — further polish (optional)

**Done (baseline):** Dedicated layouts for **purchase orders**, **requisitions**, **activity logs**, and **single supplier / single warehouse** PDFs (multi-row supplier/warehouse exports still use generic table).

**Optional next:**

| Document | Idea |
|----------|------|
| Supplier profile | Richer sections, document attachments summary |
| Warehouse configuration | Diagrams / multi-page bin tables |
| Purchase order | Terms blocks, signature lines |
| Requisition approval | Explicit approval chain table |
| Audit log | Column tuning, redaction hooks |

**Where to extend:** [`server/services/document-generator-service.ts`](../server/services/document-generator-service.ts) + [`export-config.ts`](../server/services/export-config.ts).

---

## 2. Currency / symbol — verify deployed runtime

**Code path:** [`server/routes.ts`](../server/routes.ts) `registerMasterDataCrud` POST/PATCH normalization + [`client/.../master-data.tsx`](../client/src/pages/master-data.tsx) + [`shared/schema.ts`](../shared/schema.ts).

**Action:** follow **[DEPLOYMENT.md — Post-deploy verification](DEPLOYMENT.md#post-deploy-verification-smoke)** and [`scripts/test-api-contract.ts`](../scripts/test-api-contract.ts).

---

## 3. Large pages — further decomposition

**Progress:** warehouse table component, suppliers core queries hook, requisition route + lines editor, analytics fetchers module, dashboard hash-scroll hook.

**Still heavy:** suppliers sheet + mutations, warehouse dialogs, remainder of requisition form, dashboard/analytics chart sections — continue extracting hooks and presentational components.

---

## 4. Browser vs server export

**Current:** Web PDF and (when `reportType` is passed) Excel/CSV use `/api/export/...`. Dev-only / Electron fallbacks documented in [`document-generator.ts`](../client/src/lib/document-generator.ts) and [`API_CONTRACTS.md`](API_CONTRACTS.md).

**Optional:** grep for any remaining raw `fetch` export bypasses when new features add exports.

---

## 5. Warehouse & supplier UX simplification

**Progress:** Read-only detail routes `/suppliers/:id` and `/warehouses/:id` with list links.

**Optional:** Stepped wizard inside supplier sheet; “quick add” warehouse vs advanced bins/JSON.

---

## 6. Silent degraded states vs `normalizeApiList`

**Risk:** Documented in [`API_CONTRACTS.md`](API_CONTRACTS.md). Major lists: suppliers + warehouses + requisitions + inventory use explicit loading/error/empty patterns.

**Optional:** Stricter “unexpected 200 body” detection on critical lists.

---

## 7. Workflow completion

**Scripts:** [`test-procurement-flow.ts`](../scripts/test-procurement-flow.ts) (includes PO PDF export smoke), [`test-requisitions.ts`](../scripts/test-requisitions.ts) (requisition PDF export). Run against seeded DB; see [`TEST-INSTRUCTIONS.md`](TEST-INSTRUCTIONS.md) for `BASE_URL` CI notes.

**Optional:** PO receive step assertions, `X-Request-Id` audit on mutating routes.

---

## Suggested priority order (updated)

1. **PDF polish** (terms, signatures, multi-page warehouse).  
2. **More page splits** (supplier sheet, warehouse dialogs).  
3. **Workflow** — add receive / stronger CI gates when APIs stable.  
4. **Stepped forms** for dense supplier/warehouse create flows.

---

*Scoring note (review): export architecture and auth/codespaces — strong; page foundation and API contracts — good; UX simplification — partial; end-to-end workflow — needs proof.*

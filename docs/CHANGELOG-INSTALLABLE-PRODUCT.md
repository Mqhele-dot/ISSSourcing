# Installable product milestone (changelog)

This release moves the app toward **downloadable, in-product setup** instead of env-file-first onboarding.

## First-run product onboarding

- New columns on `app_settings`: `product_onboarding_completed_at`, `product_onboarding_state`, `business_country_code`, `tax_mode`.
- **Setup wizard** at `/setup` (admin): company name, ISO currency, country, tax mode (`none` / `vat` / `us_sales_tax`), default warehouse, starter departments, optional payment term.
- **Progress saving** via `PUT /api/setup/product/checkpoint`; **finish** via `POST /api/setup/product/complete`.
- **Gate**: signed-in users are redirected to `/setup` until onboarding is complete, except `/auth`, `/admin/onboarding`, `/admin/system-diagnostics`, and `/setup`.
- **Escape hatch**: set `SKIP_PRODUCT_ONBOARDING=true` on the server (migration / support).
- **Demo seed** marks onboarding complete so developers and CI are not blocked.

## Installable / deployment surface

- **`RUNTIME_DEPLOYMENT`**: optional explicit mode — `development` | `test` | `hosted` | `packaged`.
- If unset: Electron + production Node → `packaged`; production without Electron → `hosted`; `test` → `test`; else `development`.
- **`/api/ready`** and health payloads now include **`deploymentMode`** and a live **`build`** object from `getBuildInfo()` (version, commit, deployment mode).

## Organization-aware business defaults

- Wizard writes **currency**, **country**, and **tax mode** into `app_settings` and aligns **VAT** flags for `vat` vs `us_sales_tax`.
- Default warehouse is created and linked as **`default_warehouse_id`**; organization **name** is synced from the wizard company name.

## First customer workflow (UI)

- **Control Tower** home adds a **“First procurement cycle”** checklist linking suppliers → requisition → PO → warehouse ops → invoices → AP payments → export center.

## Diagnostics

- **`/admin/system-diagnostics`**: authenticated snapshot of `/api/setup/status` plus public `/api/ready` (database, uploads path, onboarding flags, build info).
- Command palette / secondary nav: **System diagnostics**.

## Upgrading existing databases

After `drizzle-kit push` (or your migration process), existing rows will have **`product_onboarding_completed_at = NULL`**, which **enables the gate**.

- **Option A (recommended for real tenants):** complete `/setup` once as admin.
- **Option B:** `UPDATE app_settings SET product_onboarding_completed_at = NOW() WHERE product_onboarding_completed_at IS NULL;`
- **Option C:** `SKIP_PRODUCT_ONBOARDING=true` until you are ready to run the wizard.
- **Controlled skip API:** set `ALLOW_SETUP_SKIP=true` so an admin can `POST /api/setup/product/skip` (support-only; keep off in production unless required).

## Packaged / desktop smoke (manual)

1. Start the API with `RUNTIME_DEPLOYMENT=packaged` (or Electron with production profile).
2. Confirm `GET /api/ready` shows `deploymentMode: "packaged"`.
3. Complete org bootstrap and `/setup`; confirm `uploads/` and `uploads/exports/` are created next to the process (or under the executable directory when applicable).
4. Run one CSV/PDF export from **Analytics → Reports** and confirm a row appears in **Export center**.

## Phase F — Product cleanup (install hygiene)

- **Health / readiness routes:** `/health`, `/api/health`, `/ready`, `/api/ready`, `/health/deep`, and `/api/health/deep` share a single handler implementation per pair so monitors and API clients stay aligned; response shape rules are unchanged (bare paths return raw JSON where they did before; `/api/*` uses `sendOk` envelopes where applicable).
- **Demo reset:** `/admin/demo/reset` and `/api/admin/demo/reset` are registered from one loop to avoid drift.
- **Onboarding UX:** `/admin/onboarding` explicitly points admins to **`/setup`** after org bootstrap.
- **Auth:** Removed stale commented CSRF route block.

## E2E installable setup (wizard, gate, diagnostics, procurement)

- **Setup wizard:** Review step explains starter **approval policies** (requisition $0–$5,000 → manager; PO above $5,000 → admin) with a link to edit them after completion; optional **date/time format** presets persist via `POST /api/setup/product/complete`; **resume** banner when a checkpoint exists.
- **Onboarding gate:** If **`/api/setup/status` fails** transiently, operators get **Retry** and **system diagnostics** while the **shell stays navigable** (limited assurance until the check succeeds). When onboarding is **known required** from a successful payload, users outside the allowed escape routes still redirect to **`/setup`** as before; **non-admins** see a compact banner pointing admins to **`/setup`** when appropriate.
- **System diagnostics:** A **read-only summary grid** above the JSON highlights database status, onboarding completion, paths, last export failure, migration count, and build metadata.
- **Procurement:** Approve/reject routes resolve the applicable requisition policy through a single **org-scoped** helper so policy selection cannot drift.
- **Home checklist:** **First procurement cycle** adds **Approve requisition** (deep link to pending requisitions) and points vendor-bill work at **Accounts payable** instead of legacy Invoices.
- **Client reporting currency:** A single **`REPORTING_CURRENCY_FALLBACK_CODE`** constant aligns client defaults with the server-side reporting helper conceptually.

## Production stabilization (noise + resilience)

- **Supplier routing:** Procurement supplier detail and list links use canonical `/procurement/suppliers/:id` so in-app navigation matches the router.
- **Global action errors:** The diagnostics error center dedupes rapid repeats, infers severity, and avoids auto-opening the dialog for every background failure; blocking/mutation issues still surface prominently.
- **Setup / readiness queries:** Shared `setup-readiness-queries` options align `/api/setup/status` and `/api/ready` behavior across the onboarding gate, diagnostics, product setup, hooks, and readiness banner.
- **Calmer health UX:** The gate distinguishes readiness fetch failures from setup-status failures; the top readiness banner uses softer first-failure copy with retry before escalating.
- **Route loading:** Lazy routes are wrapped with suspense, a chunk error boundary (retry + reload), and a timeout message when loading stalls (e.g. slow chunk download).
- **Isolated panel errors:** Warehouse operations, cycle counts, and the AP workspace show per-section retry instead of implying the whole page failed; AP defers secondary fetches until the overview request has settled.
- **Finance invoices:** Legacy invoices UI formats money with org reporting currency instead of a hardcoded `$`.
- **Query client:** Background `GET` failures on `/api/setup/status` and `/api/ready`, plus client `GET` timeouts (`408`), no longer flood the global error center (local UI still reports them).
- **Reorder requests:** List fetch uses isolated error UI with retry so a failed `/api/reorder-requests` does not masquerade as an empty list.
- **Finance / procurement currency:** Billing invoices and payments lists/dialogs, requisition totals, suggested-approver copy, and PO detail order total use org reporting money (`useReportingMoney`) instead of hardcoded `$` / USD formatting.
- **Regression script:** `npm run test:stabilization-client` checks canonical supplier paths, error severity/suppression, money formatting, and action-error dedupe (no Playwright).

### Stabilization pass — grouped notes (readiness, errors, routing, loading, finance, diagnostics)

#### Readiness / setup

- **`useAppReadinessState`** + **`deriveAppReadinessPhase`** centralize derived phases (`pending`, `first_run_required`, `setup_incomplete`, `setup_check_temporarily_failed`, `backend_unreachable`, `ready`) from the same React Query cache as **`setup-readiness-queries`**.
- **Product onboarding gate:** Transient **`/api/setup/status`** failures show an inline alert but **do not block** the rest of the app; blocking redirects apply only when setup is **known** (e.g. onboarding required).
- **Readiness banner** surfaces setup-status and readiness probe issues with retry; **diagnostics** copy bundle includes **`clientReadiness`** snapshot.

#### Global error handling

- **Severity:** `mutation` (user writes), **`important_warning`** (e.g. GET 5xx), **`background`** (other GET noise). **`pickLatestForFab`** only considers **mutations** for the red FAB.
- **Toasts:** `important_warning` uses a **non-destructive** throttled toast; **background** no longer spams destructive toasts.
- **Deduping** window widened slightly; probe `GET`s remain suppressed in **`shouldSuppressGlobalError`**.

#### Routing

- **`parseSupplierRouteId`** / **`SUPPLIER_DETAIL_ROUTE_PATTERN`** in **`supplier-detail-route.ts`**; supplier detail **invalid-id** copy points to canonical path; tests in **`test-stabilization-client`**.

#### Loading resilience

- **Inventory:** Category filter fetch failures show an **inline** retry panel; the main table still loads from its own fetch.
- *(Existing)* **Route loading boundary:** lazy chunk retry, load timeout messaging.

#### Finance formatting

- **Value by category** chart uses **`useReportingMoney`** for tooltips and **Y-axis** compact currency (no hardcoded `$`).

#### Diagnostics

- **Client probe card:** last **`/api/ready`** / **`/api/setup/status`** error strings, phase, degraded badge, **operator recovery** bullet list; JSON export includes **`clientReadiness`**.

### Stabilization phases 10–17 (setup loop, backend payload, isolation, finance, checklist)

#### Readiness / backend

- **`GET /api/setup/status`** builds a **200 OK** payload even when optional pieces fail; adds **`setupStatusHealth`**, **`issues[]`** with **reason codes** (logged as `[SETUP_STATUS] …`), and avoids a single opaque **500** for non-fatal errors.
- **`GET /api/ready`**: `sendReadyPayload` wrapped in **try/catch** so unexpected failures still return a minimal **`sendOk`** body.

#### Frontend readiness UX

- **`/api/setup/status`** React Query runs only when **`useAuth`** reports a **loaded user** (`setupQueryActive`), avoiding **401-before-session** false “setup failed” loops.
- **`deriveAppReadinessPhase`** takes **`setupQueryActive`**; treats **skipped** setup query as **`pending`**, not **`setup_check_temporarily_failed`**.

#### Page-level isolation

- **`PanelInlineError`** shared component; **Gas operations** card on control tower no longer throws the whole query away on failure; **Contracts** (suppliers filter), **Export center** (history) use **throwOnError: false** + local retry.

#### Finance formatting

- **Inventory value** analytics widget uses **`useReportingMoney`** instead of **`formatCurrency`** defaults.

#### Routing

- **Mobile workflow home** (`/m/home`) tiles use **`APP_ROUTES`** (operations + `/m/*` paths) instead of legacy `/exceptions`, `/logistics`, etc. Desktop entry is **`/operations`** and **`/operations/mobile-workflows`** (launcher), not a primary Operations sidebar tab into the mobile shell.

#### Diagnostics / tests

- Diagnostics shows **server-reported setup issues** when `issues` is non-empty.
- **`docs/STABILIZATION-CHECKLIST.md`** documents repeatable passes; **`test-stabilization-client`** covers extra derive + **GBP** formatter smoke; **`test:smoke`** asserts **`setupStatusHealth`** / **`issues`** consistency on **`GET /api/setup/status`**.

### Follow-up stabilization (setup critical vs warning, readiness hardening, pages)

#### Backend readiness / setup

- **`GET /api/setup/status`**: each issue includes **`level: "critical" | "warning"`**; **`setupStatusHealth: degraded`** only when the **database ping fails** or there is at least one **critical** issue (optional diagnostics such as migrations / export job lookup are **warnings** only).
- **Top-level handler guard**: uncaught errors log **`[SETUP_STATUS] SETUP_STATUS_UNHANDLED`** and still return **200** with a minimal **`sendOk`** payload for triage (authenticated callers).
- **Per-request summary log**: **`[SETUP_STATUS] summary`** with **requestId**, **userId**, **orgId**, **health**, **firstCode**, critical/warning counts.
- **Path probes** (`uploads` / `exports`) wrapped so probe exceptions cannot take down the handler; **`getBuildInfo`** failures use a safe fallback.
- **`GET /api/ready`**: **`getBuildInfo`**, **`uploadPathReady`**, and **`emailServiceReady`** are each **try/catch**-wrapped so synchronous probes cannot abort the payload.

#### Frontend readiness UX

- **`setupStatusQueryOptions`**: **`refetchOnWindowFocus: false`** to reduce probe churn.
- **`useAppReadinessState`** exposes **`setupQueryActive`**; **`isDegraded`** still tracks **`setupStatusHealth === "degraded"`** (now aligned with **critical-only** server health).
- **`ProductOnboardingGate`**: waits on **`authLoading`**; only runs the setup **pending** spinner when **`setupQueryActive`**; **“Could not load product setup status”** only after an **authenticated** fetch completes without usable data (avoids false errors while the query is disabled).

#### Page hardening

- **Requisitions**: approval **history** query uses **`throwOnError: false`**; dialog shows **Retry** on failure.
- **Invoices**: **suppliers / POs / tax codes / inventory / PO lines** use **`throwOnError: false`** with **`PanelInlineError`** for reference data and line editor auxiliaries; primary invoice list unchanged.

#### Finance formatting

- **Contracts** detail view: contract **value** uses **`createReportingMoneyFormatter`** with the contract’s **currency** (or org reporting currency), not **`formatCurrency`** defaults.

#### Diagnostics / tests

- Diagnostics lists issue **level** (`critical` / `warning`).
- **`test:smoke`**: asserts **`GET /api/setup/status` → 401** without a session; validates **critical vs health** rules on authenticated responses.
- **`docs/MANUAL-STABILIZATION-MATRIX.md`**: printable route matrix for live passes.

#### Stabilization remainder (gap pass)

- **Readiness banner**: setup-unavailable alert only when **`setupQueryActive`**; **Retry** disables on **`setupFetching`** (not readiness fetch).
- **`useProductSetupComplete`**: returns **false** when **`setupStatusHealth === "degraded"`** or any **`critical`** issue (stricter than onboarding flags alone).
- **Suppliers**: **`payment-terms` / `currencies` / `performance`** queries **`throwOnError: false`** + **`PanelInlineError`** for aux failures.
- **Purchase orders list**: (superseded by InvTrack hardening) failures **propagate** to **`useAsyncResource`**; **`fallback`** hidden when the fetch errors.
- **Reports**: **`useReportsPageData`** aux queries **`throwOnError: false`**; report preview tabs use **`useReportingMoney`** (**`formatMoney`**) instead of **`formatCurrency`**.
- **Routing spot-check**: procurement/finance/analytics pages rely on **`APP_ROUTES`** / section nav; no stray hardcoded **`href`** paths found in that pass.

### InvTrack inventory & procurement hardening (runtime reliability)

#### Inventory

- **List filters**: Server is the single source of truth for **q / location / category / low**; redundant client-side re-filter removed.
- **CSV export (prod)**: Validates **Content-Type** before download; parses **JSON error** bodies; **403** mapped to explicit copy about **reports export** permission; dev keeps **browser CSV** plus optional **Server CSV** button.
- **Row links**: **`APP_ROUTES.inventory.item`** encodes SKU (also **analytics top-items**, **exceptions** deep links, **inventory detail adjust** URL).

#### Warehouse operations

- **Put-away**: **Per-row** pending state; **PutAwayRow** syncs inputs when server row fields change.
- **Allocations**: Validates optional **PO / requisition** ids; **invalidates** **`/api/inventory`** after create; **batch/serial issue** also invalidates **`/api/inventory-allocations`**.
- **Batch register**: Client requires **positive integer** qty; schema requires **`quantityReceived` / `quantityOnHand` ≥ 1**.

#### Purchase orders

- **List fetch**: Failures **throw** into **`useAsyncResource`** (no disguised empty list); **`fallback`** from envelope suppressed when the request **errored**.
- **Signed PDF**: Toasts map **not found** vs **DB unavailable** style errors.
- **`APP_ROUTES.procurement.order`** encodes PO number in the path.

#### Requisitions

- **`/api/users`** and **`/api/suppliers`**: **`throwOnError: false`** + **`PanelInlineError`** on the page; **share** dialog shows directory failure + **Retry users**.
- **Approval suggestions**: **`throwOnError: false`**; dialog shows **suggestions unavailable** without blocking approve/reject.
- **Reject**: Dialog closes only on **success** (failure leaves dialog open for correction/retry).
- **Helpers**: **`getRequisitionErrorMessage`** maps convert/share/not-found copy.

#### Suppliers

- **Logo**: **404** treated as **no logo** (no spurious error); real failures show **inline retry** in the logo dialog; form resets when the **logo query** settles for the selected supplier; **remove logo** closes dialogs on **success** only.
- **Delete**: **FK / constraint** errors get dependency copy; confirm dialog closes on **success** only; deleting clears **selection** and logo UI when the deleted row was selected.

#### Backend routes

- **Master data POST**: **Postgres 23505** → **400 DUPLICATE_RECORD**; **DELETE 23503** → **400 REFERENCED_RECORD**.
- **Batch / allocation / serial** inserts: stricter **Zod** (positive **itemId**, **quantity**, **serialNumber**, batch quantities).
- **Requisition share**: **`sendOk`** envelope, validated **`userIds`**, **`sendError`** for bad input / not found.
- **Requisition convert**: **404** uses **`sendError`** with **`CONVERT_REQUISITION_FAILED`**; **201** returns **`sendOk`**.
- **Supplier delete**: **23503** → **400** with dependency message.
- **Warehouse inventory PUT/DELETE**: **ID** validation uses **`Number.isFinite`** and **≥ 1**.

#### Error handling

- Shared **`export-download`** helpers for CSV export failure parsing.
- **`client/src/lib/export-download.ts`** added for inventory server export.

#### Verification (this change)

- **`npm run check`** and **`npm run test:stabilization-client`**: pass.
- **`npm run test:smoke`**: not run in this session (needs live API + DB).
- **Full manual matrix** (inventory/procurement actions per plan): **not executed** here; use **`docs/MANUAL-STABILIZATION-MATRIX.md`**.

#### Known limitations

- **Inventory CSV (production)** still requires **auth** + **`reports:export`** and org feature **exports**; degraded ops DB may still return empty inventory with **fallback** headers (unchanged).
- **Batch quantity ≥ 1** rejects **zero-on-hand** batch rows via API; use a minimum of **1** when registering traceable batches.

### Manual re-test checklist (post-stabilization)

Suggested order after `npm run demo:reset` (or seeded DB): **Login → Control tower**; **Suppliers list → supplier detail** (`/procurement/suppliers/:id`); **Inventory**; **Warehouses**; **Warehouse operations**; **Cycle counts**; **Reorder requests**; **Purchase orders**; **Requisitions**; **Accounts payable** (each tab); **Invoices** (legacy) and **Billing** UI if used; **Product setup / diagnostics** when simulating failures. Confirm: no persistent global red FAB from throttled `/api/ready` or `/api/setup/status`; supplier detail loads; stuck lazy routes recover; finance amounts match org currency.

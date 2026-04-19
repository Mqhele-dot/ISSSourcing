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
- **Onboarding gate:** If **`/api/setup/status` fails**, the app no longer falls through to full navigation—operators get **Retry** and **system diagnostics**, with **setup/diagnostics/onboarding** paths still reachable when appropriate; **non-admins** see a compact banner on allowed routes pointing admins to **`/setup`**.
- **System diagnostics:** A **read-only summary grid** above the JSON highlights database status, onboarding completion, paths, last export failure, migration count, and build metadata.
- **Procurement:** Approve/reject routes resolve the applicable requisition policy through a single **org-scoped** helper so policy selection cannot drift.
- **Home checklist:** **First procurement cycle** adds **Approve requisition** (deep link to pending requisitions) and points vendor-bill work at **Accounts payable** instead of legacy Invoices.
- **Client reporting currency:** A single **`REPORTING_CURRENCY_FALLBACK_CODE`** constant aligns client defaults with the server-side reporting helper conceptually.

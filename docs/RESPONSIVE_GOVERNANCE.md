# Responsive Governance

## Page shell variants
- `standard` -> default business workspace width
- `wide-table` -> table-heavy pages such as AP and reports
- `task-mode` -> focused operational/mobile task surfaces
- `analytics-mode` -> BI pages with wider KPI and card layouts

The shared shell component lives in `client/src/components/page-shell.tsx`.

## Route capability map
- `desktop-only`
- `mobile-safe`
- `mobile-optimized`
- `full-screen-task`

The resolver lives in:
- `client/src/lib/layout/layout-capabilities.ts`
- `client/src/lib/layout/resolve-shell.ts`

## Current audit targets
- `Home` -> standard shell
- `Control tower` -> operational desktop shell
- `Inventory` -> standard shell, mobile-safe
- `Purchase orders` -> standard shell, mobile-safe
- `Requisitions` -> standard shell, mobile-safe
- `Accounts payable` -> wide-table shell, mobile-safe
- `Reports` -> wide-table shell
- `Settings` -> standard shell with route-backed sections

## Test coverage added
- canonical route redirects
- mobile shell route isolation
- analytics workspace drilldown routes
- sidebar canonical section structure
- saved reports and export center page rendering

## Legacy route notes
- Legacy links remain functional through client redirects.
- `/mobile/*` is normalized into `/m/*`.
- Old top-level destinations stay hidden from primary navigation to reduce noise while preserving bookmarks and deep links.

# Analytics Map

## Product boundary
- `Control tower` is the operational monitor for live execution, exceptions, and recent activity.
- `Analytics workspace` is the business-intelligence surface for KPI drilldowns and cross-domain summaries.
- `Reports` remains the structured tabular output product.

## Analytics workspace sections
- `/analytics/overview` -> cross-domain KPI summary
- `/analytics/inventory` -> stock position and inventory value lens
- `/analytics/procurement` -> purchase order, requisition, and supplier performance lens
- `/analytics/finance` -> AP exposure and invoice lens
- `/analytics/logistics` -> shipment and lateness lens
- `/analytics/reports/*` -> tabular report routes
- `/analytics/saved-reports` -> saved report definitions
- `/analytics/export-center` -> export history and retries

## KPI registry contract
Each KPI entry includes:
- `id`
- `title`
- `description`
- `sourceKey`
- `allowedFilters`
- `drilldownRoute`
- `exportDatasetKey`

The client registry lives in `client/src/lib/analytics/kpi-registry.ts` and is used by the analytics workspace to keep KPI metadata consistent across sections.

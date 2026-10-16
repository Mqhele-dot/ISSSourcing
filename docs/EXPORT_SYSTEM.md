# Export System

## Shared export model
- Existing `/api/export/:dataset/:format` generation remains the execution path.
- A shared dataset registry now describes exportable datasets and supported formats.
- Export requests are recorded into `export_history` for the Export Center UI.
- Saved report definitions are stored in `saved_reports`.

## Core entities
### `export_history`
- `organization_id`
- `user_id`
- `dataset`
- `format`
- `filters`
- `status`
- `file_name`
- `file_size`
- `mime_type`
- `row_count`
- `source_page`
- `request_url`
- `created_at`

### `saved_reports`
- `organization_id`
- `created_by`
- `report_name`
- `dataset`
- `filters`
- `visible_columns`
- `default_format`
- `source_page`
- `created_at`

## UI surfaces
- `/analytics/reports` -> structured report generation
- `/analytics/saved-reports` -> saved report base model
- `/analytics/export-center` -> recent exports, retry, and download links

## Migration notes
- Legacy export entrypoints still work because the existing export route was preserved.
- New report exports should pass `sourcePage` so export history shows originating context.
- Existing exports are not deleted; the shared registry and export center layer sit on top of them.

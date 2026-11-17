# Permission Matrix

## Route Groups

| Route group | Auth | Primary permission/control | Org scoped |
|---|---|---|---|
| `/api/inventory/*` | Required for writes; mixed for reads | `inventory` `read/update` | Yes |
| `/api/stock-movements/*` | Required | `stock_movements` `read/create/execute` | Yes |
| `/api/barcodes/*` | Required | `inventory` `read/update` | Yes |
| `/api/suppliers/*` | Required | Supplier module role/permission checks | Yes |
| `/api/documents/*` | Required | Auth + manager/admin writes | Yes |
| `/api/reports/analytics` | Required | `reports` `read` via module guard | Yes |
| `/api/analytics/*` legacy inventory analytics | Required | `analytics` `read` | Yes |
| `/api/export-center/*` | Required | `reports` `export` | Yes |
| `/api/export-jobs/*` | Required | `reports` `export` | Yes |
| `/api/export/download/*` | Required | `reports` `export` + org match + scoped token | Yes |
| `/api/ap/*` | Required | AP module read/write guards | Yes |
| `/api/document-extractor/*` | Required | Authenticated access | Session scoped |
| `/api/image-recognition/*` | Required | Authenticated access | Session scoped |
| `/api/admin/*` | Required | Admin only | Mixed |

## Notes

- Export downloads are no longer served from public static paths in production.
- Export history and retry flows are tied to the requesting organization and protected by scoped download tokens.
- Legacy analytics endpoints in `server/routes.ts` are now behind authenticated analytics permission checks to avoid anonymous operational leakage.

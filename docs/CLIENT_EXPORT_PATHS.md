# Client export / binary fetch paths

Audit for [`REMAINING_WORK.md`](./REMAINING_WORK.md) §4 (browser vs server export).

## Intentional direct `fetch` to `/api/export/...`

| Location | Purpose |
|----------|---------|
| [`client/src/pages/inventory.tsx`](../client/src/pages/inventory.tsx) | Download inventory CSV blob with `credentials: "include"` |

Prefer **`document-generator.ts`** / shared helpers for new report downloads when a `reportType` exists; inventory keeps a dedicated CSV stream for UX.

## Other `fetch` “export” names

| Location | Notes |
|----------|--------|
| [`client/src/pages/document-extractor-page.tsx`](../client/src/pages/document-extractor-page.tsx) | `/api/document-extractor/export` — feature-specific, not generic reports. |

## Server contract

- All JSON mutating responses should include **`X-Request-Id`** (see `server/index.ts`).
- Integration scripts read it via [`scripts/test-http.ts`](../scripts/test-http.ts) `apiJsonRequest().requestId`.

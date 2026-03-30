# Large page decomposition (InvTrack client)

For dense screens (reports, suppliers, warehouses), keep the route file as **composition only**:

- `*-page.tsx` (or `*.tsx` default export) — layout, wiring, minimal state.
- `use-*-data.ts` — TanStack Query / `useAsyncResource` for server data.
- `use-*-export.ts` (or `use-*-mutations.ts`) — export or mutation-only hooks.
- `*-toolbar.tsx`, `*-tab-panels.tsx` — presentational chunks.

Example: [`client/src/pages/reports.tsx`](../client/src/pages/reports.tsx) delegates export UI to [`reports-export-toolbar.tsx`](../client/src/pages/reports/reports-export-toolbar.tsx) and export logic to [`use-reports-export.ts`](../client/src/pages/reports/use-reports-export.ts).

# TypeScript Baseline Status

Generated from `npm run check` on 2026-02-14 (Batch 2 pass).

## Summary

- Total reported TypeScript errors: **295** _(down from 320, -25 in Batch 2; down from 339, -44 overall)_
- Largest concentration:
  - `server/storage.ts`: 142
  - `server/auth.ts`: 22
  - `client/src/components/billing/invoice-dialog.tsx`: 14

## Top 10 recurring error types

| Rank | Code | Count | Meaning |
|---:|---|---:|---|
| 1 | TS2339 | 55 | Property does not exist on type |
| 2 | TS2322 | 39 | Type is not assignable to target type |
| 3 | TS2393 | 34 | Duplicate function implementation |
| 4 | TS7006 | 29 | Parameter implicitly has `any` type |
| 5 | TS2304 | 25 | Cannot find name |
| 6 | TS2353 | 15 | Object literal has unknown properties |
| 7 | TS2551 | 14 | Property does not exist (near-match suggested) |
| 8 | TS2367 | 13 | Comparison uses non-overlapping types |
| 9 | TS2769 | 10 | No overload matches this call |
| 10 | TS2554 | 9 | Expected argument count does not match |

## Execution order (targeted, low-chaos)

1. **Module and duplicate implementation cleanup** _(highest leverage)_
   - Remove duplicate method definitions in `server/storage.ts`.
   - Resolve missing symbols/imports (`TS2304`).
2. **Shared contract/type alignment** _(top current buckets: TS2339, TS2322, TS2353)_
   - Align schema/storage/session field names to remove `TS2339`, `TS2353`, `TS2551`.
3. **Component prop typing**
   - Fix implicit `any` and prop mismatch in billing/settings pages.
4. **Nullability and strict narrowing**
   - Resolve remaining assignment and overload errors (`TS2322`, `TS2769`).

## Notes

- `npm run check` remains non-blocking in CI for now.
- `npm run lint` is active in CI (report-only) to stop regressions while cleanup proceeds.
- Batch 1 focused on newly introduced Phase 2/3 surfaces (operational routes/pages/client typings) and Electron bridge typing mismatches.
- Batch 2 focused on high-yield boundary typing fixes (`client/src/pages/sync-dashboard.tsx`, `client/src/hooks/use-permissions.tsx`, `client/src/pages/suppliers.tsx`) plus API envelope/client contract typing.

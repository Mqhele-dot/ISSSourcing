# TypeScript Baseline Status

Generated from `npm run check` on 2026-02-14 (Batch 3 pass).

## Summary

- Total reported TypeScript errors: **215** _(down from 295, -80 in Batch 3; down from 320, -105 since Batch 2 start; down from 339, -124 overall)_
- Largest concentration:
  - `server/storage.ts`: 140
  - `server/routes.ts`: 8
  - `client/src/pages/settings.tsx`: 6

## Top 10 recurring error types

| Rank | Code | Count | Meaning |
|---:|---|---:|---|
| 1 | TS2339 | 39 | Property does not exist on type |
| 2 | TS2322 | 35 | Type is not assignable to target type |
| 3 | TS2393 | 34 | Duplicate function implementation |
| 4 | TS2304 | 25 | Cannot find name |
| 5 | TS2353 | 15 | Object literal has unknown properties |
| 6 | TS2551 | 14 | Property does not exist (near-match suggested) |
| 7 | TS2552 | 6 | Cannot find name (near-match suggested) |
| 8 | TS2345 | 5 | Argument type is not assignable |
| 9 | TS7006 | 5 | Parameter implicitly has `any` type |
| 10 | TS2554 | 4 | Expected argument count does not match |

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
- Batch 3 focused on boundary typing in `server/auth.ts`/`server/storage.ts` (`updateUser` contract + session augmentation), plus frontend prop/query typing cleanup in billing, reporting, and document extraction surfaces.

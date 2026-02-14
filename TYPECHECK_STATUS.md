# TypeScript Baseline Status

Generated from `npm run check` on 2026-02-14.

## Summary

- Total reported TypeScript errors: **339**
- Largest concentration:
  - `server/storage.ts`: 142
  - `server/auth.ts`: 22
  - `client/src/components/billing/invoice-dialog.tsx`: 14

## Top 10 recurring error types

| Rank | Code | Count | Meaning |
|---:|---|---:|---|
| 1 | TS2339 | 81 | Property does not exist on type |
| 2 | TS2322 | 41 | Type is not assignable to target type |
| 3 | TS2393 | 34 | Duplicate function implementation |
| 4 | TS7006 | 29 | Parameter implicitly has `any` type |
| 5 | TS2304 | 22 | Cannot find name |
| 6 | TS2551 | 16 | Property does not exist (near-match suggested) |
| 7 | TS2353 | 15 | Object literal has unknown properties |
| 8 | TS2367 | 13 | Comparison uses non-overlapping types |
| 9 | TS2345 | 13 | Argument not assignable to parameter |
| 10 | TS2769 | 12 | No overload matches this call |

## Execution order (targeted, low-chaos)

1. **Module and duplicate implementation cleanup**
   - Remove duplicate method definitions in `server/storage.ts`.
   - Resolve missing symbols/imports (`TS2304`).
2. **Shared contract/type alignment**
   - Align schema/storage/session field names to remove `TS2339`, `TS2353`, `TS2551`.
3. **Component prop typing**
   - Fix implicit `any` and prop mismatch in billing/settings pages.
4. **Nullability and strict narrowing**
   - Resolve remaining assignment and overload errors (`TS2322`, `TS2769`).

## Notes

- `npm run check` remains non-blocking in CI for now.
- `npm run lint` is active in CI (report-only) to stop regressions while cleanup proceeds.

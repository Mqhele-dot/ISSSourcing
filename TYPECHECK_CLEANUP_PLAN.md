# Typecheck Cleanup Plan

The repository currently builds but has a large pre-existing TypeScript error backlog.
This plan tracks an incremental cleanup strategy without blocking delivery.

## Phase A - Stop the bleeding (1 day)

- Keep strict check mode visible in CI (`npm run check`) but non-blocking.
- Keep compiler safety baseline:
  - `skipLibCheck: true`
  - `noEmit: true`
- Add CI visibility so each PR shows whether typecheck improved or regressed.

## Phase B - Fix top error clusters (2-4 days)

Run `npm run check` and group by pattern:

1. Implicit `any` and missing interfaces
2. Import/runtime mismatch (ESM/CJS)
3. API response typing mismatch
4. React prop type mismatch
5. Null/undefined safety

Fix in this order:

1. Build/runtime blockers
2. Shared/core types used broadly
3. Repeated component prop issues
4. Nullability and narrowing refinements

## Phase C - Lock in improvements (ongoing)

- Promote `npm run check` to required CI once green.
- Add optional pre-commit hooks (`lint-staged`) for changed files.
- Keep CI smoke checks (`/health`) and app build as a fast guardrail.

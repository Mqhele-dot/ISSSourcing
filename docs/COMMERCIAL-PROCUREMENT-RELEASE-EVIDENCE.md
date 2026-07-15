# Commercial Procurement Release Evidence

## Release Decision

**Current decision: CANDIDATE for commercial procurement only.**

This is not full ERP production approval. Receiving, inventory operations, logistics, mobile warehouse operations, AP, invoices, payment control, and direct bank payment initiation are not approved by this evidence pack. Formal production approval still requires the named human sign-offs and branch-protection approval.

| Field | Evidence |
|---|---|
| Branch | `cursor/project-codespace-compatibility-b14c` |
| Immutable candidate source SHA | `b8164e178126dc8c8943b165e1f95a06d47bb9a5` |
| Evidence packaging commit | This documentation-only commit; resolve with `git log -1 --format=%H` after checkout |
| Production scope | Procurement only |
| GitHub workflow | **Playwright Release Gate** (`.github/workflows/playwright-release-gate.yml`) |
| Workflow run | [Run 29383670960](https://github.com/Mqhele-dot/ISSSourcing/actions/runs/29383670960) |
| Workflow conclusion | `success` |
| PR merge SHA tested by GitHub | `545ffce7c71dab15f0469674383e699ebe719874` (incorporates candidate source SHA) |
| Evidence recorded | 2026-07-15, Africa/Johannesburg (UTC+02:00) |
| Human approval | Pending release owner, database/operations owner, and security/technical approver |

## Approved Boundary

The candidate boundary is:

`Master Data -> Supplier onboarding -> Requisition -> Approval -> RFQ and quotes -> Evaluation -> Award -> Purchase Order -> Contract oversight`

Approved modules are the tenant administration needed for procurement, governed Master Data, supplier onboarding and portal mapping, requisitions and approvals, sourcing/RFQ events, structured supplier quotes, evaluations, independent award approval, award-to-PO conversion, controlled PO dispatch, contract oversight, and procurement-scoped reporting.

## Excluded Modules

| Module or route group | Production status |
|---|---|
| Inventory mutations, warehouse stock, cycle counts, and transfers | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Receiving and GRN operations | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Logistics, shipments, and operational exceptions | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Mobile receiving, counts, scanning, and synchronization | `FEATURE_NOT_PRODUCTION_APPROVED` |
| AP, invoices, billing execution, payments, and payment control | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Direct bank payment initiation | Outside product scope |

Development/test environments may expose these modules for controlled verification. That does not grant production approval. The generated audit records 33 procurement-release route exclusions.

## Command Results

All local results below were produced from clean source SHA `b8164e178126dc8c8943b165e1f95a06d47bb9a5` on Windows in the repository workspace. The final secure run completed at 2026-07-15 04:32 SAST.

| Command | Result | Evidence |
|---|---|---|
| `npm run check` | Passed | Included in exact-SHA `verify:release:secure`; TypeScript completed without errors |
| `npm run lint` | Passed | Included in exact-SHA `verify:release:secure` |
| `npm run build` | Passed | Vite transformed 3,635 modules; server build completed with the documented Windows OneDrive fallback |
| `npm run test:commercial-procurement-foundation` | Passed | 23 controls, including fail-closed tenancy, sourcing controls, production boundary, and approved-award conversion visibility |
| `npm run test:sourcing-workflow` | Passed | Tenant-scoped event, mapped quote, weighted evaluation, independent approval, award-to-PO conversion, and audit chain |
| `npm run test:commercial-production-boundary-runtime` | Passed | Real ephemeral HTTP server exercised production procurement scope and structured exclusions |
| `npm run test:audit-chain-integrity` | Passed | Real append/verify path, safe tamper detection, critical diagnostic, and rollback |
| `npm run test:commercial-migration-rehearsal` | Passed | Required procurement/sourcing/audit schema and 6 tenant-scoped unique indexes; no data mutation |
| `npm run audit:production` | Passed | 0 core blockers, 0 marker-level blockers, 33 explicit procurement exclusions |
| `npm run verify:release` | Passed | Full non-browser release and live delta suite |
| `npm run verify:release:secure` | Passed | Exact source SHA; 462.5 seconds; release plus manifest, lifecycle, SBOM, registry-signature, and high-vulnerability gates |

Expected AP negative-path error messages appeared while the release tests proved that unmatched or disputed invoices cannot be approved or batched. Those assertions passed and the secure command exited 0; they do not expand AP into the production boundary.

## GitHub Evidence

| Required check | Result | Reference |
|---|---|---|
| Playwright Release Gate | Passed | [Run 29383670960](https://github.com/Mqhele-dot/ISSSourcing/actions/runs/29383670960) |
| CI | Passed | [Run 29383670968](https://github.com/Mqhele-dot/ISSSourcing/actions/runs/29383670968) |
| Codespaces Compatibility | Passed | [Run 29383670958](https://github.com/Mqhele-dot/ISSSourcing/actions/runs/29383670958) |
| Security supply chain | Passed | [Run 29383670961](https://github.com/Mqhele-dot/ISSSourcing/actions/runs/29383670961) |
| Outstanding required check failures | None observed for the candidate source head | GitHub commit workflow results reviewed 2026-07-15 |

The Playwright workflow passed package/base verification, disposable database initialization, commercial migration rehearsal, backup/restore rehearsal, production build, Chromium installation, the formal E2E gate, and sourcing browser proof. The browser suites reported 20 passing tests in total, including the final supplier quote -> evaluation -> independent approval -> award-to-PO journey.

GitHub `pull_request` workflows check the generated PR merge commit. Run 29383670960 checked `545ffce7c71dab15f0469674383e699ebe719874`, whose merge message records source head `b8164e178126dc8c8943b165e1f95a06d47bb9a5`. The source head independently passed the full local secure gate.

## Migration And Recovery Evidence

| Rehearsal | Result | Evidence |
|---|---|---|
| Commercial schema preflight | Passed | Playwright run 29383670960 and local release gate |
| Sourcing and audit-chain columns | Passed | Workflow log: required columns present |
| Tenant-scoped unique indexes | Passed | 6 required indexes verified |
| Destructive DDL scan | Passed | 1 `DROP NOT NULL` constraint relaxation reported separately; no unapproved destructive data operation |
| Custom-format PostgreSQL backup | Passed | Disposable `invtrack_e2e_gate` source |
| Isolated restore | Passed | Disposable `invtrack_restore_rehearsal` target |
| Restored schema/count/audit verification | Passed | `test:backup-restore-rehearsal` completed successfully |
| Human recovery sign-off | Pending | Release owner, database/operations owner, security/technical approver |

## Audit And Security Evidence

| Control | Result |
|---|---|
| Valid audit chain accepted | Passed |
| Modified in-memory event rejected | Passed |
| First broken event identified | Passed |
| Critical security diagnostic recorded | Passed |
| Test-owned database records rolled back | Passed |
| Package manifests clean | Passed |
| Lifecycle/SBOM/signature controls | Passed |
| High-severity npm audit gate | Passed |
| Critical/high unresolved release findings | None reported by required candidate gates |

## Blocker Accounting

| Category | Candidate result |
|---|---:|
| Core blocking risks | 0 |
| Marker-level blockers | 0 |
| Procurement-release exclusions | 33 routes, explicit and runtime-gated |
| Required GitHub check failures | 0 |
| Human production sign-offs | 3 pending |

## Final Decision

The immutable source is a **commercial-procurement production approval candidate**. It is not `APPROVED` until the release owner, database/operations owner, and security/technical approver sign off. It is never evidence of full-suite ERP production readiness, and excluded operational/finance areas remain server-gated.

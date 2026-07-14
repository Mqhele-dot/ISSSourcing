# Commercial Procurement Release Evidence

## Release Decision

**Current decision: BLOCKED pending immutable candidate verification.**

This evidence pack applies only to the commercial procurement boundary. It does not approve the full ERP suite or promote receiving, inventory operations, logistics, mobile warehouse operations, AP, payment control, or direct bank payment initiation.

| Field | Evidence |
|---|---|
| Branch | `cursor/project-codespace-compatibility-b14c` |
| Candidate source SHA | `PENDING_SOURCE_COMMIT` |
| Evidence packaging SHA | `PENDING_EVIDENCE_COMMIT` |
| Production scope | Procurement only |
| GitHub workflow | **Playwright Release Gate** (`.github/workflows/playwright-release-gate.yml`) |
| Workflow run | Pending |
| Workflow conclusion | Pending |
| Final approver decision | Pending human release approval |

## Approved Boundary

The candidate boundary is:

`Master Data -> Supplier onboarding -> Requisition -> Approval -> RFQ and quotes -> Evaluation -> Award -> Purchase Order -> Contract oversight`

Approved modules are tenant administration required for procurement, governed Master Data, supplier onboarding and portal mapping, requisitions and approvals, sourcing events and RFQs, structured supplier quotes, evaluations, awards, purchase orders, contract oversight, and procurement-scoped reporting.

## Excluded Modules

| Module or route group | Release status |
|---|---|
| Inventory mutations, warehouse stock, cycle counts, and transfers | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Receiving and GRN operations | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Logistics, shipments, and operational exceptions | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Mobile receiving, counts, scanning, and sync | `FEATURE_NOT_PRODUCTION_APPROVED` |
| AP, invoices, billing execution, payments, and payment control | `FEATURE_NOT_PRODUCTION_APPROVED` |
| Direct bank payment initiation | Outside product scope |

Development and test environments may expose excluded modules for controlled verification. That preview behavior is not production approval.

## Runtime And Release Results

Record results against the candidate source SHA. A pass from another SHA is not release evidence.

| Command | Result | Environment | Evidence/notes |
|---|---|---|---|
| `npm run check` | Passed | Local, 2026-07-14 | TypeScript gate |
| `npm run lint` | Passed | Local, 2026-07-14 | ESLint gate |
| `npm run build` | Passed | Local, 2026-07-14 | Production client/server build |
| `npm run test:commercial-procurement-foundation` | Passed, 22 controls | Local, 2026-07-14 | Tenant, sourcing, country pack, control, and UI source contracts |
| `npm run test:sourcing-workflow` | Passed | Local live API, 2026-07-14 | RFQ through approved award-to-PO workflow |
| `npm run test:commercial-production-boundary-runtime` | Passed | Local, 2026-07-14 | Production-mode procurement boundary over HTTP |
| `npm run test:audit-chain-integrity` | Passed | Local PostgreSQL, 2026-07-14 | Append, verify, tamper detection, critical diagnostic, rollback |
| `npm run test:commercial-migration-rehearsal` | Passed | Local PostgreSQL, 2026-07-14 | Read-only schema and migration preflight; 21 required tables and 6 tenant unique indexes verified |
| `npm run audit:production` | Passed | Local, 2026-07-14 | 0 core blockers, 0 marker blockers, 33 intentional procurement exclusions |
| `npm run verify:release` | Passed | Local, 2026-07-14 | Full non-browser release gate, including live delta suite |
| `npm run verify:release:secure` | Pending candidate commit | Local | Release portion passed; manifest guard correctly requires the package script changes to be committed before secure evidence is valid |
| `npm run test:backup-restore-rehearsal` | Pending | GitHub disposable PostgreSQL | Custom dump, isolated restore, schema/count/audit verification |
| `npm run verify:release:e2e` | Pending | GitHub Actions | Includes sourcing browser workflow |

## Security Evidence

The secure gate must confirm package-manifest cleanliness, lifecycle policy, SBOM generation, registry-signature verification, and zero unresolved high-severity npm audit findings. A passing Playwright run does not override failed dependency review, supply-chain, branch-protection, or other required CI checks.

| Check | Result | Reference |
|---|---|---|
| `npm run verify:release:secure` | Pending candidate commit | Candidate command output |
| GitHub required CI checks | Pending | Candidate commit checks |
| Critical/high unresolved findings | Pending | Secure gate and repository security checks |

## Migration And Recovery Evidence

| Rehearsal | Result | Reference |
|---|---|---|
| Commercial schema preflight | Passed locally | `npm run test:commercial-migration-rehearsal` |
| Destructive DDL scan | Passed locally | Same command; one `DROP NOT NULL` constraint relaxation reported separately |
| Backup and isolated restore | Pending | `npm run test:backup-restore-rehearsal` in Playwright Release Gate |
| Restored audit-chain verification | Pending | Backup/restore workflow output |
| Human recovery sign-off | Pending | Release owner, database/operations owner, security/technical approver |

## Audit Integrity Evidence

The integrity test must create test-owned events inside a transaction, verify the real chain, detect a safely simulated tamper, emit the same critical diagnostic used by the scheduled monitor, and roll back all database changes.

| Check | Result |
|---|---|
| Valid chain accepted | Passed locally |
| Modified event rejected | Passed locally |
| First broken event identified | Passed locally |
| Critical security diagnostic recorded | Passed locally |
| Test records rolled back | Passed locally |

## Blocker Accounting

| Category | Required result | Candidate result |
|---|---:|---:|
| Core blocking risks | 0 | 0 |
| Marker-level blockers | 0 | 0 |
| Procurement-release exclusions | Explicit and gated | 33 routes; runtime boundary passed locally |
| Required GitHub checks | Green | Pending |

## Final Decision Rule

- Set `BLOCKED` when any mandatory local gate, GitHub check, Playwright sourcing test, migration rehearsal, backup/restore rehearsal, audit-chain check, or security gate is absent or failed.
- Set `CANDIDATE` only when all evidence is green for the exact candidate source SHA and the only remaining step is human production approval.
- Set `APPROVED` only after the named human approvers sign the release. This status still applies only to the procurement boundary.

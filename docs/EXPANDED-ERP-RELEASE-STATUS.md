# Expanded ERP Release Status

## Branch Decision

**Current branch status: EXPANDED HARDENING - BLOCKED FOR PRODUCTION APPROVAL.**

The historical procurement-only candidate is preserved at `b8164e178126dc8c8943b165e1f95a06d47bb9a5`. Its evidence does not transfer to the current branch head.

## Status Definitions

| Status | Meaning |
|---|---|
| Approved historical procurement candidate | Immutable procurement-only SHA reached candidate review; this is historical, not inherited. |
| Workflow-backed | Core API/database behavior is proven, but at least one isolation, security, audit, or browser evidence class remains. |
| Evidence incomplete | Implementation exists, but repeatable release evidence is missing or partial. |
| Blocked | Known production blocker or missing mandatory evidence prevents promotion. |
| Explicitly excluded | Outside the approved release scope and fail-closed in production. |

## Current Matrix

| Module | Historical procurement SHA | Current expanded branch | Runtime | Tenant isolation | Permission/security | Audit | Browser | Production gate |
|---|---|---|---|---|---|---|---|---|
| Tenant and membership foundation | Approved historical procurement candidate | Workflow-backed | Present | Present for procurement paths | Present | Present | Partial | Evidence incomplete |
| Master Data and supplier onboarding | Approved historical procurement candidate | Workflow-backed | Present | Partial expanded-domain proof | Present | Present | Partial | Evidence incomplete |
| Requisitions and approvals | Approved historical procurement candidate | Workflow-backed | Present, including manual lines | Partial expanded proof | Present | Present | Partial | Evidence incomplete |
| Sourcing, RFQ, quotes, awards | Approved historical procurement candidate | Workflow-backed | Present | Present for supplier mapping | Present | Present | Historical browser proof | Evidence incomplete at current SHA |
| Purchase orders and contracts | Approved historical procurement candidate | Workflow-backed | Present | Partial expanded proof | Present | Present | Partial | Evidence incomplete |
| Reports and analytics | Procurement reports only | Evidence incomplete | Wave 7A runtime proof | Missing complete dataset matrix | Partial | Failure evidence present | Missing current browser proof | Blocked |
| Diagnostics | Supporting evidence only | Evidence incomplete | Wave 7A workspace proof | Partial | Admin-only and redacted | Partial | Source-contract only | Blocked |
| Inventory operations | Explicitly excluded | Workflow-backed | Existing workflow proof | Incomplete | Incomplete | Partial | Partial | Blocked |
| Receiving and GRN | Explicitly excluded | Workflow-backed | Existing PO-to-GRN proof | Incomplete | Partial | Present | Partial | Blocked |
| Logistics and exceptions | Explicitly excluded | Blocked | Incomplete | Incomplete | Incomplete | Incomplete | Incomplete | Blocked |
| AP and invoices | Explicitly excluded | Workflow-backed | Existing match/payment-control proof | Incomplete | Partial | Present | Partial | Blocked |
| Payment control | Explicitly excluded | Blocked | Partial approval-ready proof | Incomplete | Partial | Partial | Partial | Explicitly excludes direct bank execution |
| Notifications | Explicitly excluded | Evidence incomplete | Partial | Incomplete | Partial | Partial | Incomplete | Blocked |
| Mobile warehouse operations | Explicitly excluded | Blocked | Partial count/receive foundation | Incomplete | Incomplete | Partial | Incomplete | Blocked |
| Setup and onboarding | Procurement setup only | Evidence incomplete | Partial | Partial | Partial | Partial | Partial | Blocked |

## Required Gates

- `npm run prerelease:gate:delta` protects database safety, data hygiene, and high-volume behavior.
- `npm run release:gate:delta` includes the stable Wave 7A runtime suites.
- `npm run verify:release` is the non-browser gate.
- `npm run verify:release:e2e` is the browser gate.
- `npm run verify:release:secure` is the supply-chain and release gate.

Passing an individual command does not change the branch decision. Promotion requires all module evidence in [EXPANDED-ERP-RELEASE-ROADMAP.md](./EXPANDED-ERP-RELEASE-ROADMAP.md) and an immutable evidence pack.

## Wave 7A Verification Record

The Wave 7A implementation was committed in `bfbbb12`, dependency remediation in `0965438`, and the final tested code state in `ad63e0d`. These commits strengthen the expanded branch but do not replace or amend the immutable procurement-only candidate at `b8164e178126dc8c8943b165e1f95a06d47bb9a5`.

| Evidence | Result | Scope |
|---|---|---|
| `npm run check` | Passed | TypeScript contracts for the expanded source state. |
| `npm run lint` | Passed | ESLint 10 and TypeScript ESLint completed without errors. |
| `npm run build` | Passed | Client and server production builds completed. |
| `npm run prerelease:gate:delta` | Passed | Disposable-database enforcement, fixture hygiene, and large-data contracts. |
| `npm run test:manual-procurement-lines-runtime` | Passed | Catalogue, non-stock, and service lines through conversion and AP line linkage. |
| `npm run test:procurement-reporting-runtime` | Passed | Line-level rows, no-line quality rows, paginated preview, download-token renewal, and export diagnostics. |
| `npm run test:approval-policy-runtime-hardening` | Passed | Conflict detection, safe legacy correction/deactivation, stale versions, tenant isolation, and audit history. |
| `npm run test:diagnostics-runtime-workspaces` | Passed | Distinct diagnostic workspaces, safe probes, finding classification, and affected-module summaries. |
| `npm run audit:production` | Passed as an audit command | Inspected 80 routes, 426 endpoints, 121 tables, and 611 classified source markers. This is inventory evidence, not production approval. |
| `npm run verify:release` | Passed | Full non-browser release gate. |
| `npm run verify:release:secure` | Passed | Release gate plus manifest, lifecycle, SBOM, registry-signature, attestation, and vulnerability checks. Audit reported 0 vulnerabilities; 1,052 signatures and 128 attestations were verified. |
| Expanded browser and module evidence | Outstanding | Current-SHA E2E evidence and complete expanded-module tenant/permission/audit proof remain required. |

**Decision after Wave 7A: EXPANDED HARDENING - BLOCKED.** The branch is buildable and its stable non-browser gates pass, but it is not an expanded ERP production candidate.

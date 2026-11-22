# ISSSourcing Modern Procurement Programme

Programme established from the user's instructions on 2026-11-02. These control files did not exist when requested; the older audit is dated supporting evidence, not current release sign-off.

## Dependency order

1. Supplier 360
2. Contract Obligations
3. Maverick Spend
4. Smart Procurement Intake
5. Role-level Segregation-of-Duties Analysis
6. Payment Risk Engine
7. Spend Cube
8. Procurement Savings Tracking
9. TCO / Should-Cost
10. AP Invoice Ingestion

Reuse supplier, contract, requisition, PO, sourcing, AP, financial-measure, workflow, Action Inbox, notification, audit, exception, document and RBAC authorities. Never create a parallel register or trust client-calculated financial/approval values.

## Definition of done

For each capability: audit executable source; document gaps; implement complete vertical slices; add tests; run focused runtime and affected regression tests; fix failures; update STATUS and NEXT. UI presence or test-file presence is not implementation verification.

Completion requires tenant-scoped bounded APIs, appropriate permissions, governed posting with idempotency/audit, immutable/versioned evidence where history depends on it, connected production UI, failure/empty/denied states, desktop and 390px runtime evidence, and applicable migration/type/lint/build/security gates. Keep implementation, enablement and verification separate. Later capabilities must not be rolled out around incomplete dependencies.

Use disposable databases and mock delivery for mutations. No local business migrations, data reconstruction, external messages, payments, business-data cleanup or automatic commits. Remove only exact test-owned resources after ownership/process checks; retain verification artifacts. Production/destructive actions and local business migrations need separate explicit approval. Provider configuration is separate from adapter completion. AI cannot approve, bank-maintain or post transactions.

Continue safe atomic slices without routine engineering questions. Before a context-boundary stop, finish or roll back the current slice, run its important test, and record exact remaining files/commands and failures in NEXT.

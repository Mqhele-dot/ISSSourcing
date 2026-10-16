# Data Hygiene And Test Isolation

## Current State

The application database contains a large number of records created by historical runtime, release-gate, RBAC, AP, sourcing, and MDM tests. These records make operational lists noisy and can create false approval-policy overlaps, misleading low-stock counts, duplicate notifications, and slow selectors.

No automated purge is allowed against the application database. The fixture tool defaults to a read-only audit and follows foreign-key dependencies so operators can review the complete deletion graph before any change.

## Audit And Purge

Run a dry audit:

```powershell
npm run data:fixture-audit -- --output=tmp/fixture-data-audit.json
```

Review the JSON report and confirm every direct fixture pattern and dependent row belongs to automated tests. Then create and verify a PostgreSQL backup. Only after that review may an operator run:

```powershell
npm run data:fixture-purge -- --backup-file="C:\backups\isssourcing-before-fixture-purge.dump" --confirm=targeted-test-fixtures --output=tmp/fixture-data-purge.json
```

The purge is transactional, requires a real non-empty backup file, requires the exact confirmation phrase, and produces a JSON deletion report. Seeded and manual records are preserved unless they match a conclusive fixture identity and are included in the reviewed graph.

## Test Database Rule

All runtime, integration, release-gate, and browser suites that mutate data must use a disposable PostgreSQL database through `TEST_DATABASE_URL`. Accepted database names contain `test`, `testing`, `ci`, `rehearsal`, `temp`, or `tmp`; names containing `prod`, `production`, or `live` are always rejected.

```powershell
set TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/isssourcing_test
npm run test:local:delta
```

The local runner passes the disposable URL to the server and tests. Before any shared HTTP helper sends a mutating request, it checks `/api/ready` for a server-issued `X-Test-Database-Mode: disposable` handshake. A test cannot mutate the normal app merely by setting an environment variable in the test process.

Read-only rendering, lint, type, build, and source-contract tests do not require a database. The normal application database must never be used as a convenient replacement for a missing test database.

## Ownership

- Release owner reviews the fixture audit and authorizes the maintenance window.
- Database/operations owner creates and validates the backup and restore path.
- Technical owner confirms the disposable test database configuration in local and CI runners.
- The purge report and backup reference are retained with the release evidence.

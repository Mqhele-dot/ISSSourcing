# PostgreSQL Backup And Restore Rehearsal

## Purpose

This rehearsal proves that the commercial procurement candidate can be backed up and restored without touching a production or staging database. The automated release rehearsal uses a disposable PostgreSQL database whose name ends in `_restore_rehearsal`.

## Safety Rules

- Never use the same URL for source and target.
- Never use a production or staging database as the target.
- Keep the default remote-target guard enabled. Remote targets require an explicit operator override.
- Verify the target database name before permitting terminate, drop, or create operations.
- The source database is read only for the duration of the dump.
- Delete the temporary dump and disposable target after validation.
- Retain the GitHub workflow logs and evidence summary, not the rehearsal dump.

## Operator Commands

Linux/macOS:

```bash
export BACKUP_RESTORE_SOURCE_URL="postgresql://USER:PASSWORD@HOST:5432/source_db"
export BACKUP_RESTORE_TARGET_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/invtrack_restore_rehearsal"
npm run test:backup-restore-rehearsal
```

Windows PowerShell:

```powershell
$env:BACKUP_RESTORE_SOURCE_URL = "postgresql://USER:PASSWORD@HOST:5432/source_db"
$env:BACKUP_RESTORE_TARGET_URL = "postgresql://USER:PASSWORD@127.0.0.1:5432/invtrack_restore_rehearsal"
npm run test:backup-restore-rehearsal
```

Equivalent manual dump and restore commands:

```bash
pg_dump --format=custom --no-owner --no-privileges --file isssourcing.dump "$BACKUP_RESTORE_SOURCE_URL"
createdb --maintenance-db="$BACKUP_RESTORE_TARGET_URL" invtrack_restore_rehearsal
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$BACKUP_RESTORE_TARGET_URL" isssourcing.dump
```

Use the automated command for release evidence because it validates target safety, schema, counts, and audit integrity consistently.

## Recovery Order

1. Declare the recovery incident and freeze application writes.
2. Identify the approved backup and verify its checksum and retention metadata.
3. Restore PostgreSQL into an isolated validation environment.
4. Verify required commercial tables, row counts, tenant membership, sourcing records, and audit chains.
5. Restore managed document/export storage referenced by database records.
6. Rotate credentials if compromise is suspected.
7. Point the application at the validated recovery database during an approved maintenance window.
8. Run readiness, authentication, procurement workflow, audit integrity, and release-boundary checks.
9. Obtain sign-off before reopening writes.

## Minimum Acceptance Criteria

- `pg_dump` and `pg_restore` complete without error.
- All required procurement, sourcing, membership, and audit tables exist after restore.
- Critical source and target row counts match.
- Every active organization audit chain verifies successfully.
- Tenant memberships and supplier portal mappings retain organization isolation.
- The procurement-only production boundary remains active after startup.
- No source records are changed by the rehearsal.
- The temporary dump and disposable target are removed after validation.

## Required Sign-Off

| Role | Responsibility | Sign-off |
|---|---|---|
| Release owner | Confirms candidate SHA, release scope, and evidence completeness | Pending |
| Database/operations owner | Confirms dump, restore, counts, recovery order, and retention | Pending |
| Security/technical approver | Confirms tenant isolation, audit integrity, secrets handling, and security gates | Pending |

Production approval is blocked until all three roles sign the release record.


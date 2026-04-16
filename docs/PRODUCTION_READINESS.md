# Production Readiness

## Severity-Based Changelog

### Critical

- Added central environment validation in `server/config/env.ts` and made production fail fast when `DATABASE_URL` or a safe `SESSION_SECRET` is missing.
- Removed production reliance on startup schema mutation by gating bootstrap behavior to non-production profiles in `server/index.ts`.
- Re-enabled CSRF protection for state-changing API routes and added `/api/csrf-token` client/test integration.

### High

- Added secure HTTP middleware with Helmet, production HSTS, request size limits, and expanded rate limiting for auth, exports, analytics, and uploads.
- Replaced export request/response flow with queued export jobs, governed downloads, retry support, retention metadata, and a background worker.
- Locked down previously open analytics, barcode, stock movement, image-recognition, and document-extractor routes.

### Medium

- Replaced response-body logging with structured request metadata and added in-memory metrics plus build metadata on health/readiness surfaces.
- Added release-gate automation, CI Playwright browser installation, smoke coverage, and production deployment examples.
- Added governed export cleanup and direct `/uploads` static access shutdown in production.

## Completed Controls

- Central env/runtime profile resolution
- Production secret enforcement
- CSRF token endpoint and client/test usage
- Secure headers and request limits
- Expanded rate limiting
- Structured logger and request metrics
- Build metadata in readiness and logs
- Production startup split from dev bootstrap
- Export jobs, retry, download governance, and retention cleanup
- Permission matrix and org-isolation coverage expansion
- Docker production example and CI release gate

## Remaining Risks

- Existing legacy DDL bootstrap modules still exist for local/dev convenience and should eventually be replaced with checked-in SQL migrations.
- Core release-path route groups now use normalized permission middleware; a few auxiliary modules still use role-based guards until the permission registry is expanded further.
- Metrics are currently in-memory and should move to Prometheus/OpenTelemetry before high-scale production use.

## UI readiness banner vs `/api/ready`

The **web app** polls **`GET /api/ready`** and shows a **red “Limited mode”** banner only when critical subsystems needed for most workflows are down: **`dbReady`**, **`schemaReady`**, **`sessionStoreReady`**, and **`uploadPathReady`**.

The **same JSON** also includes **`websocketReady`** and **`emailServiceReady`**. Those are **not** surfaced as blocking errors in the banner today; some features may degrade (live updates, outbound mail) while the rest of the app works.

**Production gate:** Treat **`npm run release:gate`**, the deployment checklist below, and **`/health` / `/ready` / `/health/deep`** probes as the **authoritative** installability checks. The UI banner is a **developer/operator hint**, not a substitute for monitoring or release automation.

For first-run / packaged installs later, reuse the same `/api/ready` contract and extend the client only if you need to show optional warnings (e.g. websocket) or a dedicated onboarding flow.

## Deployment Checklist

1. Set `NODE_ENV=production`, `DATABASE_URL`, and a strong `SESSION_SECRET`.
2. Run migrations before app startup.
3. Confirm reverse proxy forwards `X-Forwarded-Proto` and terminates TLS.
4. Verify `/health`, `/ready`, and `/health/deep` after deploy.
5. Confirm export retention expectations and storage volume sizing.

## Security Checklist

1. Do not expose `/uploads` directly in production.
2. Rotate `SESSION_SECRET` and any third-party API credentials through your secret manager.
3. Keep TLS termination in front of the app and preserve forwarded proto headers.
4. Review rate-limit thresholds before exposing public auth surfaces.

## Backup and Restore Notes

- Back up PostgreSQL and the export storage volume together.
- Restore database first, then restore export files if you want historical downloads to remain valid.
- Expired export files may be safely omitted during restore.

## Migration Workflow

1. Apply database migrations.
2. Start the application.
3. Confirm `/ready` reports `dbReady`, `schemaReady`, and `sessionStoreReady`.
4. Run `npm run release:gate` against the target environment when feasible.

## Export Retention Policy

- Export jobs receive scoped download tokens and retention timestamps.
- Files are retained for `EXPORT_RETENTION_DAYS` and then cleaned up by the export worker.
- Downloads require authentication, organization match, and a valid scoped token.

## Operational Runbook

- Use `/health` for liveness and `/health/deep` for readiness diagnostics.
- Use `/metrics` for the in-memory request/export/AP counters added in this hardening pass.
- Inspect structured logs for `requestId`, `route`, `status`, `orgId`, and `userId`.

## Rollback Notes

- Revert the deployment and database change together if export job schema changes are involved.
- If export job processing is degraded, queued jobs remain durable in `export_jobs` and can be retried after rollback or forward fix.

# AI Dependency Safety Checklist

Use this before merging AI-assisted prompts that touched dependencies, auth, infra, or data paths.

## 1. Dependencies

1. **No new npm package** without business justification documented in the PR description.
2. **Prefer existing** dependencies from `package.json`; search the repo before adding equivalents.
3. **Verify externally** package name spelling, publisher, approximate age, downloads, license, upstream repo URL, recent advisories, and install hooks.
4. **Never install** hallucinated packages without confirming they exist on the approved registry with `npm view <name> version`.
5. **Lifecycle scripts:** any new package with hooks must appear in [`scripts/list-lifecycle-scripts.mjs`](../../scripts/list-lifecycle-scripts.mjs) with rationale, or lifecycle audit must intentionally fail for review.
6. All lockfile merges must succeed with `npm ci` and pass Dependency Review plus supply-chain workflows.

## 2. Mandatory Human Review

Require human review for changes touching:

- Authentication, sessions, CSRF, SSO, Passport strategies
- Roles, RBAC, or permission matrices
- Payments, Stripe/AP batch release, or segregation-of-duties paths
- SQL, Drizzle schemas, migrations, or raw SQL escapes
- File uploads, Cloudinary, document extractors, or PDF parsing
- Admin-only routes and diagnostics exports
- `package.json`, `package-lock.json`, GitHub workflows, `Dockerfile`, or Compose
- `.env*` examples only; secrets must never be checked in

## 3. Automated Gates

- `npm run check`, `npm run build`, `npm run verify:release`, and `npm run release:gate:delta` must remain green unless the release policy is explicitly changed.
- `security:supply-chain` mirrors CI semantics; `npm audit --audit-level=high` must stay at 0 high / 0 critical.
- Track any moderate audit tail in [`audit-remediation-backlog.md`](./audit-remediation-backlog.md) instead of downgrading gate severity.

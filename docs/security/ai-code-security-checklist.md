# AI / “vibe coding” dependency safety checklist

Use this before merging AI-assisted prompts that touched dependencies, auth, infra, or data paths.

## 1. Dependencies

1. **No new npm package** without business justification documented in PR description.
2. **Prefer existing** dependencies (`package.json`). Search the repo before adding equivalents.
3. **Verify externally** package name spelling, publisher, approximate age, downloads, license, upstream repo URL, recent security advisories, and **`hasInstallScript` / risky install hooks** (`npm info <pkg> scripts` preview if uncertain).
4. **Never install** hallucinated packages without confirming they exist on the approved registry (`npm view <name> version`).
5. **Lifecycle scripts:** any new package with hooks must appear in **[`scripts/list-lifecycle-scripts.mjs`](../../scripts/list-lifecycle-scripts.mjs)** allowlist with rationale *or* lifecycle audit must intentionally fail forcing review (`--enforce`).
6. All lockfile merges must succeed **`npm ci`** and pass **Dependency Review** + supply-chain workflows.

## 2. Mandatory human review (no bot-only merges)

Touches to any of:

- Authentication, sessions, CSRF, SSO, Passport strategies
- Roles / RBAC / permissions matrices
- Payments, Stripe/AP batch release, segregation-of-duties paths
- SQL / Drizzle schemas / migrations / raw `$executeRaw`-style escapes
- File uploads (`multer`), Cloudinary, document extractors, PDF parsing
- Admin-only routes (`/api/...`), diagnostics exports
- **`package.json` / `package-lock.json`**, GitHub workflows, **`Dockerfile`** / Compose
- **`/.env*`** examples only (secrets never checked in—verify)

## 3. Automated gates to respect

- `npm run check`, `npm run build`, **`npm run verify:release`** and **`npm run release:gate:delta`** must remain green unless scope explicitly adjusts release policy.
- `security:supply-chain` (local) mirrors CI semantics; **`npm audit --audit-level=high`** currently reports findings—do not downgrade severity without upgrade path tracked.

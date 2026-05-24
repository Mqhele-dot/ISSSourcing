# npm audit remediation backlog (high / critical focus)

Rolling inventory for **`npm audit --audit-level=high`**. Goal: shrink high/critical count with **semver-safe bumps** (no blind `audit fix --force`), document reachable surfaces, and track **electron / native / builder** blast radius separately.

Related: [**Electron / desktop posture**](./electron-desktop-strategy.md) · [**Security verification**](SECURITY_VERIFICATION_RESULTS.md) · [**CSP notes**](./CSP_AND_FRONTEND_NOTES.md).

## How to regenerate evidence

Run from repo root (Node/npm current LTS aligns with CI Node 22):

```bash
npm audit --audit-level=high --json > /tmp/npm-audit-high.json   # omit --json for human-readable
```

Prefer **never committing** raw JSON blobs; summarize counts below and link to SBOM/uploaded CI artifacts (`security-supply-chain` workflow uploads CycloneDX when configured).

---

## Baseline snapshot (before this wave — lockfile-era)

Captured from a local **`npm audit --audit-level=high --json`** export (inventory only; file not tracked). Metadata at that moment:

| Metric | Value |
|--------|-------|
| **Total** vuln buckets (npm aggregate) | 56 |
| Low | 8 |
| Moderate | 19 |
| High | 28 |
| Critical | 1 |

**Direct** npm dependencies implicated at **high+** included: `cloudinary`, `drizzle-orm`, `electron`, `electron-builder`, `express`, **`multer-storage-cloudinary`** (dependency removed in favor of inline Multer→Cloudinary stream upload), `nodemailer`, `sqlite3`.

Representative advisory references (subset): **GHSA-gpj5-g38j-94v9** (drizzle-orm — fix **≥ 0.45.2**), **GHSA-g4mf-96x5-5m2c** / range **≥ 2.7.0** (cloudinary), **GHSA-mm7p-fcc7-pg87** / nodemailer line (audit recommended **≥ 8.0.5**), **critical** transitive **form-data** chain (**GHSA-fjxv-7rqg-78g4**).

Larger transitive clusters (**tar**, **node-gyp**, **@electron/*** rebuild stack, rollup, lodash, axios, etc.) overwhelmingly track **Electron / installer / toolchain** edges—see Electron strategy doc.

---

## Grouping: direct vs transitive (high+, representative)

Paths are indicative of where code or runtime usually touches the graph.

| Package | Relationship | Severity (npm) | Typical reach | Notes / remediation cue |
|---------|---------------|----------------|---------------|--------------------------|
| `express` | direct | high | Hosted API | Bump **4.x** line past vulnerable range (**≥ 4.22.x**) |
| `drizzle-orm` | direct | high | Server DB layer | Bump **≥ 0.45.2** (`drizzle-zod` accepts `drizzle-orm >= 0.36`) |
| `nodemailer` | direct | high | Server email | Bump **≥ 8.0.5** |
| `cloudinary` | direct | high | Hosted uploads (`server/services/cloudinary-service.ts`) | Bump **≥ 2.7.0** |
| ~~`multer-storage-cloudinary`~~ | ~~direct~~ removed | ~~high~~ | Inline storage engine | Removed; custom `Multer.StorageEngine` + `upload_stream` |
| `sqlite3` | direct | high | Electron local DB (`electron/database-service.js`) | **Major 6.x** fixes line where 5.x is capped |
| `electron` | direct | high | Desktop shell | Raised to **Electron 40+** (beyond **≤39.8.4** advisory window) |
| `electron-builder` | direct | high | Packaging | Raised to **≥ 26.8.x** aligned with patched `app-builder-lib` trains |
| `path-to-regexp` | transitive (`express`) | high | Hosted routing | Resolved by patched `express` |
| `@electron/node-gyp`, `@electron/rebuild`, `app-builder-lib`, `dmg-builder` | transitive | high | Electron build | Driven by Electron + electron-builder upgrades |
| `form-data` | transitive | critical | Tooling edges | Resolved when upstream publishes fixed ranges (watch audit after bumps) |

---

## Operational verification backlog

| Command | Automation | Owner note |
|---------|-------------|------------|
| `npm run check` · `npm run build` | CI **`ci`** job | Blocking on every PR |
| `npm run test:rbac`, `migrate:check`-style guards | Periodic / selective | CI org-api isolation + migrations job where present |
| `npm run verify:release` · `npm run release:gate:delta` | **`release-gate`-class job** — **infra-dependent** | Needs seeded Postgres + app up; replicate CI-style env |

After **material dependency moves** (Electron major, sqlite3 major), run **desktop/desktop-build smoke** locally (platform matrix: Windows CI when available).

---

## After upgrades (maintainers)

Update **this section** whenever a remediation wave merges:

| Date | `npm audit --audit-level=high` exit | High+ count (npm metadata) | Notes |
|------|--------------------------------------|----------------------------|-------|
| **2026-05-19** (post-wave tree) | **1** (still **10 high**, **0 critical**) | 10 high | Down from **28 high + 1 critical** baseline; remaining items are mostly **transitive** chains (axios / rollup / glob stack, dev-tooling). |
| *pre-wave inventory* | — | 28 high + 1 critical | See “Baseline snapshot” above. |

---

## Success criteria reminder

Measurable drop in high/critical count with **documented before/above table** ↔ **after** rows. Preserve **`npm run verify:release`** / **`npm run release:gate:delta`** semantics unless deliberate policy change.

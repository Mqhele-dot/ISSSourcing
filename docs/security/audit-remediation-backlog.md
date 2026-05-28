# npm audit remediation backlog (high / critical focus)

Rolling inventory for **`npm audit --audit-level=high`**. Goal: shrink high/critical count with **semver-safe bumps** (no blind `audit fix --force`), document reachable surfaces, and track **electron / native / builder** blast radius separately.

Related: [**Electron / desktop posture**](./electron-desktop-strategy.md) · [**Security verification**](SECURITY_VERIFICATION_RESULTS.md) · [**CSP notes**](./CSP_AND_FRONTEND_NOTES.md).

## How to regenerate evidence

Run from repo root (CI uses **Node 24**; local dev may use Node 20+ per `engines`):

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

## minimatch@5.1.6 (Dependency Review blocker — resolved)

**Root cause (two paths):**

| Path | Chain |
|------|--------|
| Electron packaging | `electron-builder` → `app-builder-lib` → `ejs` → `jake` → **`filelist@1.0.4`** → `minimatch@5.1.6` |
| Excel exports | `exceljs` → `archiver@5` → **`readdir-glob@1.1.3`** → `minimatch@5.1.6` |

**Fix applied:** root [`package.json`](../../package.json) **`overrides`** (no new packages):

```json
"overrides": {
  "filelist": "2.0.2",
  "readdir-glob": "3.0.0",
  "tmp": "0.2.7"
}
```

Both upstream majors declare **`minimatch@^10.2.x`**, clearing **GHSA-3ppc-4f35-3m26**, **GHSA-23c5-xmqv-rm74**, **GHSA-7r86-cg39-jmmj**. Follow-up **`npm audit fix`** cleared remaining high advisories (axios, glob, rollup, etc.) without `--force`.

**Removed unused direct dep:** **`sharp`** (no runtime imports; lifecycle allowlist updated).

**2026-05-27 follow-up:** Removed deprecated `csurf` / `@types/csurf` and replaced it with session-backed CSRF validation in `server/services/security-service.ts`, clearing the `csurf -> cookie` advisory. Added a `tmp@0.2.7` override after npm registry review showed `tmp` latest as `0.2.7`, clearing the high `tmp` path traversal audit chain through Electron packaging and Excel export tooling.

---

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
| **2026-05-27** (update-audit pass) | **0** | **0 high / 0 critical** | Replaced `csurf`; added `tmp@0.2.7` override; **7** moderate remain (dev esbuild/vite chain, nested exceljs uuid). |
| **2026-05-21** (gap remediation) | **0** | **0 high / 0 critical** | `filelist`/`readdir-glob` overrides + `npm audit fix`; **9** moderate/low remain (csurf/cookie, dev esbuild/vite, exceljs uuid). |
| **2026-05-19** (post-wave tree) | **1** | 10 high | Before minimatch overrides. |
| *pre-wave inventory* | — | 28 high + 1 critical | See “Baseline snapshot” above. |

---

## Success criteria reminder

Measurable drop in high/critical count with **documented before/above table** ↔ **after** rows. Preserve **`npm run verify:release`** / **`npm run release:gate:delta`** semantics unless deliberate policy change.

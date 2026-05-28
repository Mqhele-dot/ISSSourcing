# Security verification results (manual / agent run)

## 2026-05-27 update-audit pass

Captured after replacing `csurf` with session-backed CSRF validation and pinning `tmp` to `0.2.7`.

| Command | Exit / outcome |
|---------|----------------|
| **`npm run check`** (`tsc`) | **0** |
| **`npm run lint`** | **0** (0 warnings) |
| **`npm run validate:migrations`** | **0** |
| **`npm run security:lifecycle:enforce`** | **0** |
| **`npm run test:diagnostics`** | **0** |
| **`npm run test:stabilization-client`** | **0** |
| **`npm audit --audit-level=high`** | **0** (**0 high / 0 critical**; 7 moderate remain: dev `esbuild` chain and nested `exceljs`/`uuid`) |
| **`npm audit signatures`** | **0** when run with a workspace-local npm cache; default user cache hit Windows `EPERM` on this machine |

Local **`npm run build`** was not proven in this pass because Vite/esbuild could not read the sandboxed OneDrive workspace path (`Access is denied` while loading `vite.config.ts`). Treat CI/Linux build as the authoritative build check until the local cache/path permission issue is resolved.

## Build hardening update

The build path now follows the supplied supply-chain research: CI security gates run before artifact build, package manifest drift is checked after installs, `npm audit signatures` is blocking in CI, build artifacts include `sbom.cdx.json`, and the experimental attestation workflow attests both the packed `dist` artifact and SBOM. See [`build-supply-chain-hardening.md`](./build-supply-chain-hardening.md).

Captured **2026-05-21** after security gap remediation (minimatch overrides, CI security gates, Node 24 Actions). Commands from repo root (`rest-express@1.0.0`). Root [`.npmrc`](../../.npmrc) commits **`legacy-peer-deps=true`** (documented in [`npm-registry-policy.md`](./npm-registry-policy.md)).

| Command | Exit / outcome |
|---------|----------------|
| **`npm run check`** (`tsc`) | **0** |
| **`npm run build`** | **0** (`vite build` + `esbuild` server bundle) |
| **`npm run lint`** | **0** |
| **`node scripts/list-lifecycle-scripts.mjs`** | **0** (report-only; warns outside allowlist) |
| **`npm run security:lifecycle:enforce`** | **0** (7 lockfile installers after `sharp` removal) |
| **`npm run security:sbom`** | **0** (writes `./sbom.cdx.json`; **gitignored**) |
| **`npm audit --audit-level=high`** | **0** (**0 high / 0 critical**; 9 moderate/low remain) |
| **`npm ci --ignore-scripts`** | **0** |

## Not exercised here (infra-dependent)

| Command | Reason |
|---------|--------|
| **`npm run verify:release`** | Needs seeded Postgres, long-lived **`npm run dev`**, and Playwright — run in CI **`release-gate`** job (after security merge gate). |
| **`npm run release:gate:delta`** | Requires API on **`127.0.0.1:5000`** — same CI job. |

**Dependency Review** (PR-only in [`ci.yml`](../../.github/workflows/ci.yml)) requires **dependency graph submission**; private orgs may need [**GitHub Advanced Security**](https://docs.github.com/en/code-security/getting-started/quickstart-for-github-advanced-security).

## Blocking vs report-only semantics

| Control | Behaviour |
|---------|-----------|
| **`security-supply-chain-gate`** in [`ci.yml`](../../.github/workflows/ci.yml) | **Blocking:** `npm ci --ignore-scripts`, lifecycle **`--enforce`**, **`npm audit --audit-level=high`**. |
| **`pr-security-merge-gate`** in `ci.yml` | **Blocking:** requires supply-chain gate success; on PRs also requires **Dependency Review** success. |
| **`release-gate`** in `ci.yml` | **Unchanged** semantics; **`needs: pr-security-merge-gate`** so release tests run only after security gates. |
| **Lifecycle `npm run security:lifecycle`** (no `--enforce`) | **Report-only** locally. |
| **Lifecycle `--enforce`** | **Blocking** in CI + [`security-supply-chain.yml`](../../.github/workflows/security-supply-chain.yml). |
| **`npm audit signatures`** | **Report-only** (`continue-on-error: true`) in supply-chain workflow. |
| **Artifact attestation** | Runs via **`workflow_run`** after successful supply-chain on `main`/`master`; job **`continue-on-error: true`**. |

## Remaining systemic risks

- **Moderate tail:** dev **`esbuild`/`vite`** and nested **`exceljs`/`uuid`** — documented in [`audit-remediation-backlog.md`](./audit-remediation-backlog.md); below `--audit-level=high` threshold.
- **Electron + sqlite3** — validate desktop packaging on release OS before tagging.
- **Codespaces devcontainer** still **Node 20** image; CI enforces **Node 24**.

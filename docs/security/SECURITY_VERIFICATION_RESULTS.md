# Security verification results (manual / agent run)

Captured **2026-05-19** after dependency remediation + CSP / workflow pinning work. Commands from repo root (`rest-express@1.0.0`, **Node.js 22** per CI). Root [`.npmrc`](../../.npmrc) commits **`legacy-peer-deps=true`** (documented in [`npm-registry-policy.md`](./npm-registry-policy.md)).

| Command | Exit / outcome |
|---------|----------------|
| **`npm run check`** (`tsc`) | **0** |
| **`npm run build`** | **0** (`vite build` + `esbuild` server bundle) |
| **`npm run security:lifecycle`** | **0** (8 lockfile installers; aligns with enforced allowlist) |
| **`npm run security:lifecycle:enforce`** | **0** |
| **`npm run security:sbom`** | **0** (writes `./sbom.cdx.json`; **gitignored**; CycloneDX JSON) |
| **`npm audit signatures`** | **0** (~networked registry signing check) |
| **`npm audit --audit-level=high`** | **1** (npm metadata: **31** issues total incl. **10 high**, **0 critical** — down from historical **56** incl. **28 high + 1 critical** prior to this wave) |
| **`npm ci --ignore-scripts`** | **0** (supply-chain CI parity — **developers** still need full `npm ci` for native addons) |

## Not exercised here (infra-dependent)

| Command | Reason |
|---------|--------|
| **`npm run verify:release`** | Needs seeded Postgres, long-lived **`npm run dev`**, and Playwright; mirror CI **`release-gate`** semantics in a seeded environment; track cadence alongside [`audit-remediation-backlog.md`](./audit-remediation-backlog.md). |
| **`npm run release:gate:delta`** | Portions require API up on **`127.0.0.1:5000`** (`test:smoke`, checkpoints). |

**Dependency Review** requires **dependency graph submission** enabled for the repository. **Fork** and **private** repositories may need [**GitHub Advanced Security**](https://docs.github.com/en/code-security/getting-started/quickstart-for-github-advanced-security) (or comparable org policy) plus dependency submission being turned on — otherwise the action exits without full signal.

## Blocking vs report-only semantics

| Control | Behaviour |
|---------|-----------|
| **Lifecycle `--enforce`** in `security-supply-chain.yml` | **Blocking** failure. |
| **`npm audit` / signatures** | **Report-only**: step uses **`continue-on-error: true`** with a **`GITHUB_STEP_SUMMARY`**/`::warning::` annotation when unresolved high issues remain (`security-supply-chain.yml`). |
| **Weekly schedule** (`security-supply-chain.yml`) | Runs only on **`main` / `master`** (`schedule` guard) for drift visibility. |
| **Dependency Review** (`dependency-review.yml`) | **Fails** PR introducing **high+** vulns (`fail-on-severity: high`) when graph data exists. |

## Remaining systemic risks

- **`npm audit` high tail** persists on **nested dev/build** edges (vite/rollup toolchain, transitive axios/minimatch, etc.). Track in [`audit-remediation-backlog.md`](./audit-remediation-backlog.md).
- **`npm run lint`** omitted from this rerun — unchanged expectation: CI runs `npm run lint` without `--max-warnings 0` (warnings tolerated).
- **Electron + sqlite3 majors** bumped this wave — validate **desktop packaging** on intended release OS before tagging releases.

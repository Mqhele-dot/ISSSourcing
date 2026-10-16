# Build Supply-Chain Hardening

This pass applies the supplied research report to the ISSSourcing build path.

## Implemented Controls

| Research recommendation | Project implementation |
|-------------------------|------------------------|
| Gate dependency changes before build | `build` in CI now depends on `pr-security-merge-gate`, which requires the supply-chain gate and PR dependency review where applicable. |
| Use deterministic installs | CI continues to use `npm ci`; scan-only jobs use `npm ci --ignore-scripts`. |
| Assert lockfile/manifests are not modified | [`scripts/verify-package-manifests-clean.mjs`](../../scripts/verify-package-manifests-clean.mjs) checks `package.json`, `package-lock.json`, and `.npmrc` after install. |
| Suppress lifecycle scripts in scan jobs | Security supply-chain jobs use `npm ci --ignore-scripts`, then enforce the lifecycle allowlist. |
| Verify registry signatures | `npm audit signatures` is now blocking in CI supply-chain jobs. |
| Produce SBOMs | Build and security jobs generate `sbom.cdx.json`; the build artifact upload includes the SBOM. |
| Attest released artifacts | The experimental attestation workflow now builds `dist`, packages it with the SBOM, and attests both the build tarball and SBOM. |
| Keep local secure build entry point | `npm run build:secure` runs typecheck, lint, migration validation, supply-chain checks, then build. |

## Deliberately Deferred

- **Private registry/proxy:** not configured because this repo does not currently provide a registry endpoint.
- **Snyk:** not added because it requires a `SNYK_TOKEN` secret and an explicit account decision.
- **Network-restricted runners:** requires organization/runner infrastructure outside the repo.
- **Blocking artifact attestation:** still experimental/non-blocking until the team confirms release workflow expectations.

## Verification

Use these local checks before opening a PR:

```powershell
npm run check
npm run lint
npm run docs:validate
npm run security:audit
```

Use `npm run build:secure` from a non-sandboxed checkout or CI runner when validating the full production build.

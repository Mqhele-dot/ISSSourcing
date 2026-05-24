## GitHub Actions pinning inventory

Pinned **full commit SHAs** for immutable action resolution per GitHub hardening guidance: [security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions).

Dependabot **`package-ecosystem: github-actions`** ([`.github/dependabot.yml`](../../.github/dependabot.yml)) continues to propose digest bumps weekly; merges should preserve **inline semver comments** (`# v4`) so reviewers know which tag line matches the SHA.

| Action | Pin (SHA) | Tag snapshot (approx) | Workflow usage |
|--------|-----------|------------------------|----------------|
| `actions/checkout` | `34e114876b0b11c390a56381ad16ebd13914f8d5` | `v4` | [`ci.yml`](../../.github/workflows/ci.yml), [`codespaces-compatibility.yml`](../../.github/workflows/codespaces-compatibility.yml), [`dependency-review.yml`](../../.github/workflows/dependency-review.yml), [`security-supply-chain.yml`](../../.github/workflows/security-supply-chain.yml), [`artifact-attestation-experimental.yml`](../../.github/workflows/artifact-attestation-experimental.yml) |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `v4` | Same as checkout (except dependency-review skips setup where unused) |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | `v4` | [`ci.yml`](../../.github/workflows/ci.yml) build artifact, [`security-supply-chain.yml`](../../.github/workflows/security-supply-chain.yml) SBOM upload |
| `actions/dependency-review-action` | `2031cfc080254a8a887f58cffee85186f0e49e48` | `v4.9.0` | [`dependency-review.yml`](../../.github/workflows/dependency-review.yml) |

| Workflow | Still on semver tag | Risk note | Planned action |
|---------|---------------------|-----------|----------------|
| [`artifact-attestation-experimental.yml`](../../.github/workflows/artifact-attestation-experimental.yml) | `actions/attest@v2` | OIDC-backed; **`continue-on-error: true`** | Pin when attestation flow stabilizes (tag resolution issues on some orgs) |

### Private repository note

**Dependency Review** requires **dependency graph submission**; private orgs typically need **GitHub Advanced Security** — see [`SECURITY_VERIFICATION_RESULTS.md`](./SECURITY_VERIFICATION_RESULTS.md).

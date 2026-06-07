## GitHub Actions pinning inventory

Pinned **full commit SHAs** for immutable action resolution per GitHub hardening guidance: [security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions).

**CI Node runtime:** workflows use **`node-version: "24"`** via `actions/setup-node` (local dev should use Node 22.12+ per `package.json` `engines`).

Dependabot **`package-ecosystem: github-actions`** ([`.github/dependabot.yml`](../../.github/dependabot.yml)) proposes digest bumps weekly; preserve inline semver comments (`# v4`) when merging.

| Action | Pin (SHA) | Tag snapshot | Workflow usage |
|--------|-----------|--------------|----------------|
| `actions/checkout` | `34e114876b0b11c390a56381ad16ebd13914f8d5` | `v4` | [`ci.yml`](../../.github/workflows/ci.yml), [`codespaces-compatibility.yml`](../../.github/workflows/codespaces-compatibility.yml), [`security-supply-chain.yml`](../../.github/workflows/security-supply-chain.yml), [`artifact-attestation-experimental.yml`](../../.github/workflows/artifact-attestation-experimental.yml) |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `v4` | Same as checkout |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | `v4` | [`ci.yml`](../../.github/workflows/ci.yml) build artifact, [`security-supply-chain.yml`](../../.github/workflows/security-supply-chain.yml) SBOM upload |
| `actions/dependency-review-action` | `2031cfc080254a8a887f58cffee85186f0e49e48` | `v4.9.0` | **PR-only** job in [`ci.yml`](../../.github/workflows/ci.yml) (`fail-on-severity: high`) |

| Workflow | Still on semver tag | Notes |
|---------|---------------------|-------|
| [`artifact-attestation-experimental.yml`](../../.github/workflows/artifact-attestation-experimental.yml) | `actions/attest@v2` | Triggered after successful **Security supply chain** on `main`/`master`, or `workflow_dispatch`; job **`continue-on-error: true`** |

**Dependency Review** requires **dependency graph submission**; private orgs typically need **GitHub Advanced Security** - see [`SECURITY_VERIFICATION_RESULTS.md`](./SECURITY_VERIFICATION_RESULTS.md).

Standalone **`dependency-review.yml`** was **removed**; PR gate lives in **`ci.yml`** to enforce ordering before **`release-gate`**.

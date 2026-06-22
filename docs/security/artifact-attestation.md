# Artifact attestation (experimental)

GitHub Artifact Attestations bind an OIDC-signed statement to artifacts (such as CycloneDX SBOMs).

## Workflow

Manual trigger only: [.github/workflows/artifact-attestation-experimental.yml](../../.github/workflows/artifact-attestation-experimental.yml)

- **`continue-on-error: true`** so experiments never gate merges.
- Requires repository/org policy permitting **`id-token: write`** + **`attestations: write`** (+ `artifact-metadata: write` per GitHub product notes).
- Availability differs for private/internal repositories versus public—see GitHub documentation *Artifact attestations*.

## Local reproduction (no OIDC signing)

```bash
npm run security:sbom
# Inspect sbom.cdx.json locally (ignored by Git; regenerate anytime)
```

Verification of signed payloads should use **`gh attest verify …`** commands per GitHub docs once attestations succeed in-repo.

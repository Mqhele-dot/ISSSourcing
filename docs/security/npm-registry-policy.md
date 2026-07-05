# npm registry policy (ISSSourcing)

## Approved registry

- **Default:** public registry `https://registry.npmjs.org` for all OSS dependencies.
- **Scoped internal packages:** if the org introduces private modules, reserve a scope (convention **`@invtrack/*`**) and map it in `.npmrc` to **one** authoritative registry (GitHub Packages, Artifact registry, Verdaccio, etc.).
- Never point production CI at ephemeral or unapproved mirrors without review.

## No committed npm tokens

- Do **not** commit `.npmrc` containing `_auth`, `_password`, `token=`, `//registry…:_auth`.
- Prefer **repository secrets / OIDC trusted publishing** for publish flows outside this repo’s scope.

## Scoped internal packages (`@invtrack/*` example)

- Private code must use a **distinct scope** unlikely to collide with squatters on npmjs (if ever published externally, register the scope first).
- Configure scope mapping explicitly (example sketch only):

  ```bash
  @invtrack:registry=https://npm.pkg.github.com/
  ```

- Document mirror URL and egress requirements in infra runbooks before enabling.

## Private proxy option

- Optional: **Verdaccio**, **JFrog Artifactory**, **GitHub Packages npm** acting as caching proxy + allowlist deny-by-default egress.
- Benefits: centralized audit logs of tarballs fetched, suppression of rogue public packages mimicking internals.

## Dependency confusion prevention

- Never depend on `@company/foo` internally without **owning that scope** publicly or pinning to the private registry.
- CI must use **`npm ci`** with a maintained [`package-lock.json`](../../package-lock.json) (`lockfileVersion: 3`) so merges cannot silently widen the tree.
- **GitHub Dependency Review** (PR) + **npm audit signatures** complement lockfile hygiene.

## Root `.npmrc` (non-secret)

The repo commits [`.npmrc`](../../.npmrc) with **`legacy-peer-deps=true`** because **`drizzle-orm@0.45+`** advertises peer-optional tooling (`knex` / `pg-query-stream`) edges that deadlock npm’s peer resolver on this dependency graph. **`npm ci` honors this flag** locally and in Actions. Remove the flag once npm or Drizzle publish a cleaner dependency contract for this tree.

## Emergency steps during suspected npm compromise

1. Pause merges; rotate **publish tokens** only from a clean workstation (assume dev machines compromised if malicious `postinstall` ran).
2. Run **`npm audit`**, **`npm audit signatures`** locally; regenerate [`sbom.cdx.json`](VERIFICATION.md) analogue.
3. Compare lockfile deltas in last known-good tag; reinstall from clean caches only when advisories clarify safe versions.
4. Re-run **`npm run security:lifecycle`** and CI security workflow; escalate any new **`hasInstallScript`** packages missing from [`scripts/list-lifecycle-scripts.mjs`](../../scripts/list-lifecycle-scripts.mjs) allowlist.
5. File incident noting affected advisories (`GHSA-…`) with owners/maintainers.

See also [**EVIDENCE-2026-05-19.md**](./EVIDENCE-2026-05-19.md), [**SECURITY_VERIFICATION_RESULTS.md**](./SECURITY_VERIFICATION_RESULTS.md).

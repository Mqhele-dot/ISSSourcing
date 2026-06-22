# Electron / desktop stack strategy (supply-chain blast radius)

## Decision summary (maintainer record)

For this workspace **Electron remains a first-class dependency** for the bundled **desktop SKU** (`electron/` tree, SQLite persistence, updater path). **`npm ci` therefore always resolves the Electron + electron-builder subgraph** alongside the hosted-server graph.

Server-only/container deploys (**Docker**, hosted Node) benefit from skipping native compile in **scan-only** jobs via `npm ci --ignore-scripts`; **developers and release builds** performing desktop packaging must install with lifecycle scripts enabled so **`sqlite3`**, **`electron`**, and tooling compile.

## Alternatives intentionally deferred

- **`optionalDependencies` split** — Would shrink default `npm ci` transitive surface for CI that never builds Electron, but breaks unless **all CI paths** tolerate optional skip and desktop pipelines explicitly `npm rebuild` / full install.

- **`npm workspaces`** with `packages/desktop` — Strong long-term hygiene; deferred as a larger refactor (shared tsconfig, lockfile choreography, Electron Builder paths).

Either path belongs in a **focused follow-up PR** coordinated with **`npm ls` parity** on Windows + Linux builders.

## Coordinated upgrades

Treat **electron**, **electron-builder**, **`sqlite3`**, and **`@electron/rebuild`**-adjacent tooling as **one train**:

1. Bump **electron** to a Chromium line that clears open advisories (this wave moved to **Electron 40+** where prior audit flagged **`<=39.8.4`**).
2. Match **electron-builder** to patched **`app-builder-lib` / `dmg-builder`** minors recommended by **`npm audit`** (**≥ ~26.8** era at time of change).
3. Rebuild **`sqlite3`** natives on CI matrix after **major bumps**.

## Operational verification expectations

Electron packaging is **not** exercised in lightweight `npm run check`/`build` CI alone. After substantive bumps, run **`electron-builder`** (or project’s documented packaging script) on at least **one CI platform** aligned with releases (historically Windows-centric + optional Linux smoketest).

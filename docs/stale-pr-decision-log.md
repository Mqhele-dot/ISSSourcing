# Stale PR Decision Log

This log records branch and pull-request decisions so unfinished work does not get mistaken for the production base.

| Ref | Decision | Reason | Action |
|---|---|---|---|
| `cursor/project-codespace-compatibility-b14c` | Current production-base candidate | Contains the app hardening, Codespaces, master-data, diagnostics, supplier, procurement, AP, logistics, and release-gate work being stabilised now. | Continue Wave 1 work here. |
| PR #4 | Production-base PR/candidate context | Matches the selected branch history used for the latest audits. | Keep current until superseded by an explicit production-base update. |
| PR #7 | Stale/diverged | Useful ideas may exist, but it is not the active source of truth. | Cherry-pick only reviewed, compatible patches. |
| PR #8 | Stale/diverged | Useful ideas may exist, but it is not the active source of truth. | Cherry-pick only reviewed, compatible patches. |
| PR #3 | Separate spike | FastAPI/SQLite/Tauri direction differs from the current Node/React/Postgres app. | Keep as research/spike material only unless a future migration is planned. |

Before reviving any stale work, compare it against `docs/production-readiness-audit.md`, current schema, current package scripts, and the active release gate.

# ISSSourcing Production Base

The selected production-base candidate for this stabilisation wave is:

`cursor/project-codespace-compatibility-b14c`

This branch is the source of truth for production-hardening work, Codespaces fixes, master-data work, diagnostics, supplier/procurement/AP/logistics wiring, and release gates. New stabilisation work should start from this branch or target it in a pull request.

## Branch Rules

- Treat `cursor/project-codespace-compatibility-b14c` as the current release candidate until a newer candidate is explicitly documented here.
- Do not copy code from stale PR branches directly into production without a focused diff review.
- Run `npm run verify:production-base` before release work. The command warns on stale or unrelated branches but does not block feature branches.
- Run `npm run verify:release` before considering a stabilisation change ready for push or merge.

## Why This Exists

The app has had useful work split across local worktrees, Codespaces, and stale PR branches. This document anchors the branch truth so new work lands in one place and CI, Codespaces, local testing, and GitHub stay aligned.

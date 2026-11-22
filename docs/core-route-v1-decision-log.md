# Core Route V1 Decision Log

This log records Wave 3B decisions for core routes that still contain mock/demo risk or incomplete production proof.

| Route | V1 Decision | Owner | Blocking Reason | Required Action |
|---|---|---|---|---|
| `/operations/logistics` | Review-ready on live data; outbound dispatch remains excluded. | Operations | The list, filters, carrier defaults, and linked-record navigation already run on live logistics APIs, but mutation proof still depends on a disposable test database and browser execution in CI/local. | Keep outbound issue-document flow fail-closed, keep role-gated writes, and attach disposable-db runtime plus browser evidence for status/edit actions. |
| `/operations/logistics/:id` | Review-ready on live data; mutation evidence incomplete. | Operations | Detail reads live shipment, supplier, carrier, receipt, and exception context, but status/edit approval still lacks current disposable-db proof in this repo state. | Preserve live detail navigation, keep denied/disabled action guards, and attach disposable-db runtime plus browser evidence for status/update flows. |
| `/operations/exceptions` | Review-ready on live data; mutation evidence incomplete. | Operations | Queue filters, exports, run-checks entry, and linked-record navigation are wired to real exception APIs, but mutation approval still depends on disposable-db proof and browser execution. | Keep live queue states, keep role-gated actions, and attach disposable-db runtime plus browser evidence for run-checks and quick triage flows. |
| `/operations/exceptions/:id` | Review-ready on live data; mutation evidence incomplete. | Operations | Detail, incident context, activity history, and linked navigation are live, but status/assignment/comment approval still lacks current disposable-db proof in this repo state. | Preserve live detail states, keep note requirements and disabled guards, and attach disposable-db runtime plus browser evidence for resolution and denied-access flows. |

Production release rule: these routes must remain clearly labelled as review-only or partially excluded until their required actions are completed and the production-readiness audit shows route-specific runtime, UI, permission, audit, and browser evidence for them.

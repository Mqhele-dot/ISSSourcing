# Core Route V1 Decision Log

This log records Wave 3B decisions for core routes that still contain mock/demo risk or incomplete production proof.

| Route | V1 Decision | Owner | Blocking Reason | Required Action |
|---|---|---|---|---|
| `/operations/logistics` | Non-production for v1 until real screen proof is complete. | Operations | The module has useful backend logistics filters and supplier/carrier diagnostics, but the route audit still sees unsafe mock/demo/static risk and lacks route-specific browser proof. | Remove unsafe fallback data, show empty/error states from real logistics APIs, add source-level UI contract, then add Playwright smoke for shipment list and carrier/supplier defaults. |
| `/operations/logistics/:id` | Non-production for v1 until detail workflow is proven. | Operations | Detail route still lacks route-specific runtime/browser evidence for shipment status, linked supplier/carrier, PO/receipt context, and audit history. | Wire detail page to real shipment endpoint only, expose loading/error/permission states, and test status changes and linked record navigation. |
| `/operations/exceptions` | Non-production for v1 until real exception queue proof is complete. | Operations | Exception data exists in diagnostics/AP/procurement workflows, but this operations route is still classified as mock/demo risk by the production audit. | Use real exception APIs, remove demo fallback, group exceptions by source workflow, and add route-level UI contract plus browser smoke. |
| `/operations/exceptions/:id` | Non-production for v1 until resolution workflow is proven. | Operations | Detail/resolution path lacks route-specific proof for backend validation, permissions, audit history, and blocked/closed state behavior. | Wire to real exception detail and resolution endpoints, require reason/comment on resolution, record audit, and add denied-access and successful-resolution tests. |

Production release rule: these routes must remain labelled non-production or excluded from production navigation until their required actions are completed and the production-readiness audit no longer reports critical core mock/demo risk for them.

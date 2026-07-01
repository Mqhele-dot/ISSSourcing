# Core Route V1 Decision Log

This log records Wave 3B decisions for core routes that still contain mock/demo risk or incomplete production proof.

| Route | V1 Decision | Owner | Blocking Reason | Required Action |
|---|---|---|---|---|
| `/operations/logistics` | Non-production for v1 until real screen proof is complete. | Operations | The module has useful backend logistics filters and supplier/carrier diagnostics, but route-specific runtime/browser proof is still incomplete. | Keep excluded from v1 production navigation/approval, show empty/error states from real logistics APIs, add source-level UI contract, then add Playwright smoke for shipment list and carrier/supplier defaults. |
| `/operations/logistics/:id` | Non-production for v1 until detail workflow is proven. | Operations | Detail route still lacks route-specific runtime/browser evidence for shipment status, linked supplier/carrier, PO/receipt context, and audit history. | Wire detail page to real shipment endpoint only, expose loading/error/permission states, and test status changes and linked record navigation. |
| `/operations/exceptions` | Non-production for v1 until real exception queue proof is complete. | Operations | Exception data exists in diagnostics/AP/procurement workflows, but this operations route still lacks route-specific proof for production approval. | Use real exception APIs, keep production-safe empty states, group exceptions by source workflow, and add route-level UI contract plus browser smoke. |
| `/operations/exceptions/:id` | Non-production for v1 until resolution workflow is proven. | Operations | Detail/resolution path lacks route-specific proof for backend validation, permissions, audit history, and blocked/closed state behavior. | Wire to real exception detail and resolution endpoints, require reason/comment on resolution, record audit, and add denied-access and successful-resolution tests. |

Production release rule: these routes must remain labelled `Non-production v1` or excluded from production navigation until their required actions are completed and the production-readiness audit shows route-specific runtime, UI, permission, audit, and browser evidence for them.

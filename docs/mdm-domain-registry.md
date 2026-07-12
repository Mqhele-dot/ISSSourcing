# MDM Domain Registry

The MDM domain registry is the canonical control map for Master Data. MDM is not plain CRUD: each domain has an owner, steward, risk level, required permissions, required fields, unique keys, high-risk fields, approval rules, where-used checks, supported actions, import/export policy, and audit requirement.

## Domains

- `suppliers`
- `supplier-contacts`
- `supplier-banks`
- `supplier-compliance-documents`
- `contracts`
- `items`
- `item-categories`
- `units-of-measure`
- `uom-conversions`
- `warehouses`
- `bins-locations`
- `departments`
- `cost-centres`
- `gl-accounts`
- `tax-codes`
- `currencies`
- `fx-rates`
- `payment-terms`
- `incoterms`
- `carriers`
- `approval-rules`
- `document-sequences`
- `legal-entities`

## High-Risk Examples

- Supplier bank or tax changes
- Supplier compliance status changes
- GL mapping and cost-centre changes
- UOM conversion factor changes
- Tax rate changes
- Payment term changes
- Contract currency changes
- Approval policy/approver changes
- Warehouse status changes

These require maker-checker approval and audit evidence.

## Standard Record Model

Every domain adapter must support or map to: organization, business key/code, name, status, version, effective dates, created/updated/approved actors, source system, external reference, archived timestamp, and archive actor.


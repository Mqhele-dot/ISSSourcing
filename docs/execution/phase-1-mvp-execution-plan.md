# Phase 1 MVP Execution Plan — SupplyChain Control Tower Desktop App

## Objective
Deliver a usable MVP that enables planners to ingest core supply-chain data, see trusted inventory/order/shipment status, and manage priority exceptions with audit-ready case workflows.

## Scope (locked for MVP)
### In scope
- Desktop app shell + login + RBAC
- CSV/Excel drop-folder connector
- One ERP connector (API or scheduled export path)
- Canonical model for:
  - SKUs
  - Suppliers
  - Inventory
  - POs + PO lines + confirmations
  - Shipments + ETA milestones
- Data quality checks v1 + conflict resolution rules v1
- Exceptions v1:
  - Stockout risk
  - Late confirmation
  - Shipment delay
- Case workflow v1 + immutable audit log

### Out of scope (deferred)
- Supplier portal
- Forecasting/replenishment engine
- EDI and advanced integrations
- SSO/MFA enterprise hardening
- Scenario simulation

## Workstreams
1. **Desktop Foundation**
   - App shell, navigation, auth, RBAC guards
2. **Integration Runtime**
   - Connector framework, scheduler, retries, dead-letter queue
3. **Canonical Data Platform**
   - Staging-to-canonical pipelines + source-of-record rules
4. **Control Tower UX**
   - Inventory, PO, shipment, and activity feed views
5. **Exception + Case Management**
   - Detection rules, scoring, ownership, SLA, closure flows
6. **Audit + Security Baseline**
   - Signed audit events, role matrix, secret storage
7. **Release + Operations**
   - Diagnostics bundle, health dashboard, installer/update channel

## 10-week delivery schedule
### Sprint 0 (Week 1): Foundations
- Repo structure + architecture decision records (ADRs)
- Local dev environment + CI checks
- Data contracts and canonical schema draft
- UX wireframe set for MVP screens

### Sprint 1 (Weeks 2–3): Ingestion baseline
- CSV/Excel connector operational
- ERP connector stub + one real extraction path
- Staging tables and ingestion metadata (source timestamp, batch id)
- Freshness monitor v1

### Sprint 2 (Weeks 4–5): Canonical publish + quality
- Mapping/transformation for MVP entities
- Data quality rule engine v1
- Source-of-record conflict logic v1
- Lineage fields persisted per record/field group

### Sprint 3 (Weeks 6–7): Visibility + exceptions
- Home + Control Tower + Exceptions screens functional
- Exception detection jobs for 3 MVP exception types
- Case workflow: create/assign/comment/close + SLA timers
- Basic notification hooks (email/webhook)

### Sprint 4 (Weeks 8–9): Hardening + UAT
- Audit trail completeness + tamper-evident hash chain
- Role validation + permission tests
- Performance tuning for core queries
- UAT runbook + signoff cycle

### Release week (Week 10)
- Production packaging and deployment checklist
- Hypercare dashboard + incident playbook
- Go-live signoff

## Deliverables by module
- **Home**: KPI tiles (open exceptions, stale sources, at-risk stockouts), activity feed
- **Control Tower**: inventory by site/SKU, open POs, in-transit shipments + ETA drift flag
- **Exceptions**: queue view, severity, assignee, SLA remaining, linked entities
- **Master Data (MVP subset)**: SKU and supplier records with quality status
- **Integrations**: connector status, last sync, error details, retry action
- **Audit**: searchable event log for master data edits + case actions

## MVP data model (minimum entities)
- `sku`
- `supplier`
- `location`
- `inventory_position`
- `purchase_order`
- `purchase_order_line`
- `po_confirmation`
- `shipment`
- `shipment_milestone`
- `exception_case`
- `case_event`
- `audit_event`

## Rule definitions (MVP)
1. **Stockout risk**
   - Trigger: projected days-of-cover < configured threshold
   - Severity: high if stockout <= 3 days
2. **Late PO confirmation**
   - Trigger: PO not acknowledged within SLA from issue timestamp
   - Severity: based on PO value + critical SKU flag
3. **Shipment delay**
   - Trigger: ETA drift exceeds threshold (hours/days)
   - Severity: based on customer/service impact and confidence

## Done criteria (MVP)
- Planner can identify top at-risk SKUs and delayed supply in under 2 minutes
- Data lineage available for inventory quantity and ETA fields
- Case actions (assign/escalate/close) are fully audited
- Connector failures surface within 5 minutes on Integrations screen
- Critical defects: 0 open; major defects: <= agreed threshold at go-live

## Risks and mitigations
- **ERP data inconsistency** → create source adapter contract + contract tests
- **Poor master data quality** → enforce blocked publish for critical invalid fields
- **Exception fatigue** → severity tuning + suppress duplicate alerts window
- **Desktop deployment friction** → signed installer + rollback versioning

## Ownership model
- Product: scope, acceptance, UAT signoff
- Engineering: implementation and quality gates
- Data lead: canonical model and lineage validity
- Operations: deployment readiness and monitoring
- Security: RBAC and secret-handling review

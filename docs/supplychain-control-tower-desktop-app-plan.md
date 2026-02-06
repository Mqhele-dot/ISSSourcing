# SupplyChain Control Tower Desktop App Plan (Full Features)

## Goal
A desktop app that unifies ERP/WMS/TMS + suppliers + logistics into one trusted view, fixes data quality, automates workflows, manages exceptions, and supports planning/forecasting securely with audit trails.

## 1) Product modules and feature list

### A. Onboarding and Setup
- Company profile (sites/warehouses, currencies, units, incoterms)
- User management (roles, teams, approvals)
- Connector wizard (guided setup per system)
- Data import bootstrap (initial master data load)
- Environment checks (network, permissions, disk, encryption)
- Demo mode (sample dataset to explore features)

### B. Connector Hub (Integrations)

#### Connectors (plug-ins)
- ERP: SAP / Oracle / MS Dynamics / Sage (API, ODBC, scheduled exports)
- WMS: common systems + CSV drop-folder
- TMS: common systems + carrier portals via API
- Carriers: tracking APIs (milestones, ETA, POD)
- Supplier channels:
  - EDI (850/855/856/810 where applicable)
  - Supplier portal (webhooks/API)
  - Email ingestion (PO confirmations, ASNs, invoices)
  - WhatsApp/Chat export ingestion (optional, controlled)
- Finance/AP: invoicing systems (for 3-way match)
- External data: FX rates, holiday calendars, port congestion feeds (optional)

#### Connector platform features
- Connector SDK ("new connector in 1 folder")
- Field mapping + transformation UI (drag/drop mapping)
- Scheduling (every 5 min/hour/day) + event-based triggers
- Retry policies + dead-letter queue
- Data freshness monitor ("source last updated")
- Credential vault (OS keychain + encrypted secrets)
- Integration health dashboard + alerts

### C. Unified Data Model (Single Source of Truth)

#### Canonical objects
- Items/SKUs, BOM (optional), units, packaging
- Locations (sites, DCs, stores), bins (optional)
- Suppliers, contracts, lead times, MOQ, Incoterms, payment terms
- Purchase requisitions, POs, PO lines, confirmations
- ASNs, shipments, milestones, ETAs, PODs
- Inventory (on-hand, available, reserved, in-transit)
- Sales orders / demand signals (if integrated)
- Invoices, GRNs, 3-way match status
- Quality events, returns (optional)

#### Truth + lineage
- Source-of-record rules (e.g., WMS overrides ERP for on-hand)
- Version history on key fields (price, lead time, MOQ)
- Data lineage view ("this field came from X at time Y")
- Conflict resolution queue ("ERP=120, WMS=94—apply rule")

### D. Master Data Governance & Data Quality
- Validation rule library (missing fields, bad formats, out-of-range)
- Duplicate detection (fuzzy matching for suppliers/SKUs)
- Standardization (naming conventions, address formats)
- Approval workflows (propose → review → approve → publish)
- Data quality scorecards by domain and site
- "Fix suggestions" (auto-correct common patterns)
- Exception: "blocked publish" if high-risk fields invalid
- Audit log of all master data edits

### E. Real-Time Visibility (Control Tower)
- End-to-end view: demand → supply → inventory → shipment → delivery

#### Inventory views
- By site, by SKU, by availability state
- Aging, slow movers, excess and obsolete

#### Purchase views
- Open POs, confirmations, backorders
- Supplier lead-time trend and reliability

#### Logistics views
- Shipment milestone timeline
- Delay reasons, dwell time, exceptions

#### Coverage views
- Days of cover, projected stockout date
- Supply vs demand gaps

- "What changed" activity feed (today/24h/7d)

### F. Exception Management (Case System)

#### Exception types (library)
- Late PO confirmation / missing acknowledgment
- Supplier delivery delay / missed requested date
- ETA drift and milestone misses
- Stockout risk in X days
- Demand spike anomaly
- Lead-time deviation / variance
- Price variance vs contract
- MOQ violations / split shipments
- Inventory mismatch (ERP vs WMS)
- ASN missing or mismatch
- 3-way match failure (PO/GRN/Invoice)
- Quality hold / returns spike
- Capacity constraints (warehouse/carrier) (optional)

#### Case workflow features
- Severity scoring (impact × urgency × confidence)
- SLA timers + escalation rules
- Ownership assignment + queues by team
- Playbooks per exception (recommended actions)
- Comments, attachments, approvals
- Linked objects (SKU, supplier, shipment, PO)
- Closure reasons + root cause coding
- Metrics: MTTR, backlog, recurrence

### G. Automation & Orchestration
- Notification rules (email/Teams/Slack—where allowed)
- Auto-actions:
  - Request confirmation from supplier
  - Escalate to manager after SLA breach
  - Create change request (update lead time, expedite)
  - Generate draft PO based on plan
- Approval gates (automation cannot execute without approval in high-risk actions)
- "Automation simulator" (test rules before enabling)
- Runbook logging (every automation action recorded)

### H. Planning, Forecasting & Optimization

#### Forecasting
- Baseline models (moving average, seasonality)
- Forecast accuracy tracking (MAPE/WAPE)
- Demand sensing inputs (recent sales, promos, market signals if available)
- Override workflow (planner edits with audit trail)

#### Inventory & replenishment
- Reorder point + safety stock calculators
- Service level targets per SKU class (ABC/XYZ)
- Suggested PO quantities + timing
- Multi-echelon visibility (if multiple tiers of DCs)

#### Scenario planning
- What-if simulations:
  - Supplier shutdown
  - Lead time increase
  - FX change
  - Demand surge
  - Transport disruption
- Compare scenarios and recommended mitigation

### I. Supplier Management Portal (Optional but powerful)
- Supplier onboarding and profile completion
- PO acknowledgment and commit dates
- ASN creation and shipment booking
- Document upload (certs, invoices, POD)
- Performance dashboard for supplier (OTIF, defects, responsiveness)
- Messaging thread per PO/shipment (keeps email out of chaos)

### J. Reporting & Analytics
- KPI dashboards:
  - OTIF, fill rate, inventory turns, backorder rate
  - Forecast accuracy, service level attainment
  - Supplier scorecards (quality, delivery, cost)
  - Logistics KPIs (dwell, delay rate)
- Drill-down to transaction level
- Exports: CSV/PDF, scheduled reports
- Custom report builder (filters + grouping)
- Executive summary "weekly pack" generator

### K. Security, Compliance & Audit
- RBAC + least-privilege roles
- Per-connector access controls
- Encryption at rest + secure secret storage
- Signed audit logs (tamper-evident)
- Backup/restore + disaster recovery mode
- Device binding (optional)
- Session timeout + MFA (optional, enterprise)
- Compliance packs (change history for audits)

### L. Reliability & Operations
- Offline mode with queued sync
- Data cache + conflict handling
- Health monitor:
  - Connector failures
  - Stale feeds
  - Processing backlog
- Self-diagnostics bundle (logs export for IT)
- Auto-update system (controlled channels: stable/beta)

## 2) App screens (desktop navigation)
- Home (today’s exceptions + key KPIs + feed)
- Control Tower (inventory + orders + shipments)
- Exceptions (case queue + playbooks + SLAs)
- Planning (forecast + replenishment + scenarios)
- Suppliers (profiles, scorecards, comms)
- Logistics (in-transit, milestones, ETAs)
- Master Data (items, locations, suppliers, rules)
- Integrations (connectors, mapping, schedules, health)
- Reports (KPIs, exports, report builder)
- Audit & Security (logs, roles, backups)

## 3) Data pipeline (how everything runs)
1. Ingest → staging tables
2. Transform/map → canonical model
3. Validate → data quality scoring
4. Publish → single source of truth
5. Detect → exceptions engine creates cases
6. Act → automation triggers (with approvals)
7. Learn → forecasting updates + performance metrics

## 4) Build plan (phases)

### Phase 1 — MVP (usable fast)
- Desktop shell + login + RBAC
- CSV/Excel drop-folder connector + one ERP connector
- Canonical model for SKUs, suppliers, inventory, POs, shipments
- Data quality checks v1 + conflict rules v1
- Exceptions v1 (stockout risk, late confirmations, shipment delay)
- Case workflow v1 + audit log

### Phase 2 — Real visibility + workflow automation
- Carrier tracking integration
- Email parsing (PO confirms/ASNs)
- Exception library expansion + severity scoring
- Auto-notifications + escalation rules
- Supplier scorecards v1

### Phase 3 — Planning intelligence
- Forecast models + accuracy dashboard
- Replenishment suggestions + approvals
- Scenario planning v1
- Advanced anomaly detection

### Phase 4 — Supplier portal + enterprise readiness
- Supplier portal (ack/ASN/docs)
- Central server mode (multi-user collaboration)
- SSO/MFA + enterprise compliance
- EDI support + contract pricing enforcement

## 5) Definition of "done" (acceptance criteria)
A planner can open the app and see:
- What’s late, what’s at risk, what changed today
- Correct inventory (with lineage) across sources
- Recommended actions with playbooks
- Evidence trail of actions taken (audit-ready)

Integrations stay healthy, monitored, and recover automatically.

Data quality issues are visible, measurable, and fixable via workflow.


## 6) Execution package
For implementation-level delivery details, see:
- `docs/execution/phase-1-mvp-execution-plan.md`
- `docs/execution/mvp-delivery-backlog.md`

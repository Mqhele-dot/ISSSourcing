# MVP Delivery Backlog (Execution Checklist)

## Epic 1 — Desktop shell and access
- [ ] Implement login flow (local/enterprise-ready abstraction)
- [ ] Define RBAC matrix (Planner, Ops, Admin)
- [ ] Enforce route-level permissions
- [ ] Add session timeout handling

## Epic 2 — Integration runtime
- [ ] Build connector interface (pull, transform, publish callbacks)
- [ ] Implement CSV/Excel drop-folder connector
- [ ] Implement ERP connector (MVP source)
- [ ] Add scheduler with cron presets (5m/hour/day)
- [ ] Add retries and dead-letter queue
- [ ] Add connector health + freshness metrics

## Epic 3 — Canonical pipeline
- [ ] Create staging schema + batch metadata
- [ ] Implement mapping definitions for MVP entities
- [ ] Build canonical publish pipeline
- [ ] Implement source-of-record rules (inventory, PO status)
- [ ] Persist lineage metadata

## Epic 4 — Data quality and governance
- [ ] Add required-field validation rules
- [ ] Add format/range validators
- [ ] Add duplicate candidate detection for suppliers/SKUs
- [ ] Build blocked-publish mechanism for critical fields
- [ ] Surface quality scorecards by domain

## Epic 5 — Control Tower UI
- [ ] Home dashboard (KPIs + activity feed)
- [ ] Inventory view (site/SKU/availability)
- [ ] Purchase view (open POs + confirmations)
- [ ] Logistics view (milestones + ETA drift)

## Epic 6 — Exception and case management
- [ ] Implement rule engine for 3 MVP exception types
- [ ] Create case queue with filters and sort
- [ ] Implement assignment + SLA timer + escalation
- [ ] Add comments and linked object context
- [ ] Add closure reason taxonomy

## Epic 7 — Audit and security baseline
- [ ] Emit audit event for master data and case actions
- [ ] Hash-chain audit events for tamper evidence
- [ ] Encrypt connector credentials in OS keychain/secure store
- [ ] Add access logs for sensitive views/actions

## Epic 8 — Release readiness
- [ ] Add self-diagnostics export bundle
- [ ] Add backup/restore smoke script
- [ ] Create go-live checklist and rollback runbook
- [ ] Run UAT scripts with signoff evidence

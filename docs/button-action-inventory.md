# Button And Action Inventory

Updated: 2026-07-05

This inventory covers the visible, production-relevant action surfaces that are part of the current release candidate. Internal compatibility headers, non-production v1 logistics/exception actions, and historical documentation-only references are not counted as production action surfaces.

## Summary

| Metric | Count | Notes |
|---|---:|---|
| Core actions inventoried | 43 | Procurement, inventory/reorder, RBAC, Control Tower, AP, subscription, reporting, diagnostics, and setup actions. |
| Actions covered by source/runtime contract tests | 43 | `npm run test:button-action-contracts` plus existing runtime tests for procurement, AP, subscription, diagnostics, and setup. |
| Actions with browser smoke coverage | 7 | `npm run test:e2e:button-actions` targets the live diagnostics failures and critical workflow buttons. |
| Fixed in Wave 4C/4D | 7 | Reorder convert, role permission remove, contracts route, PO commercial validation, gas timeout, subscription buttons, route chunk recovery. |
| Non-production v1 excluded actions | 4 route families | `/operations/logistics*` and `/operations/exceptions*` remain excluded/labelled until route-specific proof exists. |

## Inventory

| Route | Component File | Visible Action | Permission | Feature / Plan | API Or Client Action | Expected Success State | Expected Error State | Tested |
|---|---|---|---|---|---|---|---|---|
| `/inventory/reorder` | `client/src/pages/reorder.tsx` | Export PDF | `reports:export` / role-gated by route | Exports feature where enforced by API | `GET /api/export/reorder-requests/pdf` | File download and success toast | Destructive toast with endpoint failure | Source contract |
| `/inventory/reorder` | `client/src/pages/reorder.tsx` | Export Excel | `reports:export` / role-gated by route | Exports feature where enforced by API | `GET /api/export/reorder-requests/excel` | File download and success toast | Destructive toast with endpoint failure | Source contract |
| `/inventory/reorder` | `client/src/pages/reorder.tsx` | Approve reorder | `reorder_requests:approve` | Core inventory | `POST /api/reorder-requests/:id/approve` | List invalidated, success toast, dialog closes | Error toast and offline queue fallback | Existing runtime + source contract |
| `/inventory/reorder` | `client/src/pages/reorder.tsx` | Reject reorder | `reorder_requests:approve` | Core inventory | `POST /api/reorder-requests/:id/reject` | List invalidated, success toast, dialog closes | Error toast | Source contract |
| `/inventory/reorder` | `client/src/pages/reorder.tsx` | Convert to requisition | `requisitions:create` | Procurement | `POST /api/reorder-requests/:id/convert` | Reorder and requisition queries invalidated, success toast | `REORDER_ITEM_MISSING` repair guidance or formatted error | Source contract, live diagnostics regression |
| `/admin/user-roles` | `client/src/components/user/role-manager.tsx` | Create custom role | `custom_roles:create` | Control plane | `POST /api/custom-roles` | Roles query invalidated and success toast | Error toast | Source contract |
| `/admin/user-roles` | `client/src/components/user/role-manager.tsx` | Add permission | `custom_roles:update` | Control plane | `POST /api/custom-roles/:id/permissions` | Permissions query invalidated and success toast | Error toast | Source contract |
| `/admin/user-roles` | `client/src/components/user/role-manager.tsx` | Remove permission | `custom_roles:update` | Control plane | `DELETE /api/custom-roles/:roleId/permissions/:permissionId` | Permissions query invalidated; repeated delete returns already removed | Error toast only for real failure | Source contract, live diagnostics regression |
| `/admin/user-roles` | `client/src/components/user/role-manager.tsx` | Assign user role | `users:update` | Control plane | `PUT /api/users/:id` | User/role queries invalidated | Error toast | Existing control-plane tests |
| `/procurement/contracts` | `client/src/pages/contracts.tsx` | Add contract | `contracts:create` | Procurement | `POST /api/contracts` | Contract list refreshes | Validation/error state | Route diagnostics + e2e smoke |
| `/procurement/contracts` | `client/src/pages/contracts.tsx` | Edit contract | `contracts:update` | Procurement | `PATCH/PUT /api/contracts/:id` | Contract list refreshes | Validation/error state | Route diagnostics + e2e smoke |
| `/procurement/contracts` | `client/src/app/route-loading-boundary.tsx` | Reload fresh assets | Public route recovery | N/A | Cache-busted navigation | Lazy route chunk reloads | Clear chunk failure guidance | Source contract |
| `/procurement/orders/:po` | `client/src/pages/orders/purchase-order-detail-view.tsx` | Save commercial terms | `purchase_orders:update` | Procurement | `PATCH /api/procurement/purchase-orders/records/:id/commercial` | PO domain invalidated and success toast | Field-level business validation banner | Source contract |
| `/procurement/orders/:po` | `client/src/pages/orders/po-commercial-terms-card.tsx` | Apply contract & supplier defaults | `purchase_orders:update` | Procurement | Client-side default application | Currency/terms fields populated and guidance shown | Destructive toast when missing currency data | Source contract |
| `/procurement/orders/:po` | `client/src/pages/orders/po-commercial-terms-card.tsx` | Use contract currency | `purchase_orders:update` | Procurement | Client-side correction | Currency field set to contract currency | Error toast if contract currency invalid | Source contract |
| `/procurement/orders/:po` | `client/src/pages/orders/po-commercial-terms-card.tsx` | Clear contract | `purchase_orders:update` | Procurement | Client-side correction | Contract field reset and guidance shown | N/A | Source contract |
| `/procurement/orders/:po` | `client/src/pages/orders/purchase-order-detail-view.tsx` | Approve PO | `purchase_orders:approve` | Procurement | `POST /api/purchase-orders/:po/approve` | PO status changes and audit updates | Retry toast | Runtime workflow tests |
| `/procurement/orders/:po` | `client/src/pages/orders/purchase-order-detail-view.tsx` | Send PO | `purchase_orders:update` | Procurement | `POST /api/purchase-orders/:po/send` | PO sent, optional shipment created | Retry toast | Runtime workflow tests |
| `/procurement/orders/:po` | `client/src/pages/orders/purchase-order-detail-view.tsx` | Receive lines / GRN | `purchase_orders:receive` | Warehouse operations | `POST /api/purchase-orders/:po/receive` | Stock movement, inventory update, GRN evidence | Validation errors and retry toast | Runtime + e2e workflow |
| `/procurement/orders/:po` | `client/src/pages/orders/purchase-order-detail-view.tsx` | Signable PDF | `purchase_orders:read` | Document export | Signed PDF export transport | File download and success toast | Error toast | Source contract |
| `/operations/control-tower` | `client/src/pages/control-tower/gas-ops-card.tsx` | Retry gas summary | `dashboard:read` | Gas/extension module | `GET /api/gas/dashboard-summary` | Card reloads summary | Disabled/unavailable card, page remains usable | Source contract + e2e smoke |
| `/operations/control-tower` | `client/src/pages/control-tower` | Refresh | `dashboard:read` | Core operations | Control tower query refresh | Refreshed timestamp/KPIs | Inline error state | Existing diagnostics tests |
| `/admin/subscription` | `client/src/pages/subscription.tsx` | Change plan | `settings:configure` | Local billing adapter | `POST /api/subscription/change-plan` | Plan card marked current | Disabled for viewer or error toast | Subscription runtime + e2e |
| `/admin/subscription` | `client/src/pages/subscription.tsx` | Start trial | `settings:configure` | Subscription admin | `POST /api/subscription/change-plan` | Trial state applied | Disabled/permission message | Subscription e2e |
| `/admin/subscription` | `client/src/pages/subscription.tsx` | Cancel subscription | `settings:configure` | Subscription admin | Subscription change endpoint | Lifecycle state updated | Disabled/permission message | Subscription e2e |
| `/admin/subscription` | `client/src/pages/subscription.tsx` | Billing portal | `settings:configure` | Stripe readiness | `POST /api/subscription/portal-session` | Redirect/session setup | Setup-required message when unconfigured | Subscription e2e |
| `/finance/accounts-payable` | `client/src/pages/accounts-payable.tsx` | Create AP payment batch | `payments:create` | AP / Growth+ where enforced | `POST /api/accounts-payable/payment-batches` | Batch created for eligible matched invoices | Invalid/exception invoices blocked visibly | Runtime + e2e workflow |
| `/finance/accounts-payable` | `client/src/pages/accounts-payable.tsx` | Approve invoice | `invoices:approve` | AP | AP approval endpoint | Invoice advances | Segregation/policy validation | AP workflow tests |
| `/finance/invoices` | `client/src/pages/invoices.tsx` | Create invoice | `invoices:create` | AP | Invoice create endpoint | Invoice list refreshes | Validation error state | AP workflow tests |
| `/finance/invoices` | `client/src/pages/invoices.tsx` | Export invoices | `reports:export` | Exports | Export transport | Download | Error toast | Source contract |
| `/admin/master-data` | `client/src/pages/master-data.tsx` | Add master-data record | Domain-specific admin | Control plane | `POST /api/mdm/:domain` or compatibility endpoint | Record appears and dependent queries invalidate | Validation/dependency error | MDM runtime tests |
| `/admin/master-data` | `client/src/pages/master-data.tsx` | Update master-data record | Domain-specific admin | Control plane | `PATCH /api/mdm/:domain/:id` | Record updates and audit exists | Dependency response shown | MDM runtime tests |
| `/admin/master-data` | `client/src/pages/master-data.tsx` | Delete/disable record | Domain-specific admin | Control plane | `DELETE/PATCH /api/mdm/:domain/:id` | Safe deletion or inactive state | Where-used dependency block | MDM dependency tests |
| `/admin/settings` | `client/src/pages/settings.tsx` | Save settings | `settings:configure` | Control plane | Settings API | Success toast/audit | Denied/error state | Control-plane runtime/e2e |
| `/finance/approval-policies` | `client/src/pages/approval-policies.tsx` | Create/update approval policy | `approval_policies:update` | Control plane | Approval policy APIs | Policy persisted/audited | Denied/error state | Control-plane runtime/e2e |
| `/admin/documents` | `client/src/pages/documents.tsx` | Upload document | `documents:create` | Document management | Document upload endpoint | Timeline updates | Upload validation/error | Existing docs screen |
| `/admin/documents` | `client/src/pages/documents.tsx` | Run retention | `documents:manage` | Document management | Retention endpoint | Retention status updates | Error state | Existing docs screen |
| `/reports` | `client/src/pages/reports` | Build custom report preview | `reports:read` | Analytics/exports | `/api/export-center/custom-preview` | Preview table renders | Structured validation | Custom reports tests |
| `/reports` | `client/src/pages/reports` | Export custom report | `reports:export` | Exports | `/api/export-center/custom-export` | Compressed download | Error toast | Custom reports tests |
| `/admin/system-diagnostics` | `client/src/pages/system-diagnostics-page.tsx` | Fix / guidance | `settings:configure` where repair mutates | Diagnostics | Guidance/repair endpoints | Guidance opens or safe repair runs | Clear error toast | Diagnostics tests |
| `/admin/system-diagnostics` | `client/src/pages/system-diagnostics-page.tsx` | Run scan | `diagnostics:read` | Diagnostics | Diagnostics scan endpoint | Issue counts refresh | Error state | Diagnostics tests |
| App shell | `client/src/components/sidebar.tsx` | Navigation items | Authenticated route access | Varies | Client navigation | Route marker appears | Route boundary / auth state | Route diagnostics |
| App shell | `client/src/components/header.tsx` | Global search / jump | Authenticated route access | Varies | Client action | Search/jump opens intended route | Empty/no result state | Existing smoke coverage |


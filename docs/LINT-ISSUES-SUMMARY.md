# Lint issues summary (all similar errors)

**Total: 705 warnings (0 errors)**  
**Auto-fixable: 45** (run `npm run lint -- --fix` to fix those)

---

## By rule

### 1. `@typescript-eslint/no-unused-vars`
Variables, imports, or function args defined but never used. Fix: remove the import/variable or prefix with `_` (e.g. `_error`).

| File | Line(s) | Item(s) |
|------|---------|---------|
| client/src/App.tsx | 38, 46 | useState, TitleBar |
| client/src/components/activity/entity-activity-panel.tsx | 5 | ActivityRecord |
| client/src/components/analytics/demand-forecast.tsx | 7, 28 | CalendarIcon, ChevronLeft, ChevronRight, range, updateRange |
| client/src/components/analytics/inventory-value.tsx | 146 | entry |
| client/src/components/analytics/top-items.tsx | 12, 18 | formatCurrency, range, updateRange |
| client/src/components/barcode/barcode-generator.tsx | 6, 22 | TabsContent, onClose |
| client/src/components/billing/invoice-dialog.tsx | 18 | FormDescription |
| client/src/components/billing/invoices-list.tsx | 155, 209, 216 | id, invoice |
| client/src/components/billing/payment-dialog.tsx | 87, 211 | selectedInvoice, invoice |
| client/src/components/billing/payments-list.tsx | 147, 177, 184, 191 | id, payment |
| client/src/components/dashboard/custom-graph-builder.tsx | 181 | isPie |
| client/src/components/dashboard/recent-orders.tsx | 19 | formatDate |
| client/src/components/electron/*.tsx | various | React, FileText, connectionStatus |
| client/src/components/inventory/*.tsx | various | FormMessage, useEffect, Download, Warehouse |
| client/src/components/page-header.tsx | 1 | (import type) |
| client/src/components/real-time-updates.tsx | 1, 2, 10, 100 | useEffect, WebSocketMessage, BarChart2, sendMessage, disconnect |
| client/src/components/reports/report-filters.tsx | — | (hook deps) |
| client/src/components/settings/*.tsx | various | CardFooter, DollarSign, Receipt, Download, Upload, Select*, DatabaseInfo, BackupResult, setIsElectron, AppSettings, Label, Input, settings |
| client/src/components/sync/*.tsx | various | SyncMessageType, SyncMessage, RefreshCw, isFeatureEnabled, setPendingChanges, Input, Loader2, CardFooter, latencies |
| client/src/components/tutorial/*.tsx | 40, 454 | CardFooter, (useEffect deps) |
| client/src/components/ui/calendar.tsx | 55, 56 | props |
| client/src/components/ui/data-table.tsx | 40 | searchColumn |
| client/src/components/user/role-manager.tsx | 3, 19, 50, 53 | Trash2, Save, Edit, CardFooter, Checkbox, Separator |
| client/src/contexts/TutorialContext.tsx | 446, 485 | tourConfig, e |
| client/src/contexts/tutorial-context.tsx | 1 | useEffect |
| client/src/hooks/use-date-range-params.ts | 1, 3 | useEffect, addDays |
| client/src/hooks/use-real-time-sync.ts | 75, 276 | toast, e |
| client/src/hooks/use-toast.ts | 18 | actionTypes |
| client/src/pages/auth-page.tsx | 4, 52, 54, 252, 635, 756, 899 | KeyRound, loginMutation, registerMutation, location, error |
| client/src/pages/barcode-scanner-page.tsx | 8, 11 | Zap, queryClient |
| client/src/pages/dashboard.tsx | 70 | itemsLoading |
| client/src/pages/document-extractor-page.tsx | 4, 42, 44–52, 578, 797, 960 | ChevronDown, Textarea, AlertDialog*, key |
| client/src/pages/download.tsx | 4 | Server |
| client/src/pages/exceptions.tsx | 10 | Label |
| client/src/pages/home.tsx | 17 | ControlTowerOverview |
| client/src/pages/image-recognition-page.tsx | 8, 9, 14, 16, 17, 22 | useQuery, apiRequest, Badge, AlertTriangle, Server, Button, toast |
| client/src/pages/logistics.tsx | 38 | ShipmentListItem |
| client/src/pages/orders.tsx | 33 | PurchaseOrderListItem |
| client/src/pages/profile.tsx | 1, 5, 10, 11, 50, 339, 351, 459 | useRef, Mail, CardFooter, Tabs*, error, res |
| client/src/pages/reorder.tsx | 1 | useEffect |
| client/src/pages/reports.tsx | 9, 104 | Alert, AlertDescription, AlertTitle, safeSuppliers |
| client/src/pages/suppliers.tsx | 6, 7, 14–24, 30, 31, 38, 58, 67 | CardFooter, Tabs*, Dialog*, Table*, Separator, Check, Plus, ExternalLink, Badge, logoUrl, setLogoUrl, isLogoLoading |
| client/src/pages/sync-dashboard.tsx | 11, 28 | Server, activeTab, setActiveTab |
| client/src/pages/sync-test-page.tsx | 5, 8 | Tabs*, GearIcon |
| client/src/pages/warehouses.tsx | 20, 21, 37 | DialogTrigger, DialogClose, CardDescription, CardHeader, CardTitle |
| server/auth.ts | 8, 15–17, 22, 24, 369, 875, 936 | User, csrfProtection, handleCSRFError, detectSuspiciousActivity, sendWelcomeEmail, sendSuspiciousActivityEmail, confirmPassword, password, twoFactorSecret, passwordResetToken, passwordResetExpires |
| server/controllers/document-extractor-controller.ts | 16, 45, 203 | FileType, fileFilter, error |
| server/controllers/profile-picture-controller.ts | 49, 97, 148 | password |
| server/controllers/user-controller.ts | 90, 158 | password, updatedSettings |
| server/database-storage.ts | 13, 15, 20–38, 40–46, 51, 53, 466 | (many schema/imports), userId |
| server/db.ts | 9 | DEFAULT_CONNECTION_STRING |
| server/forecast-service.ts | 1, 21, 72, 73 | stockMovementTypeEnum, daysToForecast, startWeek, endWeek |
| server/index.ts | 103 | wsService |
| server/init-db.ts | 3–10, 14, 49, 52 | (schema imports), PgTable, userCount, error |
| server/operations-routes.ts | 967 | opSeed |
| server/reorder-request-generators.ts | 174 | title |
| server/seed-operational.ts | 26 | shipmentCount |
| server/seed.ts | 26–29 | InsertPurchaseRequisition*, InsertPurchaseOrder* |
| server/services/cloudinary-service.ts | 27 | file |
| server/services/document-extractor-service.ts | 16, 184, 397, 469, 912 | util, error, options, hocr, tsv, insertIntoDatabase, schemaName |
| server/services/document-generator-service.ts | 4, 9–19, 23, 116, 311 | createWriteStream, ReorderRequest, User, Supplier, Warehouse, Category, PurchaseOrder, PurchaseRequisition, reportTypeEnum, reportFormatEnum, pipelineAsync, height, title |
| server/services/image-recognition-service.ts | 8, 9, 94 | fs, path, imageBuffer |
| server/services/openai-service.ts | 10, 109 | fs, e |
| server/storage.ts | 3–53, 56, 158, 945, 1540, 2815, 5261 | (many schema/imports), verified, updatedSourceInventory |
| server/websocket-service.ts | 7 | AppSettings |

### 2. `@typescript-eslint/no-explicit-any`
Use of `any`; replace with a concrete type or `unknown`.

**Heavy in:**  
- client/src/contexts/TutorialContext.tsx (many)  
- client/src/lib/electron-bridge.ts  
- client/src/lib/document-generator.ts  
- server/auth.ts  
- server/routes.ts (multiple handlers)  
- server/services/document-extractor-service.ts  
- server/real-time-sync-service.ts  
- Plus scattered in: demand-forecast, inventory-value, invoice-dialog, invoices-list, payment-dialog, payments-list, item-form, real-time-inventory, real-time-updates, report-filters, dashboard, document-extractor-page, profile, auth-page, hooks (use-inventory-sync, use-permissions, use-barcode-scanner, use-real-time-sync, use-websocket), document-generator-service, database-storage, cloudinary-service, email-service, image-recognition-controller, openai-service, pdfjs-setup, security-service, websocket-service, proxy, reorder-request-generators, index.ts, document-generator-service.test.ts, qrcode.d.ts.

### 3. `react-hooks/exhaustive-deps`
useEffect/useMemo/useCallback dependency arrays missing or wrong.

| File | Line | Issue |
|------|------|--------|
| client/src/components/analytics/value-by-category-chart.tsx | 24, 30 | items/categories conditional affects useMemo deps |
| client/src/components/billing/invoice-dialog.tsx | 224 | useEffect missing `defaultValues` |
| client/src/components/dashboard/custom-graph-builder.tsx | 68, 74, 88 | inventory/categories/stockUsage conditionals affect useMemo |
| client/src/components/reports/report-filters.tsx | 47 | useEffect missing filter, setFilter |
| client/src/components/tutorial/tutorial-steps.tsx | 454 | useEffect missing registerTutorial |
| client/src/hooks/use-barcode-scanner.ts | 201, 226 | Unused eslint-disable (remove directive) |
| client/src/hooks/use-query-state.ts | 34 | useMemo unnecessary dependency: location |
| client/src/hooks/use-real-time-sync.ts | 201 | useCallback missing sendCapabilitiesMessage |
| client/src/pages/document-extractor-page.tsx | 344 | useCallback missing handleDatabaseImport |
| client/src/pages/profile.tsx | 83, 114 | useEffect missing profileForm, securityForm |

### 4. `@typescript-eslint/consistent-type-imports`
Imports used only as types should use `import type`.

**Files:**  
barcode-scanner.tsx, electron-provider.tsx, recent-activity.tsx, page-header.tsx, database-settings-form.tsx, real-time-sync-tester.tsx, data-table.tsx, date-range-picker.tsx, form.tsx, pagination.tsx, sidebar.tsx, tutorial-context.tsx, use-auth.tsx, use-barcode-scanner.ts, use-date-range-params.ts, queryClient.ts, barcode-scanner-page.tsx, document-extractor-page.tsx, auth.ts, document-extractor-controller.ts, image-recognition-controller.ts, profile-picture-controller.ts, user-controller.ts, database-storage.ts, forecast-service.ts, index.ts, real-time-sync-service.ts, cloudinary-service.ts, openai-service.ts, security-service.ts, websocket-service.ts, document-generator-service.ts.

---

## Quick commands

```bash
# List all issues (what you ran)
npm run lint

# Auto-fix the 45 fixable warnings (e.g. some unused vars, some import type)
npm run lint -- --fix
```

---

## Suggested order of fixes

1. Run `npm run lint -- --fix` to clear auto-fixable ones.
2. Fix **react-hooks/exhaustive-deps** (profile, invoice-dialog, report-filters, tutorial-steps, document-extractor-page, custom-graph-builder, value-by-category-chart, use-query-state, use-real-time-sync).
3. Remove or prefix **unused** imports/vars (no-unused-vars); start with client pages and components, then server.
4. Replace **any** with proper types or `unknown` in hotspots (TutorialContext, routes, document-extractor-service, auth, storage).
5. Switch type-only imports to **import type** (consistent-type-imports).

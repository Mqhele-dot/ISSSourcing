# Security

## Role-based access control (RBAC)

- **Viewer:** Read-only. Can list and view contracts, suppliers, warehouses, requisitions, purchase orders. Cannot create, update, delete, approve, or reject.
- **Manager:** Can approve/reject requisitions, manage data (contracts, suppliers, warehouses, requisitions, POs). Cannot access admin-only features (e.g. reset demo data, user management).
- **Admin:** Full access.

### Automated RBAC checks

Run the RBAC test script (requires server running with seeded DB):

```bash
npm run dev   # in one terminal
npm run db:seed
npm run test:rbac   # in another terminal
```

Or with a custom base URL:

```bash
BASE_URL=http://localhost:5000 npx tsx scripts/test-rbac.ts
```

The script verifies:

- Viewer receives **403** on `POST /api/contracts`.
- Viewer receives **200** on `GET /api/contracts`.
- Admin can create contracts (**201** or **400** for validation).
- Unauthenticated requests to protected routes get **401**, **302**, or **403**.

### Manual RBAC checklist

Before release or after auth changes, consider:

1. Log in as **viewer** and confirm:
   - No "Add contract", "Edit", "Delete" on Contracts.
   - No "Add warehouse", "Edit", "Delete" on Warehouses.
   - No "New requisition", "Approve", "Reject", "Convert", "Share" on Requisitions.
   - No "Add supplier", "Edit", "Delete", "Logo" on Suppliers.
2. Log in as **manager** and confirm write actions are available for contracts, warehouses, requisitions, suppliers.
3. Log in as **admin** and confirm "Reset demo data" (Development Utilities) is available in development only.
4. Run `npm run test:rbac` and ensure all checks pass.

### Reporting vulnerabilities

If you discover a security issue, please report it responsibly (e.g. via private disclosure to the maintainers rather than a public issue).

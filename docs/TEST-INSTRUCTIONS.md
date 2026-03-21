# Test instructions

Quick steps to verify the app and login work after pulling the latest code.

## 1. Pull and install

```bash
git pull
npm install
```

## 2. Database (if using Postgres)

Create/update schema and optionally seed demo users:

```bash
npm run db:push
npm run db:seed
```

In Codespaces, the devcontainer usually has Postgres; after `db:push` and `db:seed`, the `admin` / `planner` / `viewer` users exist with password **Admin123!**.

## 3. Build

```bash
npm run build
```

Expect exit code 0 (no compile errors).

## 4. Start the app

```bash
npm run dev
```

Leave this running. You should see the server start and **no** “Cannot use a pool after calling end on the pool” error.

## 5. Test login (with server running)

In another terminal:

```bash
npm run test:login
```

- **Valid credentials (admin / Admin123!)** should return 200 and a user object (or 503 with a clear message if DB/session is unavailable).
- **Invalid credentials** should return 401 with a clear “Invalid username or password” (or 503 with a clear message).

## 6. Manual login in the browser

1. Open the app (e.g. `http://127.0.0.1:5000` or your Codespaces URL).
2. Go to the login page.
3. Use **admin** / **Admin123!** (or planner / viewer with same password).
4. If login fails, the UI should show a **specific** message (e.g. database/session issue), not a generic “An error occurred during login”.

## 7. Optional: full API and E2E

With the app still running:

```bash
npm run test:contracts
npm run test:e2e
```

(Requires Playwright install: `npx playwright install chromium` once if needed.)

### CI / staging against a running URL

When `BASE_URL` is set to a reachable app (e.g. preview or staging):

```bash
BASE_URL=https://your-preview.example npx tsx scripts/test-api-contract.ts
BASE_URL=https://your-preview.example npx tsx scripts/test-exports.ts
BASE_URL=https://your-preview.example npx tsx scripts/test-requisitions.ts
BASE_URL=https://your-preview.example npx tsx scripts/test-procurement-flow.ts
BASE_URL=https://your-preview.example npx tsx scripts/demo-supply-chain-e2e.ts
```

`demo-supply-chain-e2e.ts` covers requisition → approve → PO → receive → invoice → match → payment → PDF export → activity logs; see [`docs/DEMO_WORKFLOW.md`](DEMO_WORKFLOW.md).

Scripts exit 0 if the server is unreachable (local dev convenience) unless they need a strict failure — check each script’s header comment. Use a **seeded** database for procurement/requisition flows.

---

## Summary

| Step | Command | Purpose |
|------|--------|--------|
| Pull & install | `git pull` then `npm install` | Get latest code and deps |
| Schema | `npm run db:push` | Create/update DB tables |
| Seed | `npm run db:seed` | Create demo users (admin/planner/viewer, Admin123!) |
| Build | `npm run build` | Verify compile |
| Run app | `npm run dev` | Start server (no pool error) |
| Test login API | `npm run test:login` | Check login endpoint and error messages |
| Manual login | Browser → login with admin / Admin123! | Confirm UI and clear errors |

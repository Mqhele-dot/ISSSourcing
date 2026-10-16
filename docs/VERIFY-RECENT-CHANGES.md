# Verifying Recent Changes

These steps **guarantee** that the Radix Select fix, CSV export (Excel-friendly), QueryState error handling, and related changes work and stay correct.

## One command (recommended)

```bash
npm run verify:changes
```

This runs, in order:

1. **Radix Select guard** – Scans `client/src` for any `<SelectItem value="">`. If found, the script exits with an error (empty Select value can crash Radix). All optional selects must use the `__none__` sentinel instead.
2. **CSV tests** – Asserts that CSV output has:
   - UTF-8 BOM (first 3 bytes `0xEF 0xBB 0xBF`) so Excel detects encoding
   - A `sep=,` line so Excel splits columns correctly
   - CRLF (`\r\n`) line endings for Excel compatibility
3. **Production build** – Runs `vite build` and `esbuild` for the server. Exits with an error if the build fails.

If `verify:changes` exits with code 0, these behaviors are verified.

## Individual checks

| What | Command |
|------|--------|
| No empty Select values | Part of `npm run verify:changes` (no standalone command) |
| CSV BOM + sep=, + CRLF | `npm run test:csv` |
| App builds | `npm run build` |
| E2E (dashboard, reports, settings, exports) | Start app, then `npm run test:e2e` |

## E2E tests (optional)

With the app running on port 5000 (and logged in if your app requires auth):

```bash
npx playwright install chromium   # once
npm run dev                        # in one terminal
npm run test:e2e                   # in another
```

E2E tests confirm that `/dashboard`, `/reports`, and `/settings` load without crashing and that export actions trigger downloads.

## CI

In CI, run **after** `npm install`:

```bash
npm run verify:changes
```

Optionally add `npm run test:e2e` if the app is started (e.g. in a job that runs the server and then runs Playwright).

## After production / staging deploy

See **[DEPLOYMENT.md — Post-deploy verification](DEPLOYMENT.md#post-deploy-verification-smoke)** (`test-api-contract`, currency POST check, export PDF smoke).

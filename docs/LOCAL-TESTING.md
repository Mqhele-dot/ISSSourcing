# Local Testing

Use these commands to test the app from the local Windows workspace without using Codespaces.

## Quick App Check

```powershell
node scripts/run-local-tests.mjs
```

This starts `npm run dev` on `http://127.0.0.1:5000` in API-only test mode, waits for `/api/ready`, runs the core supplier/defaults and diagnostics checks, then stops the server. API-only mode keeps automated checks local and avoids depending on the Codespaces forwarded URL or the browser dev server.

## Delta Release Check

```powershell
node scripts/run-local-tests.mjs --delta
```

This runs the quick checks plus the server-backed AP, procurement, export, smoke, setup, and installable-app delta gate.

## Reuse An Already Running Server

```powershell
npm run dev
node scripts/run-local-tests.mjs --no-server
```

Use this when you want to keep the app open while tests run. Set a different port if needed:

```powershell
$env:PORT="5100"
$env:BASE_URL="http://127.0.0.1:5100"
node scripts/run-local-tests.mjs
```

## Open The Full App Locally

```powershell
npm run dev
```

Then open the local URL printed in the terminal, usually `http://127.0.0.1:5000`. This is the full browser app for manual UI testing.

## Browser Walkthrough With Screenshots

```powershell
node scripts/run-local-browser-walkthrough.mjs
```

This opens the full local app, signs in as the admin demo user, visits the main operating sections, clicks common controls, and saves screenshots to `test-results/local-browser-walkthrough`. Use this when we need proof that pages, buttons, dialogs, and feature surfaces are working without touching Codespaces.

The walkthrough uses local Chrome by default. If the full UI cannot compile because local dependencies are cloud-placeholder files, refresh the local install once with `npm ci`, then rerun `node scripts/run-local-browser-walkthrough.mjs`.

If npm or OneDrive leaves `node_modules` in a placeholder or partial state, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/repair-windows-install.ps1
```

This rebuilds dependencies with a project-local npm cache and npm 10, then runs `npm run check`.

## Codespace / Remote Browser Walkthrough

Use this when local OneDrive dependency placeholders block Vite, or when an agent/browser session needs to test the app through the Codespace URL:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://your-codespace-5000.app.github.dev"
node scripts/run-remote-browser-walkthrough.mjs
```

This does not start a local server. It probes `/api/ready` and `/auth`, opens the remote app, logs in as the admin demo user, clicks the walkthrough controls, and writes screenshots to `test-results/remote-browser-walkthrough`.

In Codespaces, set port `5000` to `Public` before running the remote browser walkthrough.

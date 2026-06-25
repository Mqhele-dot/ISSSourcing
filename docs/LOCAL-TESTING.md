# Local Testing

Use these commands to test the app from the local Windows workspace without using Codespaces.

## Quick App Check

```powershell
npm run test:local
```

This starts `npm run dev` on `http://127.0.0.1:5000` in API-only test mode, waits for `/api/ready`, runs the core supplier/defaults and diagnostics checks, then stops the server. API-only mode keeps automated checks local and avoids depending on the Codespaces forwarded URL or the browser dev server.

## Start And Probe The Local App

```powershell
npm run local:up
```

This starts or reuses the full local app, waits until both `/api/ready` and `/auth` are reachable, prints the matching `curl` checks, and then keeps the server attached to the terminal until you stop it.

In a second terminal:

```powershell
npm run local:doctor
curl -i http://127.0.0.1:5000/api/ready
curl -i http://127.0.0.1:5000/auth
```

## Delta Release Check

```powershell
npm run test:local:delta
```

This runs the quick checks plus the server-backed AP, procurement, export, smoke, setup, and installable-app delta gate.

## Reuse An Already Running Server

```powershell
npm run dev
npm run test:local:no-server
```

Use this when you want to keep the app open while tests run. Set a different port if needed:

```powershell
$env:PORT="5100"
$env:BASE_URL="http://127.0.0.1:5100"
npm run test:local
```

## Open The Full App Locally

```powershell
npm run dev
```

Then open the local URL printed in the terminal, usually `http://127.0.0.1:5000`. This is the full browser app for manual UI testing.

## Browser Walkthrough With Screenshots

```powershell
npm run test:local:browser
```

This opens the full local app, signs in as the admin demo user, visits the main operating sections, clicks common controls, and saves screenshots to `test-results/local-browser-walkthrough`. Use this when we need proof that pages, buttons, dialogs, and feature surfaces are working without touching Codespaces.

The walkthrough uses local Chrome by default. If the full UI cannot compile because local dependencies are cloud-placeholder files, refresh the local install once with `npm ci`, then rerun `npm run test:local:browser`.

## Target A Single Route

```powershell
npm run test:local:url
$env:LOCAL_BROWSER_TEST_PATH="/inventory/cycle-counts"; npm run test:local:url
$env:LOCAL_BROWSER_TEST_PATH="/operations/control-tower"; npm run test:local:url
$env:LOCAL_BROWSER_TEST_PATH="/m/counts"; npm run test:local:url
```

Use `LOCAL_BROWSER_EXPECT_TEXT` when a route needs an explicit content assertion:

```powershell
$env:LOCAL_BROWSER_TEST_PATH="/m/counts"
$env:LOCAL_BROWSER_EXPECT_TEXT="count"
npm run test:local:url
```

The route smoke helper logs in as the admin demo user, opens the requested route, verifies the app stays out of `/auth`, confirms a visible `<main>` shell, and saves a screenshot to `test-results/local-url-smoke`.

If npm or OneDrive leaves `node_modules` in a placeholder or partial state, run:

```powershell
npm run repair:win-install
```

This rebuilds dependencies with a project-local npm cache and npm 10, then runs `npm run check`.

## Codespace / Remote Browser Walkthrough

Use this when local OneDrive dependency placeholders block Vite, or when an agent/browser session needs to test the app through the Codespace URL:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://your-codespace-5000.app.github.dev"
npm run test:codespace:browser
```

This does not start a local server. It probes `/api/ready` and `/auth`, opens the remote app, logs in as the admin demo user, clicks the walkthrough controls, and writes screenshots to `test-results/remote-browser-walkthrough`.

In Codespaces, set port `5000` to `Public` before running the remote browser walkthrough.

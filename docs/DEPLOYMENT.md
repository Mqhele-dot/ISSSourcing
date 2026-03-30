# Deployment

**Local Windows development** (not production deploy): **[`WINDOWS-LOCAL-SETUP.md`](./WINDOWS-LOCAL-SETUP.md)**.

## Running behind a reverse proxy with TLS

For production, run the Node app behind a reverse proxy (e.g. nginx or Caddy) and terminate TLS at the proxy.

### 1. Run the app

- Build: `npm run build`
- Run: `PORT=5000 node dist/index.js` (or use the root `Dockerfile` with `DATABASE_URL` and `SESSION_SECRET`).
- The app listens on `HOST:PORT` (default `0.0.0.0:5000`). Bind to `127.0.0.1:5000` if only the proxy should reach it.

### 2. Nginx with TLS

- Copy and edit the example config:
  - `cp deploy/nginx.conf.example deploy/nginx.conf`
  - Set `server_name` to your domain.
  - Set `ssl_certificate` and `ssl_certificate_key` to your TLS cert and key (e.g. Let's Encrypt: `certbot certonly --nginx` then use `/etc/letsencrypt/live/your-domain/`).
- Test and reload:
  - `sudo nginx -t && sudo systemctl reload nginx`

### 3. Caddy (alternative)

Caddy obtains and renews TLS certificates automatically. Example `Caddyfile`:

```text
your-domain.example.com {
    reverse_proxy 127.0.0.1:5000
}
```

Run: `caddy run --config Caddyfile`

### 4. Environment

- Set `DATABASE_URL` and `SESSION_SECRET` (and optional `PORT`) in the environment where the Node process runs.
- Ensure the app trusts the proxy (it uses `X-Forwarded-Proto` and `X-Forwarded-For` when present).

See `.env.production.example` and `docs/ENV-CONFIG.md` for variables.

After pulling releases that add `users.supplier_id` / `users.approver_amount_limit`, run **`npm run db:push`** (or rely on `init-db` alters if you use the raw SQL path) so Postgres matches `shared/schema.ts`.

## PWA (install on phone / tablet)

- The app ships [`client/public/manifest.webmanifest`](../client/public/manifest.webmanifest) and a minimal [`client/public/sw.js`](../client/public/sw.js). The service worker is registered in production builds (`client/src/main.tsx`).
- Serve the site over **HTTPS** (or `localhost`); browsers require a secure context for service workers and “Add to Home Screen”.
- After `npm run build`, static assets under `dist/public` must be reachable at `/manifest.webmanifest` and `/sw.js` (Vite embeds `public/` into the build output).
- On mobile: open the deployed URL in Chrome or Safari, use **Add to Home Screen** / **Install app** when offered.

## Post-deploy verification (smoke)

After each deploy to an environment you can reach over HTTP:

1. **API contract** (optional): `BASE_URL=https://your-host npx tsx scripts/test-api-contract.ts`  
   - Skips gracefully if the server is down; with a healthy app checks login, inventory shape, currencies, etc.

2. **Currency POST path** (manual): authenticated `POST /api/currencies` with `code` + `name` and **omit** `symbol` — response row should include a non-empty `symbol` (server normalizes before zod). Confirm in browser Network tab if testing from the UI.

3. **Dedicated export PDFs** (optional): with admin session, `GET /api/export/purchase_orders/pdf` and `GET /api/export/purchase_requisitions/pdf` should return `Content-Type: application/pdf` and a body starting with `%PDF-`.

4. **Export matrix** (optional): `BASE_URL=https://your-host npx tsx scripts/test-exports.ts` — checks PDF/CSV/Excel across inventory, suppliers, POs, requisitions, activity logs, warehouses.

5. **Supply-chain demo** (optional): `BASE_URL=https://your-host npx tsx scripts/demo-supply-chain-e2e.ts` — full API walk (requisition → receipt → invoice → payment → export → activity); see [`docs/DEMO_WORKFLOW.md`](DEMO_WORKFLOW.md).

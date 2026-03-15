# Deployment

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

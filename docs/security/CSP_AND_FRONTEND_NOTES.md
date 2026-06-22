# CSP / frontend posture (InvTrack)

## Server CSP (Helmet)

[`server/bootstrap/security-middleware.ts`](../../server/bootstrap/security-middleware.ts) configures **Helmet** with:

- **`script-src`**:  
  - **Production / hosted packaged API** (`appEnv.isProduction === true`): **`'self'` only** — the Vite prod bundle emits **external** hashed script tags (`type="module"`), **not** reliance on permissive CSP for inline bundles. Dev (`npm run dev`) and non-production **`NODE_ENV`** keep **`'unsafe-inline'`** so Vite transforms, injected preamble, and HMR websocket flows keep working without nonces yet.
  - *(Prototype outcome)* **Nonce / strict-dynamic** was deferred: injecting per-request nonces requires coordinated `vite build`/`transformIndexHtml` + Express HTML plumbing; see gap below.

- **`img-src`**: allows `data:`, `blob:`, **`https:`** (remote branding / Cloudinary / CDNs).

- **`connect-src`**: `'self'`, **`ws:/wss:`** (local dev/Vite/HMR), `https:`.

- **`HSTS`** only when **`NODE_ENV=production`**.

### Gap / follow-up (nonce roadmap)

Migrating **`'unsafe-inline'`** scripts in **development** remains tied to:

1. Passing a CSP nonce through the Vite middleware / [`server/vite.ts`](../../server/vite.ts) index template pathway.
2. Teaching Vite **`transformIndexHtml`** to annotate `<script>` tags with **`nonce`** while preserving HMR client injection semantics.

Production no longer relies on permissive **`script-src`**, but **`style-src`** still inherits Helmets defaults / inline allowances needed for Tailwind-critical **inline `<style>`** blocks in **`dist/public/index.html`**. Tightening **styles** implies build-time hashing or splitting theme CSS entirely into external bundles.

## dangerous patterns scan

| Pattern | Locations | Notes |
|---------|-----------|-------|
| `dangerouslySetInnerHTML` | `client/src/components/ui/chart.tsx` | Builds **scoped CSS variables** only from curated theme keys—does not ingest raw user HTML |
| `eval` / `new Function` | *none found* (`client/src`) | Periodic re-scan: `grep -R "dangerouslySetInnerHTML"` |

## Diagnostics / secrets

Diagnostics redaction heuristic is in [`server/diagnostics/server-diagnostics-store.ts`](../../server/diagnostics/server-diagnostics-store.ts) (`SENSITIVE_KEY_RE`).

## Cookies / Same-Origin posture

Sessions use **`httpOnly`, `sameSite=lax`, `secure: auto`** (`express-session`), see [`server/auth.ts`](../../server/auth.ts).
No separate **CORS** middleware—the SPA is served **same-origin** with the API in bundled deployments (`registerRoutes`), reducing wildcard CORS misuse.

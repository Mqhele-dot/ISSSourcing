# Triaging “Could not load product setup status”

The **exact** root cause in production depends on the failing request. Use this table to map symptoms to dependencies.

| Browser / UI symptom | Likely cause | Confirm |
|---------------------|--------------|---------|
| Banner / gate message, **HTTP 401** on `GET /api/setup/status` | No valid session for that request (cookie, proxy, or timing vs `/api/user`) | Network tab: status 401; compare `Set-Cookie` / request cookies with `/api/user` |
| Same message, **HTTP 5xx** | Server or proxy error before **`sendOk`** (rare after top-level handler guard) | Response body; server logs `[SETUP_STATUS] SETUP_STATUS_UNHANDLED` |
| Same message, **HTTP 200** but UI still errors | Client did not unwrap JSON (`ok` envelope), empty body, or **`data: null`** | Response body shape vs `invTrackFetch` in `client/src/lib/queryClient.ts` |
| **Intermittent** | Timeouts (**408**), focus refetch churn, cold start | Correlate with **`X-Request-Id`** and `[SETUP_STATUS] summary` log line |
| Diagnostics show **`setupStatusHealth: degraded`** only with **warning** codes | Should **not** happen after follow-up stabilization; if it does, report a bug | Check each issue’s **`level`** in JSON |

## Server-side steps (authenticated handler)

1. **`ensureAuthenticated`** → 401 if not logged in.
2. **Active org** → `getActiveOrganizationId()` (defaults to org **1** if ALS unset).
3. **Critical path**: org row, **`storage.getAppSettings()`**, DB **`SELECT 1`**.
4. **Warnings only**: **`getProductBootstrapHints`**, **`__drizzle_migrations`** count, **export job** diagnostic.

## What to attach for support

- HAR or Network export for **`/api/setup/status`** and **`/api/ready`**.
- **System diagnostics → Copy diagnostics JSON**.
- Server log lines containing **`[SETUP_STATUS]`** for the same **`X-Request-Id`**.

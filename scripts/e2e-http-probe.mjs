/**
 * Shared HTTP probes for E2E preflight and run-playwright-e2e.mjs.
 */

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, redirect?: RequestRedirect }} [options]
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, elapsedMs: number }>}
 */
export async function probeUrl(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const redirect = options.redirect ?? "follow";
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, redirect });
    clearTimeout(t);
    return { ok: true, status: res.status, elapsedMs: Date.now() - started };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message, elapsedMs: Date.now() - started };
  }
}

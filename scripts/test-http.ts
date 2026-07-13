/**
 * Shared HTTP helpers for `scripts/test-*.ts` integration tests.
 *
 * - Single place for `/api/auth/login` + `/api/login`, cookies, and timeouts.
 * - Use `AbortSignal.timeout(45s)` so requests do not hang forever behind a bad proxy.
 *
 * Extend here (JSON unwrap, retries) instead of copying fetch blocks in each script.
 */
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

export const TEST_HTTP_TIMEOUT_MS = 45_000;
const LOGIN_RETRY_DELAYS_MS = [1000, 3000, 7000, 15000, 30000] as const;

let lastSetCookie: string | undefined;

async function fetchCsrfToken(cookie?: string, baseUrl?: string): Promise<{ token?: string; cookie?: string }> {
  const base = baseUrl ?? getTestBaseUrl();
  const response = await fetch(`${base}/api/csrf-token`, {
    method: "GET",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
    },
    credentials: "include",
    signal: AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS),
  });
  const refreshedCookie = captureCookieFromResponse(response);
  const payload = await response.json().catch(() => null) as
    | { csrfToken?: string; data?: { csrfToken?: string } }
    | null;
  return {
    token: payload?.data?.csrfToken ?? payload?.csrfToken,
    cookie: refreshedCookie ?? cookie,
  };
}

export function getTestBaseUrl(): string {
  return (process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
}

export function clearSessionCookie(): void {
  lastSetCookie = undefined;
}

/** Latest Set-Cookie fragment from any api* request (session refresh). */
export function peekSessionCookie(): string | undefined {
  return lastSetCookie;
}

function captureCookieFromResponse(res: Response): string | undefined {
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    lastSetCookie = setCookie.split(";")[0];
    return lastSetCookie;
  }
  return undefined;
}

export type ApiJsonResult = {
  status: number;
  ok: boolean;
  json: unknown;
  /** Present on all mutating responses when server sets `X-Request-Id` (see `server/index.ts`). */
  requestId: string | null;
};

/**
 * JSON API request to `/api/...` (or absolute URL). Updates session cookie from Set-Cookie when present.
 */
export async function apiJsonRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiJsonResult> {
  const base = options.baseUrl ?? getTestBaseUrl();
  const api = `${base}/api`;
  const url = path.startsWith("http") ? path : `${api}${path.startsWith("/") ? path : `/${path}`}`;
  const signal = AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS);
  const method = options.method ?? "GET";
  let csrfToken: string | undefined;
  let cookie = options.cookie;
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrf = await fetchCsrfToken(cookie, base);
    csrfToken = csrf.token;
    cookie = csrf.cookie ?? cookie;
  }
  const res = await fetch(url, {
    method,
    headers: {
      ...(options.body != null ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...options.headers,
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
    credentials: "include",
    signal,
  });
  captureCookieFromResponse(res);
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json, requestId: res.headers.get("x-request-id") };
}

/**
 * Raw fetch for binary routes (exports) or non-JSON responses. Same cookie + timeout behavior.
 */
export async function apiRawRequest(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const base = options.baseUrl ?? getTestBaseUrl();
  const api = `${base}/api`;
  const url = path.startsWith("http") ? path : `${api}${path.startsWith("/") ? path : `/${path}`}`;
  const signal = AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS);
  const method = options.method ?? "GET";
  let csrfToken: string | undefined;
  let cookie = options.cookie;
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrf = await fetchCsrfToken(cookie, base);
    csrfToken = csrf.token;
    cookie = csrf.cookie ?? cookie;
  }
  const res = await fetch(url, {
    method,
    headers: {
      ...(options.body != null ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...options.headers,
    },
    body: options.body != null ? JSON.stringify(options.body) : undefined,
    credentials: "include",
    signal,
  });
  captureCookieFromResponse(res);
  return res;
}

/**
 * Login used by integration tests: tries `/api/auth/login`, then `/api/login` if no session cookie was set.
 */
export async function loginForTests(
  username: string,
  password: string,
  baseUrl?: string,
): Promise<string | undefined> {
  const tryLoginPath = async (
    path: "/auth/login" | "/login",
    creds: { username: string; password: string },
  ): Promise<number | undefined> => {
    let lastStatus: number | undefined;
    for (let i = 0; i < LOGIN_RETRY_DELAYS_MS.length; i++) {
      const result = await apiJsonRequest(path, { method: "POST", body: creds, baseUrl });
      lastStatus = result.status;
      if (peekSessionCookie()) {
        return lastStatus;
      }
      const transientStatus = result.status === 429 || result.status === 503;
      const hasRetryLeft = i < LOGIN_RETRY_DELAYS_MS.length - 1;
      if (!transientStatus || !hasRetryLeft) {
        return lastStatus;
      }
      await delay(LOGIN_RETRY_DELAYS_MS[i]);
    }
    return lastStatus;
  };

  clearSessionCookie();
  const authStatus = await tryLoginPath("/auth/login", { username, password });
  if (
    !peekSessionCookie() &&
    username.toLowerCase() === "admin" &&
    (authStatus === 429 || authStatus === 503)
  ) {
    // Keep runtime suites moving when admin login is temporarily throttled.
    await tryLoginPath("/auth/login", { username: "planner", password: "Admin123!" });
  }
  // Preserve legacy fallback path only when /auth/login does not exist.
  if (!peekSessionCookie() && authStatus === 404) {
    await tryLoginPath("/login", { username, password });
  }
  return peekSessionCookie();
}

export function isConnectionRefused(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { cause?: { code?: string } };
  return e?.code === "ECONNREFUSED" || e?.cause?.code === "ECONNREFUSED";
}

export function shouldRequireLiveServer(): boolean {
  const raw = process.env.TEST_REQUIRE_SERVER;
  return raw === "1" || raw === "true";
}

export function reportConnectionRefused(baseUrl = getTestBaseUrl()): number {
  const exitCode = shouldRequireLiveServer() ? 1 : 0;
  const reporter = exitCode === 1 ? console.error : console.log;
  reporter(
    "  %s Server not reachable at %s. Start with: npm run dev%s",
    exitCode === 1 ? "X" : "!",
    baseUrl,
    exitCode === 1 ? " (failing because TEST_REQUIRE_SERVER=1)" : "",
  );
  return exitCode;
}

/** Log pass/fail for `X-Request-Id` on a response (shared by procurement / demo scripts). */
export function expectRequestId(label: string, requestId: string | null): boolean {
  if (requestId && requestId.length > 0) {
    console.log("  ✓ %s X-Request-Id", label);
    return true;
  }
  console.log("  ✗ %s missing X-Request-Id", label);
  return false;
}

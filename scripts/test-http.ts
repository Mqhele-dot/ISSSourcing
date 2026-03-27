/**
 * Shared HTTP helpers for `scripts/test-*.ts` integration tests.
 *
 * - Single place for `/api/auth/login` + `/api/login`, cookies, and timeouts.
 * - Use `AbortSignal.timeout(45s)` so requests do not hang forever behind a bad proxy.
 *
 * Extend here (JSON unwrap, retries) instead of copying fetch blocks in each script.
 */
import process from "node:process";

export const TEST_HTTP_TIMEOUT_MS = 45_000;

let lastSetCookie: string | undefined;

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

function captureCookieFromResponse(res: Response): void {
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    lastSetCookie = setCookie.split(";")[0];
  }
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
  } = {},
): Promise<ApiJsonResult> {
  const base = options.baseUrl ?? getTestBaseUrl();
  const api = `${base}/api`;
  const url = path.startsWith("http") ? path : `${api}${path.startsWith("/") ? path : `/${path}`}`;
  const signal = AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS);
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body != null ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
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
  } = {},
): Promise<Response> {
  const base = options.baseUrl ?? getTestBaseUrl();
  const api = `${base}/api`;
  const url = path.startsWith("http") ? path : `${api}${path.startsWith("/") ? path : `/${path}`}`;
  const signal = AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS);
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body != null ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
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
  clearSessionCookie();
  await apiJsonRequest("/auth/login", { method: "POST", body: { username, password }, baseUrl });
  if (!peekSessionCookie()) {
    await apiJsonRequest("/login", { method: "POST", body: { username, password }, baseUrl });
  }
  return peekSessionCookie();
}

export function isConnectionRefused(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { cause?: { code?: string } };
  return e?.code === "ECONNREFUSED" || e?.cause?.code === "ECONNREFUSED";
}

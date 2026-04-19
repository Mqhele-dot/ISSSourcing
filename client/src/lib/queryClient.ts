import type { QueryFunction } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { setFallbackState } from "./fallback-store";
import { actionErrorStore } from "./action-error-store";

type ApiErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    requestId?: string;
    details?: unknown;
  };
};

type ApiSuccessEnvelope<T> = {
  ok: true;
  data: T;
  meta?: { fallback?: string };
};

function isApiEnvelope<T>(value: unknown): value is ApiErrorEnvelope | ApiSuccessEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok?: unknown }).ok === "boolean"
  );
}

async function parseJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatServerErrorPayload(payload: unknown): string | null {
  if (isApiEnvelope(payload) && !payload.ok) {
    const codePrefix = payload.error.code ? `[${payload.error.code}] ` : "";
    return `${codePrefix}${payload.error.message}`;
  }
  if (typeof payload === "object" && payload !== null) {
    const maybeFunction = "functionName" in payload ? (payload as { functionName?: unknown }).functionName : undefined;
    const maybeMessage = "message" in payload ? (payload as { message?: unknown }).message : undefined;
    const maybeDetails = "details" in payload ? (payload as { details?: unknown }).details : undefined;
    const fn = typeof maybeFunction === "string" ? maybeFunction : "";
    const msg = typeof maybeMessage === "string" ? maybeMessage : "";
    const details =
      typeof maybeDetails === "string"
        ? maybeDetails
        : maybeDetails != null
          ? JSON.stringify(maybeDetails)
          : "";
    const combined = [fn ? `[${fn}]` : "", msg, details].filter(Boolean).join(" ");
    return combined || null;
  }
  if (typeof payload === "string" && payload.trim()) return payload;
  return null;
}

function getRequestIdFromPayload(payload: unknown): string | undefined {
  if (isApiEnvelope(payload) && !payload.ok) {
    return payload.error.requestId;
  }
  if (payload && typeof payload === "object" && "requestId" in payload) {
    const value = (payload as { requestId?: unknown }).requestId;
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function extractApiErrorCode(payload: unknown): string | undefined {
  if (isApiEnvelope(payload) && !payload.ok) {
    return payload.error.code;
  }
  return undefined;
}

function reportRequestError(params: {
  method: string;
  url: string;
  status?: number;
  reason: string;
  payload?: unknown;
  requestPayload?: unknown;
  requestId?: string;
  payloadSummary?: string;
  stack?: string;
}) {
  if (shouldSuppressGlobalError(params.method, params.status, params.url)) {
    return;
  }
  actionErrorStore.push({
    method: params.method,
    endpoint: params.url,
    status: params.status,
    reason: params.reason,
    requestId: params.requestId ?? getRequestIdFromPayload(params.payload),
    module: inferModuleName(params.url),
    action: inferActionName(params.method, params.url),
    payloadSummary: params.payloadSummary,
    retryMethod: params.method,
    retryEndpoint: params.url,
    retryPayload: params.requestPayload,
    stack: isDevRuntime ? params.stack : undefined,
    lastGoodResponse: lastGoodByEndpoint.get(params.url),
    raw: params.payload,
  });
}

function shouldSuppressGlobalError(method: string, status: number | undefined, url: string): boolean {
  if (status !== 401) return false;
  if (method.toUpperCase() !== "GET") return false;
  const path = normalizeEndpointPath(url);
  // Anonymous bootstrap: session probe and auth/session discovery should not spam GlobalActionErrorCenter.
  if (path === "/api/user" || path === "/api/me") return true;
  if (path.startsWith("/api/auth/")) return true;
  // Normalize trailing variants (some callers use /api/auth/me vs /auth)
  if (path === "/auth" || path.startsWith("/auth/")) return true;
  return false;
}

function normalizeEndpointPath(url: string): string {
  const withoutQuery = url.split("?")[0]?.split("#")[0] ?? url;
  if (withoutQuery.startsWith("/")) return withoutQuery;
  try {
    return new URL(url).pathname;
  } catch {
    return withoutQuery;
  }
}

/** Set after `queryClient` is created — clears stale cached user when APIs return 401 */
let invalidateUserQueryOn401: (() => void) | null = null;
let csrfTokenCache: string | null = null;
let csrfTokenInFlight: Promise<string> | null = null;

function isMutationMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE";
}

async function fetchCsrfToken(): Promise<string> {
  const response = await fetch("/api/csrf-token", {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to refresh CSRF token.");
  }

  const payload = (await response.json()) as
    | { csrfToken?: string }
    | { data?: { csrfToken?: string } };
  const token =
    "data" in payload
      ? payload.data?.csrfToken
      : (payload as { csrfToken?: string }).csrfToken;
  if (!token) {
    throw new Error("Server did not return a CSRF token.");
  }
  csrfTokenCache = token;
  return token;
}

export async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && csrfTokenCache) {
    return csrfTokenCache;
  }
  if (!forceRefresh && csrfTokenInFlight) {
    return csrfTokenInFlight;
  }

  csrfTokenInFlight = fetchCsrfToken().finally(() => {
    csrfTokenInFlight = null;
  });
  return csrfTokenInFlight;
}

export async function buildRequestHeaders(
  method: string,
  headers?: HeadersInit,
  options?: { contentType?: string | false },
): Promise<Headers> {
  const built = new Headers(headers ?? {});

  if (options?.contentType !== false && options?.contentType && !built.has("Content-Type")) {
    built.set("Content-Type", options.contentType);
  }

  if (isMutationMethod(method)) {
    built.set("X-CSRF-Token", await getCsrfToken());
  }

  return built;
}

/**
 * When the server rejects a request as unauthenticated, force `/api/user` to refetch.
 * Avoids a stuck UI: default query staleTime can keep a logged-in user in cache after sessions are reset or cookies are invalid.
 */
function scheduleAuthInvalidateOn401(status: number, method: string, url: string) {
  if (status !== 401) return;
  const path = normalizeEndpointPath(url);
  /** `/api/user` uses on401 returnNull — cache is already cleared; invalidating would refetch in a tight loop */
  if (path === "/api/user") return;
  const m = method.toUpperCase();
  if (path === "/api/login" || path === "/api/auth/login") return;
  if (path === "/api/register" && m === "POST") return;
  if (path === "/api/logout" && m === "POST") return;
  queueMicrotask(() => invalidateUserQueryOn401?.());
}

function summarizeRequestPayload(data: unknown): string | undefined {
  if (data == null) return undefined;
  if (typeof data === "string") return data.slice(0, 300);
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return String(data).slice(0, 300);
  }
}

function reportNetworkFailure(params: {
  method: string;
  url: string;
  error: unknown;
  requestPayload?: unknown;
}) {
  const reason =
    params.error instanceof Error
      ? params.error.name === "AbortError"
        ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : params.error.message
      : String(params.error);
  reportRequestError({
    method: params.method,
    url: params.url,
    reason,
    payload:
      params.error instanceof Error
        ? {
            name: params.error.name,
            message: params.error.message,
          }
        : params.error,
    requestPayload: params.requestPayload,
    payloadSummary: summarizeRequestPayload(params.requestPayload),
    stack: isDevRuntime ? new Error().stack : undefined,
  });
}

function isLikelyTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  if (error.name === "TypeError") return true;
  const message = error.message.toLowerCase();
  return message.includes("network") || message.includes("fetch");
}

async function throwIfResNotOk(res: Response, context?: { method?: string; url?: string }) {
  if (!res.ok) {
    const payload = await parseJsonOrText(res);
    const message = formatServerErrorPayload(payload) ?? res.statusText;
    scheduleAuthInvalidateOn401(res.status, context?.method ?? "UNKNOWN", context?.url ?? res.url);
    reportRequestError({
      method: context?.method ?? "UNKNOWN",
      url: context?.url ?? res.url,
      status: res.status,
      reason: message,
      payload,
      requestPayload: undefined,
      requestId: res.headers.get("X-Request-Id") ?? undefined,
      stack: isDevRuntime ? new Error().stack : undefined,
    });
    throw new Error(`${res.status}: ${message}`);
  }
}

/** Slightly above server operational timeout (8s) so server fallback returns first */
const REQUEST_TIMEOUT_MS = 12000;

export type InvTrackMeta = { fallback?: string; endpoint?: string };
const lastGoodByEndpoint = new Map<string, unknown>();
const isDevRuntime = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

function inferModuleName(url: string): string {
  const clean = url.startsWith("/") ? url.slice(1) : url;
  const parts = clean.split("/");
  const apiIndex = parts[0] === "api" ? 1 : 0;
  const segment = parts[apiIndex] ?? "unknown";
  return segment.replace(/-/g, " ");
}

function inferActionName(method: string, url: string): string {
  const module = inferModuleName(url);
  const verb =
    method.toUpperCase() === "POST"
      ? "Create/Run"
      : method.toUpperCase() === "PATCH" || method.toUpperCase() === "PUT"
        ? "Update"
        : method.toUpperCase() === "DELETE"
          ? "Delete"
          : "Fetch";
  return `${verb} ${module}`;
}

/**
 * Single central fetch: same timeout, credentials, envelope unwrap, and X-InvTrack-* / meta.
 * Updates fallback store when response has fallback; clears store when response is ok with no fallback.
 */
export async function invTrackFetch<T>(
  method: string,
  url: string,
  data?: unknown,
): Promise<{ data: T; meta: InvTrackMeta }> {
  let csrfRetried = false;

  for (;;) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      const headers = await buildRequestHeaders(method, undefined, {
        contentType: data != null ? "application/json" : false,
      });
      res = await fetch(url, {
        method,
        headers,
        body: data != null ? JSON.stringify(data) : undefined,
        credentials: "include",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (isLikelyTransportError(err)) {
        reportNetworkFailure({ method, url, error: err, requestPayload: data });
      }
      if (err instanceof Error && err.name === "AbortError") {
        const timeoutError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`) as Error & { status?: number };
        timeoutError.status = 408;
        throw timeoutError;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
    clearTimeout(timeoutId);

    const headerFallback = res.headers.get("X-InvTrack-Fallback") ?? undefined;
    const headerEndpoint = res.headers.get("X-InvTrack-Endpoint") ?? undefined;

    if (!res.ok) {
      const payload = await parseJsonOrText(res);
      if (
        !csrfRetried &&
        res.status === 403 &&
        isMutationMethod(method) &&
        extractApiErrorCode(payload) === "CSRF_TOKEN_INVALID"
      ) {
        csrfTokenCache = null;
        await getCsrfToken(true);
        csrfRetried = true;
        continue;
      }
      const msg = formatServerErrorPayload(payload) ?? res.statusText;
      scheduleAuthInvalidateOn401(res.status, method, url);
      reportRequestError({
        method,
        url,
        status: res.status,
        reason: msg,
        payload,
        requestPayload: data,
        requestId: res.headers.get("X-Request-Id") ?? undefined,
        payloadSummary: summarizeRequestPayload(data),
        stack: isDevRuntime ? new Error().stack : undefined,
      });
      const err = new Error(`${res.status}: ${msg}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    if (res.status === 204 || res.headers.get("content-length") === "0") {
      setFallbackState(headerFallback ?? null, headerEndpoint ?? null);
      lastGoodByEndpoint.set(url, { status: 204 });
      return { data: undefined as T, meta: { fallback: headerFallback, endpoint: headerEndpoint } };
    }

    const payload = await parseJsonOrText(res);
    const fallbackRaw = headerFallback ?? (payload && typeof payload === "object" && "meta" in payload && (payload as { meta?: { fallback?: string } }).meta?.fallback);
    const endpointRaw = headerEndpoint ?? (payload && typeof payload === "object" && "meta" in payload && (payload as { meta?: { endpoint?: string } }).meta?.endpoint);
    setFallbackState(typeof fallbackRaw === "string" ? fallbackRaw : null, typeof endpointRaw === "string" ? endpointRaw : null);

    if (isApiEnvelope<T>(payload)) {
      if (payload.ok) {
        const success = payload as ApiSuccessEnvelope<T>;
        lastGoodByEndpoint.set(url, success.data);
        return {
          data: success.data as T,
          meta: {
            fallback: success.meta?.fallback ?? headerFallback,
            endpoint: headerEndpoint,
          },
        };
      }
      const codePrefix = payload.error.code ? `[${payload.error.code}] ` : "";
      scheduleAuthInvalidateOn401(res.status, method, url);
      reportRequestError({
        method,
        url,
        status: res.status,
        reason: `${codePrefix}${payload.error.message}`,
        payload,
        requestPayload: data,
        requestId: res.headers.get("X-Request-Id") ?? payload.error.requestId,
        payloadSummary: summarizeRequestPayload(data),
        stack: isDevRuntime ? new Error().stack : undefined,
      });
      const err = new Error(`${codePrefix}${payload.error.message}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    lastGoodByEndpoint.set(url, payload as T);
    return {
      data: payload as T,
      meta: { fallback: headerFallback, endpoint: headerEndpoint },
    };
  }
}

/** Legacy: returns Response. Still uses timeout + credentials; sets fallback from X-InvTrack-* headers only. */
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers = await buildRequestHeaders(method, undefined, {
      contentType: data ? "application/json" : false,
    });
    const res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
    const headerFallback = res.headers.get("X-InvTrack-Fallback");
    const headerEndpoint = res.headers.get("X-InvTrack-Endpoint");
    setFallbackState(headerFallback ?? null, headerEndpoint ?? null);
    await throwIfResNotOk(res, { method, url });
    return res;
  } catch (err) {
    if (isLikelyTransportError(err)) {
      reportNetworkFailure({ method, url, error: err, requestPayload: data });
    }
    if (err instanceof Error && err.name === "AbortError") {
      const timeoutError = new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`) as Error & { status?: number };
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Preferred: single wrapper with envelope unwrap and meta. Use for all new code. */
export async function requestJson<T>(method: string, url: string, data?: unknown): Promise<T> {
  const { data: out } = await invTrackFetch<T>(method, url, data);
  return out;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export function getQueryFn<T>(options: { on401: "throw" }): QueryFunction<T>;
export function getQueryFn<T>(options: { on401: "returnNull" }): QueryFunction<T | null>;
export function getQueryFn<T>(options: { on401: UnauthorizedBehavior }): QueryFunction<T | null> {
  const { on401: unauthorizedBehavior } = options;
  return async ({ queryKey }) => {
    const url = queryKey[0] as string;
    try {
      const { data } = await invTrackFetch<T>("GET", url);
      return data;
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err ? (err as { status: number }).status : undefined;
      if (unauthorizedBehavior === "returnNull" && status === 401) {
        return null;
      }
      throw err;
    }
  };
}

/**
 * Format mutation error for consistent error toasts: action + endpoint + reason.
 * Use in mutation onError: toast({ title: "Action failed", description: formatMutationError(...), variant: "destructive" }).
 */
export function formatMutationError(
  action: string,
  method: string,
  url: string,
  error: unknown,
): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `${action} failed: ${method} ${url} — ${reason}`;
}

/**
 * Normalize list-shaped GET responses per dual contract (see docs/API_CONTRACTS.md).
 * Handles: raw `T[]`, or legacy `{ data: T[] }` when `ok` is absent (not unwrapped as envelope).
 * Note: `{ ok: true, data }` is already unwrapped by `invTrackFetch` before this runs.
 */
export function normalizeApiList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (
    raw &&
    typeof raw === "object" &&
    "data" in raw &&
    Array.isArray((raw as { data: unknown }).data)
  ) {
    return (raw as { data: T[] }).data;
  }
  return [];
}

/**
 * Like {@link normalizeApiList} but logs a dev warning when a 200 body looks like a list endpoint
 * yet `.data` is missing or not an array (silent empty list risk).
 */
export function normalizeApiListStrict<T>(raw: unknown, context?: string): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object" && "data" in raw) {
    const inner = (raw as { data: unknown }).data;
    if (Array.isArray(inner)) return inner as T[];
    if (inner !== undefined && isDevRuntime && context) {
      console.warn(`[${context}] Expected array in response.data, got:`, typeof inner);
    }
    return [];
  }
  if (raw != null && raw !== undefined && isDevRuntime && context) {
    console.warn(`[${context}] Unexpected list response shape:`, typeof raw);
  }
  return [];
}

/** Unwrap operational list response that may include meta.fallback (timeout | db-error | degraded) */
export function unwrapOperationalResponse<T>(
  payload: T | { data: T; meta?: { fallback?: string } },
): { data: T; fallback?: string } {
  if (Array.isArray(payload)) {
    return { data: payload };
  }
  if (
    payload != null &&
    typeof payload === "object" &&
    "data" in payload
  ) {
    const p = payload as { data: T; meta?: { fallback?: string } };
    return { data: p.data, fallback: p.meta?.fallback };
  }
  return { data: payload as T };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      /** Keep list views snappy while avoiding stale dashboards forever */
      staleTime: 60_000,
      gcTime: 30 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

invalidateUserQueryOn401 = () => {
  void queryClient.invalidateQueries({ queryKey: ["/api/user"] });
};

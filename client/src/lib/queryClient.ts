import type { QueryFunction } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { setFallbackState } from "./fallback-store";

type ApiErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
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

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const payload = await parseJsonOrText(res);
    if (isApiEnvelope(payload) && !payload.ok) {
      const codePrefix = payload.error.code ? `[${payload.error.code}] ` : "";
      throw new Error(`${res.status}: ${codePrefix}${payload.error.message}`);
    }
    if (
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
    ) {
      throw new Error(`${res.status}: ${String((payload as { message: string }).message)}`);
    }
    throw new Error(`${res.status}: ${typeof payload === "string" ? payload : res.statusText}`);
  }
}

/** Slightly above server operational timeout (8s) so server fallback returns first */
const REQUEST_TIMEOUT_MS = 12000;

export type InvTrackMeta = { fallback?: string; endpoint?: string };

/**
 * Single central fetch: same timeout, credentials, envelope unwrap, and X-InvTrack-* / meta.
 * Updates fallback store when response has fallback; clears store when response is ok with no fallback.
 */
export async function invTrackFetch<T>(
  method: string,
  url: string,
  data?: unknown,
): Promise<{ data: T; meta: InvTrackMeta }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: data != null ? { "Content-Type": "application/json" } : {},
      body: data != null ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
  clearTimeout(timeoutId);

  const headerFallback = res.headers.get("X-InvTrack-Fallback") ?? undefined;
  const headerEndpoint = res.headers.get("X-InvTrack-Endpoint") ?? undefined;

  if (!res.ok) {
    const payload = await parseJsonOrText(res);
    const msg =
      isApiEnvelope(payload) && !payload.ok
        ? `${payload.error.code ? `[${payload.error.code}] ` : ""}${payload.error.message}`
        : typeof payload === "object" && payload !== null && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
          ? String((payload as { message: string }).message)
          : typeof payload === "string" ? payload : res.statusText;
    const err = new Error(`${res.status}: ${msg}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    setFallbackState(headerFallback ?? null, headerEndpoint ?? null);
    return { data: undefined as T, meta: { fallback: headerFallback, endpoint: headerEndpoint } };
  }

  const payload = await parseJsonOrText(res);
  const fallbackRaw = headerFallback ?? (payload && typeof payload === "object" && "meta" in payload && (payload as { meta?: { fallback?: string } }).meta?.fallback);
  const endpointRaw = headerEndpoint ?? (payload && typeof payload === "object" && "meta" in payload && (payload as { meta?: { endpoint?: string } }).meta?.endpoint);
  setFallbackState(typeof fallbackRaw === "string" ? fallbackRaw : null, typeof endpointRaw === "string" ? endpointRaw : null);

  if (isApiEnvelope<T>(payload)) {
    if (payload.ok) {
      const success = payload as ApiSuccessEnvelope<T>;
      return {
        data: success.data as T,
        meta: {
          fallback: success.meta?.fallback ?? headerFallback,
          endpoint: headerEndpoint,
        },
      };
    }
    const codePrefix = payload.error.code ? `[${payload.error.code}] ` : "";
    throw new Error(`${codePrefix}${payload.error.message}`);
  }

  return {
    data: payload as T,
    meta: { fallback: headerFallback, endpoint: headerEndpoint },
  };
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
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
    const headerFallback = res.headers.get("X-InvTrack-Fallback");
    const headerEndpoint = res.headers.get("X-InvTrack-Endpoint");
    setFallbackState(headerFallback ?? null, headerEndpoint ?? null);
    await throwIfResNotOk(res);
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
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
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

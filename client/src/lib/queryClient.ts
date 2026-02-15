import { QueryClient, QueryFunction } from "@tanstack/react-query";

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

const REQUEST_TIMEOUT_MS = 15000;

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

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(queryKey[0] as string, {
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

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    const payload = await parseJsonOrText(res);
    if (isApiEnvelope<T>(payload)) {
      if (payload.ok) {
        return payload.data as T;
      }
      const codePrefix = payload.error.code ? `[${payload.error.code}] ` : "";
      throw new Error(`${codePrefix}${payload.error.message}`);
    }
    return payload as T;
  };

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

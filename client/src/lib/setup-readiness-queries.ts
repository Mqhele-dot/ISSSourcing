import type { UseQueryOptions } from "@tanstack/react-query";
import { requestJson } from "@/lib/queryClient";

export type ReadinessStatus = {
  dbReady: boolean;
  schemaReady: boolean;
  sessionStoreReady: boolean;
  websocketReady: boolean;
  uploadPathReady: boolean;
  emailServiceReady: boolean;
  deploymentMode?: string;
  build?: {
    version?: string;
    runtimeProfile?: string;
    deploymentMode?: string;
    commitSha?: string | null;
    buildId?: string | null;
    builtAt?: string | null;
  };
  /** Present when the API could query install state (packaged / first-run hints). */
  productBootstrap?: {
    organizationCount: number;
    needsFirstRunOnboarding: boolean;
  } | null;
};

export async function fetchReadinessStatus(): Promise<ReadinessStatus> {
  const res = await fetch("/api/ready", { credentials: "include" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error("Invalid JSON from /api/ready");
  }
  if (!res.ok) {
    throw new Error(`Readiness check failed (HTTP ${res.status})`);
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed !== null &&
    "ok" in parsed &&
    (parsed as { ok?: unknown }).ok === true &&
    "data" in parsed
  ) {
    return (parsed as { data: ReadinessStatus }).data;
  }
  return parsed as ReadinessStatus;
}

export type SetupStatusIssue = { code: string; message: string; level?: "critical" | "warning" };

export type SetupStatusPayload = {
  /** Present when server built a partial payload instead of failing the request. */
  setupStatusHealth?: "ok" | "degraded";
  issues?: SetupStatusIssue[];
  deploymentMode: string;
  runtimeProfile: string;
  skipProductOnboarding: boolean;
  allowSetupSkip?: boolean;
  database?: { ok: boolean; error: string | null };
  build?: {
    version?: string;
    commitSha?: string | null;
    buildId?: string | null;
    builtAt?: string | null;
    runtimeProfile?: string;
    deploymentMode?: string;
  };
  onboarding: {
    completedAt: string | null;
    required: boolean;
    adminMayContinue: boolean;
    checkpoint: unknown;
  };
  productBootstrap?: { organizationCount: number; needsFirstRunOnboarding: boolean } | null;
  organization: { id: number; name: string; slug: string | null } | null;
  uploads?: { pathReady: boolean; path?: string; writable?: boolean };
  exports?: { pathReady: boolean; path?: string; writable?: boolean };
  diagnostics?: {
    drizzleMigrationCount: number | null;
    lastExportFailure: { id: number; lastError: string; updatedAt: string } | null;
  };
};

export async function fetchSetupStatus(): Promise<SetupStatusPayload> {
  return requestJson<SetupStatusPayload>("GET", "/api/setup/status");
}

/** Shared client defaults for `/api/ready` (background health; see queryClient shouldSuppressGlobalError). */
export const readinessQueryOptions = {
  queryKey: ["/api/ready"] as const,
  queryFn: fetchReadinessStatus,
  staleTime: 15_000,
  retry: false,
  /** Matches setup status: avoid focus-driven refetch loops that flip `needsFirstRunOnboarding` and churn redirects. */
  refetchOnWindowFocus: false,
  meta: { globalError: "off" as const },
} satisfies UseQueryOptions<ReadinessStatus>;

/** Shared client defaults for `/api/setup/status` (onboarding gate + diagnostics). */
export const setupStatusQueryOptions = {
  queryKey: ["/api/setup/status"] as const,
  queryFn: fetchSetupStatus,
  staleTime: 10_000,
  retry: 1,
  refetchOnWindowFocus: false,
  meta: { globalError: "off" as const },
} satisfies UseQueryOptions<SetupStatusPayload>;

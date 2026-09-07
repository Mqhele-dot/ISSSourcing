import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_ORGANIZATION_ID = 1;

export type TenantContext = {
  organizationId: number;
  membershipId: number;
  userId: number;
  userRole: string;
  membershipRole: string;
  effectivePermissions: readonly string[];
  correlationId: string;
  systemActor?: {
    id: string;
    purpose: string;
  };
};

export class TenantContextError extends Error {
  readonly code = "TENANT_CONTEXT_REQUIRED";

  constructor(message = "An active organization membership is required for this operation.") {
    super(message);
    this.name = "TenantContextError";
  }
}

export const organizationAsyncLocalStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext {
  const context = organizationAsyncLocalStorage.getStore();
  if (!context) throw new TenantContextError();
  return context;
}

export function getOptionalTenantContext(): TenantContext | null {
  return organizationAsyncLocalStorage.getStore() ?? null;
}

/** Compatibility helper for existing repositories. It now fails closed instead of defaulting to tenant 1. */
export function getActiveOrganizationId(): number {
  return getTenantContext().organizationId;
}

export function runWithTenantContext<T>(context: TenantContext, callback: () => T): T {
  return organizationAsyncLocalStorage.run(context, callback);
}

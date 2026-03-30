import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_ORGANIZATION_ID = 1;

type OrgStore = { organizationId: number };

export const organizationAsyncLocalStorage = new AsyncLocalStorage<OrgStore>();

/** Active org for the current request (defaults to 1 until multi-org UI ships). */
export function getActiveOrganizationId(): number {
  return organizationAsyncLocalStorage.getStore()?.organizationId ?? DEFAULT_ORGANIZATION_ID;
}

export { DEFAULT_ORGANIZATION_ID };

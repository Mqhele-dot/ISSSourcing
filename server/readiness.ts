import { getBuildInfo } from "./lib/build-info";

/**
 * Readiness state for /ready endpoint. Updated by background init in index.ts.
 * /health always returns 200; /ready reports db and schema readiness for debugging.
 */
export const readiness = {
  dbReady: false,
  schemaReady: false,
  sessionStoreReady: false,
  websocketReady: false,
  build: getBuildInfo(),
};

export function setDbReady(value: boolean): void {
  readiness.dbReady = value;
}

export function setSchemaReady(value: boolean): void {
  readiness.schemaReady = value;
}

export function setSessionStoreReady(value: boolean): void {
  readiness.sessionStoreReady = value;
}

export function setWebsocketReady(value: boolean): void {
  readiness.websocketReady = value;
}

/**
 * Readiness state for /ready endpoint. Updated by background init in index.ts.
 * /health always returns 200; /ready reports db and schema readiness for debugging.
 */
export const readiness = {
  dbReady: false,
  schemaReady: false,
};

export function setDbReady(value: boolean): void {
  readiness.dbReady = value;
}

export function setSchemaReady(value: boolean): void {
  readiness.schemaReady = value;
}

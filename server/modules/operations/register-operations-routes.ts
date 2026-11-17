/**
 * Operational / control-tower HTTP surface — implementation lives in `server/operations-routes.ts`.
 * Registered here so all domain mounts are visible under `server/modules/`.
 */
export { registerOperationalRoutes as registerOperationsRoutes } from "../../operations-routes";

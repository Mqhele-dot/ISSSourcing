import fs from "node:fs";
import path from "node:path";
import { appEnv } from "../config/env";

export function isPackagedDeployment(): boolean {
  return appEnv.deploymentMode === "packaged";
}

/** Dev-only HTTP helpers (e.g. seed, demo reset) — off in production and in packaged builds unless explicitly allowed. */
export function allowDevOnlyRoutes(): boolean {
  if (appEnv.isProduction) return false;
  if (isPackagedDeployment()) return false;
  return true;
}

export function isDemoModeEnabled(): boolean {
  return String(process.env.DEMO_MODE ?? "").toLowerCase() === "true";
}

/** Mutating walkthroughs require two explicit switches, even in a demo deployment. */
export function isDemoWalkthroughEnabled(): boolean {
  return isDemoModeEnabled() && String(process.env.ENABLE_DEMO_WALKTHROUGH ?? "").toLowerCase() === "true";
}

/** Developer tools never become available in production or packaged builds. */
export function areDeveloperToolsEnabled(): boolean {
  return allowDevOnlyRoutes() && String(process.env.ENABLE_DEVELOPER_TOOLS ?? "").toLowerCase() === "true";
}

export function defaultLogVerbosity(): "debug" | "info" | "warn" | "error" {
  if (isPackagedDeployment() && appEnv.isProduction) return "warn";
  if (appEnv.isDevelopment) return "debug";
  return "info";
}

/**
 * Resolve directory for uploads/exports. Packaged apps may start with an unexpected cwd; prefer executable-relative when packaged.
 */
export function resolveWritableDataRoot(): string {
  if (!isPackagedDeployment()) return process.cwd();
  try {
    const exeDir = path.dirname(process.execPath);
    if (exeDir && fs.existsSync(exeDir)) return exeDir;
  } catch {
    /* ignore */
  }
  return process.cwd();
}

export function uploadsDirResolution(): string {
  return path.join(resolveWritableDataRoot(), "uploads");
}

export function exportsDirResolution(): string {
  return path.join(uploadsDirResolution(), "exports");
}

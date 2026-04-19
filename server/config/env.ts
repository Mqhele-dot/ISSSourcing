import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { DeploymentMode } from "./runtime-profile";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { isProductionProfile, runtimeProfile } from "./runtime-profile";

loadDotEnv({ path: ".env", override: true });

const DEFAULT_DEV_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/inventory_dev";
const DEFAULT_CODESPACES_DATABASE_URL = "postgresql://postgres:postgres@db:5432/inventory_dev";
const DEV_SESSION_SECRET = "dev-session-secret-change-me";
const DISALLOWED_PRODUCTION_SESSION_SECRETS = new Set([
  "",
  "changeme",
  "change-me",
  "default",
  "development",
  "inventory-management-system-secret-key",
  DEV_SESSION_SECRET,
]);

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  HOST: z.string().trim().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().trim().optional(),
  PGHOST: z.string().trim().optional(),
  PGPORT: z.string().trim().optional(),
  PGDATABASE: z.string().trim().optional(),
  PGUSER: z.string().trim().optional(),
  PGPASSWORD: z.string().trim().optional(),
  PGSSLMODE: z.string().trim().optional(),
  SESSION_SECRET: z.string().trim().optional(),
  TRUST_PROXY: z.string().trim().optional(),
  CODESPACES: z.string().trim().optional(),
  CODESPACE_NAME: z.string().trim().optional(),
  /** GitHub sets this in Codespaces; used with trust proxy + session cookies. */
  GITHUB_CODESPACES: z.string().trim().optional(),
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: z.string().trim().optional(),
  AUTO_SEED_ON_EMPTY_DB: z.string().trim().optional(),
  ALLOW_DEV_BOOTSTRAP: z.string().trim().optional(),
  EXPORT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  EXPORT_DOWNLOAD_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(60),
  OPERATIONAL_EXCEPTION_SCAN_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(0),
  REQUEST_JSON_LIMIT: z.string().trim().default("1mb"),
  REQUEST_FORM_LIMIT: z.string().trim().default("256kb"),
  REQUEST_TEXT_LIMIT: z.string().trim().default("128kb"),
  AUTH_RATE_LIMIT_POINTS: z.coerce.number().int().min(1).default(5),
  EXPORT_RATE_LIMIT_POINTS: z.coerce.number().int().min(1).default(60),
  UPLOAD_RATE_LIMIT_POINTS: z.coerce.number().int().min(1).default(20),
  ANALYTICS_RATE_LIMIT_POINTS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  BUILD_COMMIT_SHA: z.string().trim().optional(),
  BUILD_ID: z.string().trim().optional(),
  BUILD_TIMESTAMP: z.string().trim().optional(),
  /** Explicit deployment surface: development | test | hosted | packaged */
  RUNTIME_DEPLOYMENT: z.enum(["development", "test", "hosted", "packaged"]).optional(),
  /** When true, first-run product onboarding gate is disabled (local/dev escape hatch). */
  SKIP_PRODUCT_ONBOARDING: z.string().trim().optional(),
  /** When true, admins may POST /api/setup/product/skip to mark onboarding complete (support / controlled installs only). */
  ALLOW_SETUP_SKIP: z.string().trim().optional(),
});

function buildConnectionStringFromEnv(env: z.infer<typeof rawEnvSchema>): string | undefined {
  if (!env.PGHOST || !env.PGDATABASE || !env.PGUSER || !env.PGPASSWORD) {
    return undefined;
  }

  return `postgresql://${encodeURIComponent(env.PGUSER)}:${encodeURIComponent(env.PGPASSWORD)}@${env.PGHOST}:${env.PGPORT || "5432"}/${env.PGDATABASE}`;
}

function resolveDatabaseUrl(env: z.infer<typeof rawEnvSchema>): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const built = buildConnectionStringFromEnv(env);
  if (built) return built;

  if (isProductionProfile()) {
    throw new Error(
      "DATABASE_URL is required in production. Alternatively set PGHOST, PGPORT, PGDATABASE, PGUSER, and PGPASSWORD.",
    );
  }

  if (env.CODESPACES === "true" || env.GITHUB_CODESPACES === "true") {
    return DEFAULT_CODESPACES_DATABASE_URL;
  }

  return DEFAULT_DEV_DATABASE_URL;
}

function resolveSessionSecret(env: z.infer<typeof rawEnvSchema>): string {
  const value = env.SESSION_SECRET?.trim();
  if (!value) {
    if (isProductionProfile()) {
      throw new Error("SESSION_SECRET is required in production.");
    }
    return DEV_SESSION_SECRET;
  }

  if (isProductionProfile() && DISALLOWED_PRODUCTION_SESSION_SECRETS.has(value.toLowerCase())) {
    throw new Error("SESSION_SECRET must be a strong unique value in production.");
  }

  return value;
}

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version?.trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const rawEnv = rawEnvSchema.parse(process.env);
const databaseUrl = resolveDatabaseUrl(rawEnv);
const sessionSecret = resolveSessionSecret(rawEnv);

function resolveDeploymentMode(): DeploymentMode {
  const explicit = rawEnv.RUNTIME_DEPLOYMENT;
  if (explicit) return explicit;
  const isElectron = Boolean(process.versions.electron);
  if (isElectron) {
    return runtimeProfile === "production" ? "packaged" : "development";
  }
  if (runtimeProfile === "production") return "hosted";
  if (runtimeProfile === "test") return "test";
  return "development";
}
const sslMode = rawEnv.PGSSLMODE ?? databaseUrl.match(/[?&]sslmode=(\w+)/)?.[1];
const useDatabaseSsl = (databaseUrl.includes("neon.tech") && sslMode !== "disable") || sslMode === "require";
const trustProxy =
  rawEnv.TRUST_PROXY === "1" ||
  rawEnv.TRUST_PROXY === "true" ||
  rawEnv.CODESPACES === "true" ||
  rawEnv.GITHUB_CODESPACES === "true" ||
  Boolean(rawEnv.CODESPACE_NAME) ||
  Boolean(rawEnv.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN);

const resolvedDeploymentMode = resolveDeploymentMode();

export const appEnv = {
  runtimeProfile,
  deploymentMode: resolvedDeploymentMode,
  skipProductOnboarding: rawEnv.SKIP_PRODUCT_ONBOARDING === "true",
  allowSetupSkip: rawEnv.ALLOW_SETUP_SKIP === "true",
  isProduction: isProductionProfile(),
  isDevelopment: runtimeProfile === "development",
  isTest: runtimeProfile === "test",
  host: rawEnv.HOST,
  port: rawEnv.PORT,
  databaseUrl,
  sessionSecret,
  useDatabaseSsl,
  trustProxy,
  requestLimits: {
    json: rawEnv.REQUEST_JSON_LIMIT,
    form: rawEnv.REQUEST_FORM_LIMIT,
    text: rawEnv.REQUEST_TEXT_LIMIT,
  },
  rateLimits: {
    authPoints: rawEnv.AUTH_RATE_LIMIT_POINTS,
    exportPoints: rawEnv.EXPORT_RATE_LIMIT_POINTS,
    uploadPoints: rawEnv.UPLOAD_RATE_LIMIT_POINTS,
    analyticsPoints: rawEnv.ANALYTICS_RATE_LIMIT_POINTS,
    windowSeconds: rawEnv.RATE_LIMIT_WINDOW_SECONDS,
  },
  exportRetentionDays: rawEnv.EXPORT_RETENTION_DAYS,
  exportDownloadTokenTtlMinutes: rawEnv.EXPORT_DOWNLOAD_TOKEN_TTL_MINUTES,
  operationalExceptionScanIntervalMinutes: rawEnv.OPERATIONAL_EXCEPTION_SCAN_INTERVAL_MINUTES,
  allowStartupBootstrap:
    runtimeProfile !== "production" &&
    resolvedDeploymentMode !== "packaged" &&
    (rawEnv.ALLOW_DEV_BOOTSTRAP === "false" ? false : true),
  autoSeedOnEmptyDb:
    resolvedDeploymentMode !== "packaged" &&
    (rawEnv.AUTO_SEED_ON_EMPTY_DB === "true" ||
      (runtimeProfile !== "production" && rawEnv.AUTO_SEED_ON_EMPTY_DB !== "false")),
  build: {
    version: readPackageVersion(),
    commitSha: rawEnv.BUILD_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
    buildId: rawEnv.BUILD_ID ?? undefined,
    builtAt: rawEnv.BUILD_TIMESTAMP ?? undefined,
  },
} as const;

export type AppEnv = typeof appEnv;

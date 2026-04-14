export type RuntimeProfile = "development" | "test" | "production";

export function resolveRuntimeProfile(value: string | undefined): RuntimeProfile {
  if (value === "production") return "production";
  if (value === "test") return "test";
  return "development";
}

export const runtimeProfile = resolveRuntimeProfile(process.env.NODE_ENV);

export function isProductionProfile(profile: RuntimeProfile = runtimeProfile): boolean {
  return profile === "production";
}

export function isTestProfile(profile: RuntimeProfile = runtimeProfile): boolean {
  return profile === "test";
}

export function isDevelopmentProfile(profile: RuntimeProfile = runtimeProfile): boolean {
  return profile === "development";
}

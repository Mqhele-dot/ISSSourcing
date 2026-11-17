/**
 * Core vs industry extension modules — used for docs/UI gating; flags live in `organization_settings.feature_flags`.
 */
export const CORE_PLATFORM_MODULES = [
  "suppliers",
  "inventory",
  "warehouses",
  "procurement",
  "documents",
  "contracts",
  "reports",
  "organizations",
] as const;

export const INDUSTRY_EXTENSION_MODULES = [
  { id: "gas", label: "Gas distribution", featureFlag: "gas" },
  { id: "construction", label: "Construction / projects", featureFlag: "construction" },
  { id: "field_service", label: "Field service", featureFlag: "field_service" },
  { id: "manufacturing_lite", label: "Light manufacturing", featureFlag: "manufacturing_lite" },
] as const;

export type IndustryModuleId = (typeof INDUSTRY_EXTENSION_MODULES)[number]["id"];

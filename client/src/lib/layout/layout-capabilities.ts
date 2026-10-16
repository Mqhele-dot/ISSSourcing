export type RouteMobility =
  | "desktop-only"
  | "mobile-safe"
  | "mobile-optimized"
  | "full-screen-task";

export type PageShellVariant = "standard" | "wide-form" | "wide-table" | "task-mode" | "analytics-mode";
export type AppShellKind = "desktop" | "mobile";

export type RouteLayoutCapabilities = {
  shell: AppShellKind;
  mobility: RouteMobility;
  pageShell: PageShellVariant;
};

type CapabilityRule = {
  pattern: RegExp;
  capabilities: RouteLayoutCapabilities;
};

/**
 * First matching rule wins. `/m/*` uses the mobile shell; `/operations/*` (including
 * `/operations/mobile-workflows`) stays on the desktop shell—only navigating to `/m/…` swaps layout.
 */
const CAPABILITY_RULES: CapabilityRule[] = [
  {
    pattern: /^\/(m|mobile)(\/|$)/,
    capabilities: {
      shell: "mobile",
      mobility: "full-screen-task",
      pageShell: "task-mode",
    },
  },
  {
    pattern: /^\/analytics(\/|$)/,
    capabilities: {
      shell: "desktop",
      mobility: "mobile-safe",
      pageShell: "analytics-mode",
    },
  },
  {
    pattern: /^\/finance\/accounts-payable(\/|$)/,
    capabilities: {
      shell: "desktop",
      mobility: "mobile-safe",
      pageShell: "wide-table",
    },
  },
  {
    pattern: /^\/(inventory\/warehouse-operations|inventory\/barcodes)(\/|$)/,
    capabilities: {
      shell: "desktop",
      mobility: "mobile-optimized",
      pageShell: "task-mode",
    },
  },
  {
    pattern: /^\/(admin\/master-data|admin\/document-extractor)(\/|$)/,
    capabilities: {
      shell: "desktop",
      mobility: "desktop-only",
      pageShell: "wide-table",
    },
  },
  {
    pattern: /^\/(inventory|procurement|finance|operations|admin)(\/|$)/,
    capabilities: {
      shell: "desktop",
      mobility: "mobile-safe",
      pageShell: "standard",
    },
  },
];

const DEFAULT_CAPABILITIES: RouteLayoutCapabilities = {
  shell: "desktop",
  mobility: "mobile-safe",
  pageShell: "standard",
};

export function resolveRouteLayoutCapabilities(pathname: string): RouteLayoutCapabilities {
  const match = CAPABILITY_RULES.find((rule) => rule.pattern.test(pathname));
  return match?.capabilities ?? DEFAULT_CAPABILITIES;
}

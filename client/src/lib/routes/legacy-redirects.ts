import { APP_ROUTES, LEGACY_ROUTE_REDIRECTS } from "./app-routes";

/**
 * Keys in LEGACY_ROUTE_REDIRECTS that already have dedicated top-level redirects
 * or must not use the auto-generated kebab path (avoids duplicate Route entries).
 */
export const LEGACY_REDIRECT_KEYS_EXCLUDED_FROM_KEBAB_MAP = new Set(["analytics", "dashboard"]);

/** Explicit path overrides for LEGACY_ROUTE_REDIRECTS keys (camelCase → URL). */
export const LEGACY_ROUTE_PATH_OVERRIDES: Partial<Record<keyof typeof LEGACY_ROUTE_REDIRECTS, string>> = {
  mobileReceive: "/mobile/receive",
  mobilePick: "/mobile/pick",
};

/** Static legacy paths → canonical targets (order matters: list before parametric /purchase/:po). */
export const LEGACY_STATIC_REDIRECTS: ReadonlyArray<{ path: string; to: string }> = [
  { path: "/dashboard", to: APP_ROUTES.analytics.overview },
  { path: "/analytics", to: APP_ROUTES.analytics.overview },
  { path: "/control-tower", to: APP_ROUTES.operations.controlTower },
  { path: "/purchase/requisitions", to: APP_ROUTES.procurement.requisitions },
  { path: "/orders/requisitions", to: APP_ROUTES.procurement.requisitions },
  { path: "/requisitions", to: APP_ROUTES.procurement.requisitions },
  { path: "/purchase/requisitions/new", to: APP_ROUTES.procurement.requisitionNew },
  { path: "/orders/requisitions/new", to: APP_ROUTES.procurement.requisitionNew },
  { path: "/requisitions/new", to: APP_ROUTES.procurement.requisitionNew },
  { path: "/suppliers", to: APP_ROUTES.procurement.suppliers },
  { path: "/supplier-portal", to: APP_ROUTES.procurement.supplierPortal },
];

/** Parametric static redirects (path pattern → builder). Placed after non-parametric /purchase/requisitions*. */
export const LEGACY_PARAMETRIC_STATIC_REDIRECTS: ReadonlyArray<{
  path: string;
  to: (params: { id: string }) => string;
}> = [
  {
    path: "/logistics/:id",
    to: (p) => `${APP_ROUTES.operations.logistics}/${p.id}`,
  },
  {
    path: "/exceptions/:id",
    to: (p) => `${APP_ROUTES.operations.exceptions}/${p.id}`,
  },
  {
    path: "/purchase/requisitions/:id",
    to: (p) => APP_ROUTES.procurement.requisition(p.id),
  },
  {
    path: "/orders/requisitions/:id",
    to: (p) => APP_ROUTES.procurement.requisition(p.id),
  },
  {
    path: "/requisitions/:id",
    to: (p) => APP_ROUTES.procurement.requisition(p.id),
  },
  {
    path: "/suppliers/:id",
    to: (p) => APP_ROUTES.procurement.supplier(p.id),
  },
  {
    path: "/warehouses/:id",
    to: (p) => APP_ROUTES.inventory.warehouse(p.id),
  },
];

/** PO deep links (must follow static /purchase/requisitions* so :po never captures "requisitions"). */
export const LEGACY_PO_PARAM_REDIRECTS: ReadonlyArray<{
  path: string;
  to: (params: { po: string }) => string;
}> = [
  { path: "/purchase/:po", to: (p) => APP_ROUTES.procurement.order(p.po) },
  { path: "/orders/:po", to: (p) => APP_ROUTES.procurement.order(p.po) },
];

function legacyKeyToKebabPath(key: string): string {
  return `/${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Entries from LEGACY_ROUTE_REDIRECTS rendered as /kebab-key → target.
 * Skips keys in LEGACY_REDIRECT_KEYS_EXCLUDED_FROM_KEBAB_MAP and keys with path overrides
 * that duplicate a static redirect (purchase, orders, requisitions, suppliers, reports are covered elsewhere).
 */
export function getLegacyKebabRedirectEntries(): ReadonlyArray<{ path: string; to: string }> {
  const staticPaths = new Set(LEGACY_STATIC_REDIRECTS.map((e) => e.path));
  const out: { path: string; to: string }[] = [];

  for (const [legacyKey, targetRoute] of Object.entries(LEGACY_ROUTE_REDIRECTS)) {
    if (LEGACY_REDIRECT_KEYS_EXCLUDED_FROM_KEBAB_MAP.has(legacyKey)) continue;
    const path = LEGACY_ROUTE_PATH_OVERRIDES[legacyKey as keyof typeof LEGACY_ROUTE_REDIRECTS] ?? legacyKeyToKebabPath(legacyKey);
    if (staticPaths.has(path)) continue;
    out.push({ path, to: targetRoute });
  }

  return out;
}

/** Single ordered list for the router (static → :id patterns → :po → kebab). Do not reorder. */
export type LegacyRedirectRule =
  | { kind: "static"; path: string; to: string }
  | { kind: "idParam"; path: string; to: (params: { id: string }) => string }
  | { kind: "poParam"; path: string; to: (params: { po: string }) => string };

export function buildLegacyRedirectRules(): LegacyRedirectRule[] {
  const kebab = getLegacyKebabRedirectEntries();
  return [
    ...LEGACY_STATIC_REDIRECTS.map((r) => ({ kind: "static" as const, path: r.path, to: r.to })),
    ...LEGACY_PARAMETRIC_STATIC_REDIRECTS.map((r) => ({
      kind: "idParam" as const,
      path: r.path,
      to: (params: { id: string }) => r.to(params),
    })),
    ...LEGACY_PO_PARAM_REDIRECTS.map((r) => ({
      kind: "poParam" as const,
      path: r.path,
      to: (params: { po: string }) => r.to(params),
    })),
    ...kebab.map((r) => ({ kind: "static" as const, path: r.path, to: r.to })),
  ];
}

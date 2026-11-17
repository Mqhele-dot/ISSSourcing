export type NavigationPreferences = {
  allowedNavPaths?: string[];
};

function routeBase(path: string): string {
  const parameterIndex = path.indexOf("/:");
  return parameterIndex >= 0 ? path.slice(0, parameterIndex) : path;
}

export function hasProfileNavigationAccess(
  role: string | null | undefined,
  preferences: NavigationPreferences | null | undefined,
  route: string,
): boolean {
  if (String(role ?? "").toLowerCase() === "admin") return true;
  if (route === "/" || route === "/admin/profile" || route === "/auth") return true;
  if (!Array.isArray(preferences?.allowedNavPaths)) return true;

  const requested = routeBase(route).split("?")[0];
  return preferences.allowedNavPaths.some((allowedPath) => {
    const allowed = routeBase(String(allowedPath)).split("?")[0];
    return requested === allowed || requested.startsWith(`${allowed}/`) || allowed.startsWith(`${requested}/`);
  });
}

import {
  resolveRouteLayoutCapabilities,
  type AppShellKind,
  type PageShellVariant,
  type RouteMobility,
} from "@/lib/layout/layout-capabilities";

export type ResolvedShell = {
  shell: AppShellKind;
  mobility: RouteMobility;
  pageShell: PageShellVariant;
};

export function resolveShell(pathname: string): ResolvedShell {
  const capabilities = resolveRouteLayoutCapabilities(pathname);
  return {
    shell: capabilities.shell,
    mobility: capabilities.mobility,
    pageShell: capabilities.pageShell,
  };
}

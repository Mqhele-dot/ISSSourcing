import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Redirect, Route } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { routeDebug } from "@/lib/route-debug";

type WouterSwitchMatch = [boolean, Record<string, string | undefined> | null, ...unknown[]];

/** `wouter` typings omit `match`/`nest` even though `Switch` passes them at runtime. */
const SwitchRoute = Route as ComponentType<{
  path: string;
  match?: WouterSwitchMatch;
  nest?: boolean;
  children?: ReactNode;
}>;

interface ProtectedRouteProps {
  path: string;
  component: React.ComponentType;
  /** When rendered inside `wouter` `Switch`, preserves the precomputed match and avoids rematching bugs. */
  match?: WouterSwitchMatch;
  nest?: boolean;
}

export function ProtectedRoute({ path, component: Component, match, nest }: ProtectedRouteProps) {
  const { user, isLoading, isFetching } = useAuth();

  /** Avoid treating in-flight session revalidation as “logged out” (reduces `/auth` flash). */
  if (isLoading || (!user && isFetching)) {
    routeDebug("protected.session-pending", { path, isLoading, isFetching, hasUser: Boolean(user) });
    return (
      <SwitchRoute path={path} match={match} nest={nest}>
        <div
          className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6"
          aria-busy="true"
          aria-label="Loading session"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>Verifying session…</span>
          </div>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-full max-w-lg" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      </SwitchRoute>
    );
  }

  if (!user) {
    routeDebug("protected.redirect-auth", { path });
    return (
      <SwitchRoute path={path} match={match} nest={nest}>
        <Redirect to="/auth" />
      </SwitchRoute>
    );
  }

  // User is authenticated, render the component
  return (
    <SwitchRoute path={path} match={match} nest={nest}>
      <Component />
    </SwitchRoute>
  );
}
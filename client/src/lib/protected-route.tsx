import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

interface ProtectedRouteProps {
  path: string;
  component: React.ComponentType;
}

export function ProtectedRoute({ path, component: Component }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Route path={path}>
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
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  // User is authenticated, render the component
  return (
    <Route path={path}>
      <Component />
    </Route>
  );
}
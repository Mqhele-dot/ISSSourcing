import React from "react";
import { Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { ThemeProvider } from "@/components/theme-provider";
import { AccentProvider } from "@/components/accent-provider";
import { DensityProvider } from "@/components/density-provider";
import { useEffect } from "react";
import { TutorialProvider } from "@/contexts/tutorial-context";
import { HelpExplainProvider } from "@/contexts/help-explain-context";
import { TutorialSteps } from "@/components/tutorial/tutorial-steps";
import { AuthProvider } from "@/hooks/use-auth";
import { isElectronEnvironment } from "./lib/electron-bridge";
import { ElectronProvider } from "./contexts/electron-provider";
import { DesktopLayout } from "./components/layout/desktop-layout";
import { UpdateNotification } from "./components/electron";
import { GlobalActionErrorCenter } from "./components/diagnostics/global-action-error-center";
import { AppRouter } from "./router";

// Error boundary component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4">
          <Alert variant="destructive" className="max-w-2xl">
            <AlertTitle className="text-lg font-semibold">Something went wrong</AlertTitle>
            <AlertDescription className="mt-2">
              <div className="mb-4 text-sm">
                {this.state.error?.message || "An unexpected error occurred"}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Reload Application
                </Button>
                <Button variant="outline" onClick={() => (window.location.href = "/")}>
                  Go back
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DesktopLayout>
      <UpdateNotification />
      {children}
    </DesktopLayout>
  );
}

type ReadinessStatus = {
  dbReady: boolean;
  schemaReady: boolean;
  sessionStoreReady: boolean;
  websocketReady: boolean;
  uploadPathReady: boolean;
  emailServiceReady: boolean;
};

async function fetchReadinessStatus(): Promise<ReadinessStatus> {
  const res = await fetch("/api/ready", { credentials: "include" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    throw new Error("Invalid JSON from /api/ready");
  }
  if (!res.ok) {
    throw new Error(`Readiness check failed (HTTP ${res.status})`);
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed !== null &&
    "ok" in parsed &&
    (parsed as { ok?: unknown }).ok === true &&
    "data" in parsed
  ) {
    return (parsed as { data: ReadinessStatus }).data;
  }
  return parsed as ReadinessStatus;
}

function ReadinessBanner() {
  const { data, error } = useQuery<ReadinessStatus>({
    queryKey: ["/api/ready"],
    queryFn: fetchReadinessStatus,
    retry: false,
    refetchInterval: 30_000,
  });

  if (error) {
    return (
      <div className="sticky top-0 z-40 shrink-0 p-3">
        <Alert variant="destructive">
          <AlertTitle>System readiness check failed</AlertTitle>
          <AlertDescription>
            Unable to verify backend health. If pages fail to load, confirm the API server and database are running.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  const unavailable: string[] = [];
  if (!data.dbReady) unavailable.push("database");
  if (!data.schemaReady) unavailable.push("schema");
  if (!data.sessionStoreReady) unavailable.push("session store");
  if (!data.uploadPathReady) unavailable.push("uploads path");

  if (unavailable.length === 0) return null;

  return (
    <div className="sticky top-0 z-40 shrink-0 p-3">
      <Alert variant="destructive">
        <AlertTitle>Limited mode: backend is not fully ready</AlertTitle>
        <AlertDescription>
          Unavailable: {unavailable.join(", ")}. Check database connectivity, run migrations, and seed demo data.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function setupElectronApp() {
  if (isElectronEnvironment()) {
    document.documentElement.classList.add("electron-app");
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => e.preventDefault());
  }
}

function App() {
  useEffect(() => {
    setupElectronApp();
  }, []);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" storageKey="invtrack-theme">
        <DensityProvider>
          <AccentProvider>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <TutorialProvider>
                  <HelpExplainProvider>
                    <ElectronProvider>
                      <div className="app-shell relative flex h-svh min-h-0 flex-col overflow-hidden">
                        <ReadinessBanner />
                        <Route path="/auth">
                          <AppRouter />
                        </Route>
                        <Route path="*">
                          {(params) => {
                            const pathname = params["*"] || "";
                            if (pathname === "auth") return null;
                            return (
                              <AppLayout>
                                <AppRouter />
                              </AppLayout>
                            );
                          }}
                        </Route>
                      </div>
                      <TutorialSteps />
                      <GlobalActionErrorCenter />
                      <Toaster />
                    </ElectronProvider>
                  </HelpExplainProvider>
                </TutorialProvider>
              </AuthProvider>
            </QueryClientProvider>
          </AccentProvider>
        </DensityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

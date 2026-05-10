import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TutorialSteps } from "@/components/tutorial/tutorial-steps";
import { isElectronEnvironment } from "./lib/electron-bridge";
import { GlobalActionErrorCenter } from "@/components/diagnostics/global-action-error-center";
import { DiagnosticsGlobalListeners } from "@/components/diagnostics/diagnostics-global-listeners";
import { DiagnosticsRouteMonitor } from "@/components/diagnostics/diagnostics-route-monitor";
import { DiagnosticsStatusIndicator } from "@/components/diagnostics/diagnostics-status-indicator";
import { AppRouter } from "./router";
import { AppErrorBoundary } from "@/app/app-error-boundary";
import { AppProviders } from "@/app/app-providers";
import { ReadinessBanner } from "@/app/app-readiness-banner";
import { AppShellLayout } from "@/app/app-shell-layout";

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
    <AppErrorBoundary>
      <AppProviders>
        <DiagnosticsGlobalListeners />
        <DiagnosticsRouteMonitor />
        <div className="app-shell relative flex h-svh min-h-0 flex-col overflow-hidden" data-testid="app-shell">
          <ReadinessBanner />
          {/**
           * Single `AppRouter` mount: avoids unmount/remount when switching between `/auth` and the main app
           * (previously two sibling `<Route>` trees each created their own router instance).
           */}
          <AppShellLayout>
            <AppRouter />
          </AppShellLayout>
        </div>
        <TutorialSteps />
        <DiagnosticsStatusIndicator />
        <GlobalActionErrorCenter />
        <Toaster />
      </AppProviders>
    </AppErrorBoundary>
  );
}

export default App;

import { useEffect } from "react";
import { Route } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { TutorialSteps } from "@/components/tutorial/tutorial-steps";
import { isElectronEnvironment } from "./lib/electron-bridge";
import { GlobalActionErrorCenter } from "@/components/diagnostics/global-action-error-center";
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
                <AppShellLayout>
                  <AppRouter />
                </AppShellLayout>
              );
            }}
          </Route>
        </div>
        <TutorialSteps />
        <GlobalActionErrorCenter />
        <Toaster />
      </AppProviders>
    </AppErrorBoundary>
  );
}

export default App;

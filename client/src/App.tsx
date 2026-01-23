import React from "react";
import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { RefreshCw } from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { ThemeProvider } from "@/components/theme-provider";
import { TutorialProvider } from "@/contexts/tutorial-context";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { DesktopLayout } from "./components/layout/desktop-layout";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Discover from "@/pages/discover";
import JobsPage from "@/pages/jobs";
import MessagesPage from "@/pages/messages";
import ReviewsPage from "@/pages/reviews";
import ProfilePage from "@/pages/profile";
import SettingsPage from "@/pages/settings";
import AuthPage from "@/pages/auth-page";

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
              <Button variant="outline" onClick={() => window.location.reload()} className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload Application
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

function Router() {
  return (
    <Switch>
      <ProtectedRoute path="/" component={Home} />
      <ProtectedRoute path="/discover" component={Discover} />
      <ProtectedRoute path="/jobs" component={JobsPage} />
      <ProtectedRoute path="/messages" component={MessagesPage} />
      <ProtectedRoute path="/reviews" component={ReviewsPage} />
      <ProtectedRoute path="/profile" component={ProfilePage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <Route path="/auth" component={AuthPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DesktopLayout>
      {children}
    </DesktopLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" storageKey="skillradius-theme">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TutorialProvider>
              <div className="relative min-h-screen">
                <Route path="/auth">
                  <Router />
                </Route>
                <Route path="*">
                  {(params) => {
                    const pathname = params["*"] || "";
                    if (pathname === "auth") return null;
                    return <AppLayout><Router /></AppLayout>;
                  }}
                </Route>
              </div>
              <Toaster />
            </TutorialProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

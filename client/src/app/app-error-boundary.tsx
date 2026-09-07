import React from "react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Clipboard, RefreshCw, Stethoscope } from "lucide-react";
import { addDiagnosticEvent } from "@/lib/diagnostics/diagnostics-store";
import { APP_ROUTES } from "@/lib/routes/app-routes";

type State = { hasError: boolean; error: Error | null; componentStack?: string };

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ componentStack: errorInfo.componentStack ?? undefined });
    addDiagnosticEvent({
      severity: "critical",
      source: "react",
      title: "React render error",
      message: error.message || "A React component failed to render.",
      stack: error.stack,
      component: errorInfo.componentStack?.split("\n")[1]?.trim(),
      details: {
        componentStack: errorInfo.componentStack,
      },
      userAction: "Open System Diagnostics and share the report with developers.",
    });
    console.error("Uncaught error:", error, errorInfo);
  }

  copySummary = async () => {
    const summary = [
      "Something went wrong on this page",
      `Route: ${window.location.pathname}${window.location.search}`,
      `Message: ${this.state.error?.message ?? "Unknown error"}`,
      this.state.error?.stack ? `Stack: ${this.state.error.stack}` : "",
      this.state.componentStack ? `Component stack: ${this.state.componentStack}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(summary);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4" data-testid="app-error-boundary">
          <Alert variant="destructive" className="max-w-2xl">
            <AlertTitle className="text-lg font-semibold">Something went wrong on this page</AlertTitle>
            <AlertDescription className="mt-2 space-y-4">
              <div className="text-sm">
                <div className="mb-1 text-muted-foreground">
                  Route: <code>{window.location.pathname}</code>
                </div>
                <div data-testid="error-boundary-message">
                {this.state.error?.message || "An unexpected error occurred"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Reload page
                </Button>
                <Button
                  variant="outline"
                  onClick={() => (window.location.href = APP_ROUTES.admin.systemDiagnostics)}
                  className="gap-2"
                  data-testid="error-boundary-open-diagnostics"
                >
                  <Stethoscope className="h-4 w-4" />
                  Go to System Diagnostics
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void this.copySummary()}
                  className="gap-2"
                  data-testid="error-boundary-copy"
                >
                  <Clipboard className="h-4 w-4" />
                  Copy error summary
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

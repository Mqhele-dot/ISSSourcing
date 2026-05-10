import { useEffect } from "react";
import { addDiagnosticEvent, redactDiagnosticDetails } from "@/lib/diagnostics/diagnostics-store";

const originalConsole = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

let installed = false;

function valueToMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(redactDiagnosticDetails(value));
  } catch {
    return String(value);
  }
}

function logConsole(level: "error" | "warn", args: unknown[]) {
  const [first] = args;
  addDiagnosticEvent({
    severity: level === "error" ? "error" : "warning",
    source: "console",
    title: level === "error" ? "Console error" : "Console warning",
    message: args.map(valueToMessage).join(" ").slice(0, 1_000) || "Console event",
    stack: first instanceof Error ? first.stack : undefined,
    details: args,
  });
}

export function DiagnosticsGlobalListeners() {
  useEffect(() => {
    if (installed) return;
    installed = true;

    const onError = (event: ErrorEvent) => {
      addDiagnosticEvent({
        severity: "critical",
        source: "react",
        title: "Unhandled browser error",
        message: event.message || "Unhandled browser error",
        component: event.filename,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        details: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      addDiagnosticEvent({
        severity: "error",
        source: "system",
        title: "Unhandled promise rejection",
        message: valueToMessage(event.reason),
        stack: event.reason instanceof Error ? event.reason.stack : undefined,
        details: event.reason,
      });
    };

    console.error = (...args: unknown[]) => {
      logConsole("error", args);
      originalConsole.error(...args);
    };
    console.warn = (...args: unknown[]) => {
      logConsole("warn", args);
      originalConsole.warn(...args);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
      installed = false;
    };
  }, []);

  return null;
}

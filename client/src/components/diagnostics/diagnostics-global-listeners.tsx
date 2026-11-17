import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { buildRequestHeaders, getCsrfToken } from "@/lib/queryClient";
import { addDiagnosticEvent, redactDiagnosticDetails } from "@/lib/diagnostics/diagnostics-store";

const originalConsole = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

let installed = false;
let sending = false;
let activeUpload: AbortController | null = null;
let queueGeneration = 0;
function clearIncidentQueue() {
  queueGeneration++;
  uploadQueue.length = 0;
  activeUpload?.abort();
}
const uploadQueue: Array<{ eventType: "browser_error" | "unhandled_rejection" | "console_error"; clientEventId: string; route: string; buildId?: string }> = [];

function safeRoute(): string {
  const path = window.location.pathname;
  return path.startsWith("/") ? path.slice(0, 200) : "/";
}

function queueSafeIncident(eventType: "browser_error" | "unhandled_rejection" | "console_error") {
  if (sending) return;
  if (uploadQueue.length >= 20) uploadQueue.shift();
  uploadQueue.push({ eventType, clientEventId: crypto.randomUUID(), route: safeRoute() });
  void flushSafeIncidents();
}

async function flushSafeIncidents() {
  if (sending) return;
  sending = true;
  const generation = queueGeneration;
  try {
    while (uploadQueue.length && generation === queueGeneration) {
      const incident = uploadQueue[0];
      // Diagnostic uploads can follow a session replacement. Refresh the token
      // rather than reusing a token cached before login or organization change.
      await getCsrfToken(true);
      const headers = await buildRequestHeaders("POST", undefined, { contentType: "application/json" });
      if (generation !== queueGeneration) break;
      activeUpload = new AbortController();
      let response = await fetch("/api/diagnostics/events", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(incident),
        signal: activeUpload.signal,
      });
      if(response.status===403 && generation===queueGeneration) {
        const error=await response.clone().json().catch(()=>null);
        if(error?.error?.code==="CSRF_TOKEN_INVALID") {
          await getCsrfToken(true);
          if(generation!==queueGeneration)break;
          response=await fetch("/api/diagnostics/events",{method:"POST",credentials:"include",
            headers:await buildRequestHeaders("POST",undefined,{contentType:"application/json"}),
            body:JSON.stringify(incident),signal:activeUpload.signal});
        }
      }
      if (generation !== queueGeneration) break;
      if (response.ok || response.status === 400 || response.status === 413) uploadQueue.shift();
      else if (response.status === 401 || response.status === 403) { uploadQueue.length = 0; break; }
      else break;
    }
  } catch {
    // Never log ingestion failures: that would recursively create more incidents.
  } finally {
    activeUpload = null;
    sending = false;
  }
}

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
  const event = {
    severity: level === "error" ? "error" as const : "warning" as const,
    source: "console" as const,
    title: level === "error" ? "Console error" : "Console warning",
    message: args.map(valueToMessage).join(" ").slice(0, 1_000) || "Console event",
    stack: first instanceof Error ? first.stack : undefined,
    details: args,
  };
  // React invokes console.error while rendering development warnings. Deferring
  // the external-store write avoids updating DiagnosticsStatusIndicator during
  // a different component's render phase.
  queueMicrotask(() => addDiagnosticEvent(event));
  if (level === "error") queueSafeIncident("console_error");
}

export function DiagnosticsGlobalListeners() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const identity = () => JSON.stringify(queryClient.getQueryData(["/api/user"]) ?? null);
    let previous = identity();
    return queryClient.getQueryCache().subscribe(() => {
      const current = identity();
      if (current !== previous) { clearIncidentQueue(); previous = current; }
    });
  }, [queryClient]);
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
      queueSafeIncident("browser_error");
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
      queueSafeIncident("unhandled_rejection");
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
    const retry = window.setInterval(() => { void flushSafeIncidents(); }, 60_000);
    window.addEventListener("online", flushSafeIncidents);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.clearInterval(retry);
      window.removeEventListener("online", flushSafeIncidents);
      clearIncidentQueue();
      console.error = originalConsole.error;
      console.warn = originalConsole.warn;
      installed = false;
    };
  }, []);

  return null;
}

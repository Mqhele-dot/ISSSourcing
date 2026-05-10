export type ServerDiagnosticSeverity = "info" | "warning" | "error" | "critical";

export type ServerDiagnosticEvent = {
  id: string;
  timestamp: string;
  severity: ServerDiagnosticSeverity;
  source: "startup" | "request" | "database" | "schema" | "runtime" | "system";
  title: string;
  message: string;
  route?: string;
  method?: string;
  status?: number;
  stack?: string;
  details?: unknown;
};

type ServerDiagnosticEventInput = Omit<ServerDiagnosticEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

const MAX_EVENTS = 300;
const events: ServerDiagnosticEvent[] = [];
const SENSITIVE_KEY_RE = /(database_url|authorization|cookie|token|password|secret|session|csrf|api[-_]?key|set-cookie)/i;

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function redactServerDiagnosticDetails(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 1_000 ? `${value.slice(0, 1_000)}...[truncated]` : value;
  if (typeof value !== "object") return value;
  if (depth > 6) return "[Max depth reached]";
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.slice(0, 4_000),
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactServerDiagnosticDetails(entry, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redactServerDiagnosticDetails(entry, depth + 1, seen);
  }
  return out;
}

export function recordServerDiagnosticEvent(input: ServerDiagnosticEventInput): ServerDiagnosticEvent {
  const event: ServerDiagnosticEvent = {
    ...input,
    id: input.id ?? makeId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    message: String(input.message || "No diagnostic message"),
    details: redactServerDiagnosticDetails(input.details),
    stack: input.stack?.slice(0, 8_000),
  };
  events.unshift(event);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  return event;
}

export function getServerDiagnosticEvents(): ServerDiagnosticEvent[] {
  return events.map((event) => ({ ...event }));
}

export function registerProcessDiagnosticHandlers(): void {
  const globalKey = "__invtrackServerDiagnosticsProcessHandlers";
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  if (g[globalKey]) return;
  g[globalKey] = true;

  process.on("unhandledRejection", (reason) => {
    recordServerDiagnosticEvent({
      severity: "error",
      source: "runtime",
      title: "Unhandled promise rejection",
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      details: reason,
    });
  });

  process.on("uncaughtException", (error) => {
    recordServerDiagnosticEvent({
      severity: "critical",
      source: "runtime",
      title: "Uncaught exception",
      message: error.message,
      stack: error.stack,
      details: error,
    });
  });
}

import {
  isSlowApiDiagnosticEvent,
  slowApiDiagnosticDedupeKey,
} from "@shared/diagnostics/event-dedupe";

export type DiagnosticSeverity = "info" | "warning" | "error" | "critical";

export type DiagnosticSource =
  | "react"
  | "route"
  | "api"
  | "console"
  | "network"
  | "diagnostics"
  | "calculation"
  | "auth"
  | "system";

export type DiagnosticEvent = {
  id: string;
  timestamp: string;
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  title: string;
  message: string;
  route?: string;
  component?: string;
  endpoint?: string;
  method?: string;
  status?: number;
  durationMs?: number;
  stack?: string;
  details?: unknown;
  userAction?: string;
  resolved?: boolean;
};

export type DiagnosticsSnapshot = {
  generatedAt: string;
  currentRoute: string;
  userAgent: string;
  events: DiagnosticEvent[];
  counts: Record<DiagnosticSeverity, number>;
  unresolvedCount: number;
};

type DiagnosticListener = (events: DiagnosticEvent[], latest?: DiagnosticEvent) => void;
type DiagnosticEventInput = Omit<DiagnosticEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

const STORAGE_KEY = "invtrack.diagnostics.events";
const MAX_MEMORY_EVENTS = 500;
const MAX_PERSISTED_EVENTS = 200;
const DEDUPE_WINDOW_MS = 5_000;
const SLOW_API_DIAGNOSTICS_DEDUPE_MS = 30_000;
const listeners = new Set<DiagnosticListener>();
const events: DiagnosticEvent[] = loadPersistedEvents();

const SENSITIVE_KEY_RE = /(authorization|cookie|token|password|secret|session|csrf|api[-_]?key|set-cookie)/i;

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentRoute(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function loadPersistedEvents(): DiagnosticEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDiagnosticEvent).slice(0, MAX_MEMORY_EVENTS);
  } catch {
    return [];
  }
}

function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DiagnosticEvent>;
  return (
    typeof row.id === "string" &&
    typeof row.timestamp === "string" &&
    typeof row.severity === "string" &&
    typeof row.source === "string" &&
    typeof row.title === "string" &&
    typeof row.message === "string"
  );
}

function persistEvents(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_PERSISTED_EVENTS)));
  } catch {
    // Storage may be blocked or full; diagnostics should never break the app.
  }
}

function notify(latest?: DiagnosticEvent): void {
  const snapshot = getDiagnosticEvents();
  listeners.forEach((listener) => listener(snapshot, latest));
}

function dedupeKey(
  event: Pick<DiagnosticEvent, "source" | "title" | "message" | "route" | "endpoint" | "method">,
): string {
  if (isSlowApiDiagnosticEvent(event)) {
    return slowApiDiagnosticDedupeKey(event.endpoint, event.method);
  }
  return [event.source, event.title, event.message, event.route ?? ""].join("|");
}

function pruneEvents(): void {
  if (events.length > MAX_MEMORY_EVENTS) {
    events.length = MAX_MEMORY_EVENTS;
  }
}

export function redactDiagnosticDetails<T>(value: T, depth = 0, seen = new WeakSet<object>()): T | unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.length > 1_000 ? `${value.slice(0, 1_000)}...[truncated]` : value;
  }
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

  if (value instanceof Headers) {
    const out: Record<string, unknown> = {};
    value.forEach((headerValue, key) => {
      out[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : headerValue;
    });
    return out;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactDiagnosticDetails(entry, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redactDiagnosticDetails(entry, depth + 1, seen);
  }
  return out;
}

export function addDiagnosticEvent(input: DiagnosticEventInput): DiagnosticEvent {
  const now = Date.now();
  const timestamp = input.timestamp ?? new Date(now).toISOString();
  const normalized: DiagnosticEvent = {
    ...input,
    id: input.id ?? makeId(),
    timestamp,
    route: input.route ?? currentRoute(),
    message: String(input.message || "No diagnostic message"),
    details: redactDiagnosticDetails(input.details),
    stack: input.stack?.slice(0, 8_000),
    resolved: input.resolved ?? false,
  };

  const key = dedupeKey(normalized);
  const dedupeMs = isSlowApiDiagnosticEvent(normalized) ? SLOW_API_DIAGNOSTICS_DEDUPE_MS : DEDUPE_WINDOW_MS;
  const duplicate = events.find((event) => {
    const eventTime = new Date(event.timestamp).getTime();
    return now - eventTime <= dedupeMs && dedupeKey(event) === key;
  });

  if (duplicate) {
    duplicate.timestamp = timestamp;
    duplicate.severity = normalized.severity;
    duplicate.durationMs = normalized.durationMs ?? duplicate.durationMs;
    duplicate.status = normalized.status ?? duplicate.status;
    duplicate.details = normalized.details ?? duplicate.details;
    duplicate.resolved = false;
    persistEvents();
    notify(duplicate);
    return duplicate;
  }

  events.unshift(normalized);
  pruneEvents();
  persistEvents();
  notify(normalized);
  return normalized;
}

export function getDiagnosticEvents(): DiagnosticEvent[] {
  return events.map((event) => ({ ...event }));
}

export function clearDiagnosticEvents(): void {
  events.length = 0;
  persistEvents();
  notify();
}

export function markDiagnosticResolved(id: string): void {
  const event = events.find((row) => row.id === id);
  if (!event) return;
  event.resolved = true;
  persistEvents();
  notify(event);
}

export function subscribeToDiagnostics(listener: DiagnosticListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function buildDiagnosticsSnapshot(): DiagnosticsSnapshot {
  const snapshotEvents = getDiagnosticEvents();
  const counts: Record<DiagnosticSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  };
  let unresolvedCount = 0;
  for (const event of snapshotEvents) {
    counts[event.severity] += 1;
    if (!event.resolved) unresolvedCount += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    currentRoute: currentRoute(),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    events: snapshotEvents,
    counts,
    unresolvedCount,
  };
}

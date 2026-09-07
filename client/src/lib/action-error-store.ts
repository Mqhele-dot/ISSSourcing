/**
 * Internal severity drives deduplication and UI policy.
 * Maps to product language: blocking_user_action / important_warning / background_fetch_failure / expected_auth_or_setup_probe.
 */
export type ActionErrorSeverity = "mutation" | "important_warning" | "background";

export type ActionErrorUxLevel =
  | "blocking_user_action"
  | "important_warning"
  | "background_fetch_failure"
  | "expected_auth_or_setup_probe";

export function severityToUxLevel(severity: ActionErrorSeverity): ActionErrorUxLevel {
  switch (severity) {
    case "mutation":
      return "blocking_user_action";
    case "important_warning":
      return "important_warning";
    case "background":
      return "background_fetch_failure";
    default:
      return "background_fetch_failure";
  }
}

export type ActionErrorRecord = {
  id: string;
  timestamp: string;
  method: string;
  endpoint: string;
  status?: number;
  reason: string;
  requestId?: string;
  module?: string;
  action?: string;
  payloadSummary?: string;
  retryMethod?: string;
  retryEndpoint?: string;
  retryPayload?: unknown;
  stack?: string;
  lastGoodResponse?: unknown;
  raw?: unknown;
  /** How loudly the UI should surface this error. */
  severity: ActionErrorSeverity;
  /** Merged duplicate count within the dedupe window. */
  occurrenceCount?: number;
  lastSeen?: string;
};

type Listener = (error: ActionErrorRecord | null) => void;

const listeners = new Set<Listener>();
const records: ActionErrorRecord[] = [];

const DEDUPE_MS = 16_000;
const MAX_RECORDS = 50;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizePath(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  if (withoutQuery.startsWith("/")) return withoutQuery;
  try {
    return new URL(withoutQuery).pathname;
  } catch {
    return withoutQuery;
  }
}

function dedupeKeyFrom(input: {
  method: string;
  endpoint: string;
  status?: number;
  reason: string;
  severity: ActionErrorSeverity;
}): string {
  const reasonHead = input.reason.slice(0, 96);
  return `${input.method.toUpperCase()}|${normalizePath(input.endpoint)}|${input.status ?? "na"}|${input.severity}|${reasonHead}`;
}

export function inferActionErrorSeverity(method: string, status?: number): ActionErrorSeverity {
  const m = method.toUpperCase();
  if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") {
    return "mutation";
  }
  if (status != null && status >= 500) {
    return "important_warning";
  }
  return "background";
}

/** FAB + high-visibility dialog: user-initiated writes only (not background GET failures). */
export function pickLatestForFab(list: readonly ActionErrorRecord[]): ActionErrorRecord | null {
  return list.find((r) => r.severity === "mutation") ?? null;
}

export const actionErrorStore = {
  push(input: Omit<ActionErrorRecord, "id" | "timestamp" | "severity"> & { severity?: ActionErrorSeverity }) {
    const severity = input.severity ?? inferActionErrorSeverity(input.method, input.status);
    const key = dedupeKeyFrom({
      method: input.method,
      endpoint: input.endpoint,
      status: input.status,
      reason: input.reason,
      severity,
    });
    const now = Date.now();
    const head = records[0];
    if (head) {
      const headTime = new Date(head.timestamp).getTime();
      if (now - headTime < DEDUPE_MS && dedupeKeyFrom(head) === key) {
        head.occurrenceCount = (head.occurrenceCount ?? 1) + 1;
        head.lastSeen = new Date().toISOString();
        if (severity === "background" || severity === "important_warning") {
          return;
        }
        listeners.forEach((listener) => listener(head));
        return;
      }
    }

    const record: ActionErrorRecord = {
      id: makeId(),
      timestamp: new Date().toISOString(),
      severity,
      occurrenceCount: 1,
      ...input,
    };
    records.unshift(record);
    if (records.length > MAX_RECORDS) {
      records.length = MAX_RECORDS;
    }
    listeners.forEach((listener) => listener(record));
  },
  list() {
    return [...records];
  },
  clearAll() {
    records.length = 0;
    listeners.forEach((listener) => listener(null));
  },
  clearById(id: string) {
    const idx = records.findIndex((record) => record.id === id);
    if (idx >= 0) {
      records.splice(idx, 1);
      listeners.forEach((listener) => listener(null));
    }
  },
  clearResolved(method: string, endpoint: string) {
    const normalizedMethod = method.toUpperCase();
    const normalizedEndpoint = normalizePath(endpoint);
    let changed = false;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (
        record.method.toUpperCase() === normalizedMethod &&
        normalizePath(record.endpoint) === normalizedEndpoint
      ) {
        records.splice(index, 1);
        changed = true;
      }
    }
    if (changed) listeners.forEach((listener) => listener(null));
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

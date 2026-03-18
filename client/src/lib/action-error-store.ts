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
};

type Listener = (error: ActionErrorRecord) => void;

const listeners = new Set<Listener>();
const records: ActionErrorRecord[] = [];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const actionErrorStore = {
  push(input: Omit<ActionErrorRecord, "id" | "timestamp">) {
    const record: ActionErrorRecord = {
      id: makeId(),
      timestamp: new Date().toISOString(),
      ...input,
    };
    records.unshift(record);
    if (records.length > 50) {
      records.length = 50;
    }
    listeners.forEach((listener) => listener(record));
  },
  list() {
    return [...records];
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

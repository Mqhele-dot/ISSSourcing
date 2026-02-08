export type ApiErrorEntry = {
  route: string;
  status: number | null;
  message: string;
  time: string;
};

const MAX_ERRORS = 20;
let errors: ApiErrorEntry[] = [];
const listeners = new Set<() => void>();

export function pushApiError(entry: ApiErrorEntry) {
  errors = [entry, ...errors].slice(0, MAX_ERRORS);
  listeners.forEach((listener) => listener());
}

export function getApiErrors(): ApiErrorEntry[] {
  return errors;
}

export function subscribeApiErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

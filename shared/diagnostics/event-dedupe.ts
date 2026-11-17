/** Pure helpers for coalescing noisy diagnostics (e.g. repeated slow API warnings). */

export const SLOW_API_DIAGNOSTIC_TITLE = "Slow API request";

export function slowApiDiagnosticDedupeKey(endpoint: string | undefined, method: string | undefined): string {
  const e = String(endpoint ?? "").split("?")[0] ?? "";
  const m = String(method ?? "").toUpperCase();
  return `api|slow|${m}|${e}`;
}

export function isSlowApiDiagnosticEvent(params: {
  source: string;
  title: string;
  endpoint?: string;
}): boolean {
  return params.source === "api" && params.title === SLOW_API_DIAGNOSTIC_TITLE && Boolean(params.endpoint?.trim());
}

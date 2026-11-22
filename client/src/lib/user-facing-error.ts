/** Keep technical response details in Diagnostics; give ordinary users an actionable explanation. */
export function userFacingError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const candidate = error && typeof error === "object" ? error as { message?: unknown; status?: unknown; code?: unknown; hint?: unknown } : {};
  const status = Number(candidate.status);
  const code = String(candidate.code ?? "").toUpperCase();
  const raw = typeof candidate.message === "string" ? candidate.message : typeof error === "string" ? error : "";
  const message = raw.replace(/^\s*(?:\d{3}:\s*)?(?:\[[A-Z][A-Z0-9_]+\]\s*)?/, "").trim();
  if (status === 401 || /AUTHENTICATION_REQUIRED|UNAUTHORIZED/.test(code)) return "Your session has ended. Sign in again to continue.";
  if (status === 403 || /FORBIDDEN|PERMISSION_REQUIRED/.test(code)) return "You do not have access to this action. Ask an administrator to review your role.";
  if (status === 404) return "This record is no longer available. Refresh the page and try again.";
  if (status === 408 || /timed out/i.test(message)) return "This is taking longer than expected. Check your connection and try again.";
  if (status === 409 && !message) return "This record changed while you were working. Refresh it before trying again.";
  if (status === 429) return "Too many requests were sent. Wait a moment and try again.";
  if (status >= 500 || /(?:SQLSTATE|SELECT\s+.+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|stack trace|ECONN|TypeError:|\bat\s+\S+\s*\([^)]*:\d+:\d+\))/i.test(message)) {
    return "The service could not complete this request. Please try again; if it continues, contact support.";
  }
  if (!message || /^\d{3}$/.test(message) || /^(?:internal server error|unknown error)$/i.test(message)) return fallback;
  const hint = typeof candidate.hint === "string" && candidate.hint.trim() ? ` ${candidate.hint.trim()}` : "";
  return `${message}${hint}`;
}

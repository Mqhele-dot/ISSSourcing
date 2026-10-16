/**
 * Validates a post-login or in-app navigation target. Rejects external URLs and `/auth` loops.
 */
export function safeInternalNextParam(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t.startsWith("/")) return null;
  if (t.startsWith("//")) return null;
  if (t.includes("://")) return null;
  if (t.includes("\0")) return null;
  if (t === "/auth") return null;
  return t;
}

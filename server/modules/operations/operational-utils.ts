/** Shared parsers for operational SQL row mapping. */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function toString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function refsMatch(
  existing: Record<string, unknown>,
  candidate: Record<string, string | number>,
): boolean {
  for (const [key, value] of Object.entries(candidate)) {
    if (existing[key] !== value) {
      return false;
    }
  }
  return true;
}

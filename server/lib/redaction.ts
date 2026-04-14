const SENSITIVE_KEY_PATTERN = /(password|secret|token|cookie|authorization|api[-_]?key|session|credit|card|cvv)/i;

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(nested),
    ]),
  );
}

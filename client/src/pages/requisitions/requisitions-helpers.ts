export function formatRequisitionDate(value: string | Date | null) {
  if (value == null) return "-";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
}

export function getRequisitionErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

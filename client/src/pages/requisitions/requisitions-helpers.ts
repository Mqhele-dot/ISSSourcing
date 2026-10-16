export function formatRequisitionDate(value: string | Date | null) {
  if (value == null) return "-";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
}

export function getRequisitionErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("convertpurchaserequisitiontopo") || lower.includes("failed to convert")) {
    if (lower.includes("approved") || lower.includes("exist")) {
      return "Could not convert: the requisition must exist and be approved, with valid lines and supplier.";
    }
    return "Could not convert this requisition to a purchase order. Check that it is approved and try again.";
  }
  if (lower.includes("userids must be an array")) {
    return "Share failed: no valid users were selected.";
  }
  if (lower.includes("purchase requisition not found") || lower.includes("not found")) {
    return "This requisition is no longer available. Refresh the list and try again.";
  }
  if (lower.includes("failed to share")) {
    return "Could not update sharing for this requisition. Try again or contact an admin.";
  }
  return raw;
}

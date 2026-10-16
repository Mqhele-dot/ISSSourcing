export const PO_MUTATION_ERRORS = {
  poRequired: "Purchase order number is required.",
  statusRequired: "Target status is required.",
  receiveLinesRequired: "At least one receive line is required.",
} as const;

export function assertPoNumberForMutation(poNumber: string): void {
  if (!String(poNumber ?? "").trim()) {
    throw new Error(PO_MUTATION_ERRORS.poRequired);
  }
}

export function assertTransitionTargetStatus(toStatus: string): void {
  if (!String(toStatus ?? "").trim()) {
    throw new Error(PO_MUTATION_ERRORS.statusRequired);
  }
}

export function assertNonEmptyReceiveLines(lines: readonly unknown[] | undefined): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error(PO_MUTATION_ERRORS.receiveLinesRequired);
  }
}

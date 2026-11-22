export function normalizeExceptionAssigneeInput(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

export function hasExceptionAssigneeChanged(
  currentAssignee: string | null | undefined,
  nextAssigneeInput: string | null | undefined,
): boolean {
  return normalizeExceptionAssigneeInput(currentAssignee) !== normalizeExceptionAssigneeInput(nextAssigneeInput);
}

export function shouldSubmitExceptionQuickUpdate(input: {
  currentStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  currentAssignee: string | null | undefined;
  nextAssigneeInput: string | null | undefined;
  note: string | null | undefined;
  statusRequiresNote: boolean;
}): boolean {
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (input.statusRequiresNote && note.length === 0) {
    return false;
  }

  const statusChanged = (input.currentStatus ?? "") !== (input.nextStatus ?? "");
  const assigneeChanged = hasExceptionAssigneeChanged(input.currentAssignee, input.nextAssigneeInput);

  return statusChanged || assigneeChanged;
}

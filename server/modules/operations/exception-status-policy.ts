const CLOSE_LIKE_EXCEPTION_STATUSES = new Set(["resolved", "closed"]);

export const EXCEPTION_STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed", "open"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

export type ValidatedExceptionStatusTransition = {
  currentStatus: string;
  toStatus: string;
  note: string;
  allowedTargets: string[];
};

export function validateExceptionStatusTransition(input: {
  currentStatus: string;
  toStatus: string;
  note?: string | null;
}): ValidatedExceptionStatusTransition {
  const currentStatus = input.currentStatus.trim().toLowerCase();
  const toStatus = input.toStatus.trim().toLowerCase();
  const note = (input.note ?? "").trim();
  const allowedTargets = EXCEPTION_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (!toStatus) {
    throw new Error("invalid_target_status");
  }
  if (toStatus !== currentStatus && !allowedTargets.includes(toStatus)) {
    throw new Error("invalid_transition");
  }
  if (CLOSE_LIKE_EXCEPTION_STATUSES.has(toStatus) && !note) {
    throw new Error("comment_required");
  }

  return {
    currentStatus,
    toStatus,
    note,
    allowedTargets,
  };
}

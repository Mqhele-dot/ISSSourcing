/**
 * Whether to invalidate non-session queries when the authenticated user id changes.
 * Must NOT return true on first session restore (null → id) — that caused a full refetch storm.
 */
export function shouldInvalidateCachedQueriesOnUserIdTransition(
  previousUserId: number | null,
  nextUserId: number | null,
): boolean {
  return (
    previousUserId !== null &&
    nextUserId !== null &&
    nextUserId !== previousUserId
  );
}

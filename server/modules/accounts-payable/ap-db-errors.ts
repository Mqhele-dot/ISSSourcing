import type { Response } from "express";
import { sendError } from "../../api-response";

type PgLikeError = {
  code?: string;
  message?: string;
  detail?: string;
};

function asPgError(err: unknown): PgLikeError | null {
  if (!err || typeof err !== "object") return null;
  const o = err as Record<string, unknown>;
  if (typeof o.code !== "string") return null;
  return o as PgLikeError;
}

/**
 * Map Postgres / node-pg constraint errors to stable API responses for finance clients.
 */
export function trySendDbConstraintError(res: Response, err: unknown): boolean {
  const pg = asPgError(err);
  if (!pg?.code) return false;

  if (pg.code === "23503") {
    sendError(res, 409, "CONSTRAINT_VIOLATION", "This record cannot be removed because other data still references it.", {
      hint: "Remove or reassign dependent payments, batch lines, receipts, or other AP records, then try again.",
      details: pg.detail ? { detail: pg.detail } : undefined,
    });
    return true;
  }

  if (pg.code === "23505") {
    sendError(res, 409, "UNIQUE_VIOLATION", "A record with this unique key already exists.", {
      details: pg.detail ? { detail: pg.detail } : undefined,
    });
    return true;
  }

  return false;
}

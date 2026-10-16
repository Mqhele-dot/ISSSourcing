import type { Request } from "express";

export type RequestActor = {
  userId: number;
  role: string;
};

export function resolveRequestActor(req: Request): RequestActor {
  const sessionUser = (req as Request & { user?: { id?: number; role?: string } }).user;
  const userId = Number(sessionUser?.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error("Authenticated user context is required for this operation.");
  }
  return {
    userId,
    role: String(sessionUser?.role ?? "").toLowerCase(),
  };
}

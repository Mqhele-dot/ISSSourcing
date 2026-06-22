import type { Response } from "express";

type ApiErrorBody = {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
  requestId: string;
};

type ApiMeta = Record<string, unknown> & { requestId: string };

function resolveRequestId(res: Response): string {
  const existing =
    (res.locals?.requestId as string | undefined) ??
    (res.getHeader("X-Request-Id") as string | undefined);
  return existing || "unknown-request-id";
}

export function sendOk<T>(res: Response, data: T, status = 200, meta?: Record<string, unknown>) {
  const requestId = resolveRequestId(res);
  return res.status(status).json({
    ok: true,
    data,
    meta: {
      requestId,
      ...(meta ?? {}),
    } satisfies ApiMeta,
  });
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  options?: { hint?: string; details?: unknown },
) {
  const requestId = resolveRequestId(res);
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      hint: options?.hint,
      details: options?.details,
      requestId,
    } satisfies ApiErrorBody,
  });
}

/** Normalized error envelope for legacy route handlers that include a function name in the message. */
export function sendFunctionError(
  res: Response,
  status: number,
  functionName: string,
  message: string,
  details?: unknown,
) {
  const normalizedMessage = `${functionName}: ${message}`;
  return sendError(res, status, functionName.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), normalizedMessage, {
    details: {
      functionName,
      ...(details !== undefined ? { details } : {}),
    },
  });
}

import type { NextFunction, Request, Response } from "express";

export type ApiSuccessMeta = {
  fallback?: string;
  appliedFilters?: Record<string, string | number | boolean | null | undefined>;
  resultCount?: number;
  queryMs?: number;
  /** ISO timestamp for when this response payload was assembled */
  generatedAt?: string;
};

export type ApiSuccessEnvelope<T> = {
  ok: true;
  data: T;
  meta?: ApiSuccessMeta;
};

export type ApiErrorDetails = Record<string, unknown> | unknown[] | null;

export type ApiErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    hint?: string;
    details?: ApiErrorDetails;
  };
};

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export class ApiContractError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly details?: ApiErrorDetails;

  constructor(
    status: number,
    code: string,
    message: string,
    hint?: string,
    details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiContractError";
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export function contractError(
  status: number,
  code: string,
  message: string,
  hint?: string,
  details?: ApiErrorDetails,
) {
  return new ApiContractError(status, code, message, hint, details);
}

export function respondOk<T>(res: Response, data: T, status = 200, meta?: ApiSuccessMeta) {
  if (meta) {
    res.setHeader("Cache-Control", "no-store");
  }
  const payload: ApiSuccessEnvelope<T> = meta ? { ok: true, data, meta } : { ok: true, data };
  return res.status(status).json(payload);
}

export function respondErr(
  res: Response,
  status: number,
  code: string,
  message: string,
  hint?: string,
  details?: ApiErrorDetails,
) {
  const payload: ApiErrorEnvelope = {
    ok: false,
    error: {
      code,
      message,
      ...(hint ? { hint } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
  return res.status(status).json(payload);
}

export type ApiRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void | Response> | void;

export function withApiContract(handler: ApiRouteHandler): ApiRouteHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof ApiContractError) {
        respondErr(res, error.status, error.code, error.message, error.hint, error.details);
        return;
      }

      console.error("Unhandled API contract error:", error);
      respondErr(
        res,
        500,
        "INTERNAL_ERROR",
        "Unexpected server error",
        "Please retry in a few moments.",
      );
    }
  };
}

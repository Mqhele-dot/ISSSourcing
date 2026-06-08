import type { Request } from "express";

export function parseInvoiceFilters(req: Request) {
  const customerId = typeof req.query.customerId === "string" ? Number(req.query.customerId) : undefined;
  const dueInDays = typeof req.query.dueInDays === "string" ? Number(req.query.dueInDays) : undefined;
  const fromDate = typeof req.query.fromDate === "string" ? new Date(req.query.fromDate) : undefined;
  const toDate = typeof req.query.toDate === "string" ? new Date(req.query.toDate) : undefined;
  return {
    customerId: Number.isFinite(customerId) ? customerId : undefined,
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    fromDate,
    toDate,
    overdue: req.query.overdue === "true",
    dueInDays: Number.isFinite(dueInDays) ? dueInDays : undefined,
  };
}

export function parseApprovalContext(req: Request, actorRole: string) {
  return {
    actorRole,
    overrideExplicit: Boolean(req.body?.adminOverride),
    overrideReason: typeof req.body?.overrideReason === "string" ? req.body.overrideReason : undefined,
    comment: typeof req.body?.comment === "string" ? req.body.comment : undefined,
  };
}

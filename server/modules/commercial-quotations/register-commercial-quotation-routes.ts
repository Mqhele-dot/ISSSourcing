import type { Express, Request, RequestHandler, Response } from "express";
import type { PoolClient } from "pg";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";
import { pool } from "../../db";
import { sendError, sendOk } from "../../api-response";
import { getActiveOrganizationId } from "../../organization-context";
import { getRequisitionContext } from "../master-data/mdm-control-centre";
import { getOrganizationDocumentBranding } from "../../services/organization-document-branding";
import {
  appendAuditEvent,
  appendAuditEventWithClient,
  type AuditChainInput,
} from "../../services/audit-chain-service";
import { recordActivity } from "../operations/operations-core";

type Auth = {
  ensureAuthenticated: RequestHandler;
  ensureRole: (roles: string[]) => RequestHandler;
  ensurePermission: (resource: string, permissionType: string) => RequestHandler;
};

const lineSchema = z.object({
  lineType: z.enum(["CATALOG", "NON_STOCK", "SERVICE"]),
  inventoryItemId: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitOfMeasureId: z.coerce.number().int().positive(),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  taxCodeId: z.coerce.number().int().positive().nullable().optional(),
});

const quotationBaseSchema = z.object({
  recipientSource: z.enum(["SUPPLIER_MASTER", "MANUAL"]).default("MANUAL"),
  recipientSupplierId: z.coerce.number().int().positive().nullable().optional(),
  recipientCompany: z.string().trim().min(1).max(200),
  recipientName: z.string().trim().max(200).nullable().optional(),
  recipientEmail: z.string().trim().email().max(320).nullable().optional(),
  recipientPhone: z.string().trim().max(80).nullable().optional(),
  recipientAddress: z.string().trim().max(1000).nullable().optional(),
  recipientRegistrationNumber: z.string().trim().max(120).nullable().optional(),
  recipientTaxNumber: z.string().trim().max(120).nullable().optional(),
  recipientPhysicalAddress: z.string().trim().min(5).max(1000),
  recipientBillingAddress: z.string().trim().max(1000).nullable().optional(),
  recipientDeliveryAddress: z.string().trim().max(1000).nullable().optional(),
  currencyCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  validUntil: z.coerce.date(),
  paymentTermsId: z.coerce.number().int().positive().nullable().optional(),
  incotermId: z.coerce.number().int().positive().nullable().optional(),
  acceptanceMethod: z.enum(["SIGNATURE", "PURCHASE_ORDER", "EMAIL_CONFIRMATION"]),
  acceptanceTerms: z.string().trim().min(20).max(12_000),
  legalTerms: z.string().trim().max(12_000).nullable().optional(),
  notes: z.string().trim().max(4_000).nullable().optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

function validateRecipientSource(
  value: z.infer<typeof quotationBaseSchema>,
  context: z.RefinementCtx,
) {
  if (value.recipientSource === "SUPPLIER_MASTER" && !value.recipientSupplierId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["recipientSupplierId"], message: "Select an onboarded supplier." });
  }
  if (value.recipientSource === "MANUAL" && value.recipientSupplierId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["recipientSupplierId"], message: "A manual recipient cannot reference an onboarded supplier." });
  }
}

const quotationSchema = quotationBaseSchema.superRefine(validateRecipientSource);

const quotationUpdateSchema = quotationBaseSchema.extend({
  expectedVersion: z.coerce.number().int().positive(),
}).superRefine(validateRecipientSource);

const acceptanceSchema = z.object({
  acceptedByName: z.string().trim().min(2).max(200),
  acceptanceReference: z.string().trim().min(3).max(500),
}).superRefine((value, context) => {
  const placeholders = [
    "recorded customer acceptance",
    "see attached customer evidence",
  ];
  if (placeholders.includes(value.acceptedByName.toLowerCase())) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptedByName"], message: "Enter the real accepting party." });
  }
  if (placeholders.includes(value.acceptanceReference.toLowerCase())) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["acceptanceReference"], message: "Enter an auditable evidence reference." });
  }
});

const rejectionSchema = z.object({
  rejectedByName: z.string().trim().min(2).max(200),
  rejectionReason: z.string().trim().min(5).max(2_000),
  rejectionReference: z.string().trim().max(500).nullable().optional(),
});

function userId(req: Request): number | null {
  return (req as Request & { user?: { id?: number } }).user?.id ?? null;
}

function activityActor(req: Request): string {
  const user = (req as Request & { user?: { username?: string; email?: string; id?: number } }).user;
  return user?.username?.trim() || user?.email?.trim() || (user?.id ? `user:${user.id}` : "system");
}

function requestId(req: Request, res: Response): string {
  return String(res.locals.requestId ?? req.get("x-request-id") ?? "unknown-request-id");
}

function camelQuotation(row: Record<string, unknown>) {
  return {
    id: Number(row.id), quotationNumber: row.quotation_number, status: row.status, version: Number(row.version),
    recipientSource: row.recipient_source === "SUPPLIER_MASTER" ? "SUPPLIER_MASTER" : "MANUAL",
    recipientSupplierId: row.recipient_supplier_id == null ? null : Number(row.recipient_supplier_id),
    recipientCompany: row.recipient_company, recipientName: row.recipient_name, recipientEmail: row.recipient_email,
    recipientPhone: row.recipient_phone, recipientAddress: row.recipient_address,
    recipientRegistrationNumber: row.recipient_registration_number, recipientTaxNumber: row.recipient_tax_number,
    recipientPhysicalAddress: row.recipient_physical_address ?? row.recipient_address,
    recipientBillingAddress: row.recipient_billing_address, recipientDeliveryAddress: row.recipient_delivery_address,
    supplierLegalName: row.supplier_legal_name, supplierRegistrationNumber: row.supplier_registration_number,
    supplierTaxNumber: row.supplier_tax_number, supplierPhysicalAddress: row.supplier_physical_address,
    supplierEmail: row.supplier_email, supplierPhone: row.supplier_phone, supplierWebsite: row.supplier_website,
    partyEvidenceSource: row.party_evidence_source === "current_profile_fallback" ? "current_profile_fallback" : "quotation",
    currencyCode: row.currency_code,
    reportingCurrencyCode: row.reporting_currency_code, exchangeRateToReporting: Number(row.exchange_rate_to_reporting),
    subtotal: Number(row.subtotal), discountTotal: Number(row.discount_total), taxTotal: Number(row.tax_total),
    total: Number(row.total), reportingTotal: Number(row.reporting_total), validUntil: row.valid_until,
    paymentTermsId: row.payment_terms_id == null ? null : Number(row.payment_terms_id), paymentTerms: row.payment_terms,
    incotermId: row.incoterm_id == null ? null : Number(row.incoterm_id), incoterm: row.incoterm,
    acceptanceMethod: row.acceptance_method, acceptanceTerms: row.acceptance_terms, legalTerms: row.legal_terms,
    notes: row.notes, approvedAt: row.approved_at, issuedAt: row.issued_at, acceptedByName: row.accepted_by_name,
    acceptedAt: row.accepted_at, acceptanceReference: row.acceptance_reference, createdAt: row.created_at, updatedAt: row.updated_at,
    rejectedByName: row.rejected_by_name, rejectedAt: row.rejected_at, rejectionReason: row.rejection_reason,
    rejectionReference: row.rejection_reference,
    evidenceSource: row.evidence_source === "audit_log" ? "audit_log" : "quotation",
    lineCount: row.line_count == null ? undefined : Number(row.line_count),
  };
}

async function loadSupplierPartySnapshot(organizationId: number) {
  const branding = await getOrganizationDocumentBranding(organizationId);
  if (!branding.address?.trim()) {
    throw Object.assign(
      new Error("Add the issuing company's physical address in Company Setup before creating or updating a commercial quotation."),
      { code: "COMPANY_PROFILE_INCOMPLETE" },
    );
  }
  return {
    legalName: branding.legalName,
    registrationNumber: branding.registrationNumber,
    taxNumber: branding.taxNumber,
    physicalAddress: branding.address,
    email: branding.contactEmail,
    phone: branding.contactPhone,
    website: branding.website,
  };
}

type RecipientInput = z.infer<typeof quotationSchema>;

async function loadRecipientSnapshot(client: PoolClient, organizationId: number, input: RecipientInput) {
  if (input.recipientSource === "MANUAL") {
    return {
      source: "MANUAL" as const,
      supplierId: null,
      company: input.recipientCompany,
      name: input.recipientName ?? null,
      email: input.recipientEmail ?? null,
      phone: input.recipientPhone ?? null,
      registrationNumber: input.recipientRegistrationNumber ?? null,
      taxNumber: input.recipientTaxNumber ?? null,
      physicalAddress: input.recipientPhysicalAddress,
      billingAddress: input.recipientBillingAddress ?? null,
      deliveryAddress: input.recipientDeliveryAddress ?? null,
    };
  }
  const result = await client.query(
    `SELECT id, name, legal_name, status, onboarding_status, contact_name, email, phone, address,
            billing_address, delivery_site, registration_number, tax_identification_number
       FROM suppliers
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, input.recipientSupplierId],
  );
  const row = result.rows[0];
  if (!row) {
    throw Object.assign(new Error("The selected supplier does not belong to this organization."), { code: "INVALID_RECIPIENT_SUPPLIER" });
  }
  if (String(row.status).toLowerCase() !== "active") {
    throw Object.assign(new Error("The selected supplier is inactive and cannot be used for a new quotation."), { code: "INACTIVE_RECIPIENT_SUPPLIER" });
  }
  if (!String(row.address ?? "").trim()) {
    throw Object.assign(new Error("Complete the selected supplier's physical address in the Suppliers workspace before using it on a quotation."), { code: "SUPPLIER_PROFILE_INCOMPLETE" });
  }
  return {
    source: "SUPPLIER_MASTER" as const,
    supplierId: Number(row.id),
    company: String(row.legal_name ?? row.name),
    name: row.contact_name,
    email: row.email,
    phone: row.phone,
    registrationNumber: row.registration_number,
    taxNumber: row.tax_identification_number,
    physicalAddress: String(row.address),
    billingAddress: row.billing_address,
    deliveryAddress: row.delivery_site,
  };
}

async function quotationPartyReadiness(organizationId: number, quotationId: number) {
  const result = await pool.query(
    `SELECT
       COALESCE(recipient_physical_address, recipient_address) AS customer_address,
       supplier_legal_name,
       supplier_physical_address
     FROM commercial_quotations
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, quotationId],
  );
  const row = result.rows[0];
  return {
    exists: Boolean(row),
    ready: Boolean(row?.customer_address?.trim() && row?.supplier_legal_name?.trim() && row?.supplier_physical_address?.trim()),
  };
}

async function loadQuotation(organizationId: number, id: number, client?: PoolClient) {
  const headerSql = `SELECT q.*,
       COALESCE(q.supplier_legal_name, os.legal_name, o.name) AS supplier_legal_name,
       COALESCE(q.supplier_registration_number, os.registration_number) AS supplier_registration_number,
       COALESCE(q.supplier_tax_number, os.tax_number) AS supplier_tax_number,
       COALESCE(q.supplier_physical_address, os.address) AS supplier_physical_address,
       COALESCE(q.supplier_email, os.contact_email) AS supplier_email,
       COALESCE(q.supplier_phone, os.contact_phone) AS supplier_phone,
       COALESCE(q.supplier_website, os.website) AS supplier_website,
       CASE WHEN q.supplier_legal_name IS NULL OR q.supplier_physical_address IS NULL
         THEN 'current_profile_fallback' ELSE 'quotation' END AS party_evidence_source,
       pt.name AS payment_terms, i.name AS incoterm,
       COALESCE(q.rejected_by_name, rejection_audit.details->>'rejectedByName') AS rejected_by_name,
       COALESCE(q.rejection_reason, rejection_audit.details->>'rejectionReason') AS rejection_reason,
       COALESCE(q.rejection_reference, rejection_audit.details->>'rejectionReference') AS rejection_reference,
       COALESCE(q.rejected_at, rejection_audit.created_at) AS rejected_at,
       CASE
         WHEN q.rejected_by_name IS NULL AND rejection_audit.id IS NOT NULL THEN 'audit_log'
         ELSE 'quotation'
       END AS evidence_source
     FROM commercial_quotations q
     JOIN organizations o ON o.id = q.organization_id
     LEFT JOIN organization_settings os ON os.organization_id = q.organization_id
     LEFT JOIN payment_terms pt ON pt.id = q.payment_terms_id AND pt.organization_id = q.organization_id
     LEFT JOIN incoterms i ON i.id = q.incoterm_id AND i.organization_id = q.organization_id
     LEFT JOIN LATERAL (
       SELECT audit.id, audit.details, audit.created_at
       FROM audit_logs audit
       WHERE audit.organization_id = q.organization_id
         AND audit.resource_type = 'commercial_quotation'
         AND audit.resource_id = q.id
         AND audit.action = 'COMMERCIAL_QUOTATION_REJECTED'
         AND audit.event_hash IS NOT NULL
       ORDER BY audit.created_at DESC, audit.id DESC
       LIMIT 1
     ) rejection_audit ON TRUE
     WHERE q.organization_id = $1 AND q.id = $2`;
  const header = client
    ? await client.query(headerSql, [organizationId, id])
    : await pool.query(headerSql, [organizationId, id]);
  if (!header.rows[0]) return null;
  const linesSql = `SELECT id, line_number AS "lineNumber", line_type AS "lineType", inventory_item_id AS "inventoryItemId",
       sku, description, quantity, unit_of_measure_id AS "unitOfMeasureId", unit_of_measure_code AS "unitOfMeasureCode",
       unit_price AS "unitPrice", discount_percent AS "discountPercent", tax_code_id AS "taxCodeId", tax_code AS "taxCode",
       tax_rate AS "taxRate", net_amount AS "netAmount", tax_amount AS "taxAmount", line_total AS "lineTotal"
     FROM commercial_quotation_lines WHERE organization_id = $1 AND quotation_id = $2 ORDER BY line_number, id`;
  const lines = client
    ? await client.query(linesSql, [organizationId, id])
    : await pool.query(linesSql, [organizationId, id]);
  return { quotation: camelQuotation(header.rows[0]), lines: lines.rows.map((row) => ({ ...row, id: Number(row.id) })) };
}

async function commitQuotationTransition(input: {
  organizationId: number;
  quotationId: number;
  updateSql: string;
  updateValues: unknown[];
  audit: AuditChainInput;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(input.updateSql, input.updateValues);
    if (!updated.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const detail = await loadQuotation(input.organizationId, input.quotationId, client);
    await appendAuditEventWithClient(client, input.audit);
    await client.query("COMMIT");
    return detail;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function nextQuotationNumber(client: PoolClient, organizationId: number): Promise<string> {
  const year = new Date().getFullYear();
  await client.query(
    `INSERT INTO mdm_document_sequences (organization_id, document_type, prefix, year, next_number, padding, active)
     VALUES ($1, 'COMMERCIAL_QUOTATION', $2, $3, 1, 6, TRUE)
     ON CONFLICT (organization_id, document_type, prefix) DO NOTHING`,
    [organizationId, `QUO-${year}-`, year],
  );
  const result = await client.query(
    `UPDATE mdm_document_sequences SET next_number = next_number + 1, updated_at = NOW()
     WHERE id = (SELECT id FROM mdm_document_sequences WHERE organization_id = $1 AND document_type = 'COMMERCIAL_QUOTATION' AND COALESCE(active, TRUE) = TRUE ORDER BY year DESC NULLS LAST, id DESC LIMIT 1)
     RETURNING prefix, next_number - 1 AS issued_number, padding`, [organizationId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("No active commercial quotation number sequence is configured.");
  return `${row.prefix}${String(row.issued_number).padStart(Number(row.padding ?? 6), "0")}`;
}

async function validateAndCalculate(client: PoolClient, organizationId: number, input: z.infer<typeof quotationSchema>) {
  const context = await getRequisitionContext(organizationId);
  const currency = context.currencies.find((entry: Record<string, unknown>) => String(entry.code).toUpperCase() === input.currencyCode);
  const rate = Number((currency as Record<string, unknown> | undefined)?.exchangeRateToZar ?? 0);
  if (!currency || !Number.isFinite(rate) || rate <= 0) throw Object.assign(new Error(`${input.currencyCode} has no active conversion rate to ${context.defaultCurrencyCode}.`), { code: "FX_RATE_REQUIRED" });
  if (input.paymentTermsId && !context.paymentTerms.some((entry: Record<string, unknown>) => Number(entry.id) === input.paymentTermsId)) throw Object.assign(new Error("Payment terms are inactive or belong to another organization."), { code: "INVALID_PAYMENT_TERMS" });
  if (input.incotermId && !context.incoterms.some((entry: Record<string, unknown>) => Number(entry.id) === input.incotermId)) throw Object.assign(new Error("Incoterm is inactive or belongs to another organization."), { code: "INVALID_INCOTERM" });
  const inventoryIds = [...new Set(input.lines.flatMap((line) => line.inventoryItemId ? [line.inventoryItemId] : []))];
  const inventoryRows = inventoryIds.length
    ? await client.query(
        `SELECT id, sku, name FROM inventory_items
         WHERE organization_id = $1 AND id = ANY($2::int[]) AND COALESCE(status, 'active') = 'active'`,
        [organizationId, inventoryIds],
      )
    : { rows: [] as Array<Record<string, unknown>> };
  const items = new Map(inventoryRows.rows.map((entry: Record<string, unknown>) => [Number(entry.id), entry]));
  const uoms = new Map(context.unitsOfMeasure.map((entry: Record<string, unknown>) => [Number(entry.id), entry]));
  const taxes = new Map(context.taxCodes.map((entry: Record<string, unknown>) => [Number(entry.id), entry]));
  const calculated = input.lines.map((line, index) => {
    const item = line.inventoryItemId ? items.get(line.inventoryItemId) : undefined;
    if (line.lineType === "CATALOG" && !item) throw Object.assign(new Error(`Line ${index + 1} must reference an active inventory item from this organization.`), { code: "INVALID_INVENTORY_ITEM" });
    if (line.lineType !== "CATALOG" && line.inventoryItemId) throw Object.assign(new Error(`Line ${index + 1} cannot attach an inventory item unless its type is Catalog.`), { code: "INVALID_LINE_TYPE" });
    const uom = uoms.get(line.unitOfMeasureId);
    if (!uom) throw Object.assign(new Error(`Line ${index + 1} has an invalid unit of measure.`), { code: "INVALID_UOM" });
    const tax = line.taxCodeId ? taxes.get(line.taxCodeId) : undefined;
    if (line.taxCodeId && !tax) throw Object.assign(new Error(`Line ${index + 1} has an invalid tax code.`), { code: "INVALID_TAX_CODE" });
    const gross = line.quantity * line.unitPrice;
    const discount = gross * line.discountPercent / 100;
    const net = gross - discount;
    const taxRate = Number((tax as Record<string, unknown> | undefined)?.rate ?? 0);
    const taxAmount = net * taxRate / 100;
    return { ...line, lineNumber: index + 1, sku: item ? String((item as Record<string, unknown>).sku ?? "") : null,
      description: line.lineType === "CATALOG" && item ? String((item as Record<string, unknown>).name ?? line.description) : line.description,
      uomCode: String((uom as Record<string, unknown>).code ?? (uom as Record<string, unknown>).symbol ?? "EA"),
      taxCode: tax ? String((tax as Record<string, unknown>).code ?? "") : null, taxRate,
      gross, discount, net, taxAmount, lineTotal: net + taxAmount };
  });
  const subtotal = calculated.reduce((sum, line) => sum + line.gross, 0);
  const discountTotal = calculated.reduce((sum, line) => sum + line.discount, 0);
  const taxTotal = calculated.reduce((sum, line) => sum + line.taxAmount, 0);
  const total = subtotal - discountTotal + taxTotal;
  return { context, rate, calculated, subtotal, discountTotal, taxTotal, total, reportingTotal: total * rate };
}

function drawWrapped(page: PDFPage, font: PDFFont, text: string, x: number, y: number, width: number, size = 9, lineHeight = 12): number {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      page.drawText(line, { x, y, size, font }); y -= lineHeight; line = word;
    } else line = candidate;
  }
  if (line) { page.drawText(line, { x, y, size, font }); y -= lineHeight; }
  return y;
}

function partyLines(input: {
  name: unknown;
  registrationNumber?: unknown;
  taxNumber?: unknown;
  physicalAddress?: unknown;
  email?: unknown;
  phone?: unknown;
  website?: unknown;
}): string[] {
  return [
    String(input.name ?? "").trim(),
    input.registrationNumber ? `Registration: ${String(input.registrationNumber).trim()}` : "",
    input.taxNumber ? `Tax/VAT: ${String(input.taxNumber).trim()}` : "",
    input.physicalAddress ? `Physical address: ${String(input.physicalAddress).trim()}` : "Physical address not recorded",
    [input.email, input.phone].filter(Boolean).map(String).join(" | "),
    input.website ? String(input.website).trim() : "",
  ].filter(Boolean);
}

function drawPartyBlock(page: PDFPage, font: PDFFont, bold: PDFFont, title: string, lines: string[], x: number, y: number, width: number): number {
  page.drawText(title, { x, y, size: 8, font: bold, color: rgb(.1, .35, .42) });
  let cursor = y - 13;
  lines.forEach((line, index) => {
    cursor = drawWrapped(page, index === 0 ? bold : font, line, x, cursor, width, index === 0 ? 9 : 7.5, 10);
  });
  return cursor;
}

export function registerCommercialQuotationRoutes(app: Express, auth: Auth): void {
  const read = [auth.ensureAuthenticated, auth.ensurePermission("sales", "read")];
  const create = [auth.ensureAuthenticated, auth.ensurePermission("sales", "create")];
  const update = [auth.ensureAuthenticated, auth.ensurePermission("sales", "update")];

  app.get("/api/commercial-quotations/context", ...read, async (_req, res) => {
    try {
      const organizationId = getActiveOrganizationId();
      const [masterData, branding, template] = await Promise.all([
        getRequisitionContext(organizationId), getOrganizationDocumentBranding(organizationId),
        pool.query(`SELECT id, name, terms_text AS "termsText", footer_text AS "footerText" FROM mdm_document_templates
          WHERE organization_id = $1 AND document_type = 'COMMERCIAL_QUOTATION' AND COALESCE(active, TRUE) = TRUE ORDER BY id DESC LIMIT 1`, [organizationId]),
      ]);
      return sendOk(res, { ...masterData, branding, template: template.rows[0] ?? null });
    } catch (error) {
      return sendError(res, 500, "QUOTATION_CONTEXT_FAILED", error instanceof Error ? error.message : "Failed to load quotation Master Data.");
    }
  });

  app.get("/api/commercial-quotations/scan-item", ...read, async (req, res) => {
    const value = String(req.query.value ?? "").trim();
    if (!value) return sendError(res, 400, "QUOTATION_SCAN_REQUIRED", "Scan or enter an item barcode, QR value, or SKU.");
    let pathSku: string | null = null;
    const pathMatch = value.match(/\/inventory\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
      try { pathSku = decodeURIComponent(pathMatch[1]); } catch { pathSku = pathMatch[1]; }
    }
    const organizationId = getActiveOrganizationId();
    const candidates = [...new Set([value, pathSku].filter((entry): entry is string => Boolean(entry)))];
    const result = await pool.query(
      `SELECT DISTINCT ii.id, ii.sku, ii.name, ii.price,
         COALESCE(ii.unit_of_measure_id, u.id) AS "unitOfMeasureId",
         ii.unit_of_measure AS "unitOfMeasure"
       FROM inventory_items ii
       LEFT JOIN barcodes b ON b.organization_id = ii.organization_id AND b.item_id = ii.id
       LEFT JOIN LATERAL (
         SELECT id FROM units_of_measure
         WHERE organization_id = ii.organization_id
           AND lower(code) = lower(COALESCE(ii.unit_of_measure, ''))
         ORDER BY id LIMIT 1
       ) u ON TRUE
       WHERE ii.organization_id = $1
         AND COALESCE(ii.status, 'active') = 'active'
         AND (ii.sku = ANY($2::text[]) OR ii.barcode = ANY($2::text[]) OR b.value = ANY($2::text[]))
       ORDER BY ii.id
       LIMIT 2`,
      [organizationId, candidates],
    );
    if (result.rows.length === 0) return sendError(res, 404, "QUOTATION_SCAN_NOT_FOUND", "No active Inventory item matches this scan.", { hint: "Confirm the barcode is linked to an item in this organization." });
    if (result.rows.length > 1) return sendError(res, 409, "QUOTATION_SCAN_AMBIGUOUS", "This scan matches more than one Inventory item.", { hint: "Correct duplicate barcode assignments before quoting the item." });
    const row = result.rows[0];
    return sendOk(res, { id:Number(row.id), sku:row.sku, name:row.name, price:Number(row.price ?? 0), unitOfMeasureId:row.unitOfMeasureId == null ? null : Number(row.unitOfMeasureId), unitOfMeasure:row.unitOfMeasure });
  });

  app.get("/api/v2/commercial-quotations", ...read, async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
    const q = String(req.query.q ?? "").trim();
    const status = String(req.query.status ?? "").trim().toUpperCase();
    if (status && !["DRAFT","PENDING_APPROVAL","APPROVED","ISSUED","ACCEPTED","REJECTED","EXPIRED","CANCELLED"].includes(status)) return sendError(res, 400, "INVALID_STATUS", "Invalid commercial quotation status.");
    const organizationId = getActiveOrganizationId(); const values: unknown[] = [organizationId]; const clauses = ["q.organization_id = $1"];
    if (q) { values.push(`%${q}%`); clauses.push(`(q.quotation_number ILIKE $${values.length} OR q.recipient_company ILIKE $${values.length})`); }
    if (status) { values.push(status); clauses.push(`q.status = $${values.length}`); }
    const where = clauses.join(" AND ");
    const count = await pool.query(`SELECT COUNT(*)::int total, COALESCE(SUM(reporting_total),0)::float8 AS value FROM commercial_quotations q WHERE ${where}`, values);
    values.push(pageSize, (page - 1) * pageSize);
    const rows = await pool.query(`SELECT q.*, COUNT(l.id)::int AS line_count FROM commercial_quotations q LEFT JOIN commercial_quotation_lines l ON l.quotation_id=q.id AND l.organization_id=q.organization_id WHERE ${where} GROUP BY q.id ORDER BY q.updated_at DESC, q.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    const total = Number(count.rows[0]?.total ?? 0);
    return sendOk(res, { items: rows.rows.map(camelQuotation), total, page, pageSize, hasNext: page * pageSize < total, summary: { reportingTotal: Number(count.rows[0]?.value ?? 0) } });
  });

  app.post("/api/commercial-quotations", ...create, async (req, res) => {
    const parsed = quotationSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "INVALID_COMMERCIAL_QUOTATION", "Complete the recipient, currency, validity, acceptance terms, and valid lines.", { details: parsed.error.flatten() });
    if (parsed.data.validUntil.getTime() < Date.now()) return sendError(res, 400, "INVALID_VALIDITY", "Valid-until date must be in the future.");
    const organizationId = getActiveOrganizationId(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const calc = await validateAndCalculate(client, organizationId, parsed.data);
      const supplier = await loadSupplierPartySnapshot(organizationId);
      const recipient = await loadRecipientSnapshot(client, organizationId, parsed.data);
      const quotationNumber = await nextQuotationNumber(client, organizationId);
      const inserted = await client.query(`INSERT INTO commercial_quotations (
          organization_id,quotation_number,recipient_source,recipient_supplier_id,recipient_company,recipient_name,recipient_email,recipient_phone,recipient_address,
          recipient_registration_number,recipient_tax_number,recipient_physical_address,recipient_billing_address,recipient_delivery_address,
          supplier_legal_name,supplier_registration_number,supplier_tax_number,supplier_physical_address,supplier_email,supplier_phone,supplier_website,
          currency_code,reporting_currency_code,exchange_rate_to_reporting,subtotal,discount_total,tax_total,total,reporting_total,
          valid_until,payment_terms_id,incoterm_id,acceptance_method,acceptance_terms,legal_terms,notes,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37) RETURNING id`,
        [organizationId,quotationNumber,recipient.source,recipient.supplierId,recipient.company,recipient.name,
          recipient.email,recipient.phone,recipient.physicalAddress,
          recipient.registrationNumber,recipient.taxNumber,
          recipient.physicalAddress,recipient.billingAddress,recipient.deliveryAddress,
          supplier.legalName,supplier.registrationNumber,supplier.taxNumber,supplier.physicalAddress,
          supplier.email,supplier.phone,supplier.website,parsed.data.currencyCode,calc.context.defaultCurrencyCode,calc.rate,
          calc.subtotal,calc.discountTotal,calc.taxTotal,calc.total,calc.reportingTotal,parsed.data.validUntil,
          parsed.data.paymentTermsId ?? null,parsed.data.incotermId ?? null,parsed.data.acceptanceMethod,
          parsed.data.acceptanceTerms,parsed.data.legalTerms ?? null,parsed.data.notes ?? null,userId(req)]);
      for (const line of calc.calculated) await client.query(`INSERT INTO commercial_quotation_lines (organization_id,quotation_id,line_number,line_type,inventory_item_id,sku,description,quantity,unit_of_measure_id,unit_of_measure_code,unit_price,discount_percent,tax_code_id,tax_code,tax_rate,net_amount,tax_amount,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [organizationId,inserted.rows[0].id,line.lineNumber,line.lineType,line.inventoryItemId ?? null,line.sku,line.description,line.quantity,line.unitOfMeasureId,line.uomCode,line.unitPrice,line.discountPercent,line.taxCodeId ?? null,line.taxCode,line.taxRate,line.net,line.taxAmount,line.lineTotal]);
      await client.query("COMMIT");
      const detail = await loadQuotation(organizationId, Number(inserted.rows[0].id));
      await appendAuditEvent({ organizationId, actor: { userId: userId(req) }, action: "COMMERCIAL_QUOTATION_CREATED", resourceType: "commercial_quotation", resourceId: Number(inserted.rows[0].id), after: detail, requestId: requestId(req, res), ipAddress: req.ip, userAgent: req.get("user-agent") ?? null });
      await recordActivity({actor:activityActor(req),entityType:"commercial_quotation",entityId:Number(inserted.rows[0].id),action:"create",summary:{quotationNumber,recipientCompany:recipient.company,recipientSource:recipient.source,recipientSupplierId:recipient.supplierId,total:calc.total,currencyCode:parsed.data.currencyCode,requestId:requestId(req,res)}});
      return sendOk(res, detail, 201);
    } catch (error) {
      await client.query("ROLLBACK"); const code = String((error as { code?: string }).code ?? "COMMERCIAL_QUOTATION_CREATE_FAILED");
      return sendError(res, code.startsWith("INVALID") || code === "FX_RATE_REQUIRED" || code === "COMPANY_PROFILE_INCOMPLETE" || code === "INACTIVE_RECIPIENT_SUPPLIER" || code === "SUPPLIER_PROFILE_INCOMPLETE" ? 400 : 500, code, error instanceof Error ? error.message : "Failed to create quotation.",
        code === "COMPANY_PROFILE_INCOMPLETE" ? { hint: "Open Admin → Company setup and complete the legal address block." } : undefined);
    } finally { client.release(); }
  });

  app.put("/api/commercial-quotations/:id", ...update, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_ID", "Invalid quotation ID.");
    const parsed = quotationUpdateSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "INVALID_COMMERCIAL_QUOTATION", "Complete the recipient, currency, validity, acceptance terms, and valid lines.", { details: parsed.error.flatten() });
    if (parsed.data.validUntil.getTime() < Date.now()) return sendError(res, 400, "INVALID_VALIDITY", "Valid-until date must be in the future.");
    const organizationId = getActiveOrganizationId();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT status, version FROM commercial_quotations WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [organizationId, id],
      );
      if (!locked.rows[0]) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "COMMERCIAL_QUOTATION_NOT_FOUND", "Commercial quotation not found.");
      }
      if (locked.rows[0].status !== "DRAFT") {
        await client.query("ROLLBACK");
        return sendError(res, 409, "QUOTATION_NOT_EDITABLE", "Only draft quotations can be edited.", { hint: "Create a revised quotation instead of changing issued or decided commercial evidence." });
      }
      if (Number(locked.rows[0].version) !== parsed.data.expectedVersion) {
        await client.query("ROLLBACK");
        return sendError(res, 409, "QUOTATION_VERSION_CONFLICT", "This draft changed after you opened it.", { hint: "Reload the latest draft before applying your changes." });
      }
      const before = await loadQuotation(organizationId, id);
      const calc = await validateAndCalculate(client, organizationId, parsed.data);
      const supplier = await loadSupplierPartySnapshot(organizationId);
      const recipient = await loadRecipientSnapshot(client, organizationId, parsed.data);
      await client.query(
        `UPDATE commercial_quotations SET recipient_source=$1,recipient_supplier_id=$2,recipient_company=$3,recipient_name=$4,recipient_email=$5,recipient_phone=$6,
          recipient_address=$7,recipient_registration_number=$8,recipient_tax_number=$9,recipient_physical_address=$10,
          recipient_billing_address=$11,recipient_delivery_address=$12,supplier_legal_name=$13,
          supplier_registration_number=$14,supplier_tax_number=$15,supplier_physical_address=$16,
          supplier_email=$17,supplier_phone=$18,supplier_website=$19,currency_code=$20,
          reporting_currency_code=$21,exchange_rate_to_reporting=$22,subtotal=$23,discount_total=$24,
          tax_total=$25,total=$26,reporting_total=$27,valid_until=$28,payment_terms_id=$29,
          incoterm_id=$30,acceptance_method=$31,acceptance_terms=$32,legal_terms=$33,
          notes=$34,version=version+1,updated_at=NOW()
         WHERE organization_id=$35 AND id=$36`,
        [recipient.source,recipient.supplierId,recipient.company,recipient.name,recipient.email,
          recipient.phone,recipient.physicalAddress,recipient.registrationNumber,recipient.taxNumber,
          recipient.physicalAddress,recipient.billingAddress,recipient.deliveryAddress,supplier.legalName,supplier.registrationNumber,
          supplier.taxNumber,supplier.physicalAddress,supplier.email,supplier.phone,supplier.website,
          parsed.data.currencyCode,calc.context.defaultCurrencyCode,calc.rate,calc.subtotal,calc.discountTotal,
          calc.taxTotal,calc.total,calc.reportingTotal,parsed.data.validUntil,parsed.data.paymentTermsId ?? null,
          parsed.data.incotermId ?? null,parsed.data.acceptanceMethod,parsed.data.acceptanceTerms,
          parsed.data.legalTerms ?? null,parsed.data.notes ?? null,
          organizationId,id],
      );
      await client.query(`DELETE FROM commercial_quotation_lines WHERE organization_id=$1 AND quotation_id=$2`, [organizationId, id]);
      for (const line of calc.calculated) await client.query(
        `INSERT INTO commercial_quotation_lines (organization_id,quotation_id,line_number,line_type,inventory_item_id,sku,description,quantity,unit_of_measure_id,unit_of_measure_code,unit_price,discount_percent,tax_code_id,tax_code,tax_rate,net_amount,tax_amount,line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [organizationId,id,line.lineNumber,line.lineType,line.inventoryItemId ?? null,line.sku,line.description,line.quantity,
          line.unitOfMeasureId,line.uomCode,line.unitPrice,line.discountPercent,line.taxCodeId ?? null,line.taxCode,
          line.taxRate,line.net,line.taxAmount,line.lineTotal],
      );
      await client.query("COMMIT");
      const after = await loadQuotation(organizationId, id);
      await appendAuditEvent({ organizationId, actor:{userId:userId(req)}, action:"COMMERCIAL_QUOTATION_UPDATED", resourceType:"commercial_quotation", resourceId:id, before, after, requestId:requestId(req,res), ipAddress:req.ip, userAgent:req.get("user-agent") ?? null });
      await recordActivity({actor:activityActor(req),entityType:"commercial_quotation",entityId:id,action:"edit",summary:{version:Number(locked.rows[0].version)+1,requestId:requestId(req,res)}});
      return sendOk(res, after);
    } catch (error) {
      await client.query("ROLLBACK");
      const code = String((error as { code?: string }).code ?? "COMMERCIAL_QUOTATION_UPDATE_FAILED");
      return sendError(res, code.startsWith("INVALID") || code === "FX_RATE_REQUIRED" || code === "COMPANY_PROFILE_INCOMPLETE" || code === "INACTIVE_RECIPIENT_SUPPLIER" || code === "SUPPLIER_PROFILE_INCOMPLETE" ? 400 : 500, code, error instanceof Error ? error.message : "Failed to update quotation.",
        code === "COMPANY_PROFILE_INCOMPLETE" ? { hint: "Open Admin → Company setup and complete the legal address block." } : undefined);
    } finally { client.release(); }
  });

  app.get("/api/commercial-quotations/:id", ...read, async (req, res) => {
    const id = Number(req.params.id); if (!Number.isInteger(id) || id <= 0) return sendError(res, 400, "INVALID_ID", "Invalid quotation ID.");
    const detail = await loadQuotation(getActiveOrganizationId(), id); return detail ? sendOk(res, detail) : sendError(res, 404, "COMMERCIAL_QUOTATION_NOT_FOUND", "Commercial quotation not found.");
  });

  app.post("/api/commercial-quotations/:id/submit", ...update, async (req, res) => {
    const organizationId = getActiveOrganizationId(); const id = Number(req.params.id);
    const parties = await quotationPartyReadiness(organizationId, id);
    if (!parties.exists) return sendError(res, 404, "COMMERCIAL_QUOTATION_NOT_FOUND", "Commercial quotation not found.");
    if (!parties.ready) return sendError(res, 409, "QUOTATION_PARTIES_INCOMPLETE", "Supplier and customer legal addresses must be snapshotted before approval.", { hint: "Edit and save the draft after completing Company Setup and the customer physical address." });
    const rules = await pool.query(`SELECT id FROM mdm_approval_rules WHERE organization_id=$1 AND entity_type='commercial_quotation' AND COALESCE(active,TRUE)=TRUE LIMIT 1`, [organizationId]);
    const status = rules.rows[0] ? "PENDING_APPROVAL" : "APPROVED";
    const detail = await commitQuotationTransition({ organizationId, quotationId:id,
      updateSql:`UPDATE commercial_quotations SET status=$1, approved_by_user_id=CASE WHEN $1='APPROVED' THEN $2 ELSE approved_by_user_id END, approved_at=CASE WHEN $1='APPROVED' THEN NOW() ELSE approved_at END, updated_at=NOW() WHERE organization_id=$3 AND id=$4 AND status='DRAFT' RETURNING id`,
      updateValues:[status,userId(req),organizationId,id],
      audit:{ organizationId, actor:{userId:userId(req)}, action: status === "APPROVED" ? "COMMERCIAL_QUOTATION_AUTO_APPROVED" : "COMMERCIAL_QUOTATION_SUBMITTED", resourceType:"commercial_quotation", resourceId:id, requestId:requestId(req,res) },
    });
    if (!detail) return sendError(res, 409, "QUOTATION_NOT_DRAFT", "Only a draft quotation can be submitted.");
    await recordActivity({actor:activityActor(req),entityType:"commercial_quotation",entityId:id,action:status === "APPROVED" ? "auto_approve" : "submit",summary:{status,requestId:requestId(req,res)}});
    return sendOk(res, detail);
  });

  app.post("/api/commercial-quotations/:id/approve", auth.ensureAuthenticated, auth.ensureRole(["manager","admin"]), async (req, res) => {
    const organizationId=getActiveOrganizationId(); const id=Number(req.params.id);
    const detail=await commitQuotationTransition({organizationId,quotationId:id,updateSql:`UPDATE commercial_quotations SET status='APPROVED',approved_by_user_id=$1,approved_at=NOW(),updated_at=NOW() WHERE organization_id=$2 AND id=$3 AND status='PENDING_APPROVAL' RETURNING id`,updateValues:[userId(req),organizationId,id],audit:{organizationId,actor:{userId:userId(req)},action:"COMMERCIAL_QUOTATION_APPROVED",resourceType:"commercial_quotation",resourceId:id,reason:String(req.body?.reason??"Approved commercial terms"),requestId:requestId(req,res)}});
    if(!detail) return sendError(res,409,"QUOTATION_NOT_PENDING","Only a pending quotation can be approved.");
    await recordActivity({actor:activityActor(req),entityType:"commercial_quotation",entityId:id,action:"approve",summary:{reason:String(req.body?.reason??"Approved commercial terms"),requestId:requestId(req,res)}});
    return sendOk(res,detail);
  });

  app.post("/api/commercial-quotations/:id/issue", ...update, async (req,res)=>{
    const organizationId=getActiveOrganizationId(); const id=Number(req.params.id);
    const parties=await quotationPartyReadiness(organizationId,id);
    if(!parties.exists)return sendError(res,404,"COMMERCIAL_QUOTATION_NOT_FOUND","Commercial quotation not found.");
    if(!parties.ready)return sendError(res,409,"QUOTATION_PARTIES_INCOMPLETE","Supplier and customer legal addresses are required before issue.",{hint:"Create a revised draft with complete party details."});
    const detail=await commitQuotationTransition({organizationId,quotationId:id,updateSql:`UPDATE commercial_quotations SET status='ISSUED',issued_at=NOW(),updated_at=NOW() WHERE organization_id=$1 AND id=$2 AND status='APPROVED' RETURNING id`,updateValues:[organizationId,id],audit:{organizationId,actor:{userId:userId(req)},action:"COMMERCIAL_QUOTATION_ISSUED",resourceType:"commercial_quotation",resourceId:id,requestId:requestId(req,res)}});
    if(!detail) return sendError(res,409,"QUOTATION_NOT_APPROVED","Approve the quotation before issuing it.");
    await recordActivity({actor:activityActor(req),entityType:"commercial_quotation",entityId:id,action:"issue",summary:{requestId:requestId(req,res)}}); return sendOk(res,detail);
  });

  app.post("/api/commercial-quotations/:id/accept", ...update, async (req,res)=>{
    const parsed=acceptanceSchema.safeParse(req.body); if(!parsed.success) return sendError(res,400,"INVALID_ACCEPTANCE","Record who accepted and the external evidence reference.");
    const organizationId=getActiveOrganizationId(); const id=Number(req.params.id); const detail=await commitQuotationTransition({organizationId,quotationId:id,updateSql:`UPDATE commercial_quotations SET status='ACCEPTED',accepted_by_name=$1,acceptance_reference=$2,accepted_at=NOW(),updated_at=NOW() WHERE organization_id=$3 AND id=$4 AND status='ISSUED' RETURNING id`,updateValues:[parsed.data.acceptedByName,parsed.data.acceptanceReference,organizationId,id],audit:{organizationId,actor:{userId:userId(req)},action:"COMMERCIAL_QUOTATION_ACCEPTED",resourceType:"commercial_quotation",resourceId:id,details:parsed.data,requestId:requestId(req,res)}});
    if(!detail) return sendError(res,409,"QUOTATION_NOT_ISSUED","Only an issued quotation can be marked accepted.");
    await recordActivity({actor:activityActor(req),entityType:"commercial_quotation",entityId:id,action:"accept",summary:{acceptedByName:parsed.data.acceptedByName,acceptanceReference:parsed.data.acceptanceReference,requestId:requestId(req,res)}}); return sendOk(res,detail);
  });

  app.post("/api/commercial-quotations/:id/reject", ...update, async (req,res)=>{
    const parsed=rejectionSchema.safeParse(req.body);
    if(!parsed.success) return sendError(res,400,"INVALID_REJECTION","Record who rejected the quotation and a meaningful reason.",{details:parsed.error.flatten()});
    const organizationId=getActiveOrganizationId(); const id=Number(req.params.id);
    const detail=await commitQuotationTransition({organizationId,quotationId:id,updateSql:`UPDATE commercial_quotations SET status='REJECTED',rejected_by_name=$1,rejection_reason=$2,rejection_reference=$3,rejected_at=NOW(),updated_at=NOW() WHERE organization_id=$4 AND id=$5 AND status='ISSUED' RETURNING id`,updateValues:[parsed.data.rejectedByName,parsed.data.rejectionReason,parsed.data.rejectionReference ?? null,organizationId,id],audit:{organizationId,actor:{userId:userId(req)},action:"COMMERCIAL_QUOTATION_REJECTED",resourceType:"commercial_quotation",resourceId:id,details:parsed.data,requestId:requestId(req,res)}});
    if(!detail) return sendError(res,409,"QUOTATION_NOT_ISSUED","Only an issued quotation can be marked rejected.");
    await recordActivity({actor:activityActor(req),entityType:"commercial_quotation",entityId:id,action:"reject",summary:{...parsed.data,requestId:requestId(req,res)}});
    return sendOk(res,detail);
  });

  app.get("/api/commercial-quotations/:id/document.pdf", ...read, async (req:Request,res:Response)=>{
    const organizationId=getActiveOrganizationId(); const detail=await loadQuotation(organizationId,Number(req.params.id)); if(!detail) return sendError(res,404,"COMMERCIAL_QUOTATION_NOT_FOUND","Commercial quotation not found.");
    const branding=await getOrganizationDocumentBranding(organizationId,{loadLogo:true}); const q=detail.quotation as Record<string,any>; const lines=detail.lines as Array<Record<string,any>>;
    const pdf=await PDFDocument.create(); const font=await pdf.embedFont(StandardFonts.Helvetica); const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    let logo: Awaited<ReturnType<typeof pdf.embedPng>> | undefined;
    if(branding.logoBytes?.length){try{try{logo=await pdf.embedPng(branding.logoBytes);}catch{logo=await pdf.embedJpg(branding.logoBytes);}}catch{/* text branding remains authoritative */}}
    const addPage=()=>{const next=pdf.addPage([595,842]);let titleX=50;if(logo){const scaled=logo.scaleToFit(90,45);next.drawImage(logo,{x:50,y:780,width:scaled.width,height:scaled.height});titleX=55+scaled.width;}next.drawText(branding.displayName,{x:titleX,y:811,size:13,font:bold,color:rgb(.05,.2,.3)});next.drawText("COMMERCIAL QUOTATION",{x:50,y:755,size:19,font:bold});next.drawText(String(q.quotationNumber),{x:390,y:758,size:11,font:bold});next.drawText("Offer document - not a tax invoice",{x:50,y:742,size:7,font,color:rgb(.35,.35,.35)});return next;};
    const drawLineHeader=(target:PDFPage,yPosition:number)=>{target.drawText("Description",{x:50,y:yPosition,size:9,font:bold});target.drawText("Qty",{x:330,y:yPosition,size:9,font:bold});target.drawText("Unit price",{x:375,y:yPosition,size:9,font:bold});target.drawText("Total",{x:485,y:yPosition,size:9,font:bold});return yPosition-15;};
    let page=addPage(); let y=728;
    const supplierLines=partyLines({
      name:q.supplierLegalName ?? branding.legalName,
      registrationNumber:q.supplierRegistrationNumber ?? branding.registrationNumber,
      taxNumber:q.supplierTaxNumber ?? branding.taxNumber,
      physicalAddress:q.supplierPhysicalAddress ?? branding.address,
      email:q.supplierEmail ?? branding.contactEmail,
      phone:q.supplierPhone ?? branding.contactPhone,
      website:q.supplierWebsite ?? branding.website,
    });
    const customerLines=partyLines({
      name:q.recipientCompany,
      registrationNumber:q.recipientRegistrationNumber,
      taxNumber:q.recipientTaxNumber,
      physicalAddress:q.recipientPhysicalAddress ?? q.recipientAddress,
      email:q.recipientEmail,
      phone:q.recipientPhone,
    });
    if(q.recipientName)customerLines.splice(1,0,`Attention: ${q.recipientName}`);
    const supplierBottom=drawPartyBlock(page,font,bold,"CUSTOMER / ISSUER",supplierLines,50,y,235);
    const customerBottom=drawPartyBlock(page,font,bold,"SUPPLIER / QUOTE TO",customerLines,310,y,235);
    y=Math.min(supplierBottom,customerBottom)-6;
    if(q.recipientBillingAddress && q.recipientBillingAddress !== (q.recipientPhysicalAddress ?? q.recipientAddress))
      y=drawWrapped(page,font,`Billing address: ${q.recipientBillingAddress}`,310,y,235,7.5,10);
    if(q.recipientDeliveryAddress)
      y=drawWrapped(page,font,`Delivery/service address: ${q.recipientDeliveryAddress}`,310,y,235,7.5,10);
    y-=5;
    y=drawWrapped(page,font,`Quote date: ${new Date(q.createdAt).toLocaleDateString()}  |  Valid until: ${new Date(q.validUntil).toLocaleDateString()}  |  Currency: ${q.currencyCode}  |  Status: ${q.status}`,50,y,495,8.5,12);
    y=drawWrapped(page,font,`Payment terms: ${q.paymentTerms ?? "Not specified"}  |  Delivery terms / Incoterm: ${q.incoterm ?? "Not specified"}`,50,y,495,8,11);
    y=drawLineHeader(page,y-8);
    for(const line of lines){if(y<95){page=addPage();y=drawLineHeader(page,728);}const lineLabel=line.sku?`${line.sku} - ${line.description}`:String(line.description);page.drawText(lineLabel.slice(0,49),{x:50,y,size:8,font});page.drawText(`${line.quantity} ${line.unitOfMeasureCode}`,{x:330,y,size:8,font});page.drawText(Number(line.unitPrice).toFixed(2),{x:395,y,size:8,font});page.drawText(Number(line.lineTotal).toFixed(2),{x:490,y,size:8,font});y-=15;}
    if(y<245){page=addPage();y=728;}y-=8; page.drawText(`Subtotal: ${q.currencyCode} ${Number(q.subtotal).toFixed(2)}`,{x:355,y,size:9,font});y-=14;page.drawText(`Discount: ${q.currencyCode} ${Number(q.discountTotal).toFixed(2)}`,{x:355,y,size:9,font});y-=14;page.drawText(`Tax: ${q.currencyCode} ${Number(q.taxTotal).toFixed(2)}`,{x:355,y,size:9,font});y-=16;page.drawText(`TOTAL: ${q.currencyCode} ${Number(q.total).toFixed(2)}`,{x:355,y,size:11,font:bold});y-=14;page.drawText(`Reporting value: ${q.reportingCurrencyCode} ${Number(q.reportingTotal).toFixed(2)}`,{x:355,y,size:8,font});
    y-=28;page.drawText("Acceptance and conditions",{x:50,y,size:11,font:bold});y-=16;y=drawWrapped(page,font,String(q.acceptanceTerms),50,y,495,8,11);if(q.legalTerms){y-=5;y=drawWrapped(page,font,String(q.legalTerms),50,y,495,8,11);}if(y<80){page=addPage();y=728;}y-=14;
    if(q.status==="ACCEPTED"){
      page.drawText(`Accepted by: ${q.acceptedByName ?? "Recorded customer"}`,{x:50,y,size:8,font:bold});y-=12;
      y=drawWrapped(page,font,`Evidence: ${q.acceptanceReference ?? "Not recorded"}  |  Date: ${q.acceptedAt ? new Date(q.acceptedAt).toLocaleDateString() : "Not recorded"}`,50,y,495,8,11);
    }else if(q.status==="REJECTED"){
      page.drawText(`Rejected by: ${q.rejectedByName ?? "Recorded customer"}`,{x:50,y,size:8,font:bold});y-=12;
      y=drawWrapped(page,font,`Reason: ${q.rejectionReason ?? "Not recorded"}`,50,y,495,8,11);
      y=drawWrapped(page,font,`Evidence: ${q.rejectionReference ?? "Not supplied"}  |  Date: ${q.rejectedAt ? new Date(q.rejectedAt).toLocaleDateString() : "Not recorded"}`,50,y,495,8,11);
    }else{
      page.drawText("Accepted by: ____________________   Signature/reference: ____________________   Date: __________",{x:50,y,size:8,font});
    }
    const supplierFooter=supplierLines.join(" | ");
    const allPages=pdf.getPages();
    allPages.forEach((pdfPage,index)=>{drawWrapped(pdfPage,font,supplierFooter,50,32,440,6.5,8);pdfPage.drawText(`Page ${index+1} of ${allPages.length}`,{x:505,y:32,size:6.5,font});}); const bytes=await pdf.save();res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`inline; filename="${String(q.quotationNumber).replace(/[^A-Za-z0-9_-]/g,"-")}.pdf"`);return res.status(200).send(Buffer.from(bytes));
  });
}

import { pool } from "../../db";

export type MdmDomain =
  | "legal-entities"
  | "sites"
  | "cost-centres"
  | "supplier-documents"
  | "supplier-contacts"
  | "supplier-bank-accounts"
  | "supplier-items"
  | "item-categories"
  | "uom-classes"
  | "uom-conversions"
  | "exchange-rates"
  | "procurement-policies"
  | "approval-rules"
  | "document-sequences"
  | "document-templates"
  | "gl-mappings"
  | "import-batches"
  | "data-quality-issues";

type MdmDomainConfig = {
  table: string;
  codeColumn?: string;
  searchable: string[];
  allowedColumns: string[];
};

type QueryValue = string | number | boolean | Date | Record<string, unknown> | number[] | null;

type MdmDependencyUsage = {
  label: string;
  count: number;
};

export class MdmDependencyError extends Error {
  readonly status = 409;
  readonly code = "MDM_RECORD_IN_USE";
  readonly usage: MdmDependencyUsage[];

  constructor(domain: MdmDomain, usage: MdmDependencyUsage[]) {
    const summary = usage.map((item) => `${item.count} ${item.label}`).join(", ");
    super(`Cannot deactivate this ${domain} record while it is used by ${summary}.`);
    this.name = "MdmDependencyError";
    this.usage = usage;
  }
}

type MdmDataQualityIssueInput = {
  domain: string;
  severity: "info" | "warning" | "error";
  issueCode: string;
  title: string;
  message: string;
  affectedEntityType?: string;
  affectedEntityId?: number;
  recommendedAction: string;
};

const mdmDomains = {
  "legal-entities": {
    table: "mdm_legal_entities",
    codeColumn: "code",
    searchable: ["code", "name", "registration_number", "tax_number"],
    allowedColumns: [
      "code",
      "name",
      "registration_number",
      "tax_number",
      "default_currency_code",
      "country_code",
      "active",
    ],
  },
  sites: {
    table: "mdm_sites",
    codeColumn: "code",
    searchable: ["code", "name", "site_type", "address"],
    allowedColumns: ["legal_entity_id", "code", "name", "site_type", "address", "default_warehouse_id", "active"],
  },
  "cost-centres": {
    table: "mdm_cost_centres",
    codeColumn: "code",
    searchable: ["code", "name", "gl_account_code"],
    allowedColumns: ["code", "name", "department_id", "gl_account_code", "owner_user_id", "active"],
  },
  "supplier-documents": {
    table: "mdm_supplier_documents",
    searchable: ["document_type", "status"],
    allowedColumns: ["supplier_id", "document_type", "document_id", "status", "expiry_date", "required_for_po"],
  },
  "supplier-contacts": {
    table: "mdm_supplier_contacts",
    searchable: ["contact_type", "name", "email", "phone", "role_title"],
    allowedColumns: ["supplier_id", "contact_type", "name", "email", "phone", "role_title", "is_primary", "active"],
  },
  "supplier-bank-accounts": {
    table: "mdm_supplier_bank_accounts",
    searchable: ["bank_name", "account_number_masked", "swift_code", "currency_code", "verification_status"],
    allowedColumns: [
      "supplier_id",
      "bank_name",
      "account_number_masked",
      "swift_code",
      "currency_code",
      "payment_method",
      "verification_status",
      "is_default",
      "active",
    ],
  },
  "supplier-items": {
    table: "mdm_supplier_items",
    searchable: ["supplier_item_code", "currency_code"],
    allowedColumns: [
      "supplier_id",
      "item_id",
      "supplier_item_code",
      "preferred",
      "lead_time_days",
      "min_order_quantity",
      "default_price",
      "currency_code",
      "active",
    ],
  },
  "item-categories": {
    table: "mdm_item_categories",
    codeColumn: "code",
    searchable: ["code", "name", "default_gl_account_code"],
    allowedColumns: ["code", "name", "parent_id", "default_gl_account_code", "default_tax_code_id", "active"],
  },
  "uom-classes": {
    table: "mdm_uom_classes",
    codeColumn: "code",
    searchable: ["code", "name"],
    allowedColumns: ["code", "name", "base_uom_id", "precision", "active"],
  },
  "uom-conversions": {
    table: "mdm_uom_conversions",
    searchable: [],
    allowedColumns: ["from_uom_id", "to_uom_id", "item_id", "factor", "active"],
  },
  "exchange-rates": {
    table: "mdm_exchange_rates",
    searchable: ["from_currency_code", "to_currency_code", "source"],
    allowedColumns: [
      "from_currency_code",
      "to_currency_code",
      "rate",
      "source",
      "effective_date",
      "expires_at",
      "manual_override_allowed",
      "active",
    ],
  },
  "procurement-policies": {
    table: "mdm_procurement_policies",
    codeColumn: "code",
    searchable: ["code", "name", "policy_type"],
    allowedColumns: ["code", "name", "policy_type", "config", "active"],
  },
  "approval-rules": {
    table: "mdm_approval_rules",
    codeColumn: "code",
    searchable: ["code", "name", "entity_type", "approver_role"],
    allowedColumns: [
      "code",
      "name",
      "entity_type",
      "min_local_value",
      "max_local_value",
      "department_id",
      "cost_centre_id",
      "category_code",
      "supplier_risk",
      "approver_role",
      "approval_level",
      "active",
    ],
  },
  "document-sequences": {
    table: "mdm_document_sequences",
    searchable: ["document_type", "prefix"],
    allowedColumns: [
      "document_type",
      "prefix",
      "legal_entity_id",
      "site_id",
      "year",
      "next_number",
      "padding",
      "active",
    ],
  },
  "document-templates": {
    table: "mdm_document_templates",
    searchable: ["document_type", "name"],
    allowedColumns: [
      "document_type",
      "name",
      "logo_url",
      "terms_text",
      "footer_text",
      "banking_details",
      "registration_details",
      "active",
    ],
  },
  "gl-mappings": {
    table: "mdm_gl_mappings",
    searchable: ["mapping_type", "source_type", "source_id", "gl_account_code"],
    allowedColumns: ["mapping_type", "source_type", "source_id", "gl_account_code", "cost_centre_id", "active"],
  },
  "import-batches": {
    table: "mdm_import_batches",
    searchable: ["domain", "file_name", "status"],
    allowedColumns: ["domain", "file_name", "status", "total_rows", "valid_rows", "invalid_rows", "validation_report"],
  },
  "data-quality-issues": {
    table: "mdm_data_quality_issues",
    searchable: ["domain", "issue_code", "title", "message", "status"],
    allowedColumns: [
      "domain",
      "severity",
      "issue_code",
      "title",
      "message",
      "affected_entity_type",
      "affected_entity_id",
      "recommended_action",
      "status",
    ],
  },
} satisfies Record<MdmDomain, MdmDomainConfig>;

export const mdmDomainNames = Object.keys(mdmDomains) as MdmDomain[];

export function isMdmDomain(value: string): value is MdmDomain {
  return value in mdmDomains;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function filterPayload(config: MdmDomainConfig, input: Record<string, unknown>): Record<string, QueryValue> {
  const output: Record<string, QueryValue> = {};
  for (const column of config.allowedColumns) {
    const camel = column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const value = input[column] ?? input[camel];
    if (value === undefined) continue;
    if (value instanceof Date || value === null) {
      output[column] = value;
    } else if (typeof value === "object") {
      output[column] = value as Record<string, unknown>;
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[column] = value;
    }
  }
  return output;
}

function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}

async function count(sqlText: string, values: QueryValue[] = []): Promise<number> {
  const result = await pool.query<{ count: string }>(sqlText, values);
  return Number(result.rows[0]?.count ?? 0);
}

async function getMdmDisableDependencies(
  domain: MdmDomain,
  organizationId: number,
  id: number,
): Promise<MdmDependencyUsage[]> {
  if (domain === "uom-conversions") {
    const conversion = await pool.query<{
      from_uom_id: number | null;
      to_uom_id: number | null;
      item_id: number | null;
    }>(
      "SELECT from_uom_id, to_uom_id, item_id FROM mdm_uom_conversions WHERE organization_id = $1 AND id = $2",
      [organizationId, id],
    );
    const row = conversion.rows[0];
    if (!row) return [];
    const uomIds = [row.from_uom_id, row.to_uom_id].filter(
      (value): value is number => value != null && Number.isFinite(Number(value)),
    );
    if (uomIds.length === 0) return [];
    const itemFilter = row.item_id ? "AND pri.item_id = $3" : "";
    const values: QueryValue[] = row.item_id ? [organizationId, uomIds, row.item_id] : [organizationId, uomIds];
    const openRequisitions = await count(
      `
        SELECT COUNT(*)
        FROM purchase_requisition_items pri
        JOIN purchase_requisitions pr ON pr.id = pri.requisition_id
        WHERE pr.organization_id = $1
          AND pri.unit_of_measure_id = ANY($2::int[])
          ${itemFilter}
          AND UPPER(COALESCE(pr.status, 'DRAFT')) NOT IN ('CONVERTED', 'CLOSED', 'CANCELLED', 'REJECTED')
      `,
      values,
    );
    const poItemFilter = row.item_id ? "AND poi.item_id = $3" : "";
    const openPurchaseOrders = await count(
      `
        SELECT COUNT(*)
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE po.organization_id = $1
          AND poi.unit_of_measure_id = ANY($2::int[])
          ${poItemFilter}
          AND UPPER(COALESCE(po.status, 'DRAFT')) NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')
      `,
      values,
    );
    return [
      ...(openRequisitions > 0 ? [{ label: "open requisition lines", count: openRequisitions }] : []),
      ...(openPurchaseOrders > 0 ? [{ label: "open purchase order lines", count: openPurchaseOrders }] : []),
    ];
  }

  if (domain === "gl-mappings") {
    const mapping = await pool.query<{ gl_account_code: string | null; cost_centre_id: number | null }>(
      "SELECT gl_account_code, cost_centre_id FROM mdm_gl_mappings WHERE organization_id = $1 AND id = $2",
      [organizationId, id],
    );
    const row = mapping.rows[0];
    const glAccountCode = String(row?.gl_account_code ?? "").trim();
    if (!glAccountCode) return [];
    const openRequisitions = await count(
      `
        SELECT COUNT(*)
        FROM purchase_requisition_items pri
        JOIN purchase_requisitions pr ON pr.id = pri.requisition_id
        WHERE pr.organization_id = $1
          AND pri.gl_account_code = $2
          AND ($3::int IS NULL OR pri.cost_centre_id = $3::int)
          AND UPPER(COALESCE(pr.status, 'DRAFT')) NOT IN ('CONVERTED', 'CLOSED', 'CANCELLED', 'REJECTED')
      `,
      [organizationId, glAccountCode, row.cost_centre_id ?? null],
    );
    return openRequisitions > 0 ? [{ label: "open requisition finance mappings", count: openRequisitions }] : [];
  }

  return [];
}

export async function listMdmDomain(domain: MdmDomain, organizationId: number, search = "") {
  const config = mdmDomains[domain];
  const values: QueryValue[] = [organizationId];
  let where = "organization_id = $1";
  const term = search.trim();
  if (term && config.searchable.length > 0) {
    values.push(`%${term.toLowerCase()}%`);
    const idx = values.length;
    where += ` AND (${config.searchable.map((col) => `LOWER(COALESCE(${col}::text, '')) LIKE $${idx}`).join(" OR ")})`;
  }
  const orderColumn = (config as MdmDomainConfig).codeColumn ?? "id";
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${config.table} WHERE ${where} ORDER BY ${orderColumn} ASC, id ASC LIMIT 500`,
    values,
  );
  return result.rows.map(rowToCamel);
}

export async function createMdmDomainRecord(
  domain: MdmDomain,
  organizationId: number,
  input: Record<string, unknown>,
  performedBy?: number,
) {
  const config = mdmDomains[domain];
  const payload = filterPayload(config, input);
  payload.organization_id = organizationId;
  const columns = Object.keys(payload);
  if (columns.length <= 1) {
    throw new Error("No valid MDM fields were provided.");
  }
  const values = Object.values(payload);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await pool.query<Record<string, unknown>>(
    `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    values,
  );
  const created = result.rows[0] ?? {};
  await writeMdmAudit(organizationId, domain, Number(created.id ?? 0), "create", null, created, performedBy);
  return rowToCamel(created);
}

export async function updateMdmDomainRecord(
  domain: MdmDomain,
  organizationId: number,
  id: number,
  input: Record<string, unknown>,
  performedBy?: number,
) {
  const config = mdmDomains[domain];
  const before = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ${config.table} WHERE organization_id = $1 AND id = $2`,
    [organizationId, id],
  );
  if (before.rowCount === 0) return null;

  const payload = filterPayload(config, input);
  if (payload.active === false) {
    const usage = await getMdmDisableDependencies(domain, organizationId, id);
    if (usage.length > 0) {
      throw new MdmDependencyError(domain, usage);
    }
  }
  payload.updated_at = new Date();
  const columns = Object.keys(payload);
  const values = Object.values(payload);
  values.push(organizationId, id);
  const orgIdx = values.length - 1;
  const idIdx = values.length;
  const setClause = columns.map((column, index) => `${column} = $${index + 1}`).join(", ");
  const result = await pool.query<Record<string, unknown>>(
    `UPDATE ${config.table} SET ${setClause} WHERE organization_id = $${orgIdx} AND id = $${idIdx} RETURNING *`,
    values,
  );
  const updated = result.rows[0] ?? {};
  await writeMdmAudit(organizationId, domain, id, "update", before.rows[0] ?? null, updated, performedBy);
  return rowToCamel(updated);
}

export async function getMdmAudit(domain: MdmDomain, organizationId: number, id: number) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT * FROM mdm_audit_logs WHERE organization_id = $1 AND domain = $2 AND record_id = $3 ORDER BY created_at DESC LIMIT 100`,
    [organizationId, domain, id],
  );
  return result.rows.map(rowToCamel);
}

async function writeMdmAudit(
  organizationId: number,
  domain: string,
  recordId: number,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  performedBy?: number,
) {
  await pool.query(
    `
      INSERT INTO mdm_audit_logs (organization_id, domain, record_id, action, summary, before, after, performed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      organizationId,
      domain,
      recordId,
      action,
      `${action} ${domain} #${recordId}`,
      before,
      after,
      performedBy ?? null,
    ],
  );
}

export async function scanMdmDataQuality(organizationId: number) {
  const issues: MdmDataQualityIssueInput[] = [];
  const [
    activeSuppliers,
    activeItems,
    activeWarehouses,
    activeCurrencies,
    activeTaxCodes,
    activePaymentTerms,
    activeUoms,
    activeDepartments,
    activeCostCentres,
    activeGlMappings,
    activeSequences,
    activePolicies,
  ] = await Promise.all([
    count("SELECT count(*) FROM suppliers WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'", [
      organizationId,
    ]),
    count("SELECT count(*) FROM inventory_items WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'", [
      organizationId,
    ]),
    count("SELECT count(*) FROM warehouses WHERE organization_id = $1", [organizationId]),
    count("SELECT count(*) FROM currencies WHERE COALESCE(active, TRUE) = TRUE"),
    count("SELECT count(*) FROM tax_codes WHERE COALESCE(active, TRUE) = TRUE"),
    count("SELECT count(*) FROM payment_terms WHERE COALESCE(active, TRUE) = TRUE"),
    count("SELECT count(*) FROM units_of_measure WHERE COALESCE(active, TRUE) = TRUE"),
    count("SELECT count(*) FROM departments WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
    count("SELECT count(*) FROM mdm_cost_centres WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
    count("SELECT count(*) FROM mdm_gl_mappings WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
    count("SELECT count(*) FROM mdm_document_sequences WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
    count("SELECT count(*) FROM mdm_procurement_policies WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
  ]);

  const supplierGaps = await pool.query<{
    id: number;
    name: string;
    default_currency_code: string | null;
    payment_terms_id: number | null;
    tax_code_id: number | null;
  }>(
    `
      SELECT id, name, default_currency_code, payment_terms_id, tax_code_id
      FROM suppliers
      WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'
        AND (default_currency_code IS NULL OR payment_terms_id IS NULL OR tax_code_id IS NULL)
      ORDER BY name ASC
      LIMIT 50
    `,
    [organizationId],
  );
  for (const supplier of supplierGaps.rows) {
    const missing = [
      !supplier.default_currency_code ? "preferred currency" : null,
      supplier.payment_terms_id == null ? "payment terms" : null,
      supplier.tax_code_id == null ? "tax code" : null,
    ].filter(Boolean);
    issues.push({
      domain: "Suppliers",
      severity: "warning",
      issueCode: "SUPPLIER_DEFAULTS_MISSING",
      title: "Supplier defaults incomplete",
      message: `${supplier.name} is missing ${missing.join(", ")}.`,
      affectedEntityType: "supplier",
      affectedEntityId: supplier.id,
      recommendedAction: "Open Supplier Master and complete currency, payment terms, and tax defaults before PO use.",
    });
  }

  const itemGaps = await pool.query<{ id: number; name: string; sku: string; unit_of_measure_id: number | null }>(
    `
      SELECT id, name, sku, unit_of_measure_id
      FROM inventory_items
      WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'
        AND (unit_of_measure_id IS NULL OR supplier_id IS NULL OR price IS NULL OR price <= 0)
      ORDER BY sku ASC
      LIMIT 50
    `,
    [organizationId],
  );
  for (const item of itemGaps.rows) {
    issues.push({
      domain: "Items & Services",
      severity: "warning",
      issueCode: "ITEM_CATALOGUE_GAP",
      title: "Catalogue item missing procurement defaults",
      message: `${item.sku} - ${item.name} needs UOM, supplier, and positive price defaults for requisition autofill.`,
      affectedEntityType: "inventory_item",
      affectedEntityId: item.id,
      recommendedAction: "Open Item Catalogue and add UOM, preferred supplier, price, tax, and GL mapping.",
    });
  }

  const zar = await pool.query<{ id: number; exchange_rate_to_zar: number; active: boolean | null }>(
    "SELECT id, exchange_rate_to_zar, active FROM currencies WHERE code = 'ZAR' LIMIT 1",
  );
  if (!zar.rows[0]) {
    issues.push({
      domain: "Currency & Tax",
      severity: "error",
      issueCode: "ZAR_MISSING",
      title: "Default ZAR currency missing",
      message: "ZAR must exist as the company/test currency for local approval value calculations.",
      recommendedAction: "Create active currency ZAR with exchange rate to ZAR = 1.",
    });
  } else if (Number(zar.rows[0].exchange_rate_to_zar) !== 1 || zar.rows[0].active === false) {
    issues.push({
      domain: "Currency & Tax",
      severity: "error",
      issueCode: "ZAR_INVALID",
      title: "Default ZAR currency is not valid",
      message: "ZAR must be active and have an exchange rate to ZAR of 1.",
      affectedEntityType: "currency",
      affectedEntityId: zar.rows[0].id,
      recommendedAction: "Set ZAR active with exchangeRateToZar = 1.",
    });
  }

  const fxGaps = await pool.query<{ code: string; name: string }>(
    `
      SELECT c.code, c.name
      FROM currencies c
      WHERE COALESCE(c.active, TRUE) = TRUE
        AND c.code <> 'ZAR'
        AND NOT EXISTS (
          SELECT 1 FROM mdm_exchange_rates r
          WHERE r.organization_id = $1
            AND r.from_currency_code = c.code
            AND r.to_currency_code = 'ZAR'
            AND COALESCE(r.active, TRUE) = TRUE
        )
      ORDER BY c.code ASC
      LIMIT 50
    `,
    [organizationId],
  );
  for (const currency of fxGaps.rows) {
    issues.push({
      domain: "Currency & Tax",
      severity: "warning",
      issueCode: "FX_RATE_MISSING",
      title: "FX rate missing",
      message: `${currency.code} (${currency.name}) has no active MDM exchange rate to ZAR.`,
      affectedEntityType: "currency",
      recommendedAction: "Add an exchange-rate record so requisitions and approvals can calculate local ZAR value.",
    });
  }

  if (activeTaxCodes === 0) {
    issues.push({
      domain: "Currency & Tax",
      severity: "error",
      issueCode: "NO_ACTIVE_TAX_CODES",
      title: "No active tax codes",
      message: "Requisitions, POs, invoices, and exports need controlled VAT/tax codes.",
      recommendedAction: "Create at least one active VAT/tax code, for example ZA VAT 15%.",
    });
  }
  if (activePaymentTerms === 0) {
    issues.push({
      domain: "Suppliers",
      severity: "error",
      issueCode: "NO_ACTIVE_PAYMENT_TERMS",
      title: "No active payment terms",
      message: "Suppliers, POs, invoices, and payments need payment-term defaults.",
      recommendedAction: "Create payment terms such as NET30 and map suppliers to them.",
    });
  }
  if (activeUoms === 0) {
    issues.push({
      domain: "Units & Conversions",
      severity: "error",
      issueCode: "NO_ACTIVE_UOM",
      title: "No active units of measure",
      message: "Item catalogue, PO quantities, receipts, invoices, and stock counts require UOMs.",
      recommendedAction: "Create base units such as EA, BOX, KG, and L with conversion classes.",
    });
  }
  if (activeWarehouses === 0) {
    issues.push({
      domain: "Warehouses",
      severity: "error",
      issueCode: "NO_WAREHOUSES",
      title: "No warehouses configured",
      message: "Receiving, storage, stock counts, and transfers require at least one warehouse.",
      recommendedAction: "Create a warehouse and define bins/locations in Master Data.",
    });
  }
  if (activeDepartments > 0 && activeCostCentres === 0) {
    issues.push({
      domain: "Organisation",
      severity: "warning",
      issueCode: "COST_CENTRES_MISSING",
      title: "Cost centres not configured",
      message: "Departments exist, but there are no typed MDM cost centres for requisition ownership and reporting.",
      recommendedAction: "Create cost centres and map them to departments and GL accounts.",
    });
  }
  if (activeGlMappings === 0) {
    issues.push({
      domain: "Finance Mapping",
      severity: "warning",
      issueCode: "GL_MAPPINGS_MISSING",
      title: "GL mappings not configured",
      message: "AP, spend reports, and accounting exports need item/category/supplier GL mappings.",
      recommendedAction: "Create GL mappings for item categories, suppliers, tax, and accrual/payment accounts.",
    });
  }
  if (activeSequences === 0) {
    issues.push({
      domain: "Documents",
      severity: "warning",
      issueCode: "DOCUMENT_SEQUENCES_MISSING",
      title: "Document numbering not configured",
      message: "Requisitions, POs, GRNs, invoice batches, and credit notes need controlled numbering.",
      recommendedAction: "Create document sequences by legal entity/site/year.",
    });
  }
  if (activePolicies === 0) {
    issues.push({
      domain: "Procurement Rules",
      severity: "warning",
      issueCode: "PROCUREMENT_POLICIES_MISSING",
      title: "Procurement policies not configured",
      message: "Quote rules, once-off item permissions, GRN requirements, and match tolerances need policy records.",
      recommendedAction: "Create procurement policies for requisitions, PO send, GRN, and invoice matching.",
    });
  }

  await pool.query("UPDATE mdm_data_quality_issues SET status = 'stale' WHERE organization_id = $1 AND status = 'open'", [
    organizationId,
  ]);
  for (const issue of issues) {
    await pool.query(
      `
        INSERT INTO mdm_data_quality_issues (
          organization_id, domain, severity, issue_code, title, message,
          affected_entity_type, affected_entity_id, recommended_action, status, last_seen_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', NOW())
        ON CONFLICT (organization_id, issue_code, COALESCE(affected_entity_type, ''), COALESCE(affected_entity_id, 0))
        DO UPDATE SET
          domain = EXCLUDED.domain,
          severity = EXCLUDED.severity,
          title = EXCLUDED.title,
          message = EXCLUDED.message,
          recommended_action = EXCLUDED.recommended_action,
          status = 'open',
          last_seen_at = NOW(),
          resolved_at = NULL
      `,
      [
        organizationId,
        issue.domain,
        issue.severity,
        issue.issueCode,
        issue.title,
        issue.message,
        issue.affectedEntityType ?? null,
        issue.affectedEntityId ?? null,
        issue.recommendedAction,
      ],
    );
  }

  const issueCounts = issues.reduce(
    (acc, issue) => {
      acc[issue.severity] += 1;
      return acc;
    },
    { info: 0, warning: 0, error: 0 },
  );
  const totalChecks = 12 + activeSuppliers + activeItems + activeCurrencies;
  const weightedPenalty = issueCounts.error * 14 + issueCounts.warning * 6 + issueCounts.info * 2;
  const score = Math.max(0, Math.min(100, Math.round(100 - weightedPenalty / Math.max(1, totalChecks / 8))));

  return {
    score,
    issueCounts,
    issues,
    metrics: {
      activeSuppliers,
      activeItems,
      activeWarehouses,
      activeCurrencies,
      activeTaxCodes,
      activePaymentTerms,
      activeUoms,
      activeDepartments,
      activeCostCentres,
      activeGlMappings,
      activeDocumentSequences: activeSequences,
      activeProcurementPolicies: activePolicies,
    },
  };
}

export async function getMdmDataQualityIssues(organizationId: number) {
  const result = await pool.query<Record<string, unknown>>(
    `
      SELECT *
      FROM mdm_data_quality_issues
      WHERE organization_id = $1 AND status IN ('open', 'stale')
      ORDER BY
        CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
        domain ASC,
        last_seen_at DESC
      LIMIT 200
    `,
    [organizationId],
  );
  return result.rows.map(rowToCamel);
}

export async function getMdmControlCentreHealth(organizationId: number) {
  const scan = await scanMdmDataQuality(organizationId);
  return {
    title: "Master Data & Control Centre",
    defaultCurrencyCode: "ZAR",
    healthScore: scan.score,
    issueCounts: scan.issueCounts,
    metrics: scan.metrics,
    sections: [
      {
        key: "organisation",
        label: "Organisation",
        records: scan.metrics.activeDepartments + scan.metrics.activeCostCentres,
        status: scan.metrics.activeDepartments > 0 && scan.metrics.activeCostCentres > 0 ? "ready" : "needs_setup",
        connectedTo: ["Requisitions", "Approvals", "Reports"],
      },
      {
        key: "suppliers",
        label: "Suppliers",
        records: scan.metrics.activeSuppliers,
        status: scan.metrics.activeSuppliers > 0 ? "ready" : "needs_setup",
        connectedTo: ["Requisitions", "POs", "AP", "Logistics"],
      },
      {
        key: "items",
        label: "Items & Services",
        records: scan.metrics.activeItems,
        status: scan.metrics.activeItems > 0 ? "ready" : "needs_setup",
        connectedTo: ["Requisitions", "POs", "Receipts", "Counts"],
      },
      {
        key: "currency-tax",
        label: "Currency & Tax",
        records: scan.metrics.activeCurrencies + scan.metrics.activeTaxCodes,
        status: scan.metrics.activeCurrencies > 0 && scan.metrics.activeTaxCodes > 0 ? "ready" : "needs_setup",
        connectedTo: ["Approvals", "POs", "AP", "Reports"],
      },
      {
        key: "warehouses",
        label: "Warehouses",
        records: scan.metrics.activeWarehouses,
        status: scan.metrics.activeWarehouses > 0 ? "ready" : "needs_setup",
        connectedTo: ["Receipts", "Storage", "Transfers", "Cycle counts"],
      },
      {
        key: "finance",
        label: "Finance Mapping",
        records: scan.metrics.activeGlMappings,
        status: scan.metrics.activeGlMappings > 0 ? "ready" : "needs_setup",
        connectedTo: ["AP", "Exports", "Reports"],
      },
    ],
    topIssues: scan.issues.slice(0, 8),
  };
}

export async function getRequisitionContext(organizationId: number) {
  const [currencies, departments, costCentres, taxCodes, uoms, suppliers, items, approvalRules] = await Promise.all([
    pool.query("SELECT * FROM currencies WHERE COALESCE(active, TRUE) = TRUE ORDER BY code ASC"),
    pool.query("SELECT * FROM departments WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE ORDER BY code ASC", [
      organizationId,
    ]),
    pool.query("SELECT * FROM mdm_cost_centres WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE ORDER BY code ASC", [
      organizationId,
    ]),
    pool.query("SELECT * FROM tax_codes WHERE COALESCE(active, TRUE) = TRUE ORDER BY code ASC"),
    pool.query("SELECT * FROM units_of_measure WHERE COALESCE(active, TRUE) = TRUE ORDER BY code ASC"),
    pool.query(
      `
        SELECT id, name, supplier_code, status, default_currency_code, payment_terms_id, tax_code_id, default_department_id, risk_status
        FROM suppliers
        WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'
        ORDER BY name ASC
      `,
      [organizationId],
    ),
    pool.query(
      `
        SELECT id, sku, name, supplier_id, price, unit_of_measure, unit_of_measure_id, commodity_code_id, taxable, status
        FROM inventory_items
        WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'
        ORDER BY sku ASC
        LIMIT 500
      `,
      [organizationId],
    ),
    pool.query(
      "SELECT * FROM mdm_approval_rules WHERE organization_id = $1 AND entity_type = 'requisition' AND COALESCE(active, TRUE) = TRUE ORDER BY min_local_value ASC",
      [organizationId],
    ),
  ]);
  return {
    defaultCurrencyCode: "ZAR",
    currencies: currencies.rows.map(rowToCamel),
    departments: departments.rows.map(rowToCamel),
    costCentres: costCentres.rows.map(rowToCamel),
    taxCodes: taxCodes.rows.map(rowToCamel),
    unitsOfMeasure: uoms.rows.map(rowToCamel),
    suppliers: suppliers.rows.map(rowToCamel),
    items: items.rows.map(rowToCamel),
    approvalRules: approvalRules.rows.map(rowToCamel),
    rules: {
      requiresDepartment: true,
      requiresCostCentre: true,
      requiresTaxCode: true,
      requiresCurrency: true,
      onceOffItemRequiresReason: true,
      approvalValueCurrency: "ZAR",
    },
  };
}

export async function getPurchaseOrderContext(organizationId: number) {
  const [supplierDefaults, sequences, templates, policies] = await Promise.all([
    pool.query(
      `
        SELECT s.id, s.name, s.status, s.default_currency_code, s.payment_terms_id, s.tax_code_id,
          s.incoterm_id, s.default_department_id, s.default_carrier_id, s.risk_status, s.compliance_status,
          pt.code AS payment_terms_code, tc.code AS tax_code
        FROM suppliers s
        LEFT JOIN payment_terms pt ON pt.id = s.payment_terms_id
        LEFT JOIN tax_codes tc ON tc.id = s.tax_code_id
        WHERE s.organization_id = $1
        ORDER BY s.name ASC
      `,
      [organizationId],
    ),
    pool.query("SELECT * FROM mdm_document_sequences WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
    pool.query("SELECT * FROM mdm_document_templates WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
    pool.query("SELECT * FROM mdm_procurement_policies WHERE organization_id = $1 AND COALESCE(active, TRUE) = TRUE", [
      organizationId,
    ]),
  ]);
  return {
    supplierDefaults: supplierDefaults.rows.map(rowToCamel),
    documentSequences: sequences.rows.map(rowToCamel),
    documentTemplates: templates.rows.map(rowToCamel),
    procurementPolicies: policies.rows.map(rowToCamel),
    blockingRules: {
      blockedSuppliers: true,
      inactiveItems: true,
      inactiveCostCentres: true,
      expiredRequiredSupplierDocuments: true,
      invalidCurrencies: true,
      poExchangeRateLock: true,
    },
  };
}

export async function validateMdmTransaction(organizationId: number, body: Record<string, unknown>) {
  const transactionType = String(body.transactionType ?? "");
  const supplierId = Number(body.supplierId ?? NaN);
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(Number).filter(Number.isFinite) : [];
  const currencyCode = String(body.currencyCode ?? "ZAR").toUpperCase();
  const errors: Array<{ code: string; message: string }> = [];
  const warnings: Array<{ code: string; message: string }> = [];

  if (!["requisition", "purchase_order", "receipt", "invoice"].includes(transactionType)) {
    errors.push({ code: "INVALID_TRANSACTION_TYPE", message: "transactionType must be requisition, purchase_order, receipt, or invoice." });
  }

  const currencyRows = await pool.query("SELECT code, active FROM currencies WHERE code = $1 LIMIT 1", [currencyCode]);
  if (!currencyRows.rows[0] || currencyRows.rows[0].active === false) {
    errors.push({ code: "INVALID_CURRENCY", message: `${currencyCode} is not an active Master Data currency.` });
  }

  if (Number.isFinite(supplierId)) {
    const supplierRows = await pool.query<{ name: string; status: string; default_currency_code: string | null }>(
      "SELECT name, status, default_currency_code FROM suppliers WHERE organization_id = $1 AND id = $2",
      [organizationId, supplierId],
    );
    const supplier = supplierRows.rows[0];
    if (!supplier) {
      errors.push({ code: "SUPPLIER_NOT_FOUND", message: "Supplier is not available in this organization." });
    } else {
      if (["blocked", "suspended", "archived"].includes(String(supplier.status).toLowerCase())) {
        errors.push({ code: "SUPPLIER_BLOCKED", message: `${supplier.name} is ${supplier.status} and cannot be used.` });
      }
      if (supplier.default_currency_code && supplier.default_currency_code !== currencyCode) {
        warnings.push({
          code: "SUPPLIER_CURRENCY_DIFFERS",
          message: `${supplier.name} defaults to ${supplier.default_currency_code}; requested transaction currency is ${currencyCode}.`,
        });
      }
    }
  }

  if (itemIds.length > 0) {
    const itemRows = await pool.query<{ id: number; sku: string; status: string | null }>(
      "SELECT id, sku, status FROM inventory_items WHERE (organization_id = $1 OR organization_id IS NULL) AND id = ANY($2::int[])",
      [organizationId, itemIds],
    );
    const found = new Set(itemRows.rows.map((row) => row.id));
    for (const itemId of itemIds) {
      if (!found.has(itemId)) {
        errors.push({ code: "ITEM_NOT_FOUND", message: `Item ${itemId} is not available in this organization.` });
      }
    }
    for (const item of itemRows.rows) {
      if (String(item.status ?? "active").toLowerCase() !== "active") {
        errors.push({ code: "ITEM_INACTIVE", message: `${item.sku} is inactive and cannot be used on new transactions.` });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export async function previewDocumentSequence(organizationId: number, body: Record<string, unknown>) {
  const documentType = String(body.documentType ?? "PO").toUpperCase();
  const rows = await pool.query<{ prefix: string; next_number: number; padding: number; year: number | null }>(
    `
      SELECT prefix, next_number, padding, year
      FROM mdm_document_sequences
      WHERE organization_id = $1
        AND UPPER(document_type) = $2
        AND COALESCE(active, TRUE) = TRUE
      ORDER BY id ASC
      LIMIT 1
    `,
    [organizationId, documentType],
  );
  const row = rows.rows[0] ?? {
    prefix: `${documentType}-${new Date().getFullYear()}-`,
    next_number: 1,
    padding: 6,
    year: new Date().getFullYear(),
  };
  const number = String(row.next_number).padStart(row.padding, "0");
  return {
    documentType,
    preview: `${row.prefix}${number}`,
    nextNumber: row.next_number,
    source: rows.rows[0] ? "mdm_document_sequences" : "fallback",
  };
}

export async function createImportBatch(
  organizationId: number,
  body: Record<string, unknown>,
  createdBy?: number,
) {
  const domain = String(body.domain ?? "");
  const fileName = String(body.fileName ?? body.file_name ?? "manual-import.csv");
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const validationRows = rows.map((row, index) => {
    const value = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const missing = ["code", "name"].filter((key) => !String(value[key] ?? "").trim());
    return {
      row: index + 1,
      valid: missing.length === 0,
      errors: missing.map((key) => `${key} is required`),
    };
  });
  const validRows = validationRows.filter((row) => row.valid).length;
  const result = await pool.query<Record<string, unknown>>(
    `
      INSERT INTO mdm_import_batches (
        organization_id, domain, file_name, status, total_rows, valid_rows, invalid_rows, validation_report, created_by, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `,
    [
      organizationId,
      domain,
      fileName,
      validRows === rows.length ? "validated" : "failed_validation",
      rows.length,
      validRows,
      rows.length - validRows,
      { rows: validationRows },
      createdBy ?? null,
    ],
  );
  return rowToCamel(result.rows[0] ?? {});
}

export async function getImportBatchValidationReport(organizationId: number, id: number) {
  const result = await pool.query<Record<string, unknown>>(
    "SELECT id, domain, file_name, status, total_rows, valid_rows, invalid_rows, validation_report FROM mdm_import_batches WHERE organization_id = $1 AND id = $2",
    [organizationId, id],
  );
  return result.rows[0] ? rowToCamel(result.rows[0]) : null;
}

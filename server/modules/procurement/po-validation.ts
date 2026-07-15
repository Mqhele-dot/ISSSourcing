import { pool } from "../../db";

export type PurchaseOrderValidationLine = {
  itemId?: number | null;
  lineType?: string | null;
  description?: string | null;
  glAccountCode?: string | null;
  unitOfMeasureId?: number | null;
  taxCodeId?: number | null;
};

export type PurchaseOrderValidationInput = {
  organizationId: number;
  currencyCode?: string | null;
  taxCodeId?: number | null;
  items: PurchaseOrderValidationLine[];
};

export type PurchaseOrderValidationResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 409;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };

type ProcurementValidationPolicy = {
  requireUomConversion: boolean;
  requireTaxCode: boolean;
  requireGlMapping: boolean;
  requireFxRate: boolean;
};

function asPolicyBool(config: Record<string, unknown>, key: keyof ProcurementValidationPolicy): boolean {
  return config[key] === true || config[key] === "true";
}

async function loadPurchaseOrderValidationPolicy(organizationId: number): Promise<ProcurementValidationPolicy> {
  const rows = await pool.query<{ config: Record<string, unknown> | null }>(
    `
      SELECT config
      FROM mdm_procurement_policies
      WHERE organization_id = $1
        AND COALESCE(active, TRUE) = TRUE
        AND lower(policy_type) IN ('purchase_order', 'po_validation', 'procurement_control')
      ORDER BY id DESC
      LIMIT 1
    `,
    [organizationId],
  );
  const config = rows.rows[0]?.config ?? {};
  return {
    requireUomConversion: asPolicyBool(config, "requireUomConversion"),
    requireTaxCode: asPolicyBool(config, "requireTaxCode"),
    requireGlMapping: asPolicyBool(config, "requireGlMapping"),
    requireFxRate: asPolicyBool(config, "requireFxRate"),
  };
}

async function hasUomConversion(params: {
  organizationId: number;
  itemId: number;
  fromUomId: number;
  toUomId: number;
}): Promise<boolean> {
  if (params.fromUomId === params.toUomId) return true;
  const rows = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM mdm_uom_conversions
      WHERE organization_id = $1
        AND COALESCE(active, TRUE) = TRUE
        AND (
          (from_uom_id = $2 AND to_uom_id = $3)
          OR (from_uom_id = $3 AND to_uom_id = $2)
        )
        AND (item_id IS NULL OR item_id = $4)
      LIMIT 1
    `,
    [params.organizationId, params.fromUomId, params.toUomId, params.itemId],
  );
  return rows.rows.length > 0;
}

async function hasGlMapping(params: {
  organizationId: number;
  itemId: number;
  commodityCodeId: number | null;
}): Promise<boolean> {
  const sourceIds = [String(params.itemId)];
  const sourceTypes = ["item", "inventory_item"];
  if (params.commodityCodeId != null) {
    sourceIds.push(String(params.commodityCodeId));
    sourceTypes.push("commodity", "commodity_code", "category");
  }
  const rows = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM mdm_gl_mappings
      WHERE organization_id = $1
        AND COALESCE(active, TRUE) = TRUE
        AND lower(mapping_type) IN ('expense', 'inventory', 'accrual', 'purchase')
        AND lower(source_type) = ANY($2::text[])
        AND source_id = ANY($3::text[])
      LIMIT 1
    `,
    [params.organizationId, sourceTypes, sourceIds],
  );
  return rows.rows.length > 0;
}

async function hasActiveFxRate(organizationId: number, currencyCode: string): Promise<boolean> {
  const organization = await pool.query<{ default_currency_code: string }>(
    "SELECT default_currency_code FROM organizations WHERE id = $1 AND active = TRUE LIMIT 1",
    [organizationId],
  );
  const reportingCurrency = String(organization.rows[0]?.default_currency_code ?? "ZAR").toUpperCase();
  if (!currencyCode || currencyCode.toUpperCase() === reportingCurrency) return true;
  const rows = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM mdm_exchange_rates
      WHERE organization_id = $1
        AND upper(from_currency_code) = $2
        AND upper(to_currency_code) = $3
        AND COALESCE(active, TRUE) = TRUE
        AND effective_date <= now()
        AND (expires_at IS NULL OR expires_at >= now())
      ORDER BY effective_date DESC
      LIMIT 1
    `,
    [organizationId, currencyCode.toUpperCase(), reportingCurrency],
  );
  return rows.rows.length > 0;
}

export async function validatePurchaseOrderWorkflowReadiness(
  input: PurchaseOrderValidationInput,
): Promise<PurchaseOrderValidationResult> {
  const catalogLines = input.items.filter((line) => String(line.lineType ?? "CATALOG").toUpperCase() === "CATALOG");
  const manualLines = input.items.filter((line) => String(line.lineType ?? "CATALOG").toUpperCase() !== "CATALOG");
  const itemIds = Array.from(new Set(catalogLines.map((item) => Number(item.itemId)).filter((id) => id > 0)));
  if (input.items.length === 0 || catalogLines.some((line) => !Number(line.itemId))) {
    return { ok: false, status: 400, code: "PO_ITEMS_REQUIRED", message: "Every catalogue line requires a valid item." };
  }
  if (manualLines.some((line) => !String(line.description ?? "").trim())) {
    return { ok: false, status: 400, code: "PO_MANUAL_LINE_DESCRIPTION_REQUIRED", message: "Every manual PO line requires a description." };
  }

  const policy = await loadPurchaseOrderValidationPolicy(input.organizationId);
  const itemRows = await pool.query<{
    id: number;
    sku: string;
    status: string | null;
    unit_of_measure_id: number | null;
    commodity_code_id: number | null;
    taxable: boolean | null;
  }>(
    `
      SELECT id, sku, status, unit_of_measure_id, commodity_code_id, taxable
      FROM inventory_items
      WHERE (organization_id = $1 OR organization_id IS NULL)
        AND id = ANY($2::int[])
    `,
    [input.organizationId, itemIds],
  );
  const itemsById = new Map(itemRows.rows.map((row) => [Number(row.id), row]));

  for (const itemId of itemIds) {
    const item = itemsById.get(itemId);
    if (!item) {
      return { ok: false, status: 400, code: "PO_ITEM_NOT_FOUND", message: `Item ${itemId} is not available.` };
    }
    if (String(item.status ?? "active").toLowerCase() !== "active") {
      return {
        ok: false,
        status: 409,
        code: "PO_ITEM_INACTIVE",
        message: `${item.sku} is inactive and cannot be used on a purchase order.`,
      };
    }
  }

  if (policy.requireFxRate && !(await hasActiveFxRate(input.organizationId, String(input.currencyCode ?? "")))) {
    const organization = await pool.query<{ default_currency_code: string }>("SELECT default_currency_code FROM organizations WHERE id = $1 LIMIT 1", [input.organizationId]);
    const reportingCurrency = String(organization.rows[0]?.default_currency_code ?? "ZAR").toUpperCase();
    return {
      ok: false,
      status: 409,
      code: "PO_FX_RATE_REQUIRED",
      message: `No active ${String(input.currencyCode ?? "").toUpperCase()}/${reportingCurrency} exchange rate exists.`,
    };
  }

  for (const line of input.items) {
    if (String(line.lineType ?? "CATALOG").toUpperCase() !== "CATALOG") {
      if (policy.requireUomConversion && !Number(line.unitOfMeasureId ?? 0)) {
        return { ok: false, status: 409, code: "PO_UOM_REQUIRED", message: "Manual lines require a unit of measure before the PO can be submitted or sent." };
      }
      if (policy.requireTaxCode && !Number(line.taxCodeId ?? input.taxCodeId ?? 0)) {
        return { ok: false, status: 409, code: "PO_TAX_CODE_REQUIRED", message: "Manual lines require a tax code before the PO can be submitted or sent." };
      }
      if (policy.requireGlMapping && !String(line.glAccountCode ?? "").trim()) {
        return { ok: false, status: 409, code: "PO_GL_MAPPING_REQUIRED", message: "Manual lines require a GL account before the PO can be submitted or sent." };
      }
      continue;
    }
    const item = itemsById.get(Number(line.itemId));
    if (!item) continue;
    const lineTaxCodeId = Number(line.taxCodeId ?? input.taxCodeId ?? 0) || null;
    if (policy.requireTaxCode && item.taxable !== false && lineTaxCodeId == null) {
      return {
        ok: false,
        status: 409,
        code: "PO_TAX_CODE_REQUIRED",
        message: `${item.sku} requires a tax code before the PO can be submitted or sent.`,
      };
    }

    if (policy.requireGlMapping && !(await hasGlMapping({
      organizationId: input.organizationId,
      itemId: item.id,
      commodityCodeId: item.commodity_code_id,
    }))) {
      return {
        ok: false,
        status: 409,
        code: "PO_GL_MAPPING_REQUIRED",
        message: `${item.sku} requires an active GL mapping before the PO can be submitted or sent.`,
      };
    }

    const purchaseUomId = Number(line.unitOfMeasureId ?? item.unit_of_measure_id ?? 0) || null;
    const itemUomId = Number(item.unit_of_measure_id ?? 0) || null;
    if (policy.requireUomConversion) {
      if (purchaseUomId == null || itemUomId == null) {
        return {
          ok: false,
          status: 409,
          code: "PO_UOM_REQUIRED",
          message: `${item.sku} requires item and purchase units before the PO can be submitted or sent.`,
        };
      }
      if (!(await hasUomConversion({
        organizationId: input.organizationId,
        itemId: item.id,
        fromUomId: purchaseUomId,
        toUomId: itemUomId,
      }))) {
        return {
          ok: false,
          status: 409,
          code: "PO_UOM_CONVERSION_REQUIRED",
          message: `${item.sku} requires an active UOM conversion for the selected purchase unit.`,
        };
      }
    }
  }

  return { ok: true };
}

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import {
  currencies,
  apReceipts,
  incoterms,
  invoices,
  paymentTerms,
  purchaseOrderItems,
  purchaseOrders,
  supplierContracts,
  suppliers,
  taxCodes,
} from "@shared/schema";

const LOCKED_PO_STATUSES = new Set(["SENT", "ACKNOWLEDGED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]);

export type SupplierDefaultsInput = Record<string, unknown> & {
  supplierId?: unknown;
  departmentId?: unknown;
  contractId?: unknown;
  currencyCode?: unknown;
  paymentTermsId?: unknown;
  incotermId?: unknown;
  taxCodeId?: unknown;
  confirmCurrencyOverride?: unknown;
};

type SupplierTransactionGuardInput = {
  supplierName?: string | null;
  status?: string | null;
  complianceStatus?: string | null;
  blockedReason?: string | null;
};

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizeSupplierState(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function assertSupplierTransactionAllowed(
  supplier: SupplierTransactionGuardInput,
  transactionLabel = "new transactions",
): void {
  const supplierName = supplier.supplierName?.trim() || "This supplier";
  const status = normalizeSupplierState(supplier.status);
  const complianceStatus = normalizeSupplierState(supplier.complianceStatus);
  const blockedReason = supplier.blockedReason?.trim() || "";

  if (status === "inactive") {
    throw Object.assign(
      new Error(`${supplierName} is inactive and cannot be used for ${transactionLabel}.`),
      { code: "SUPPLIER_INACTIVE", status: 409 },
    );
  }

  if (status === "blocked" || complianceStatus === "blocked") {
    const suffix = blockedReason ? ` Reason: ${blockedReason}` : "";
    throw Object.assign(
      new Error(`${supplierName} is blocked and cannot be used for ${transactionLabel}.${suffix}`),
      { code: "SUPPLIER_BLOCKED", status: 409 },
    );
  }
}

async function activeCurrencyCode(value: unknown): Promise<string | null> {
  const code = normalizeCurrency(value);
  if (!code) return null;
  const [row] = await db
    .select({ code: currencies.code })
    .from(currencies)
    .where(and(eq(currencies.code, code), eq(currencies.active, true)))
    .limit(1);
  return row?.code ?? null;
}

async function activePaymentTermsId(id: number | null): Promise<number | null> {
  if (id == null) return null;
  const [row] = await db
    .select({ id: paymentTerms.id })
    .from(paymentTerms)
    .where(and(eq(paymentTerms.id, id), eq(paymentTerms.active, true)))
    .limit(1);
  return row?.id ?? null;
}

async function activeTaxCodeId(id: number | null): Promise<number | null> {
  if (id == null) return null;
  const [row] = await db
    .select({ id: taxCodes.id })
    .from(taxCodes)
    .where(and(eq(taxCodes.id, id), eq(taxCodes.active, true)))
    .limit(1);
  return row?.id ?? null;
}

async function activeIncotermId(id: number | null): Promise<number | null> {
  if (id == null) return null;
  const [row] = await db
    .select({ id: incoterms.id })
    .from(incoterms)
    .where(and(eq(incoterms.id, id), eq(incoterms.active, true)))
    .limit(1);
  return row?.id ?? null;
}

async function resolveSupplierCurrencyAndTerms(orgId: number, supplierId: number, contractId: number | null) {
  const [supplier] = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      status: suppliers.status,
      complianceStatus: suppliers.complianceStatus,
      blockedReason: suppliers.blockedReason,
      defaultDepartmentId: suppliers.defaultDepartmentId,
      defaultContractId: suppliers.defaultContractId,
      paymentTermsId: suppliers.paymentTermsId,
      defaultCurrencyCode: suppliers.defaultCurrencyCode,
      allowCurrencyOverride: suppliers.allowCurrencyOverride,
      requireApprovalForOverride: suppliers.requireApprovalForOverride,
      taxCodeId: suppliers.taxCodeId,
      incotermId: suppliers.incotermId,
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, orgId)))
    .limit(1);

  if (!supplier) {
    throw Object.assign(new Error("Supplier not found in this organization."), { code: "SUPPLIER_NOT_FOUND", status: 400 });
  }

  assertSupplierTransactionAllowed(
    {
      supplierName: supplier.name,
      status: supplier.status,
      complianceStatus: supplier.complianceStatus,
      blockedReason: supplier.blockedReason,
    },
    "new purchase orders",
  );

  const supplierDefaultContractId = numberOrNull(supplier.defaultContractId);
  const effectiveContractId = contractId ?? supplierDefaultContractId;
  const [contract] =
    effectiveContractId != null
      ? await db
          .select({
            id: supplierContracts.id,
            currency: supplierContracts.currency,
            paymentTermsId: supplierContracts.paymentTermsId,
            incotermId: supplierContracts.incotermId,
            defaultTaxCodeId: supplierContracts.defaultTaxCodeId,
          })
          .from(supplierContracts)
          .where(
            and(
              eq(supplierContracts.id, effectiveContractId),
              eq(supplierContracts.organizationId, orgId),
              eq(supplierContracts.supplierId, supplierId),
            ),
          )
          .limit(1)
      : [];

  if (effectiveContractId != null && !contract) {
    const requestedDefault = contractId == null;
    throw Object.assign(
      new Error(
        requestedDefault
          ? `Supplier ${supplier.name} has an invalid default contract. Update supplier master data before creating the PO.`
          : "Contract not found for this supplier and organization.",
      ),
      {
        code: requestedDefault ? "SUPPLIER_DEFAULT_CONTRACT_INVALID" : "SUPPLIER_CONTRACT_NOT_FOUND",
        status: 409,
      },
    );
  }

  return {
    supplierName: supplier.name,
    departmentId: numberOrNull(supplier.defaultDepartmentId),
    supplierCurrencyCode: await activeCurrencyCode(supplier.defaultCurrencyCode),
    contractCurrencyCode: await activeCurrencyCode(contract?.currency),
    allowCurrencyOverride: supplier.allowCurrencyOverride === true,
    requireApprovalForOverride: supplier.requireApprovalForOverride !== false,
    paymentTermsId: await activePaymentTermsId(contract?.paymentTermsId ?? supplier.paymentTermsId ?? null),
    taxCodeId: await activeTaxCodeId(contract?.defaultTaxCodeId ?? supplier.taxCodeId ?? null),
    incotermId: await activeIncotermId(contract?.incotermId ?? supplier.incotermId ?? null),
    contractId: contract?.id ?? null,
  };
}

export async function applySupplierDefaultsToPurchaseOrder<T extends SupplierDefaultsInput>(input: T): Promise<T> {
  const orgId = getActiveOrganizationId();
  const supplierId = numberOrNull(input.supplierId);
  if (supplierId == null) return input;

  const defaults = await resolveSupplierCurrencyAndTerms(orgId, supplierId, numberOrNull(input.contractId));
  const requestedCurrency = normalizeCurrency(input.currencyCode);
  let resolvedCurrency = defaults.contractCurrencyCode ?? defaults.supplierCurrencyCode ?? requestedCurrency;

  if (requestedCurrency && resolvedCurrency && requestedCurrency !== resolvedCurrency) {
    if (defaults.contractCurrencyCode) {
      throw Object.assign(
        new Error(
          `Contract currency is ${defaults.contractCurrencyCode}; override to ${requestedCurrency} is not allowed while that contract is selected.`,
        ),
        { code: "SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED", status: 409 },
      );
    }
    if (!defaults.allowCurrencyOverride) {
      throw Object.assign(
        new Error(`Supplier currency is ${resolvedCurrency}; override to ${requestedCurrency} is not allowed.`),
        { code: "SUPPLIER_CURRENCY_OVERRIDE_BLOCKED", status: 409 },
      );
    }
    if (defaults.requireApprovalForOverride && input.confirmCurrencyOverride !== true) {
      throw Object.assign(
        new Error(`Supplier currency override to ${requestedCurrency} requires confirmation.`),
        { code: "SUPPLIER_CURRENCY_OVERRIDE_CONFIRMATION_REQUIRED", status: 409 },
      );
    }
    resolvedCurrency = requestedCurrency;
  }

  if (resolvedCurrency) input.currencyCode = resolvedCurrency;
  if (input.departmentId == null && defaults.departmentId != null) input.departmentId = defaults.departmentId;
  if (input.paymentTermsId == null && defaults.paymentTermsId != null) input.paymentTermsId = defaults.paymentTermsId;
  if (input.incotermId == null && defaults.incotermId != null) input.incotermId = defaults.incotermId;
  if (input.taxCodeId == null && defaults.taxCodeId != null) input.taxCodeId = defaults.taxCodeId;
  if (input.contractId == null && defaults.contractId != null) input.contractId = defaults.contractId;
  return input;
}

export async function detectSupplierDocumentMismatches(orgId: number, supplierId?: number): Promise<string[]> {
  const supplierRows = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      defaultCurrencyCode: suppliers.defaultCurrencyCode,
      defaultContractId: suppliers.defaultContractId,
      defaultCarrierId: suppliers.defaultCarrierId,
      defaultTransportMode: suppliers.defaultTransportMode,
    })
    .from(suppliers)
    .where(
      supplierId == null
        ? eq(suppliers.organizationId, orgId)
        : and(eq(suppliers.organizationId, orgId), eq(suppliers.id, supplierId)),
    );
  const activeCurrencies = new Set(
    (
      await db
        .select({ code: currencies.code })
        .from(currencies)
      .where(eq(currencies.active, true))
    ).map((row) => normalizeCurrency(row.code))
      .filter((code): code is string => code != null),
  );
  const supplierDefaultContractIds = supplierRows
    .map((row) => numberOrNull(row.defaultContractId))
    .filter((id): id is number => id != null);
  const validDefaultContractIds = new Set(
    supplierDefaultContractIds.length === 0
      ? []
      : (
          await db
            .select({ id: supplierContracts.id })
            .from(supplierContracts)
            .where(and(eq(supplierContracts.organizationId, orgId), inArray(supplierContracts.id, supplierDefaultContractIds)))
        ).map((row) => row.id),
  );

  const rows = await db
    .select({
      purchaseOrderId: purchaseOrders.id,
      supplierName: suppliers.name,
      supplierCurrency: suppliers.defaultCurrencyCode,
      orderNumber: purchaseOrders.orderNumber,
      poCurrency: purchaseOrders.currencyCode,
      poStatus: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .where(
      supplierId == null
        ? and(eq(purchaseOrders.organizationId, orgId), eq(suppliers.organizationId, orgId))
        : and(
            eq(purchaseOrders.organizationId, orgId),
            eq(suppliers.organizationId, orgId),
            eq(suppliers.id, supplierId),
        ),
    );

  const shipmentRows = await db.execute(sql`
    SELECT
      po.supplier_id AS supplier_id,
      s.id AS shipment_id,
      s.po_number AS po_number,
      s.carrier_id AS carrier_id,
      s.transport_mode AS transport_mode,
      COALESCE(s.direction, 'inbound') AS direction
    FROM shipments s
    INNER JOIN purchase_orders po
      ON po.order_number = s.po_number
     AND po.organization_id = ${orgId}
    WHERE po.organization_id = ${orgId}
      ${supplierId == null ? sql`` : sql`AND po.supplier_id = ${supplierId}`}
  `);
  const inboundShipmentsBySupplier = new Map<
    number,
    Array<{
      shipmentId: number;
      poNumber: string;
      carrierId: number | null;
      transportMode: string | null;
    }>
  >();
  for (const raw of shipmentRows.rows) {
    const supplierKey = numberOrNull((raw as { supplier_id?: unknown }).supplier_id);
    const shipmentId = Number((raw as { shipment_id?: unknown }).shipment_id ?? 0);
    const poNumber = String((raw as { po_number?: unknown }).po_number ?? "").trim();
    const direction =
      typeof (raw as { direction?: unknown }).direction === "string"
        ? String((raw as { direction?: unknown }).direction).trim().toLowerCase() || null
        : null;
    if (supplierKey == null || shipmentId <= 0 || !poNumber || (direction ?? "inbound") !== "inbound") {
      continue;
    }
    const existing = inboundShipmentsBySupplier.get(supplierKey) ?? [];
    existing.push({
      shipmentId,
      poNumber,
      carrierId: numberOrNull((raw as { carrier_id?: unknown }).carrier_id),
      transportMode:
        typeof (raw as { transport_mode?: unknown }).transport_mode === "string"
          ? String((raw as { transport_mode?: unknown }).transport_mode).trim() || null
          : null,
    });
    inboundShipmentsBySupplier.set(supplierKey, existing);
  }

  const issues: string[] = [];
  for (const row of supplierRows) {
    const code = normalizeCurrency(row.defaultCurrencyCode);
    const defaultContractId = numberOrNull(row.defaultContractId);
    const defaultCarrierId = numberOrNull(row.defaultCarrierId);
    const defaultTransportMode =
      typeof row.defaultTransportMode === "string" ? row.defaultTransportMode.trim().toLowerCase() : "";
    if (!code) {
      issues.push(`Supplier ${row.name} is missing a default currency in Master Data.`);
      continue;
    }
    if (!activeCurrencies.has(code)) {
      issues.push(`Supplier ${row.name} defaults to inactive or missing currency ${code}.`);
    }
    if (defaultContractId != null && !validDefaultContractIds.has(defaultContractId)) {
      issues.push(`Supplier ${row.name} references missing default contract #${defaultContractId}.`);
    }
    const inboundShipments = inboundShipmentsBySupplier.get(row.id) ?? [];

    if (defaultCarrierId != null) {
      for (const shipment of inboundShipments) {
        if (shipment.carrierId == null) {
          issues.push(
            `Inbound shipment ${shipment.shipmentId} for PO ${shipment.poNumber} is missing carrierId, but supplier ${row.name} defaults to carrier #${defaultCarrierId}.`,
          );
          continue;
        }
        if (shipment.carrierId !== defaultCarrierId) {
          issues.push(
            `Inbound shipment ${shipment.shipmentId} for PO ${shipment.poNumber} uses carrier #${shipment.carrierId}, but supplier ${row.name} defaults to carrier #${defaultCarrierId}.`,
          );
        }
      }
    }

    if (defaultTransportMode) {
      for (const shipment of inboundShipments) {
        if (!shipment.transportMode) {
          issues.push(
            `Inbound shipment ${shipment.shipmentId} for PO ${shipment.poNumber} is missing transport mode, but supplier ${row.name} defaults to ${defaultTransportMode}.`,
          );
          continue;
        }
        if (shipment.transportMode.trim().toLowerCase() !== defaultTransportMode) {
          issues.push(
            `Inbound shipment ${shipment.shipmentId} for PO ${shipment.poNumber} uses transport mode ${shipment.transportMode}, but supplier ${row.name} defaults to ${defaultTransportMode}.`,
          );
        }
      }
    }
  }

  for (const row of rows) {
    const supplierCurrency = normalizeCurrency(row.supplierCurrency);
    const poCurrency = normalizeCurrency(row.poCurrency);
    if (supplierCurrency && poCurrency && supplierCurrency !== poCurrency) {
      const locked = LOCKED_PO_STATUSES.has(String(row.poStatus ?? "").toUpperCase());
      issues.push(
        `${locked ? "Locked" : "Draft/open"} PO ${row.orderNumber} uses ${poCurrency}, but supplier ${row.supplierName} defaults to ${supplierCurrency}.`,
      );
    }
  }

  const invoiceRows = await db
    .select({
      invoiceNumber: invoices.invoiceNumber,
      invoiceCurrency: invoices.currencyCode,
      orderNumber: purchaseOrders.orderNumber,
      poCurrency: purchaseOrders.currencyCode,
      supplierId: purchaseOrders.supplierId,
    })
    .from(invoices)
    .innerJoin(purchaseOrders, eq(invoices.purchaseOrderId, purchaseOrders.id))
    .where(
      supplierId == null
        ? and(eq(invoices.organizationId, orgId), eq(purchaseOrders.organizationId, orgId))
        : and(
            eq(invoices.organizationId, orgId),
            eq(purchaseOrders.organizationId, orgId),
            eq(purchaseOrders.supplierId, supplierId),
          ),
    );
  for (const row of invoiceRows) {
    const invoiceCurrency = normalizeCurrency(row.invoiceCurrency);
    const poCurrency = normalizeCurrency(row.poCurrency);
    if (invoiceCurrency && poCurrency && invoiceCurrency !== poCurrency) {
      issues.push(
        `Invoice ${row.invoiceNumber} uses ${invoiceCurrency}, but linked PO ${row.orderNumber} uses ${poCurrency}.`,
      );
    }
  }

  const poIds = rows.map((row) => row.purchaseOrderId);
  if (poIds.length > 0) {
    const allPoItems = await db
      .select()
      .from(purchaseOrderItems)
      .where(inArray(purchaseOrderItems.orderId, poIds));
    const receivedPoIds = new Set(
      allPoItems
        .filter((line) => poIds.includes(line.orderId) && Number(line.receivedQuantity ?? 0) > 0)
        .map((line) => line.orderId),
    );
    const receivedStatusPoIds = new Set(
      rows
        .filter((row) =>
          ["PARTIALLY_RECEIVED", "RECEIVED", "COMPLETED", "CLOSED"].includes(String(row.poStatus ?? "").toUpperCase()),
        )
        .map((row) => row.purchaseOrderId),
    );
    const postedReceipts = await db
      .select({ purchaseOrderId: apReceipts.purchaseOrderId })
      .from(apReceipts)
      .where(and(eq(apReceipts.organizationId, orgId), eq(apReceipts.status, "POSTED")));
    const receiptPoIds = new Set(postedReceipts.map((row) => row.purchaseOrderId));
    for (const row of rows) {
      const hasReceiveSignal = receivedPoIds.has(row.purchaseOrderId) || receivedStatusPoIds.has(row.purchaseOrderId);
      if (hasReceiveSignal && !receiptPoIds.has(row.purchaseOrderId)) {
        issues.push(`PO ${row.orderNumber} has received stock but no posted AP receipt record.`);
      }
    }
  }
  return issues;
}

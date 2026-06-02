import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import {
  currencies,
  departments,
  incoterms,
  paymentTerms,
  purchaseOrders,
  supplierContracts,
  suppliers,
  taxCodes,
  type InsertPurchaseOrder,
  type PurchaseOrder,
} from "@shared/schema";

const LOCKED_PO_STATUSES = new Set(["SENT", "ACKNOWLEDGED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]);

export type SupplierDefaultsInput = Record<string, unknown> & {
  supplierId?: unknown;
  contractId?: unknown;
  currencyCode?: unknown;
  paymentTermsId?: unknown;
  incotermId?: unknown;
  taxCodeId?: unknown;
  departmentId?: unknown;
  confirmCurrencyOverride?: unknown;
};

export type SupplierCommercialDefaults = {
  supplierId: number;
  supplierName: string;
  supplierStatus: string;
  supplierCurrencyCode: string | null;
  paymentTermsId: number | null;
  taxCodeId: number | null;
  incotermId: number | null;
  defaultDepartmentId: number | null;
  defaultContractId: number | null;
  preferredCarrierId: number | null;
  defaultTransportMode: string | null;
  allowCurrencyOverride: boolean;
  requireApprovalForOverride: boolean;
  blockedReason: string | null;
  contractCurrencyCode: string | null;
  contractPaymentTermsId: number | null;
  contractTaxCodeId: number | null;
  contractIncotermId: number | null;
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
  const [row] = await db.select({ id: paymentTerms.id }).from(paymentTerms).where(eq(paymentTerms.id, id)).limit(1);
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

async function validIncotermId(id: number | null): Promise<number | null> {
  if (id == null) return null;
  const [row] = await db.select({ id: incoterms.id }).from(incoterms).where(eq(incoterms.id, id)).limit(1);
  return row?.id ?? null;
}

async function validDepartmentId(orgId: number, id: number | null): Promise<number | null> {
  if (id == null) return null;
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, id), eq(departments.organizationId, orgId)))
    .limit(1);
  return row?.id ?? null;
}

export async function resolveSupplierCommercialDefaults(
  orgId: number,
  supplierId: number,
  contractId?: number | null,
): Promise<SupplierCommercialDefaults> {
  const [supplier] = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      status: suppliers.status,
      paymentTermsId: suppliers.paymentTermsId,
      defaultCurrencyCode: suppliers.defaultCurrencyCode,
      taxCodeId: suppliers.taxCodeId,
      incotermId: suppliers.incotermId,
      defaultDepartmentId: suppliers.defaultDepartmentId,
      defaultContractId: suppliers.defaultContractId,
      defaultCarrierId: suppliers.defaultCarrierId,
      defaultTransportMode: suppliers.defaultTransportMode,
      allowCurrencyOverride: suppliers.allowCurrencyOverride,
      requireApprovalForOverride: suppliers.requireApprovalForOverride,
      blockedReason: suppliers.blockedReason,
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, orgId)))
    .limit(1);

  if (!supplier) {
    throw Object.assign(new Error("Supplier not found in this organization."), { code: "SUPPLIER_NOT_FOUND", status: 400 });
  }
  if (String(supplier.status ?? "active").toLowerCase() === "blocked") {
    throw Object.assign(new Error(supplier.blockedReason || "Supplier is blocked for new transactions."), {
      code: "SUPPLIER_BLOCKED",
      status: 409,
    });
  }

  const preferredContractId = contractId ?? supplier.defaultContractId ?? null;
  const [contract] =
    preferredContractId != null
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
              eq(supplierContracts.id, preferredContractId),
              eq(supplierContracts.organizationId, orgId),
              eq(supplierContracts.supplierId, supplierId),
            ),
          )
          .limit(1)
      : [];

  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierStatus: supplier.status ?? "active",
    supplierCurrencyCode: await activeCurrencyCode(supplier.defaultCurrencyCode),
    paymentTermsId: await activePaymentTermsId(contract?.paymentTermsId ?? supplier.paymentTermsId ?? null),
    taxCodeId: await activeTaxCodeId(contract?.defaultTaxCodeId ?? supplier.taxCodeId ?? null),
    incotermId: await validIncotermId(contract?.incotermId ?? supplier.incotermId ?? null),
    defaultDepartmentId: await validDepartmentId(orgId, supplier.defaultDepartmentId ?? null),
    defaultContractId: contract?.id ?? supplier.defaultContractId ?? null,
    preferredCarrierId: supplier.defaultCarrierId ?? null,
    defaultTransportMode: supplier.defaultTransportMode ?? null,
    allowCurrencyOverride: Boolean(supplier.allowCurrencyOverride),
    requireApprovalForOverride: Boolean(supplier.requireApprovalForOverride),
    blockedReason: supplier.blockedReason ?? null,
    contractCurrencyCode: await activeCurrencyCode(contract?.currency),
    contractPaymentTermsId: contract?.paymentTermsId ?? null,
    contractTaxCodeId: contract?.defaultTaxCodeId ?? null,
    contractIncotermId: contract?.incotermId ?? null,
  };
}

export async function validateSupplierCurrencyOverride(input: {
  requestedCurrencyCode: string | null;
  resolvedCurrencyCode: string | null;
  allowCurrencyOverride: boolean;
  requireApprovalForOverride: boolean;
  confirmed?: boolean;
}): Promise<void> {
  if (!input.requestedCurrencyCode || !input.resolvedCurrencyCode) return;
  if (input.requestedCurrencyCode === input.resolvedCurrencyCode) return;
  if (!input.allowCurrencyOverride) {
    throw Object.assign(
      new Error(`Supplier currency is ${input.resolvedCurrencyCode}; override to ${input.requestedCurrencyCode} is not allowed.`),
      { code: "SUPPLIER_CURRENCY_OVERRIDE_BLOCKED", status: 409 },
    );
  }
  if (input.requireApprovalForOverride && !input.confirmed) {
    throw Object.assign(
      new Error(`Confirm the supplier currency override from ${input.resolvedCurrencyCode} to ${input.requestedCurrencyCode}.`),
      { code: "SUPPLIER_CURRENCY_OVERRIDE_CONFIRMATION_REQUIRED", status: 409 },
    );
  }
}

export async function applySupplierDefaultsToPurchaseOrder<T extends SupplierDefaultsInput>(input: T): Promise<T> {
  const orgId = getActiveOrganizationId();
  const supplierId = numberOrNull(input.supplierId);
  if (supplierId == null) return input;

  const defaults = await resolveSupplierCommercialDefaults(orgId, supplierId, numberOrNull(input.contractId));
  const requestedCurrency = normalizeCurrency(input.currencyCode);
  const resolvedCurrency = defaults.contractCurrencyCode ?? defaults.supplierCurrencyCode ?? requestedCurrency;

  await validateSupplierCurrencyOverride({
    requestedCurrencyCode: requestedCurrency,
    resolvedCurrencyCode: resolvedCurrency,
    allowCurrencyOverride: defaults.allowCurrencyOverride,
    requireApprovalForOverride: defaults.requireApprovalForOverride,
    confirmed: input.confirmCurrencyOverride === true,
  });

  if (resolvedCurrency) input.currencyCode = resolvedCurrency;
  if (input.paymentTermsId == null && defaults.paymentTermsId != null) input.paymentTermsId = defaults.paymentTermsId;
  if (input.incotermId == null && defaults.incotermId != null) input.incotermId = defaults.incotermId;
  if (input.taxCodeId == null && defaults.taxCodeId != null) input.taxCodeId = defaults.taxCodeId;
  if (input.departmentId == null && defaults.defaultDepartmentId != null) input.departmentId = defaults.defaultDepartmentId;
  if (input.contractId == null && defaults.defaultContractId != null) input.contractId = defaults.defaultContractId;
  return input;
}

export async function detectSupplierDocumentMismatches(orgId: number, supplierId?: number): Promise<string[]> {
  const rows = await db
    .select({
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

  const issues: string[] = [];
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
  return issues;
}

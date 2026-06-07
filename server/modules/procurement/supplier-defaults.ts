import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";
import {
  currencies,
  incoterms,
  paymentTerms,
  purchaseOrders,
  supplierContracts,
  suppliers,
  taxCodes,
} from "@shared/schema";

const LOCKED_PO_STATUSES = new Set(["SENT", "ACKNOWLEDGED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"]);

export type SupplierDefaultsInput = Record<string, unknown> & {
  supplierId?: unknown;
  contractId?: unknown;
  currencyCode?: unknown;
  paymentTermsId?: unknown;
  incotermId?: unknown;
  taxCodeId?: unknown;
  confirmCurrencyOverride?: unknown;
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

async function resolveSupplierCurrencyAndTerms(orgId: number, supplierId: number, contractId: number | null) {
  const [supplier] = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      paymentTermsId: suppliers.paymentTermsId,
      defaultCurrencyCode: suppliers.defaultCurrencyCode,
    })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, orgId)))
    .limit(1);

  if (!supplier) {
    throw Object.assign(new Error("Supplier not found in this organization."), { code: "SUPPLIER_NOT_FOUND", status: 400 });
  }

  const [contract] =
    contractId != null
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
              eq(supplierContracts.id, contractId),
              eq(supplierContracts.organizationId, orgId),
              eq(supplierContracts.supplierId, supplierId),
            ),
          )
          .limit(1)
      : [];

  return {
    supplierName: supplier.name,
    supplierCurrencyCode: await activeCurrencyCode(supplier.defaultCurrencyCode),
    contractCurrencyCode: await activeCurrencyCode(contract?.currency),
    paymentTermsId: await activePaymentTermsId(contract?.paymentTermsId ?? supplier.paymentTermsId ?? null),
    taxCodeId: await activeTaxCodeId(contract?.defaultTaxCodeId ?? null),
    incotermId: await validIncotermId(contract?.incotermId ?? null),
    contractId: contract?.id ?? contractId,
  };
}

export async function applySupplierDefaultsToPurchaseOrder<T extends SupplierDefaultsInput>(input: T): Promise<T> {
  const orgId = getActiveOrganizationId();
  const supplierId = numberOrNull(input.supplierId);
  if (supplierId == null) return input;

  const defaults = await resolveSupplierCurrencyAndTerms(orgId, supplierId, numberOrNull(input.contractId));
  const requestedCurrency = normalizeCurrency(input.currencyCode);
  const resolvedCurrency = defaults.contractCurrencyCode ?? defaults.supplierCurrencyCode ?? requestedCurrency;

  if (requestedCurrency && resolvedCurrency && requestedCurrency !== resolvedCurrency) {
    throw Object.assign(
      new Error(`Supplier currency is ${resolvedCurrency}; override to ${requestedCurrency} is not allowed.`),
      { code: "SUPPLIER_CURRENCY_OVERRIDE_BLOCKED", status: 409 },
    );
  }

  if (resolvedCurrency) input.currencyCode = resolvedCurrency;
  if (input.paymentTermsId == null && defaults.paymentTermsId != null) input.paymentTermsId = defaults.paymentTermsId;
  if (input.incotermId == null && defaults.incotermId != null) input.incotermId = defaults.incotermId;
  if (input.taxCodeId == null && defaults.taxCodeId != null) input.taxCodeId = defaults.taxCodeId;
  if (input.contractId == null && defaults.contractId != null) input.contractId = defaults.contractId;
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

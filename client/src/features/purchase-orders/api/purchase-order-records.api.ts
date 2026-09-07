import { procurementPoRecordUrl } from "@/api/procurement-purchase-order-paths";
import { invTrackFetch } from "@/lib/queryClient";
import type { PoHttpOptions } from "./http-options";

export type PurchaseOrderRecordSummary = {
  id: number;
  departmentId?: number | null;
  contractId?: number | null;
  paymentTermsId?: number | null;
  incotermId?: number | null;
  currencyCode?: string | null;
  taxCodeId?: number | null;
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function pickNullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickNullableStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function normalizeRecordSummary(raw: unknown): PurchaseOrderRecordSummary | null {
  const d = asRecord(raw);
  const idRaw = d.id;
  if (idRaw === null || idRaw === undefined || idRaw === "") return null;
  const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    departmentId: pickNullableNum(d.departmentId ?? d.department_id),
    contractId: pickNullableNum(d.contractId ?? d.contract_id),
    paymentTermsId: pickNullableNum(d.paymentTermsId ?? d.payment_terms_id),
    incotermId: pickNullableNum(d.incotermId ?? d.incoterm_id),
    currencyCode: pickNullableStr(d.currencyCode ?? d.currency_code),
    taxCodeId: pickNullableNum(d.taxCodeId ?? d.tax_code_id),
  };
}

export async function fetchPurchaseOrderRecordById(
  id: number,
  options?: PoHttpOptions,
): Promise<PurchaseOrderRecordSummary | null> {
  if (!Number.isFinite(id) || id <= 0) return null;

  try {
    const { data: raw } = await invTrackFetch<unknown>(
      "GET",
      procurementPoRecordUrl(id),
      undefined,
      options,
    );
    const normalized = normalizeRecordSummary(raw);
    if (normalized) return normalized;
    /** Some deployments wrap the row in `{ data: { ... } }` after unwrap; handle loose shapes */
    const outer = asRecord(raw);
    const inner = outer.data;
    return normalizeRecordSummary(inner);
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (status === 404 || status === 401) return null;
    throw e;
  }
}

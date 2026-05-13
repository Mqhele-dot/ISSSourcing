import { procurementPoRecordUrl } from "@/api/procurement-purchase-order-paths";
import { invTrackFetch } from "@/lib/queryClient";
import type { PoHttpOptions } from "./http-options";

export type PurchaseOrderRecordSummary = {
  id: number;
  departmentId?: number | null;
  contractId?: number | null;
  paymentTermsId?: number | null;
  incotermId?: number | null;
};

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizeRecordSummary(raw: unknown): PurchaseOrderRecordSummary | null {
  const d = asRecord(raw);
  const idRaw = d.id;
  const id = typeof idRaw === "number" ? idRaw : Number(idRaw);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    departmentId: (d.departmentId ?? d.department_id ?? null) as number | null | undefined,
    contractId: (d.contractId ?? d.contract_id ?? null) as number | null | undefined,
    paymentTermsId: (d.paymentTermsId ?? d.payment_terms_id ?? null) as number | null | undefined,
    incotermId: (d.incotermId ?? d.incoterm_id ?? null) as number | null | undefined,
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

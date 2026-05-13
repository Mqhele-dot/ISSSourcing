import { procurementPoRecordUrl } from "@/api/procurement-purchase-order-paths";
import type { PoHttpOptions } from "./http-options";

export type PurchaseOrderRecordSummary = {
  id: number;
  departmentId?: number | null;
  contractId?: number | null;
  paymentTermsId?: number | null;
  incotermId?: number | null;
};

export async function fetchPurchaseOrderRecordById(
  id: number,
  options?: PoHttpOptions,
): Promise<PurchaseOrderRecordSummary | null> {
  const response = await fetch(procurementPoRecordUrl(id), {
    method: "GET",
    credentials: "include",
    signal: options?.signal,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (response.status === 404 || response.status === 401) {
    return null;
  }

  if (payload && typeof payload === "object" && "ok" in payload && (payload as { ok: boolean }).ok === false) {
    const err = (payload as { error?: { code?: string; message?: string } }).error;
    const code = typeof err?.code === "string" ? err.code : "";
    const message = typeof err?.message === "string" ? err.message : "Request failed";
    throw new Error(code ? `[${code}] ${message}` : message);
  }

  if (!response.ok) {
    const msg =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message ?? "")
        : "";
    throw new Error(
      msg
        ? `GET ${procurementPoRecordUrl(id)} failed (${response.status}): ${msg}`
        : `GET ${procurementPoRecordUrl(id)} failed: ${response.status}`,
    );
  }

  if (payload && typeof payload === "object" && "ok" in payload && (payload as { ok?: boolean }).ok === true) {
    const data = (payload as { data?: unknown }).data;
    if (data && typeof data === "object" && "id" in data) {
      return data as PurchaseOrderRecordSummary;
    }
  }

  if (payload && typeof payload === "object" && "id" in payload && typeof (payload as { id?: unknown }).id === "number") {
    return payload as PurchaseOrderRecordSummary;
  }

  return null;
}

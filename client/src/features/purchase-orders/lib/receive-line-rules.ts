/**
 * Shared rules for PO receive line quantities (client UX + server validation alignment).
 */
const MAX_BATCH_LEN = 256;
const MAX_SERIAL_TOKENS = 200;
const MAX_SERIAL_TOKEN_LEN = 128;

export function normalizeReceiveQtyInput(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** True when the value is a non-negative integer suitable to send as qtyReceivedNow. */
export function isValidReceiveQty(qty: number): boolean {
  return Number.isInteger(qty) && qty >= 0;
}

export function clampReceiveQtyToRemaining(qty: number, remaining: number): number {
  const r = Math.max(0, Math.floor(Number(remaining)));
  if (!Number.isFinite(qty) || qty < 0) return 0;
  return Math.min(Math.floor(qty), r);
}

export function normalizeBatchInput(raw: string | undefined): string {
  return String(raw ?? "").trim().slice(0, MAX_BATCH_LEN);
}

export function normalizeSerialTokensCsv(raw: string | undefined): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((t) => t.trim().slice(0, MAX_SERIAL_TOKEN_LEN))
    .filter(Boolean)
    .slice(0, MAX_SERIAL_TOKENS);
}

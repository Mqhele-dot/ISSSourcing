/**
 * Shared rules for PO receive line quantities (client UX + server validation alignment).
 */
import type { PurchaseOrderDetail } from "@/api/types";

const MAX_BATCH_LEN = 256;
const MAX_SERIAL_TOKENS = 200;
const MAX_SERIAL_TOKEN_LEN = 128;

export type ReceiveLineValidationInput = {
  sku: string;
  qtyReceivedNow: number;
  batchNumber?: string;
  serialNumbers?: string[];
};

export type ReceiveLineFieldError = {
  sku: string;
  field: "sku" | "qtyReceivedNow" | "batchNumber" | "serialNumbers" | "_line";
  message: string;
};

export type ValidateReceiveLinesResult =
  | { ok: true; lines: ReceiveLineValidationInput[] }
  | { ok: false; errors: ReceiveLineFieldError[] };

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

/**
 * Client-side GRN validation (UX; server remains authoritative).
 * Call before `receivePurchaseOrder`.
 */
export function validateReceiveLines(
  detail: PurchaseOrderDetail,
  lines: ReceiveLineValidationInput[],
): ValidateReceiveLinesResult {
  const errors: ReceiveLineFieldError[] = [];
  const lineBySku = new Map(detail.lines.map((l) => [l.sku, l]));
  const skuSeen = new Set<string>();

  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      ok: false,
      errors: [{ sku: "", field: "_line", message: "No receive lines to submit." }],
    };
  }

  const out: ReceiveLineValidationInput[] = [];

  for (const input of lines) {
    const sku = String(input.sku ?? "").trim();
    if (!sku) {
      errors.push({ sku: "", field: "sku", message: "Each receive line must include a SKU." });
      continue;
    }
    if (skuSeen.has(sku)) {
      errors.push({ sku, field: "sku", message: "Duplicate SKU in receive payload." });
      continue;
    }
    skuSeen.add(sku);

    const master = lineBySku.get(sku);
    if (!master) {
      errors.push({ sku, field: "sku", message: "SKU is not on this purchase order." });
      continue;
    }

    const qty = Number(input.qtyReceivedNow);
    if (!Number.isFinite(qty)) {
      errors.push({ sku, field: "qtyReceivedNow", message: "Quantity must be a finite number." });
      continue;
    }
    if (!Number.isInteger(qty) || qty < 0) {
      errors.push({
        sku,
        field: "qtyReceivedNow",
        message: "Quantity must be a non-negative whole number.",
      });
      continue;
    }

    const remaining = Math.max(0, Math.floor(Number(master.expectedRemaining ?? 0)));
    if (qty > remaining) {
      errors.push({
        sku,
        field: "qtyReceivedNow",
        message: `Quantity cannot exceed remaining quantity (${remaining} remaining).`,
      });
      continue;
    }

    const batchSrc = input.batchNumber ?? "";
    if (batchSrc.trim().length > MAX_BATCH_LEN) {
      errors.push({
        sku,
        field: "batchNumber",
        message: `Batch number must be at most ${MAX_BATCH_LEN} characters.`,
      });
    }
    const batchNumberNorm = normalizeBatchInput(batchSrc);
    const batchNumber = batchNumberNorm || undefined;

    let serialNumbers: string[] | undefined;
    const serialSrc = input.serialNumbers;
    if (Array.isArray(serialSrc) && serialSrc.length > 0) {
      const rawTokens = serialSrc.map((s) => String(s).trim()).filter((t) => t.length > 0);
      if (rawTokens.length > MAX_SERIAL_TOKENS) {
        errors.push({
          sku,
          field: "serialNumbers",
          message: `At most ${MAX_SERIAL_TOKENS} serial numbers per line.`,
        });
      }

      const tooLongToken = rawTokens.some((t) => t.length > MAX_SERIAL_TOKEN_LEN);
      if (tooLongToken) {
        errors.push({
          sku,
          field: "serialNumbers",
          message: `Each serial must be at most ${MAX_SERIAL_TOKEN_LEN} characters.`,
        });
      }

      const normalized = rawTokens.map((t) => t.slice(0, MAX_SERIAL_TOKEN_LEN));

      const seen = new Set<string>();
      for (const t of normalized) {
        if (seen.has(t)) {
          errors.push({
            sku,
            field: "serialNumbers",
            message: "Serial numbers must be unique within the line.",
          });
          break;
        }
        seen.add(t);
      }

      serialNumbers = normalized.length ? normalized : undefined;
    }

    const serialRequired = master.serialTrackingRequired === true;
    if (serialRequired && qty > 0) {
      const n = serialNumbers?.length ?? 0;
      if (n !== qty) {
        errors.push({
          sku,
          field: "serialNumbers",
          message: `Serial tracking requires exactly ${qty} serial number(s) for this line.`,
        });
      }
    }

    out.push({
      sku,
      qtyReceivedNow: qty,
      ...(batchNumber ? { batchNumber } : {}),
      ...(serialNumbers?.length ? { serialNumbers } : {}),
    });
  }

  const positive = out.filter((l) => l.qtyReceivedNow > 0);
  if (errors.length === 0 && positive.length === 0) {
    return {
      ok: false,
      errors: [{ sku: "", field: "_line", message: "Enter at least one receive quantity greater than 0." }],
    };
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, lines: positive };
}

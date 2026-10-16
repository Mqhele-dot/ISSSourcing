/**
 * Parse server error body from an export/download response (JSON or plain text).
 */
export async function parseExportFailureMessage(res: Response): Promise<string> {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  try {
    const text = await res.clone().text();
    if (ct.includes("application/json") && text) {
      try {
        const j = JSON.parse(text) as { message?: string; error?: { message?: string; code?: string } };
        if (typeof j?.error?.message === "string") return j.error.message;
        if (typeof j?.message === "string") return j.message;
      } catch {
        /* fall through */
      }
    }
    if (text && text.length < 800) return text.trim() || `Request failed (${res.status})`;
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

export function isLikelyCsvResponse(res: Response): boolean {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  return ct.includes("text/csv") || ct.includes("application/csv") || ct.includes("text/plain");
}

export type ExportSniffKind = "pdf" | "zipOffice" | "maybeJson" | "text" | "unknown";

/**
 * Peek the first bytes of a download to validate real file type when Content-Type is wrong or stripped by a proxy.
 */
export async function sniffBlobExportKind(blob: Blob): Promise<ExportSniffKind> {
  const slice = await blob.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(slice);
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  ) {
    return "zipOffice";
  }
  const dec = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const t = dec.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return "maybeJson";
  if (t.length > 0 && /^[\x09\x0a\x0d\x20-\x7e]/.test(t)) return "text";
  return "unknown";
}

export async function messageIfBlobLooksLikeJsonError(blob: Blob): Promise<string | null> {
  const sniff = await sniffBlobExportKind(blob);
  if (sniff !== "maybeJson") return null;
  const text = await blob.text();
  const trimmed = text.trim();
  try {
    const j = JSON.parse(trimmed) as { message?: string; error?: { message?: string } };
    if (typeof j?.error?.message === "string") return j.error.message;
    if (typeof j?.message === "string") return j.message;
  } catch {
    /* ignore */
  }
  return trimmed.slice(0, 400) || "Server returned JSON instead of a file.";
}

/**
 * When Content-Type is wrong, accept the blob if magic bytes match the expected export format.
 * CSV is treated leniently (many valid CSVs are plain text).
 */
export function invoiceExportMagicMatchesFormat(
  format: "pdf" | "csv" | "excel" | "docx",
  sniff: ExportSniffKind,
): boolean {
  if (format === "pdf") return sniff === "pdf";
  if (format === "excel" || format === "docx") return sniff === "zipOffice";
  if (format === "csv") return sniff === "text" || sniff === "unknown";
  return false;
}

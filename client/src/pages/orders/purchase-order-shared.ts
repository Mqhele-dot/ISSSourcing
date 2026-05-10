import type { PurchaseOrderDetail } from "@/api/client";

export function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

export function formatDateTime(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export function canApprove(status: string) {
  const s = String(status || "").toLowerCase();
  return s === "open";
}

export function canSend(status: string) {
  const s = String(status || "").toLowerCase();
  return s === "approved";
}

export function canReceive(status: string) {
  const s = String(status || "").toLowerCase();
  return (
    s === "approved" ||
    s === "sent" ||
    s === "partially_received" ||
    s === "partial_received" ||
    s === "partially received"
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPurchaseOrderPrintHtml(detail: PurchaseOrderDetail, formatMoney: (amount: number) => string) {
  return `
    <html>
      <head>
        <title>PO ${escapeHtml(detail.poNumber)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
          h1 { margin-bottom: 4px; }
          .meta { color: #555; margin-bottom: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background: #f5f5f5; }
          .right { text-align: right; }
        </style>
      </head>
      <body>
        <h1>Purchase Order ${escapeHtml(detail.poNumber)}</h1>
        <div class="meta">
          Supplier: ${escapeHtml(detail.supplierName || `Supplier #${detail.supplierId}`)}<br/>
          Status: ${escapeHtml(detail.status)}<br/>
          Requested: ${escapeHtml(formatDate(detail.requestedDate))}
        </div>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th class="right">Ordered</th>
              <th class="right">Received</th>
              <th class="right">Unit Price</th>
            </tr>
          </thead>
          <tbody>
            ${detail.lines
              .map(
                (line) => `
                  <tr>
                    <td>${escapeHtml(line.sku)}</td>
                    <td>${escapeHtml(line.itemName)}</td>
                    <td class="right">${escapeHtml(line.qtyOrdered)}</td>
                    <td class="right">${escapeHtml(line.qtyReceived)}</td>
                    <td class="right">${escapeHtml(formatMoney(Number(line.unitPrice ?? 0)))}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

export function openPurchaseOrderPrintView(detail: PurchaseOrderDetail, formatMoney: (amount: number) => string) {
  const html = buildPurchaseOrderPrintHtml(detail, formatMoney);
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1000,height=760");
  if (!printWindow) {
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export async function fetchPurchaseOrderRecordById(id: number): Promise<{
  id: number;
  departmentId?: number | null;
  contractId?: number | null;
  paymentTermsId?: number | null;
  incotermId?: number | null;
} | null> {
  const response = await fetch(`/api/purchase-orders/${id}`, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404 || response.status === 401) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message ?? `Request failed with ${response.status}`)
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  if (payload && typeof payload === "object" && "ok" in payload) {
    const envelope = payload as { ok: boolean; data?: unknown; error?: { message?: string } };
    if (!envelope.ok) {
      throw new Error(envelope.error?.message ?? "Failed to fetch purchase order details");
    }
    return (envelope.data as {
      id: number;
      departmentId?: number | null;
      contractId?: number | null;
      paymentTermsId?: number | null;
      incotermId?: number | null;
    }) ?? null;
  }

  return payload as {
    id: number;
    departmentId?: number | null;
    contractId?: number | null;
    paymentTermsId?: number | null;
    incotermId?: number | null;
  };
}

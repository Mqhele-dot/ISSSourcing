import type { PurchaseOrderDetail } from "@/api/client";
import { procurementPoRecordUrl } from "@/api/procurement-purchase-order-paths";
import {
  canApprovePurchaseOrder,
  canReceivePurchaseOrder,
  canSendPurchaseOrder,
  canUpdatePurchaseOrder,
} from "@shared/purchase-order-status";

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
  return canApprovePurchaseOrder(status);
}

export function canSend(status: string) {
  return canSendPurchaseOrder(status);
}

export function canReceive(status: string) {
  return canReceivePurchaseOrder(status);
}

export { canUpdatePurchaseOrder } from "@shared/purchase-order-status";

export function canApproveWithRole(status: string, role: string | undefined) {
  return canApprovePurchaseOrder(status, { role });
}

export function canSendWithRole(status: string, role: string | undefined) {
  return canSendPurchaseOrder(status, { role });
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
  const response = await fetch(procurementPoRecordUrl(id), {
    method: "GET",
    credentials: "include",
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
      msg ? `GET ${procurementPoRecordUrl(id)} failed (${response.status}): ${msg}` : `GET ${procurementPoRecordUrl(id)} failed: ${response.status}`,
    );
  }

  if (payload && typeof payload === "object" && "ok" in payload && (payload as { ok?: boolean }).ok === true) {
    const data = (payload as { data?: unknown }).data;
    if (data && typeof data === "object" && "id" in data) {
      return data as {
        id: number;
        departmentId?: number | null;
        contractId?: number | null;
        paymentTermsId?: number | null;
        incotermId?: number | null;
      };
    }
  }

  if (payload && typeof payload === "object" && "id" in payload && typeof (payload as { id?: unknown }).id === "number") {
    return payload as {
      id: number;
      departmentId?: number | null;
      contractId?: number | null;
      paymentTermsId?: number | null;
      incotermId?: number | null;
    };
  }

  return null;
}

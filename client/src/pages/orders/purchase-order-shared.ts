import type { PurchaseOrderDetail } from "@/api/types";
import {
  canApprovePurchaseOrder,
  canReceivePurchaseOrder,
  canSendPurchaseOrder,
  canUpdatePurchaseOrder,
} from "@shared/purchase-order-status";

const PO_WORKFLOW_ROLES = new Set(["manager", "planner", "admin"]);

export function poWorkflowRoleAllowed(role: string | undefined): boolean {
  return PO_WORKFLOW_ROLES.has(String(role ?? "").trim().toLowerCase());
}

/** Visible copy when Approve is disabled (user already has workflow role from Can). */
export function approveActionDisabledReason(input: {
  poNumber: string | null | undefined;
  status: string;
  role: string | undefined;
  mutationPending: boolean;
}): string | null {
  if (input.mutationPending) return "Update in progress.";
  if (!String(input.poNumber ?? "").trim()) return "PO number missing.";
  if (!poWorkflowRoleAllowed(input.role)) return "Requires Manager, Planner, or Admin role.";
  if (!canApprovePurchaseOrder(input.status, { role: input.role })) {
    return "Approve is only available when the PO is draft or open.";
  }
  return null;
}

/** Visible copy when Send is disabled (user already has workflow role from Can). */
export function sendActionDisabledReason(input: {
  poNumber: string | null | undefined;
  status: string;
  role: string | undefined;
  mutationPending: boolean;
}): string | null {
  if (input.mutationPending) return "Update in progress.";
  if (!String(input.poNumber ?? "").trim()) return "PO number missing.";
  if (!poWorkflowRoleAllowed(input.role)) return "Requires Manager, Planner, or Admin role.";
  if (!canSendPurchaseOrder(input.status, { role: input.role })) {
    return "Send is only available when the PO is approved.";
  }
  return null;
}

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

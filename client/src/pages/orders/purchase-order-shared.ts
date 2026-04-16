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
  return status === "open";
}

export function canSend(status: string) {
  return status === "approved";
}

export function canReceive(status: string) {
  return status === "approved" || status === "sent";
}

export function openPurchaseOrderPrintView(detail: PurchaseOrderDetail) {
  const html = `
    <html>
      <head>
        <title>PO ${detail.poNumber}</title>
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
        <h1>Purchase Order ${detail.poNumber}</h1>
        <div class="meta">
          Supplier: ${detail.supplierName || `Supplier #${detail.supplierId}`}<br/>
          Status: ${detail.status}<br/>
          Requested: ${formatDate(detail.requestedDate)}
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
                    <td>${line.sku}</td>
                    <td>${line.itemName}</td>
                    <td class="right">${line.qtyOrdered}</td>
                    <td class="right">${line.qtyReceived}</td>
                    <td class="right">$${line.unitPrice.toFixed(2)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;

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

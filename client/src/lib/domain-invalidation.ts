import type { QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";

const inv = (qc: QueryClient, key: readonly unknown[]) => qc.invalidateQueries({ queryKey: key });

export async function invalidateMasterDataDomain(queryClient: QueryClient, type: string) {
  const t = String(type);
  await Promise.all([
    inv(queryClient, qk.masterData.all),
    inv(queryClient, ["/api", t]),
    inv(queryClient, qk.suppliers.all),
    inv(queryClient, qk.contracts.all),
    inv(queryClient, qk.purchaseOrders.all),
    inv(queryClient, qk.invoices.all),
    inv(queryClient, qk.analytics.all),
    inv(queryClient, qk.reports.all),
    inv(queryClient, qk.controlTower.all),
    inv(queryClient, ["/api/suppliers"]),
    inv(queryClient, ["/api/contracts"]),
    inv(queryClient, ["/api/procurement/purchase-orders/records"]),
  ]);
}

export async function invalidateSupplierDomain(queryClient: QueryClient) {
  await Promise.all([
    inv(queryClient, qk.suppliers.all), inv(queryClient, qk.contracts.all), inv(queryClient, qk.requisitions.all),
    inv(queryClient, qk.purchaseOrders.all), inv(queryClient, qk.invoices.all), inv(queryClient, qk.ap.all),
    inv(queryClient, qk.analytics.all), inv(queryClient, qk.reports.all), inv(queryClient, qk.controlTower.all), inv(queryClient, qk.notifications.all),
    inv(queryClient, ["/api/suppliers"]), inv(queryClient, ["/api/contracts"]), inv(queryClient, ["/api/purchase-requisitions"]),
  ]);
}

export async function invalidateContractDomain(queryClient: QueryClient) {
  await Promise.all([inv(queryClient, qk.contracts.all), inv(queryClient, qk.suppliers.all), inv(queryClient, qk.purchaseOrders.all), inv(queryClient, qk.requisitions.all), inv(queryClient, qk.invoices.all), inv(queryClient, qk.analytics.all), inv(queryClient, qk.reports.all), inv(queryClient, qk.controlTower.all), inv(queryClient, ["/api/contracts"])]);
}

export async function invalidatePurchaseOrderDomain(queryClient: QueryClient) {
  await Promise.all([inv(queryClient, qk.purchaseOrders.all), inv(queryClient, qk.requisitions.all), inv(queryClient, qk.inventory.all), inv(queryClient, qk.logistics.all), inv(queryClient, qk.invoices.all), inv(queryClient, qk.ap.all), inv(queryClient, qk.analytics.all), inv(queryClient, qk.reports.all), inv(queryClient, qk.controlTower.all), inv(queryClient, qk.notifications.all), inv(queryClient, ["/api/procurement/purchase-orders/records"])]);
}

export async function invalidateRequisitionDomain(queryClient: QueryClient) {
  await Promise.all([inv(queryClient, qk.requisitions.all), inv(queryClient, qk.purchaseOrders.all), inv(queryClient, qk.analytics.all), inv(queryClient, qk.reports.all), inv(queryClient, qk.controlTower.all), inv(queryClient, qk.notifications.all), inv(queryClient, ["/api/purchase-requisitions"])]);
}

export async function invalidateInvoiceDomain(queryClient: QueryClient) {
  await Promise.all([inv(queryClient, qk.invoices.all), inv(queryClient, qk.ap.all), inv(queryClient, qk.purchaseOrders.all), inv(queryClient, qk.suppliers.all), inv(queryClient, qk.analytics.all), inv(queryClient, qk.reports.all), inv(queryClient, qk.controlTower.all), inv(queryClient, qk.notifications.all), inv(queryClient, ["/api/invoices"])]);
}

export async function invalidateLogisticsDomain(queryClient: QueryClient) {
  await Promise.all([inv(queryClient, qk.logistics.all), inv(queryClient, qk.purchaseOrders.all), inv(queryClient, qk.analytics.all), inv(queryClient, qk.reports.all), inv(queryClient, qk.controlTower.all), inv(queryClient, qk.notifications.all), inv(queryClient, ["/api/logistics/shipments"])]);
}

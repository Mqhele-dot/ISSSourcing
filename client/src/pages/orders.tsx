import { useLocation, useRoute } from "wouter";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { PurchaseOrdersList } from "@/pages/orders/purchase-orders-list";
import { PurchaseOrderDetailView } from "@/pages/orders/purchase-order-detail-view";
import { ProcurementLegacyTabShell } from "@/pages/orders/procurement-legacy-tab-shell";

type OrdersPageProps = {
  /**
   * When true, rendered inside PurchasePage tabs: only list or PO detail, no inner tab shell.
   */
  embedded?: boolean;
};

/**
 * Routing roles: PO detail (any legacy or canonical PO path), embedded PO list (under `PurchasePage`),
 * legacy tabbed shells (`/purchase`, `/orders`), or standalone list on `/procurement/orders` (no PO id).
 */
export default function OrdersPage({ embedded = false }: OrdersPageProps) {
  const [ordersDetailMatch, ordersDetailParams] = useRoute<{ po: string }>("/orders/:po");
  const [purchaseDetailMatch, purchaseDetailParams] = useRoute<{ po: string }>("/purchase/:po");
  const [procurementDetailMatch, procurementDetailParams] = useRoute<{ po: string }>(
    `${APP_ROUTES.procurement.orders}/:po`,
  );
  const [location] = useLocation();
  const isPurchaseRoute = location.startsWith("/purchase");
  const isProcurementOrdersPath =
    location === APP_ROUTES.procurement.orders || location.startsWith(`${APP_ROUTES.procurement.orders}/`);

  const po = ordersDetailMatch
    ? ordersDetailParams?.po
    : purchaseDetailMatch
      ? purchaseDetailParams?.po
      : procurementDetailMatch
        ? procurementDetailParams?.po
        : undefined;

  const isRequisitionsPath = po === "requisitions";

  if (po && !isRequisitionsPath) {
    return <PurchaseOrderDetailView po={po} />;
  }

  if (embedded) {
    return <PurchaseOrdersList embedded />;
  }

  if (isPurchaseRoute) {
    return <ProcurementLegacyTabShell variant="purchase" />;
  }

  if (isProcurementOrdersPath) {
    return <PurchaseOrdersList embedded />;
  }

  return <ProcurementLegacyTabShell variant="legacyOrders" />;
}

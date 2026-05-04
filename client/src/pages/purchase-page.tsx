import { Link, useLocation, useRoute } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShoppingCart, FileText } from "lucide-react";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import OrdersPage from "@/pages/orders";
import RequisitionsPage from "@/pages/requisitions";
import { ModuleTrainingPanel } from "@/components/training/module-training-panel";

/**
 * Canonical procurement **index / tab shell** only (`/procurement/orders` | `/procurement/requisitions`).
 * PO rows drill into `OrdersPage` (list + detail). Requisition list is `RequisitionsPage` (embedded);
 * new/edit forms are `RequisitionFormPage` on `/procurement/requisitions/new` and `/procurement/requisitions/:id`.
 * Legacy `/purchase` and `/orders` tab shells stay in `OrdersPage` (`ProcurementLegacyTabShell`).
 */
export default function PurchasePage() {
  const [canonicalReqMatch] = useRoute(APP_ROUTES.procurement.requisitions);
  const [reqMatch] = useRoute("/purchase/requisitions");
  const [ordersReqMatch] = useRoute("/orders/requisitions");
  const [path, setLocation] = useLocation();
  const basePath = path.startsWith("/procurement") ? APP_ROUTES.procurement.orders : path.startsWith("/orders") ? "/orders" : "/purchase";
  const requisitionsPath =
    path.startsWith("/procurement") ? APP_ROUTES.procurement.requisitions : `${basePath}/requisitions`;

  const showRequisitionsTab = !!(canonicalReqMatch || reqMatch || ordersReqMatch);

  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4" data-testid="purchase-orders-page">
      <Tabs
        value={showRequisitionsTab ? "requisitions" : "orders"}
        onValueChange={(v) => {
          if (v === "requisitions") setLocation(requisitionsPath);
          else setLocation(basePath);
        }}
      >
        <TabsList className="mb-4 orders-tabs" aria-label="Purchase Orders and Requisitions" data-tour="purchase-tabs">
          <TabsTrigger value="orders" asChild>
            <Link href={basePath}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Purchase Orders
            </Link>
          </TabsTrigger>
          <TabsTrigger value="requisitions" asChild>
            <Link href={requisitionsPath}>
              <FileText className="mr-2 h-4 w-4" />
              Requisitions
            </Link>
          </TabsTrigger>
        </TabsList>
        <ModuleTrainingPanel moduleId={showRequisitionsTab ? "requisitions" : "purchase-orders"} />
        <TabsContent value="orders" className="mt-0">
          <OrdersPage embedded />
        </TabsContent>
        <TabsContent value="requisitions" className="mt-0">
          <RequisitionsPage embedded basePath={requisitionsPath} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

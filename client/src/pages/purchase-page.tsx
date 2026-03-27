import { Link, useLocation, useRoute } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShoppingCart, FileText } from "lucide-react";
import OrdersPage from "@/pages/orders";
import RequisitionsPage from "@/pages/requisitions";

/**
 * Tabbed Purchase page: Purchase Orders | Requisitions
 * - /purchase, /orders → Orders tab
 * - /purchase/requisitions, /orders/requisitions → Requisitions tab (create/edit/approve/share)
 */
export default function PurchasePage() {
  const [reqMatch] = useRoute("/purchase/requisitions");
  const [ordersReqMatch] = useRoute("/orders/requisitions");
  const [path, setLocation] = useLocation();
  const isOrdersBase = path.startsWith("/orders");
  const basePath = isOrdersBase ? "/orders" : "/purchase";
  const requisitionsPath = `${basePath}/requisitions`;

  const showRequisitionsTab = !!(reqMatch || ordersReqMatch);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
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
        <TabsContent value="orders" className="mt-0">
          <OrdersPage />
        </TabsContent>
        <TabsContent value="requisitions" className="mt-0">
          <RequisitionsPage embedded basePath={requisitionsPath} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

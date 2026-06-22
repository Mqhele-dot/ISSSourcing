import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShoppingCart, FileText } from "lucide-react";
import RequisitionsPage from "@/pages/requisitions";
import { PurchaseOrdersList } from "./purchase-orders-list";

/**
 * Legacy tab shell for `/purchase` and `/orders` only. Canonical procurement UX is `PurchasePage`
 * (`/procurement/orders` | `/procurement/requisitions`); this component preserves old URLs without
 * duplicating tab markup.
 */
export function ProcurementLegacyTabShell({ variant }: { variant: "purchase" | "legacyOrders" }) {
  const isPurchase = variant === "purchase";
  return (
    <div className="mx-auto w-full max-w-[min(100%,88rem)] space-y-4">
      <PageHeader
        title={isPurchase ? "Purchase" : "Purchase Orders"}
        subtitle="Manage purchase orders and requisitions"
        breadcrumb={
          <span>{isPurchase ? "Operations / Purchase" : "Operations / Purchase Orders"}</span>
        }
      />
      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="mb-4 grid h-auto w-full grid-cols-1 sm:grid-cols-2">
          <TabsTrigger value="orders" className="gap-2">
            <ShoppingCart className="h-4 w-4" />
            Purchase Orders
          </TabsTrigger>
          <TabsTrigger value="requisitions" className="gap-2">
            <FileText className="h-4 w-4" />
            Requisitions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="orders">
          <PurchaseOrdersList embedded />
        </TabsContent>
        <TabsContent value="requisitions">
          <RequisitionsPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}

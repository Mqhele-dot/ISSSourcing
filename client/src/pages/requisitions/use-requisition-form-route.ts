import { useRoute, useLocation } from "wouter";
import { APP_ROUTES } from "@/lib/routes/app-routes";

/** Parse requisition form route (canonical + legacy prefixes). */
export function useRequisitionFormRoute(): { id: number | null; isNew: boolean; listPath: string } {
  const [path] = useLocation();
  const [, paramsProc] = useRoute<{ id: string }>(`${APP_ROUTES.procurement.requisitions}/:id`);
  const [, paramsReq] = useRoute<{ id: string }>("/requisitions/:id");
  const [, paramsPurchase] = useRoute<{ id: string }>("/purchase/requisitions/:id");
  const [, paramsOrders] = useRoute<{ id: string }>("/orders/requisitions/:id");
  const params = paramsProc ?? paramsReq ?? paramsPurchase ?? paramsOrders;
  const idParam = params?.id;
  const id = idParam && idParam !== "new" ? parseInt(idParam, 10) : null;
  const isNew = !idParam || idParam === "new";
  const listPath = path.startsWith("/procurement")
    ? APP_ROUTES.procurement.requisitions
    : path.startsWith("/orders")
      ? "/orders/requisitions"
      : path.startsWith("/purchase")
        ? "/purchase/requisitions"
        : "/requisitions";
  return { id: id != null && !isNaN(id) ? id : null, isNew, listPath };
}

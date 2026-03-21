import { useRoute, useLocation } from "wouter";

/** Parse requisition form route: /requisitions/:id, /purchase/requisitions/:id, or /orders/requisitions/:id */
export function useRequisitionFormRoute(): { id: number | null; isNew: boolean; listPath: string } {
  const [path] = useLocation();
  const [, paramsReq] = useRoute<{ id: string }>("/requisitions/:id");
  const [, paramsPurchase] = useRoute<{ id: string }>("/purchase/requisitions/:id");
  const [, paramsOrders] = useRoute<{ id: string }>("/orders/requisitions/:id");
  const params = paramsReq ?? paramsPurchase ?? paramsOrders;
  const idParam = params?.id;
  const id = idParam && idParam !== "new" ? parseInt(idParam, 10) : null;
  const isNew = !idParam || idParam === "new";
  const listPath = path.startsWith("/orders")
    ? "/orders/requisitions"
    : path.startsWith("/purchase")
      ? "/purchase/requisitions"
      : "/requisitions";
  return { id: id != null && !isNaN(id) ? id : null, isNew, listPath };
}

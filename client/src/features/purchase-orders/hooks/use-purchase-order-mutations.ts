import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  approvePurchaseOrder,
  receivePurchaseOrder,
  sendPurchaseOrder,
  transitionPurchaseOrderStatus,
  type PurchaseReceiveResult,
} from "../api/purchase-orders.api";
import type { PurchaseOrderDetail } from "@/api/types";
import {
  assertNonEmptyReceiveLines,
  assertPoNumberForMutation,
  assertTransitionTargetStatus,
} from "../lib/po-mutation-guards";
import { normalizeOperationalPoParam } from "../lib/query-keys";
import { invalidatePurchaseOrderOperationalQueries } from "../lib/invalidate-purchase-order-queries";

export function useApprovePurchaseOrderMutation(po: string) {
  const queryClient = useQueryClient();
  const poNumber = normalizeOperationalPoParam(po);
  return useMutation({
    mutationKey: ["purchase-order-approve", poNumber],
    mutationFn: async () => {
      assertPoNumberForMutation(poNumber);
      return approvePurchaseOrder(poNumber);
    },
    onSuccess: async () => {
      await invalidatePurchaseOrderOperationalQueries(queryClient, poNumber);
    },
  });
}

export function useSendPurchaseOrderMutation(po: string) {
  const queryClient = useQueryClient();
  const poNumber = normalizeOperationalPoParam(po);
  return useMutation({
    mutationKey: ["purchase-order-send", poNumber],
    mutationFn: async () => {
      assertPoNumberForMutation(poNumber);
      return sendPurchaseOrder(poNumber);
    },
    onSuccess: async () => {
      await invalidatePurchaseOrderOperationalQueries(queryClient, poNumber);
    },
  });
}

export function useTransitionPurchaseOrderStatusMutation(po: string) {
  const queryClient = useQueryClient();
  const poNumber = normalizeOperationalPoParam(po);
  return useMutation({
    mutationKey: ["purchase-order-transition", poNumber],
    mutationFn: async (toStatus: string) => {
      assertPoNumberForMutation(poNumber);
      assertTransitionTargetStatus(toStatus);
      return transitionPurchaseOrderStatus(poNumber, toStatus);
    },
    onSuccess: async () => {
      await invalidatePurchaseOrderOperationalQueries(queryClient, poNumber);
    },
  });
}

export function useReceivePurchaseOrderMutation(po: string) {
  const queryClient = useQueryClient();
  const poNumber = normalizeOperationalPoParam(po);
  return useMutation({
    mutationKey: ["purchase-order-receive", poNumber],
    mutationFn: async (args: {
      lines: Array<{
        sku: string;
        qtyReceivedNow: number;
        batchNumber?: string;
        serialNumbers?: string[];
      }>;
      receiveOptions?: {
        receiverUserId?: number;
        receiverName?: string;
        warehouseLocation?: string;
        receivedAt?: string;
      };
    }) => {
      assertPoNumberForMutation(poNumber);
      assertNonEmptyReceiveLines(args.lines);
      return receivePurchaseOrder(poNumber, args.lines, args.receiveOptions);
    },
    onSuccess: async () => {
      await invalidatePurchaseOrderOperationalQueries(queryClient, poNumber);
    },
  });
}

export type PurchaseOrderMutationDetail = PurchaseOrderDetail;
export type PurchaseOrderReceiveResult = PurchaseReceiveResult;

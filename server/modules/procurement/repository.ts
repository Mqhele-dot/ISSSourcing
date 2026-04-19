import type { IStorage } from "../../storage";

/**
 * Thin facade over `IStorage` procurement methods — keeps module boundaries explicit for tests/mocks.
 */
export function createProcurementRepository(storage: IStorage) {
  return {
    getAllPurchaseRequisitions: () => storage.getAllPurchaseRequisitions(),
    getRequisitionWithDetails: (id: number) => storage.getRequisitionWithDetails(id),
    getPurchaseRequisition: (id: number) => storage.getPurchaseRequisition(id),
    createPurchaseRequisition: storage.createPurchaseRequisition.bind(storage),
    updatePurchaseRequisition: storage.updatePurchaseRequisition.bind(storage),
    deletePurchaseRequisition: storage.deletePurchaseRequisition.bind(storage),
    approvePurchaseRequisition: storage.approvePurchaseRequisition.bind(storage),
    rejectPurchaseRequisition: storage.rejectPurchaseRequisition.bind(storage),
    createPurchaseOrderFromRequisition: storage.createPurchaseOrderFromRequisition.bind(storage),
    getPurchaseRequisitionItems: storage.getPurchaseRequisitionItems.bind(storage),
    addPurchaseRequisitionItem: storage.addPurchaseRequisitionItem.bind(storage),
    updatePurchaseRequisitionItem: storage.updatePurchaseRequisitionItem.bind(storage),
    deletePurchaseRequisitionItem: storage.deletePurchaseRequisitionItem.bind(storage),
    getAllPurchaseOrders: () => storage.getAllPurchaseOrders(),
    getPurchaseOrderWithDetails: (id: number) => storage.getPurchaseOrderWithDetails(id),
    createPurchaseOrder: storage.createPurchaseOrder.bind(storage),
    updatePurchaseOrder: storage.updatePurchaseOrder.bind(storage),
    deletePurchaseOrder: storage.deletePurchaseOrder.bind(storage),
    updatePurchaseOrderStatus: storage.updatePurchaseOrderStatus.bind(storage),
    updatePurchaseOrderPaymentStatus: storage.updatePurchaseOrderPaymentStatus.bind(storage),
    sendPurchaseOrderEmail: storage.sendPurchaseOrderEmail.bind(storage),
    getPurchaseOrderItems: storage.getPurchaseOrderItems.bind(storage),
    addPurchaseOrderItem: storage.addPurchaseOrderItem.bind(storage),
    updatePurchaseOrderItem: storage.updatePurchaseOrderItem.bind(storage),
    deletePurchaseOrderItem: storage.deletePurchaseOrderItem.bind(storage),
    recordPurchaseOrderItemReceived: storage.recordPurchaseOrderItemReceived.bind(storage),
    getSupplier: storage.getSupplier.bind(storage),
    getUser: storage.getUser.bind(storage),
  };
}

export type ProcurementRepository = ReturnType<typeof createProcurementRepository>;

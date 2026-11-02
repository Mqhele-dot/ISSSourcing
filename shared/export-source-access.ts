import {financialMeasureKeys,financialMeasureResource,type FinancialMeasure} from "./financial-measures";

const sources:Record<string,readonly string[]>={
  inventory:["inventory"],suppliers:["suppliers"],purchase_orders:["purchases"],purchase_requisitions:["purchases"],
  reorder_requests:["inventory","reorder_requests"],invoices:["finance","invoices"],shipments:["purchases"],
  po_delivery_comparison:["purchases"],activity_logs:["activity_logs"],warehouses:["warehouses"],
  categories:["categories"],stock_movements:["stock_movements"],users:["users"],
};
/** Unknown datasets and financial measures fail closed, including prototype keys. */
export function exportSourceResources(dataset:string,filters:Record<string,unknown>={}):readonly string[]|null{
  if(dataset==="financial_measure"){
    const measure=filters.measure;
    return typeof measure==="string"&&(financialMeasureKeys as readonly string[]).includes(measure)?[financialMeasureResource(measure as FinancialMeasure)]:null;
  }
  return Object.hasOwn(sources,dataset)?sources[dataset]:null;
}

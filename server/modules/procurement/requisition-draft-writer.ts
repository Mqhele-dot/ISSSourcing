import { purchaseRequisitions, purchaseRequisitionItems, type InsertPurchaseRequisition, type InsertPurchaseRequisitionItem } from "@shared/schema";
import type { db } from "../../db";

/** Shared persistence for new expert and guided requisitions. Never copies workflow data. */
export async function writeRequisitionDraft(
  database: Pick<typeof db, "insert">,
  organizationId: number,
  header: InsertPurchaseRequisition,
  lines: Omit<InsertPurchaseRequisitionItem,"requisitionId">[],
) {
  const priced=lines.map(line=>({...line,totalPrice:Number(line.unitPrice)*Number(line.quantity)}));
  if(!priced.length || priced.some(line=>!Number.isFinite(line.totalPrice) || line.totalPrice<=0))
    throw new Error("The requisition needs positive priced lines.");
  const [draft]=await database.insert(purchaseRequisitions).values({
    ...header,organizationId,status:"DRAFT",approverId:null,approvalDate:null,rejectionReason:null,
    totalAmount:priced.reduce((total,line)=>total+line.totalPrice,0),updatedAt:new Date(),
  }).returning();
  for(let i=0;i<priced.length;i+=500)
    await database.insert(purchaseRequisitionItems).values(priced.slice(i,i+500).map(line=>({...line,requisitionId:draft.id})));
  return draft;
}

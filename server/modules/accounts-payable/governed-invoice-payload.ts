import {pool} from "../../db";
import {governanceEnabled,GovernanceError} from "../rbac/governance-context";

type Invoice={status?:unknown;paidAmount?:unknown;dueAmount?:unknown};
const money=["total","totalAmount","subtotal","tax","totalTax","discount","paidAmount","dueAmount"];
const material=[...money,"currencyCode","supplierId","purchaseOrderId","items","issueDate","dueDate","paymentTermsId"];
export async function guardInvoicePayload(org:number,data:Record<string,unknown>,existing?:Invoice){
 if(!await governanceEnabled(org,"payment_risk"))return false;
 if(["organizationId","organization_id","createdBy","created_by","approvedBy","approved_by","approvedAt","approved_at","governanceRevision","governance_revision"].some(k=>Object.hasOwn(data,k)))
  throw new GovernanceError("INVOICE_GOVERNED_FIELDS","Invoice ownership, maker and approval evidence are recorded by the server. Remove these fields; no changes were applied.",400);
 const status=String(existing?.status??"DRAFT").toUpperCase();
 if(Object.hasOwn(data,"status")&&String(data.status).toUpperCase()!==status)
  throw new GovernanceError("INVOICE_GOVERNED_TRANSITION_REQUIRED","Use invoice submission, independent approval, cancellation or the Finance correction workflow to change lifecycle state.");
 for(const k of money){if(Object.hasOwn(data,k)&&(data[k]===null||!["number","string"].includes(typeof data[k])||String(data[k]).trim()===""||!Number.isFinite(Number(data[k]))))
  throw new GovernanceError("INVOICE_AMOUNT_INVALID","Enter finite invoice amounts. Payment balances are calculated by the server.",400);}
 if(existing&&status!=="DRAFT"&&material.some(k=>Object.hasOwn(data,k)))
  throw new GovernanceError("INVOICE_GOVERNED_CORRECTION_REQUIRED","This invoice is under review or posted. Use Finance's existing withdrawal, amendment or balance-correction workflow before changing financial evidence.");
 if(Object.hasOwn(data,"paidAmount")&&Number(data.paidAmount)!==Number(existing?.paidAmount??0))
  throw new GovernanceError("INVOICE_PAYMENT_COMMAND_REQUIRED","Recorded payments and reversals must use the governed payment workflow. A form cannot change the paid balance.");
 return true;
}
export async function requireDraftInvoice(org:number,invoiceId:number){
 if(!await governanceEnabled(org,"payment_risk"))return;
 const invoice=(await pool.query("SELECT status::text FROM invoices WHERE organization_id=$1 AND id=$2",[org,invoiceId])).rows[0];
 if(!invoice)throw new GovernanceError("INVOICE_NOT_FOUND","Invoice unavailable in this organization.",404);
 if(invoice.status!=="DRAFT")throw new GovernanceError("INVOICE_GOVERNED_CORRECTION_REQUIRED","Only draft lines can be edited or removed. Use the existing governed invoice correction workflow for reviewed or posted evidence.");
}
export async function requireDraftInvoiceLine(org:number,itemId:number,targetInvoice?:number){
 if(!await governanceEnabled(org,"payment_risk"))return;
 const line=(await pool.query("SELECT x.invoice_id FROM invoice_items x JOIN invoices i ON i.id=x.invoice_id WHERE i.organization_id=$1 AND x.id=$2",[org,itemId])).rows[0];
 if(!line)throw new GovernanceError("INVOICE_LINE_NOT_FOUND","Invoice line unavailable in this organization.",404);
 if(targetInvoice!==undefined&&targetInvoice!==line.invoice_id)throw new GovernanceError("INVOICE_LINE_IDENTITY_IMMUTABLE","An invoice line cannot be moved to another invoice. Add a new draft line instead.");
 await requireDraftInvoice(org,line.invoice_id);
}

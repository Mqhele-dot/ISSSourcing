import type {PoolClient} from "pg";
import type {FinancialContribution} from "@shared/financial-measures";
import type {SpendDimensions,spendMeasures} from "@shared/spend-cube";

/** One set-based enrichment on the caller's observation. Never allocates a
 * document total over its lines or joins mutable dimensions during saved reads. */
export async function captureSpendDimensions(c:PoolClient,org:number,measure:typeof spendMeasures[number],sources:FinancialContribution[]){
 let parent:string;
 if(measure==="ordered")parent="SELECT x.k,p.supplier_id,p.department_id,p.contract_id,p.project_id,false parent_unavailable,to_char(p.order_date,'YYYY-MM') source_month FROM x JOIN purchase_orders p ON p.id=x.id AND p.organization_id=$1";
 else if(measure==="open_commitment")parent="SELECT x.k,p.supplier_id,p.department_id,p.contract_id,p.project_id,false parent_unavailable,to_char(p.order_date,'YYYY-MM') source_month FROM x JOIN purchase_order_items l ON l.id=x.id JOIN purchase_orders p ON p.id=l.order_id AND p.organization_id=$1";
 else if(measure==="invoiced"||measure==="recorded_payments")parent=`SELECT x.k,i.supplier_id,p.department_id,p.contract_id,p.project_id,
  i.purchase_order_id IS NOT NULL AND p.id IS NULL parent_unavailable,to_char(${measure==="recorded_payments"?"pay.payment_date":"i.issue_date"},'YYYY-MM') source_month
  FROM x ${measure==="recorded_payments"?"JOIN payments pay ON pay.id=x.id JOIN invoices i ON i.id=pay.invoice_id":"JOIN invoices i ON i.id=x.id"}
  LEFT JOIN purchase_orders p ON p.id=i.purchase_order_id AND p.organization_id=$1 AND p.supplier_id=i.supplier_id WHERE i.organization_id=$1`;
 else parent=`SELECT x.k,r.supplier_id,p.department_id,p.contract_id,p.project_id,r.purchase_order_id IS NOT NULL AND p.id IS NULL parent_unavailable,
  CASE WHEN x.kind='receipt_reversal' THEN to_char(g.created_at,'YYYY-MM') ELSE to_char(r.received_date,'YYYY-MM') END source_month
  FROM x JOIN ap_receipt_items l ON l.id=x.id JOIN ap_receipts r ON r.id=l.receipt_id AND r.organization_id=$1
  LEFT JOIN purchase_orders p ON p.id=r.purchase_order_id AND p.organization_id=$1 AND p.supplier_id=r.supplier_id
  LEFT JOIN goods_receipt_reversals g ON x.kind='receipt_reversal' AND g.id=x.reversal AND g.receipt_id=r.id AND g.organization_id=$1`;
 const rows=await c.query(`WITH x AS (SELECT value->>'k' k,value->>'kind' kind,(value->>'id')::bigint id,(value->>'reversal')::bigint reversal FROM jsonb_array_elements($2::jsonb)),parents AS (${parent})
  SELECT p.k,s.id supplier_id,s.name supplier_label,d.id department_id,d.name department_label,ct.id contract_id,ct.title contract_label,pr.id project_id,pr.name project_label,
  p.supplier_id IS NOT NULL supplier_link,p.department_id IS NOT NULL department_link,p.contract_id IS NOT NULL contract_link,p.project_id IS NOT NULL project_link,p.parent_unavailable,p.source_month
  FROM parents p LEFT JOIN suppliers s ON s.id=p.supplier_id AND s.organization_id=$1
  LEFT JOIN departments d ON d.id=p.department_id AND d.organization_id=$1
  LEFT JOIN supplier_contracts ct ON ct.id=p.contract_id AND ct.organization_id=$1 AND ct.supplier_id=p.supplier_id
  LEFT JOIN projects pr ON pr.id=p.project_id AND pr.organization_id=$1`,[org,JSON.stringify(sources.map(s=>({k:s.sourceType+":"+s.sourceId,kind:s.sourceType,id:measure==="received"?s.sourceId.split(":").at(-1):s.sourceId,...(s.sourceType==="receipt_reversal"?{reversal:s.sourceId.split(":")[0]}:{})})))]);
 const byKey=new Map(rows.rows.map(r=>[r.k,r]));
 return sources.map(s=>{
  const r=byKey.get(s.sourceType+":"+s.sourceId),dimensions={} as SpendDimensions;
  for(const name of ["supplier","department","contract","project"] as const){
   const id=r?.[name+"_id"],label=r?.[name+"_label"],unassigned=Boolean(r&&!r[name+"_link"]&&!(name!=="supplier"&&r.parent_unavailable));
   dimensions[name]=id&&label?{key:name+":"+id,label:String(label),state:"observed"}:{key:unassigned?"unassigned":"unavailable",label:unassigned?`Unassigned ${name}`:`Unavailable ${name}`,state:unassigned?"unassigned":"unavailable"};
  }
  // SQL calendar fields are the same fields used by canonical source filters.
  // JS Date serializes a naive January midnight into the previous UTC month.
  const month=r?.source_month,currency=s.currencyCode;
  dimensions.month=month?{key:month,label:month,state:"observed"}:{key:"unknown",label:"Unknown source month",state:"unavailable"};
  dimensions.currency=currency?{key:currency,label:currency,state:"observed"}:{key:"unknown",label:"Unknown original currency",state:"unavailable"};
  return {...s,dimensions};
 });
}

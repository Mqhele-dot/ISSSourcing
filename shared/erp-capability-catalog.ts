export type ErpCapabilityStatus = "implemented" | "partial" | "missing" | "disabled" | "degraded" | "blocked";
export type ErpCapability = { id:string; category:string; label:string; status:ErpCapabilityStatus; aliases:readonly string[]; routes:readonly string[]; apis:readonly string[]; permissions:readonly string[]; evidence:readonly string[]; featureFlag:string|null; verifiedAt:string|null };

const definitions = {
  finance: { implemented:["Accounts Payable","VAT/tax handling","Multi-currency","Financial dashboards and reports","Audit trails"], partial:["General Ledger","Accounts Receivable","Cash flow management","Multi-company / multi-entity consolidation","Budgeting and forecasting"], missing:["Bank reconciliation","Fixed assets","Year-end close support"] },
  procurement: { implemented:["Purchase requisitions","Purchase order creation","PO approvals","Supplier/vendor master data","RFQs","Purchase order sending","Goods receipt / GRV","PO-to-invoice matching","Procurement audit trail","Multi-currency purchasing","International order tracking"], partial:["Purchase contracts","Supplier price lists","Budget or cost-centre approval"], missing:["Purchase returns"] },
  inventory: { implemented:["Item master data","SKU/item codes","Item categories","Item descriptions","Units of measure","On-hand quantity","Allocated/reserved quantity","Available quantity","Reorder points","Min/max levels","Stock valuation","Multi-location stock","Multi-bin stock","Serial number tracking","Lot/batch tracking","Vendor lead times","Stock counts","Stock adjustments","Inventory transfers"], partial:["Expiry tracking","Reorder forecasting"], missing:["Slow-moving stock reports"] },
  warehouse: { implemented:["Receiving","Put-away","Dispatch","Bin management","Warehouse transfers","Stock counts","Mobile barcode scanning","Multi-warehouse visibility"], partial:["Picking","Delivery advice","Warehouse enquiries","Inter-branch transfers","Mobile WMS app"], missing:["Packing","Pick tickets","POD capture"] },
  manufacturing: { implemented:[], partial:[], missing:["Bill of Materials","Work in Progress","MRP/material planning","Production planning","Production scheduling","Shop floor control","Work centres","Machine/labour costing","Kitting/assembly","Disassembly","Batch/process manufacturing","Quality control","Waste reduction","Production documents"] },
  logistics: { implemented:["Shipment creation","Carrier tracking","Delivery notes","Delivery status","ETA tracking","Late delivery alerts","Shipment-to-order links","Inbound/outbound shipment status","Filter by PO number","Filter by supplier","Filter by carrier","Filter by tracking number","Filter by ETA","Filter by status","Filter by risk bucket"], partial:["Dispatch planning","Delivery cost rates"], missing:["Shipment manifests","Proof of delivery","Container item management"] },
  suppliers: { implemented:["Supplier master data","Supplier banking details","Supplier contacts","Supplier performance","Supplier RFQs","PO confirmation","Supplier invoice submission","Document uploads","Supplier payment status","Supplier contracts","Supplier compliance"], partial:["Supplier price lists","Vendor lead times","Supplier risk scoring"], missing:["Supplier communication history"] },
  sales_crm: { implemented:["Quotes"], partial:["Customer master data"], missing:["Sales orders","Sales returns","Customer balances","Credit limits","CRM activities","Sales analysis","Mobile sales app","eCommerce integration","Point of sale","Customer statements","Delivery from sales orders"] },
  projects: { implemented:[], partial:["Cost tracking","Document attachments"], missing:["Project budgets","Project quotes","Project invoicing","Resource scheduling","Labour/machine hours","Project progress","Checklists"] },
  analytics: { implemented:["BI dashboards","Analysis views","Report builder","KPI cards","Drilldowns","Visual charts","Supplier reports","Inventory reports","Procurement reports","AP aging","Operational efficiency metrics","Procurement pipeline dashboard","Inventory health dashboard","AP aging dashboard","Logistics ETA risk dashboard","Exceptions aging dashboard","Supplier performance dashboard","Operations trend dashboard"], partial:["Excel integration","Role-based reports"], missing:["Power BI integration"] },
  controls: { implemented:["User roles","Permissions","Approval workflows","PO approvals","Payment approvals","Audit trails","Document matching","Segregation of duties","Management authorisation","Alerts and notifications"], partial:["Access rights per warehouse/bin"], missing:["Credit approvals"] },
  mobile: { implemented:["Barcode scanning","Mobile approvals","Mobile stock counts"], partial:["Mobile WMS","Mobile inventory enquiries"], missing:["Mobile sales","Sign-on-glass","Mobile requisitions","Mobile job/workshop functions","GPS sales activity tracking"] },
} as const;

const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
const canonicalKey=(label:string)=>({"ap-aging-dashboard":"ap-aging","supplier-performance-dashboard":"supplier-performance","mobile-wms-app":"mobile-wms"}[slug(label)]??slug(label));
const rawCapabilities: readonly ErpCapability[] = Object.entries(definitions).flatMap(([category,groups]) =>
  (["implemented","partial","missing"] as const).flatMap(status => groups[status].map(label => ({id:`${category}.${slug(label)}`,category,label,status,aliases:[],routes:[],apis:[],permissions:[],evidence:[],featureFlag:null,verifiedAt:null})))
);
const rank:Record<ErpCapabilityStatus,number>={missing:0,blocked:0,partial:1,degraded:1,disabled:1,implemented:2};
const unique=new Map<string,ErpCapability>();
for(const item of rawCapabilities){const key=canonicalKey(item.label);const prior=unique.get(key);if(!prior){unique.set(key,item);continue;}const status=rank[item.status]<rank[prior.status]?item.status:prior.status;unique.set(key,{...prior,status,aliases:[...prior.aliases,item.id]});}
const evidence:Record<string,Partial<ErpCapability>>={
  "suppliers.supplier-communication-history":{status:"implemented",routes:["/procurement/suppliers/:id"],apis:["/api/v2/suppliers/:id/communications"],permissions:["suppliers:read"],evidence:["scripts/test-supplier-communications-runtime.ts","e2e/small-business-release.spec.ts"]},
  "inventory.slow-moving-stock-reports":{status:"implemented",routes:["/inventory/reorder"],apis:["/api/v2/inventory/slow-moving"],permissions:["inventory:read"],evidence:["server/modules/reorder/register-planning-routes.ts","e2e/small-business-release.spec.ts"]},
  "procurement.purchase-contracts":{
    routes:["/procurement/contracts"],
    apis:["/api/v2/procurement/contracts","/api/v2/procurement/contracts/:id","/api/v2/procurement/contracts/:id/release-po"],
    permissions:["purchases:read","purchases:manage","purchases:approve"],
    evidence:["test:procurement-completion-contracts","e2e/blanket-agreements.spec.ts"],
    featureFlag:"procurement.phase2Enabled",
  },
  "procurement.supplier-price-lists":{apis:["/api/v2/procurement/supplier-price-lists"],permissions:["purchases:read","purchases:manage","purchases:approve"],evidence:["test:procurement-completion-contracts"],featureFlag:"procurement.phase3Enabled"},
  "procurement.purchase-returns":{status:"partial",routes:["/procurement/receiving"],apis:["/api/v2/procurement/returns"],permissions:["purchases:read","purchases:manage","purchases:approve"],evidence:["test:procurement-completion-contracts","docs/audits/warehouse-logistics-completion-2026-09-15.md"],featureFlag:"procurement.phase4Enabled"},
  // Source-audited scope, not proof that runtime/release checks have passed.
  // Stock counts also represents warehouse.stock-counts through its existing alias.
  "inventory.stock-counts":{status:"partial",routes:["/inventory/cycle-counts"],apis:["/api/cycle-counts","/api/cycle-count-lines","/api/cycle-counts/:id/post"],evidence:["docs/audits/warehouse-logistics-completion-2026-09-15.md"]},
  "inventory.multi-bin-stock":{status:"partial",evidence:["docs/audits/warehouse-logistics-completion-2026-09-15.md"]},
  "inventory.stock-valuation":{status:"partial",evidence:["docs/audits/warehouse-logistics-completion-2026-09-15.md"]},
  "warehouse.put-away":{status:"partial",routes:["/inventory/put-away"],apis:["/api/v2/inventory/put-away"],evidence:["docs/audits/warehouse-logistics-completion-2026-09-15.md"]},
};
export const erpCapabilityCatalog: readonly ErpCapability[]=[...unique.values()].map(item=>({...item,...evidence[item.id]}));
export const erpCapabilitySummary = Object.freeze({ rawTotal:rawCapabilities.length, total:erpCapabilityCatalog.length, implemented:erpCapabilityCatalog.filter(x=>x.status==="implemented").length, partial:erpCapabilityCatalog.filter(x=>x.status==="partial").length, missing:erpCapabilityCatalog.filter(x=>x.status==="missing").length });

/** Feature enablement is not verification; preserve the actual evidence timestamp. */
export function resolveCapabilityAvailability(
  catalog: readonly ErpCapability[],
  isEnabled: (flag: string) => boolean,
): readonly ResolvedErpCapability[] {
  return catalog.map(item => {
    const enabled = item.featureFlag ? isEnabled(item.featureFlag) : null;
    return {
      ...item,
      status: enabled === false ? "disabled" as const : item.status,
      implementationStatus: item.status,
      enablement: enabled === null ? "not_gated" as const : enabled ? "enabled" as const : "disabled" as const,
      // Test names and source-audit dates are not successful release-gate evidence.
      verification: "unverified" as const,
    };
  });
}

export type ResolvedErpCapability = ErpCapability & {
  implementationStatus: ErpCapabilityStatus;
  enablement: "not_gated" | "enabled" | "disabled";
  verification: "unverified";
};

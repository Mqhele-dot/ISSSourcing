export type MdmDataQualityCheckDefinition = {
  issueCode: string;
  severity: "info" | "warning" | "error";
  domain: string;
  ownerRole: string;
  affectedWorkflows: string[];
  recommendedFix: string;
};

export const MDM_DATA_QUALITY_CHECKS: MdmDataQualityCheckDefinition[] = [
  {
    issueCode: "DUPLICATE_SUPPLIER_NAME",
    severity: "warning",
    domain: "Suppliers",
    ownerRole: "supplier_master_steward",
    affectedWorkflows: ["Requisitions", "Purchase Orders", "AP", "Reports"],
    recommendedFix: "Merge or mark duplicate supplier records with a controlled replacement.",
  },
  {
    issueCode: "DUPLICATE_SUPPLIER_TAX_NUMBER",
    severity: "error",
    domain: "Suppliers",
    ownerRole: "supplier_master_steward",
    affectedWorkflows: ["AP", "Tax reporting", "Supplier onboarding"],
    recommendedFix: "Review legal supplier records and keep one approved tax identity.",
  },
  {
    issueCode: "SUPPLIER_DEFAULTS_MISSING",
    severity: "warning",
    domain: "Suppliers",
    ownerRole: "supplier_master_steward",
    affectedWorkflows: ["Requisitions", "Purchase Orders", "AP"],
    recommendedFix: "Complete supplier tax, currency, payment-term, and incoterm defaults.",
  },
  {
    issueCode: "SUPPLIER_COMPLIANCE_EXPIRED",
    severity: "error",
    domain: "Supplier Compliance Documents",
    ownerRole: "compliance_steward",
    affectedWorkflows: ["PO send", "Supplier onboarding"],
    recommendedFix: "Renew or waive required compliance documents before supplier use.",
  },
  {
    issueCode: "CONTRACT_NEAR_EXPIRY",
    severity: "warning",
    domain: "Contracts",
    ownerRole: "contract_steward",
    affectedWorkflows: ["Purchase Orders", "Supplier defaults"],
    recommendedFix: "Renew, replace, or terminate expiring contracts.",
  },
  {
    issueCode: "ITEM_CATALOGUE_GAP",
    severity: "warning",
    domain: "Items & Services",
    ownerRole: "item_master_steward",
    affectedWorkflows: ["Requisitions", "POs", "Receiving", "Counts"],
    recommendedFix: "Add UOM, preferred supplier, tax code, GL/category mapping, and price.",
  },
  {
    issueCode: "INVALID_UOM_CONVERSION",
    severity: "error",
    domain: "Units & Conversions",
    ownerRole: "item_master_steward",
    affectedWorkflows: ["Receiving", "Inventory valuation", "AP matching"],
    recommendedFix: "Correct conversion factors and item-specific conversion overrides.",
  },
  {
    issueCode: "INACTIVE_SUPPLIER_ON_OPEN_PO",
    severity: "error",
    domain: "Suppliers",
    ownerRole: "supplier_master_steward",
    affectedWorkflows: ["Purchase Orders", "Receiving", "AP"],
    recommendedFix: "Reactivate, replace, cancel, or close affected open purchase orders.",
  },
  {
    issueCode: "INACTIVE_COST_CENTRE_ON_OPEN_REQUISITION",
    severity: "error",
    domain: "Cost Centres",
    ownerRole: "finance_master_steward",
    affectedWorkflows: ["Requisitions", "Approvals", "Reports"],
    recommendedFix: "Reassign open requisitions before deactivating cost centres.",
  },
  {
    issueCode: "TAX_CODE_EFFECTIVE_DATE_MISSING",
    severity: "warning",
    domain: "Tax Codes",
    ownerRole: "tax_master_steward",
    affectedWorkflows: ["Purchase Orders", "AP", "Tax reporting"],
    recommendedFix: "Add effective date windows to active tax codes.",
  },
  {
    issueCode: "WAREHOUSE_COST_CENTRE_MISSING",
    severity: "warning",
    domain: "Warehouses",
    ownerRole: "warehouse_master_steward",
    affectedWorkflows: ["Receiving", "Inventory", "Reports"],
    recommendedFix: "Map each warehouse/site to a cost centre for reporting and receiving control.",
  },
];

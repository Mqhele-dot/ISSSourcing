#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const file = "server/modules/procurement/supplier-defaults.ts";
const text = fs.readFileSync(path.join(root, file), "utf8");

function assertContains(pattern, label) {
  if (!pattern.test(text)) {
    throw new Error(`${label} missing in ${file}`);
  }
}

function assertNotContains(pattern, label) {
  if (pattern.test(text)) {
    throw new Error(`${label} still present in ${file}`);
  }
}

assertContains(/SUPPLIER_DEFAULT_CONTRACT_INVALID/, "stale supplier default contract guard");
assertContains(/SUPPLIER_CONTRACT_NOT_FOUND/, "explicit contract validation");
assertContains(/allowCurrencyOverride:\s*suppliers\.allowCurrencyOverride/, "supplier currency override policy lookup");
assertContains(/SUPPLIER_CONTRACT_CURRENCY_OVERRIDE_BLOCKED/, "contract currency override guard");
assertContains(/SUPPLIER_CURRENCY_OVERRIDE_CONFIRMATION_REQUIRED/, "supplier override confirmation guard");
assertContains(/defaults\.requireApprovalForOverride && input\.confirmCurrencyOverride !== true/, "override confirmation enforcement");
assertContains(/eq\(paymentTerms\.active,\s*true\)/, "active payment terms guard");
assertContains(/eq\(incoterms\.active,\s*true\)/, "active incoterm guard");
assertContains(/references missing default contract/, "diagnostics for missing supplier default contract");
assertContains(/is missing default payment terms in Master Data/, "diagnostics for missing supplier payment terms");
assertContains(/is missing a default tax code in Master Data/, "diagnostics for missing supplier tax code");
assertContains(/is missing a default incoterm in Master Data/, "diagnostics for missing supplier incoterm");
assertContains(/resolveSupplierCommercialDefaultsForOrg\([\s\S]*"existing purchase-order diagnostics"/, "PO diagnostics should reuse centralized supplier commercial defaults");
assertContains(/PO \$\{row\.orderNumber\} uses payment terms #\$\{poPaymentTermsId \?\? "none"\}, but supplier \$\{row\.supplierName\} defaults to #\$\{defaults\.paymentTermsId\}\./, "PO payment terms drift diagnostics");
assertContains(/PO \$\{row\.orderNumber\} uses tax code #\$\{poTaxCodeId \?\? "none"\}, but supplier \$\{row\.supplierName\} defaults to #\$\{defaults\.taxCodeId\}\./, "PO tax code drift diagnostics");
assertContains(/PO \$\{row\.orderNumber\} uses incoterm #\$\{poIncotermId \?\? "none"\}, but supplier \$\{row\.supplierName\} defaults to #\$\{defaults\.incotermId\}\./, "PO incoterm drift diagnostics");
assertContains(/Invoice \$\{row\.invoiceNumber\} uses payment terms #\$\{invoicePaymentTermsId \?\? "none"\}, but linked PO \$\{row\.orderNumber\} uses #\$\{poPaymentTermsId\}\./, "invoice payment terms drift diagnostics");
assertContains(/inArray\(purchaseOrderItems\.orderId,\s*poIds\)/, "filtered PO line diagnostics query");
assertNotContains(/contract\?\.id\s*\?\?\s*effectiveContractId/, "invalid contract id fallback");

const routeFile = "server/modules/procurement/register-procurement-routes.ts";
const routeText = fs.readFileSync(path.join(root, routeFile), "utf8");

function assertRouteContains(pattern, label) {
  if (!pattern.test(routeText)) {
    throw new Error(`${label} missing in ${routeFile}`);
  }
}

assertRouteContains(/eq\(paymentTerms\.active,\s*true\)/, "route payment terms active validation");
assertRouteContains(/Payment terms not found or inactive\./, "route inactive payment terms error");
assertRouteContains(/eq\(incoterms\.active,\s*true\)/, "route incoterm active validation");
assertRouteContains(/Incoterm not found or inactive\./, "route inactive incoterm error");

console.log("Master-data contract hardening checks passed.");

import { readFileSync } from "node:fs";

const service = readFileSync("server/modules/accounts-payable/service.ts", "utf8");
const routes = readFileSync("server/modules/accounts-payable/register-ap-routes.ts", "utf8");
const uiInvoices = readFileSync("client/src/pages/invoices.tsx", "utf8");
const uiAp = readFileSync("client/src/pages/accounts-payable.tsx", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(service, "AP_INVOICE_PO_LINK_REQUIRED", "structured AP no-PO error code");
assertIncludes(service, "invoicePoLinkRequired(invoiceId)", "match/submit no-PO guard");
assertIncludes(
  service,
  "Link this invoice to a purchase order before matching or submitting for approval.",
  "repair hint",
);
assertIncludes(routes, "sendApStructuredError", "AP route structured error handler");
assertIncludes(routes, "ApStructuredError", "AP route imports structured error class");
assertIncludes(routes, "error.hint", "structured AP error hint propagation");
assertIncludes(routes, "error.details", "structured AP error detail propagation");

const uiSource = `${uiInvoices}\n${uiAp}`;
if (uiSource.includes("INVOICE_MATCH_FAILED") && !uiSource.includes("AP_INVOICE_PO_LINK_REQUIRED")) {
  throw new Error("AP invoice UI must handle AP_INVOICE_PO_LINK_REQUIRED instead of only generic match failure");
}

console.log("AP PO-link validation contracts passed.");

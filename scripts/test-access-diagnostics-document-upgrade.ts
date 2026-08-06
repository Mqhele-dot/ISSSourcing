import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { hasProfileNavigationAccess } from "../client/src/lib/access/profile-navigation-access";
import { notificationTarget } from "../client/src/lib/notifications/notification-target";
import { processFile } from "../server/services/document-extractor-service";

assert.equal(hasProfileNavigationAccess("admin", { allowedNavPaths: [] }, "/admin/settings"), true);
assert.equal(hasProfileNavigationAccess("custom", { allowedNavPaths: ["/inventory"] }, "/inventory/:sku"), true);
assert.equal(hasProfileNavigationAccess("custom", { allowedNavPaths: ["/inventory"] }, "/procurement/orders"), false);
assert.equal(notificationTarget({ entityType: "shipment", entityId: 42 }), "/operations/logistics/42");
assert.equal(notificationTarget({ entityType: "purchase_requisition", entityId: 7 }), "/procurement/requisitions/7");
assert.equal(notificationTarget({ entityType: "invoice", entityId: 9 }), "/finance/accounts-payable");

const workDir = await mkdtemp(path.join(tmpdir(), "iss-extractor-upgrade-"));
try {
  const workbookPath = path.join(workDir, "import.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventory");
  sheet.addRow(["SKU", "Name", "Quantity", "Calculated"]);
  sheet.addRow(["SKU-100", "Widget", 4, { formula: "C2*2", result: 8 }]);
  await workbook.xlsx.writeFile(workbookPath);
  const excelResult = await processFile(workbookPath, "import.xlsx", { headerRow: true });
  assert.equal(excelResult.fileType, "excel");
  assert.equal(excelResult.rows, 1);
  assert.deepEqual(excelResult.columns, ["SKU", "Name", "Quantity", "Calculated"]);
  assert.equal(excelResult.data[0].Calculated, 8);

  const pdfPath = path.join(workDir, "document.pdf");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 250]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("ISSSourcing document extraction test", { x: 40, y: 180, size: 14, font });
  await writeFile(pdfPath, await pdf.save());
  const pdfResult = await processFile(pdfPath, "document.pdf");
  assert.equal(pdfResult.fileType, "pdf");
  assert.equal(pdfResult.pages, 1);
  assert.match(String(pdfResult.data[0]?.text ?? ""), /ISSSourcing document extraction test/);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

console.log("Access, diagnostics, notification, and document upgrade tests passed.");

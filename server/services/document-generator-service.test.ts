/**
 * Unit tests for CSV generator (sep=, and structure).
 * Run with: npx tsx server/services/document-generator-service.test.ts
 */
import { generateGenericCsv, generateInventoryCsv } from "./document-generator-service.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function run() {
  let passed = 0;

  // generateGenericCsv: must start with sep=,
  const genericBuf = await generateGenericCsv(
    [{ id: 1, name: "Test" }],
    "Test Report",
    [
      { header: "ID", key: "id" },
      { header: "Name", key: "name" },
    ],
  );
  const genericStr = genericBuf.toString("utf-8");
  // UTF-8 BOM (Excel recognizes encoding)
  assert(genericBuf[0] === 0xef && genericBuf[1] === 0xbb && genericBuf[2] === 0xbf, "Generic CSV must start with UTF-8 BOM");
  assert(genericStr.includes("sep=,"), "Generic CSV must contain sep=, line");
  assert(genericStr.includes("\r\n"), "Generic CSV must use CRLF line endings for Excel");
  assert(genericStr.includes("ID") && genericStr.includes("Name"), "Generic CSV must contain headers");
  const genericLines = genericStr.split(/\r?\n/);
  assert(genericLines.length >= 2, "Generic CSV must have header + at least one data row");
  const headerCols = genericLines[1].split(",").length;
  const dataCols = genericLines[2] ? genericLines[2].split(",").length : 0;
  assert(headerCols === dataCols || genericLines.length === 2, "Generic CSV column count must match");
  console.log("OK generateGenericCsv: BOM, sep=,, CRLF, headers, consistent columns");
  passed++;

  // generateInventoryCsv: must start with sep=,
  const inventoryBuf = await generateInventoryCsv(
    [
      {
        id: 1,
        sku: "TST-001",
        name: "Test Item",
        description: "",
        categoryId: 1,
        supplierId: 1,
        quantity: 10,
        price: 9.99,
        cost: 5,
        lowStockThreshold: 2,
        location: "A-1",
        status: "active",
        defaultWarehouseId: 1,
        updatedAt: new Date(),
      },
    ] as any,
    "Inventory",
  );
  const inventoryStr = inventoryBuf.toString("utf-8");
  assert(inventoryBuf[0] === 0xef && inventoryBuf[1] === 0xbb && inventoryBuf[2] === 0xbf, "Inventory CSV must start with UTF-8 BOM");
  assert(inventoryStr.includes("sep=,"), "Inventory CSV must contain sep=, line");
  assert(inventoryStr.includes("\r\n"), "Inventory CSV must use CRLF line endings for Excel");
  assert(
    inventoryStr.includes("SKU") && inventoryStr.includes("Name"),
    "Inventory CSV must contain expected headers",
  );
  const invLines = inventoryStr.split(/\r?\n/);
  assert(invLines.length >= 2, "Inventory CSV must have header + data");
  console.log("OK generateInventoryCsv: BOM, sep=,, CRLF, headers present");
  passed++;

  console.log(`\n${passed} tests passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

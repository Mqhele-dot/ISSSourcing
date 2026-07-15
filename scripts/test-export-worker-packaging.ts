import assert from "node:assert/strict";
import { packageExportBuffer } from "../server/modules/exports/export-worker";

const csv = packageExportBuffer({
  buffer: Buffer.from("id,name\r\n1,Example\r\n", "utf8"),
  fileName: "suppliers.csv",
  format: "csv",
  contentType: "text/csv; charset=utf-8",
});
assert.equal(csv.fileName, "suppliers.csv.gz");
assert.equal(csv.mimeType, "application/gzip");
assert.ok(csv.buffer.length > 0);

for (const [format, fileName, mimeType] of [
  ["excel", "purchase-orders.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["docx", "suppliers.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["pdf", "requisitions.pdf", "application/pdf"],
] as const) {
  const source = Buffer.from(`native-${format}`);
  const packaged = packageExportBuffer({ buffer: source, fileName, format, contentType: mimeType });
  assert.equal(packaged.fileName, fileName);
  assert.equal(packaged.mimeType, mimeType);
  assert.deepEqual(packaged.buffer, source);
}

console.log("Queued export packaging compresses CSV only and preserves native document formats.");

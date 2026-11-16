import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { publicSupplierProfile, SUPPLIER_BANKING_GUIDANCE } from "../shared/supplier-public-profile";
import { extractPdfTestText } from "./helpers/pdf-test-text";

// This is a pure rendering/projection test. Any accidental SQL must fail at an
// unreachable, explicitly disposable target, never at the operator's database.
process.env.DATABASE_URL = `postgresql://unconfigured@127.0.0.1:1/iss_profile_pure_test_${randomUUID().replaceAll("-", "")}`;
process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
const { generateDocument, generateSupplierProfilePdf } = await import("../server/services/document-generator-service");

const secrets = ["PRIVATE-BANK-NAME-91827", "PRIVATE-ACCOUNT-00123456789", "PRIVATE-SWIFT-ABC123"];
const original = Object.freeze({ id: 1, organizationId: 1, name: "Synthetic supplier privacy check", contactName: "Test contact",
  email: "supplier@example.test", phone: "000123", address: "Test address", status: "active", defaultCurrencyCode: "ZAR",
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  bankName: secrets[0], bankAccountNumber: secrets[1], bankSwift: secrets[2],
  bank_name: secrets[0], bank_account_number: secrets[1], bank_swift: secrets[2] });
const before = JSON.stringify(original);
for (let index = 0; index < 5000; index++) {
  const visible = publicSupplierProfile({ ...original, id: index + 1 });
  assert.equal(visible.name, original.name); assert.equal(visible.bankingDisclosure, "governed_workflow_only");
  assert.equal(Object.keys(visible).some(key => /^(bankName|bankAccountNumber|bankSwift|bank_name|bank_account_number|bank_swift)$/.test(key)), false);
  for (const secret of secrets) assert.equal(JSON.stringify(visible).includes(secret), false);
}
assert.equal(JSON.stringify(original), before, "Public projections cannot rewrite stored evidence.");
assert.deepEqual(publicSupplierProfile(publicSupplierProfile(original)), publicSupplierProfile(original), "Projection is idempotent.");
for (const format of ["csv", "excel", "docx"] as const) {
  const bytes = await generateDocument("suppliers", format, [original], "Synthetic supplier privacy check", { reportingCurrencyCode: "ZAR" });
  const contents = format === "csv" ? [bytes.toString("utf8")] : await (async () => {
    const zip = await JSZip.loadAsync(bytes);
    return Promise.all(Object.values(zip.files).filter(file => !file.dir && /\.xml$/.test(file.name)).map(file => file.async("string")));
  })();
  for (const content of contents) for (const secret of secrets) assert.equal(content.includes(secret), false, `${format} contains a legacy banking value.`);
}
const pdf = await generateDocument("suppliers", "pdf", [original], "Synthetic supplier privacy check", { reportingCurrencyCode: "ZAR" });
for (const bytes of [pdf, await generateSupplierProfilePdf(original as never, "Synthetic direct-profile check")]) {
  const extracted = extractPdfTestText(bytes);
  for (const secret of secrets) assert.equal(extracted.replace(/\s/g, "").includes(secret), false, "PDF contains legacy banking.");
  assert.match(extracted, /not a verified beneficiary or payment instruction/);
  assert.match(extracted, /Supplier Banks in Master Data/);
}
const output = path.resolve("output/pdf/supplier-profile-privacy-smoke.pdf");
mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, pdf);
console.log(`Supplier public-profile checks passed: 5000 non-mutating projections; CSV, XLSX, DOCX and independently extracted PDF; guidance: ${SUPPLIER_BANKING_GUIDANCE}`);
console.log(`Synthetic PDF retained for render verification: ${output}`);

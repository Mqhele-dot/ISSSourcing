import process from "node:process";
import { exitTest } from "./test-exit.ts";
import { apiRawRequest, getTestBaseUrl, isConnectionRefused, loginForTests } from "./test-http.ts";

type ExportCase = {
  reportType: string;
  format: "pdf" | "csv" | "excel" | "docx";
  expectedMimePrefix: string;
};

const exportCases: ExportCase[] = [
  { reportType: "inventory", format: "pdf", expectedMimePrefix: "application/pdf" },
  { reportType: "inventory", format: "csv", expectedMimePrefix: "text/csv" },
  { reportType: "inventory", format: "excel", expectedMimePrefix: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { reportType: "inventory", format: "docx", expectedMimePrefix: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { reportType: "suppliers", format: "pdf", expectedMimePrefix: "application/pdf" },
  { reportType: "suppliers", format: "csv", expectedMimePrefix: "text/csv" },
  { reportType: "purchase_orders", format: "pdf", expectedMimePrefix: "application/pdf" },
  { reportType: "purchase_orders", format: "excel", expectedMimePrefix: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { reportType: "purchase_requisitions", format: "pdf", expectedMimePrefix: "application/pdf" },
  { reportType: "purchase_requisitions", format: "docx", expectedMimePrefix: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { reportType: "activity_logs", format: "pdf", expectedMimePrefix: "application/pdf" },
  { reportType: "warehouses", format: "pdf", expectedMimePrefix: "application/pdf" },
];

function isPdfMagic(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 5) return false;
  const head = new Uint8Array(buf.slice(0, 5));
  return String.fromCharCode(...head) === "%PDF-";
}

async function main() {
  const BASE_URL = getTestBaseUrl();
  console.log("Export smoke tests (BASE_URL=%s)\n", BASE_URL);

  const cookie = await loginForTests("admin", "Admin123!");
  if (!cookie) {
    console.log("  ⚠ Admin login failed. Ensure demo users exist (npm run db:seed).");
    exitTest(1);
  }

  let failures = 0;

  for (const testCase of exportCases) {
    const route = `/export/${testCase.reportType}/${testCase.format}`;
    const res = await apiRawRequest(route, { method: "GET", cookie });
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const contentDisposition = res.headers.get("content-disposition") ?? "";
    const body = await res.arrayBuffer();
    const bodyLength = body.byteLength;
    const mimeOk = contentType.startsWith(testCase.expectedMimePrefix);
    const filenameOk = contentDisposition.includes(`.${testCase.format === "excel" ? "xlsx" : testCase.format}`);
    const pdfOk = testCase.format !== "pdf" || isPdfMagic(body);

    if (res.ok && mimeOk && filenameOk && bodyLength > 0 && pdfOk) {
      console.log("  ✓ GET %s -> %d (%s, %d bytes)", route, res.status, contentType, bodyLength);
    } else {
      failures++;
      console.log(
        "  ✗ GET %s -> status=%d mime=%s disposition=%s bytes=%d",
        route,
        res.status,
        contentType || "<none>",
        contentDisposition || "<none>",
        bodyLength,
      );
    }
  }

  console.log("\nExport smoke result: %d failure(s)", failures);
  exitTest(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  if (isConnectionRefused(err)) {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", getTestBaseUrl());
    exitTest(0);
  }
  console.error(err);
  exitTest(1);
});

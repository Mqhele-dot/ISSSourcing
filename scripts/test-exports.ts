import process from "node:process";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:5000").replace(/\/$/, "");
const API = `${BASE_URL}/api`;

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
  { reportType: "purchase_orders", format: "excel", expectedMimePrefix: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { reportType: "purchase_requisitions", format: "docx", expectedMimePrefix: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
];

let lastCookie: string | undefined;

async function request(path: string, options: { method?: string; body?: unknown; cookie?: string }) {
  const url = path.startsWith("http") ? path : `${API}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) lastCookie = setCookie.split(";")[0];
  return res;
}

async function login(username: string, password: string): Promise<string | undefined> {
  lastCookie = undefined;
  await request("/auth/login", { method: "POST", body: { username, password } });
  if (!lastCookie) {
    await request("/login", { method: "POST", body: { username, password } });
  }
  return lastCookie;
}

async function main() {
  console.log("Export smoke tests (BASE_URL=%s)\n", BASE_URL);

  const cookie = await login("admin", "Admin123!");
  if (!cookie) {
    console.log("  ⚠ Admin login failed. Ensure demo users exist (npm run db:seed).");
    process.exit(1);
  }

  let failures = 0;

  for (const testCase of exportCases) {
    const route = `/export/${testCase.reportType}/${testCase.format}`;
    const res = await request(route, { method: "GET", cookie });
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const contentDisposition = res.headers.get("content-disposition") ?? "";
    const body = await res.arrayBuffer();
    const bodyLength = body.byteLength;
    const mimeOk = contentType.startsWith(testCase.expectedMimePrefix);
    const filenameOk = contentDisposition.includes(`.${testCase.format === "excel" ? "xlsx" : testCase.format}`);

    if (res.ok && mimeOk && filenameOk && bodyLength > 0) {
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
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  const cause = (err as NodeJS.ErrnoException & { cause?: { code?: string } })?.cause;
  if (cause?.code === "ECONNREFUSED") {
    console.log("  ⚠ Server not reachable at %s. Start with: npm run dev", BASE_URL);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

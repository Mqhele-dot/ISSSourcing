import { spawnSync } from "node:child_process";

/** Independent PDF reader for synthetic verification; never shells out or skips failures. */
export function extractPdfTestText(bytes: Buffer): string {
  const result = spawnSync(process.env.PDF_TEST_PYTHON || "python", ["-c",
    "import sys,io; from pypdf import PdfReader; r=PdfReader(io.BytesIO(sys.stdin.buffer.read())); print('\\n'.join(p.extract_text() or '' for p in r.pages))"],
  { input: bytes, encoding: "utf8", shell: false, windowsHide: true, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Independent PDF extraction failed. Set PDF_TEST_PYTHON to a Python runtime with pypdf; validation is not skipped.");
  return result.stdout.replace(/\s+/g, " ").trim();
}

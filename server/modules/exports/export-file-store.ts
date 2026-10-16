import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { exportsDir } from "../../http/upload-config";

function ensureDir(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

export function buildExportFilePath(
  organizationId: number,
  jobId: number,
  fileName: string,
): { absolutePath: string; relativePath: string } {
  const orgDir = path.join(exportsDir, `org-${organizationId}`);
  ensureDir(orgDir);
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedFileName = `job-${jobId}-${randomUUID()}-${safeFileName}`;
  const absolutePath = path.join(orgDir, storedFileName);
  const relativePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
  return { absolutePath, relativePath };
}

export function removeExportFile(filePath: string | null | undefined): void {
  if (!filePath) return;
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

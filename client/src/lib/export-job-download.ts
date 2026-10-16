import { requestJson } from "@/lib/queryClient";
import { downloadFile } from "@/lib/utils";

type RefreshedExportToken = {
  jobId: number;
  fileName: string | null;
  downloadUrl: string;
  expiresAt: string | null;
};

export async function downloadExportJob(jobId: number, fallbackFileName = `export-${jobId}`): Promise<void> {
  const token = await requestJson<RefreshedExportToken>("POST", `/api/export-jobs/${jobId}/download-token`);
  const response = await fetch(token.downloadUrl, {
    credentials: "include",
    headers: { Accept: "application/octet-stream" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string; hint?: string } } | null;
    throw new Error([body?.error?.message ?? `Download failed (${response.status}).`, body?.error?.hint].filter(Boolean).join(" "));
  }
  downloadFile(await response.blob(), token.fileName || fallbackFileName);
}

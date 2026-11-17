import { requestJson } from "@/lib/queryClient";

type RefreshedExportToken = {
  jobId: number;
  fileName: string | null;
  downloadUrl: string;
  expiresAt: string | null;
};

export async function downloadExportJob(jobId: number, fallbackFileName = `export-${jobId}`,artifact?:"summary"|"archive"): Promise<void> {
  const token = await requestJson<RefreshedExportToken>("POST", `/api/export-jobs/${jobId}/download-token`,artifact?{artifact}:{});
  // The browser download manager streams to disk. Do not materialize a large
  // archive in a JavaScript Blob or navigate away from the user's current form.
  const link=document.createElement("a");
  link.href=token.downloadUrl;link.target="_blank";link.rel="noopener noreferrer";
  link.setAttribute("aria-label",`Download ${token.fileName||fallbackFileName}`);
  document.body.appendChild(link);link.click();link.remove();
}

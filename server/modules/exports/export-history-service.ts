import { pool } from "../../db";
import { getActiveOrganizationId } from "../../organization-context";

export type ExportHistoryInsert = {
  userId?: number | null;
  dataset: string;
  format: string;
  filters: Record<string, unknown>;
  status: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  rowCount?: number | null;
  sourcePage?: string | null;
  requestUrl?: string | null;
};

export async function recordExportHistory(entry: ExportHistoryInsert): Promise<void> {
  try {
    await pool.query(
      `
        INSERT INTO export_history (
          organization_id,
          user_id,
          dataset,
          format,
          filters,
          status,
          file_name,
          file_size,
          mime_type,
          row_count,
          source_page,
          request_url
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        getActiveOrganizationId(),
        entry.userId ?? null,
        entry.dataset,
        entry.format,
        JSON.stringify(entry.filters ?? {}),
        entry.status,
        entry.fileName ?? null,
        entry.fileSize ?? null,
        entry.mimeType ?? null,
        entry.rowCount ?? null,
        entry.sourcePage ?? null,
        entry.requestUrl ?? null,
      ],
    );
  } catch (error) {
    console.warn("Failed to record export history:", error instanceof Error ? error.message : error);
  }
}

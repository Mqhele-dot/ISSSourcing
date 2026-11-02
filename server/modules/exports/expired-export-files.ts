import type {Pool} from "pg";
export type ExpiredExportFile={id:number;organizationId:number;primaryFilePath:string;filePaths:string[]};

/** Schema-compatible bounded retention batch; preserves job/artifact evidence. */
export async function readExpiredExportFiles(database:Pick<Pool,"query">){
  const ready=await database.query("SELECT to_regclass('public.export_artifacts') IS NOT NULL AS ready");
  const paired=ready.rows[0]?.ready===true;
  const result=await database.query(paired?`WITH candidates AS (
      SELECT id,organization_id,file_path,retention_expires_at FROM export_jobs
      WHERE retention_expires_at<now() AND file_path IS NOT NULL ORDER BY retention_expires_at,id LIMIT 100
    ) SELECT j.id,j.organization_id,j.file_path,
      array_remove(array_agg(DISTINCT a.file_path),NULL) AS artifact_paths
    FROM candidates j LEFT JOIN export_artifacts a ON a.job_id=j.id AND a.organization_id=j.organization_id
    GROUP BY j.id,j.organization_id,j.file_path,j.retention_expires_at ORDER BY j.retention_expires_at,j.id`
    :`SELECT id,organization_id,file_path FROM export_jobs WHERE retention_expires_at<now() AND file_path IS NOT NULL
      ORDER BY retention_expires_at,id LIMIT 100`);
  return result.rows.map(row=>({id:Number(row.id),organizationId:Number(row.organization_id),primaryFilePath:String(row.file_path),
    filePaths:[...new Set<string>([row.file_path,...(row.artifact_paths??[])].filter((value):value is string=>typeof value==="string"&&value.length>0))]}));
}

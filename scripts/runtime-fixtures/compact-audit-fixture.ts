import type {Pool} from 'pg';

/** Minimal canonical audit schema for independently owned export databases.
 * No pool/bootstrap imports; verify the exact guarded database BEFORE DDL.
 */
export async function initializeCompactAuditFixture(database:Pool,expectedDatabaseName:string){
  const actual=(await database.query('SELECT current_database() name')).rows[0].name;
  if(!/^iss_export_test_[a-f0-9]{32}$/.test(expectedDatabaseName)||actual!==expectedDatabaseName)throw new Error('Audit fixture refused an unrelated database.');
  await database.query(`CREATE TABLE audit_logs(id serial PRIMARY KEY,organization_id int NOT NULL,user_id int,action text NOT NULL,resource_type text NOT NULL,resource_id int,details jsonb,reason text,previous_hash text,event_hash text,hash_version int NOT NULL DEFAULT 1,request_id text,ip_address text,user_agent text,created_at timestamp NOT NULL);
    CREATE UNIQUE INDEX audit_logs_org_event_hash_uidx ON audit_logs(organization_id,event_hash) WHERE event_hash IS NOT NULL;
    CREATE INDEX audit_logs_org_created_idx ON audit_logs(organization_id,created_at,id);
    CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY: audit events cannot be updated or deleted'; END $$;
    CREATE TRIGGER audit_logs_append_only_guard BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()`);
}

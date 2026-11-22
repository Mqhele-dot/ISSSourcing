-- Separate approval boundary. No backfill: legacy files are not certified by installation.
CREATE UNIQUE INDEX IF NOT EXISTS export_jobs_id_organization_idx ON export_jobs(id,organization_id);
CREATE TABLE IF NOT EXISTS supplier_export_publications (
  job_id integer PRIMARY KEY,
  organization_id integer NOT NULL,
  policy_version text NOT NULL CHECK(policy_version='supplier-profile-no-banking-v1'),
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK(file_size>0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_user_id integer NOT NULL,
  FOREIGN KEY(job_id,organization_id) REFERENCES export_jobs(id,organization_id)
);
CREATE INDEX IF NOT EXISTS supplier_export_publications_org_job_idx ON supplier_export_publications(organization_id,job_id);
CREATE OR REPLACE FUNCTION protect_supplier_export_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Supplier export publication evidence is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM export_jobs j WHERE j.id=NEW.job_id AND j.organization_id=NEW.organization_id
    AND j.dataset='suppliers' AND j.status='running' AND j.created_by=NEW.actor_user_id) THEN
    RAISE EXCEPTION 'Supplier export publication requires its running owned job';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_export_publication_guard ON supplier_export_publications;
CREATE TRIGGER supplier_export_publication_guard BEFORE INSERT OR UPDATE OR DELETE ON supplier_export_publications
  FOR EACH ROW EXECUTE FUNCTION protect_supplier_export_publication();

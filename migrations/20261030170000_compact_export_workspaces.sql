-- Separate approval boundary. Private lifecycle support does not enable Compact.
CREATE UNIQUE INDEX IF NOT EXISTS compact_attempt_identity_idx ON compact_export_attempts(id,job_id,organization_id);
CREATE TABLE IF NOT EXISTS compact_export_workspaces (
  id uuid PRIMARY KEY,
  attempt_id bigint NOT NULL UNIQUE,
  job_id integer NOT NULL,
  organization_id integer NOT NULL,
  actor_id integer NOT NULL,
  storage_id text NOT NULL CHECK(storage_id ~ '^[A-Za-z0-9-]{1,100}$'),
  storage_root text NOT NULL CHECK(length(storage_root) BETWEEN 1 AND 4096),
  marker_nonce uuid NOT NULL UNIQUE,
  reserved_bytes bigint NOT NULL CHECK(reserved_bytes BETWEEN 1 AND 2147483648),
  state text NOT NULL DEFAULT 'registered' CHECK(state IN ('registered','ready','cleanup_claimed','cleanup_blocked','removed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cleanup_token uuid,
  cleanup_until timestamptz,
  cleanup_attempts integer NOT NULL DEFAULT 0 CHECK(cleanup_attempts>=0),
  last_cleanup_code text CHECK(last_cleanup_code IN ('ownership_mismatch','filesystem_failure')),
  removed_at timestamptz,
  FOREIGN KEY(job_id,organization_id) REFERENCES export_jobs(id,organization_id),
  FOREIGN KEY(attempt_id,job_id,organization_id) REFERENCES compact_export_attempts(id,job_id,organization_id),
  CHECK((state='cleanup_claimed')=(cleanup_token IS NOT NULL AND cleanup_until IS NOT NULL)),
  CHECK((state='removed')=(removed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS compact_workspace_quota_idx ON compact_export_workspaces(storage_id,organization_id) WHERE state<>'removed';
CREATE INDEX IF NOT EXISTS compact_workspace_cleanup_idx ON compact_export_workspaces(storage_id,state,updated_at,id) WHERE state<>'removed';
CREATE OR REPLACE FUNCTION protect_compact_workspace_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Compact workspace evidence cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.attempt_id,NEW.job_id,NEW.organization_id,NEW.actor_id,NEW.storage_id,NEW.storage_root,NEW.marker_nonce,NEW.reserved_bytes,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.attempt_id,OLD.job_id,OLD.organization_id,OLD.actor_id,OLD.storage_id,OLD.storage_root,OLD.marker_nonce,OLD.reserved_bytes,OLD.created_at)
  THEN RAISE EXCEPTION 'Compact workspace ownership is immutable'; END IF;
  IF OLD.state='removed' OR NOT (
    NEW.state=OLD.state OR
    OLD.state='registered' AND NEW.state IN ('ready','cleanup_claimed') OR
    OLD.state='ready' AND NEW.state='cleanup_claimed' OR
    OLD.state='cleanup_blocked' AND NEW.state='cleanup_claimed' OR
    OLD.state='cleanup_claimed' AND NEW.state IN ('removed','cleanup_blocked')
  ) THEN RAISE EXCEPTION 'Invalid Compact workspace lifecycle'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS compact_workspace_identity_guard ON compact_export_workspaces;
CREATE TRIGGER compact_workspace_identity_guard BEFORE UPDATE OR DELETE ON compact_export_workspaces FOR EACH ROW EXECUTE FUNCTION protect_compact_workspace_identity();

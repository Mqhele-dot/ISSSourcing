-- Separate Compact approval boundary. No queued jobs or historical evidence are created.
-- The canonical audit event is the immutable retry-command receipt.
CREATE UNIQUE INDEX IF NOT EXISTS compact_retry_command_uidx
  ON audit_logs(organization_id,request_id)
  WHERE action='COMPACT_EXPORT_RETRY_QUEUED' AND request_id IS NOT NULL;

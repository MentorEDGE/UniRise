-- The audit log is append-only (2026-11-24): entries can be added, never changed or removed, by any code path.
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER admin_log_append_only BEFORE UPDATE OR DELETE ON admin_log FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER admin_log_no_truncate BEFORE TRUNCATE ON admin_log FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();

-- Sensitive Office actions need the password again (2026-11-24): when the session last confirmed it.
ALTER TABLE user_token ADD COLUMN confirmed_at TIMESTAMPTZ;
-- The platform's own access log is append-only, like each institution's audit log.
CREATE FUNCTION audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The audit log cannot be changed or deleted' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER platform_access_log_append_only BEFORE UPDATE OR DELETE ON platform_access_log FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER platform_access_log_no_truncate BEFORE TRUNCATE ON platform_access_log FOR EACH STATEMENT EXECUTE FUNCTION audit_append_only();

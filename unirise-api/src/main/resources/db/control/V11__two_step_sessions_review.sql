-- Two-step sign-in, signed-in devices and the access review (2026-11-24).
-- A short-lived 'mfa' token is the half-finished sign-in between the password and the authenticator code.
ALTER TABLE user_token DROP CONSTRAINT IF EXISTS user_token_kind_check;
ALTER TABLE user_token ADD CONSTRAINT user_token_kind_check CHECK (kind IN ('invite', 'session', 'mfa'));
ALTER TABLE user_token ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE user_token ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE user_token ADD COLUMN IF NOT EXISTS ip TEXT;
-- Authenticator app (RFC 6238 TOTP): the shared secret (pending until the first code is confirmed), when it was turned on,
-- the last time step used (a code works once), and hashed one-time recovery codes.
ALTER TABLE account_login ADD COLUMN totp_secret TEXT;
ALTER TABLE account_login ADD COLUMN totp_enabled_at TIMESTAMPTZ;
ALTER TABLE account_login ADD COLUMN totp_last_step BIGINT;
ALTER TABLE account_login ADD COLUMN recovery_codes JSONB NOT NULL DEFAULT '[]';
-- For the Office's access review: accounts not used for a long time.
ALTER TABLE account_login ADD COLUMN last_sign_in_at TIMESTAMPTZ;

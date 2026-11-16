-- Email and password sign-in (BACKEND_PLAN phase 2, decision D1).
-- The control plane only knows which institution and tenant user an email belongs to, and its password hash, so a
-- sign-in can find the institution from the credential and nothing else. Role, name and status live in the
-- institution's own database (app_user).
CREATE TABLE account_login (
  email           TEXT PRIMARY KEY CHECK (email = lower(email) AND length(email) <= 200),
  institution_id  BIGINT NOT NULL REFERENCES institution(id),
  app_user_id     BIGINT NOT NULL,
  password_hash   TEXT NOT NULL,
  password_set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, app_user_id)
);

-- Failed sign-ins per email and per client address. Kept here, not in memory, so a restart or a second task does not
-- reset them. 5 per email or 20 per address within 15 minutes lock that key.
CREATE TABLE sign_in_failure (
  key        TEXT PRIMARY KEY,           -- 'email:<address>' or 'ip:<address>'
  failures   INT NOT NULL,
  window_end TIMESTAMPTZ NOT NULL
);

-- Browser sessions reuse user_token (kind 'session'): an idle timeout slides with use, an absolute expiry does not.
ALTER TABLE user_token ADD COLUMN last_seen_at TIMESTAMPTZ, ADD COLUMN idle_seconds INT;
CREATE INDEX user_token_user ON user_token(institution_id, app_user_id);

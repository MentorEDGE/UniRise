-- Password links sent by email: an invitation from the Office of Research (7 days) or a reset the person asked for
-- (1 hour). Only a SHA-256 hash of the link's secret is kept; each link works once, and a new link for the same
-- account replaces any unused one.
CREATE TABLE password_link (
  token_hash     TEXT PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES institution(id) ON DELETE CASCADE,
  app_user_id    BIGINT NOT NULL,
  purpose        TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);
CREATE INDEX password_link_user ON password_link(institution_id, app_user_id);

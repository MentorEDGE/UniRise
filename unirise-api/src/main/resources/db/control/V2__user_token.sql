-- Maps an invitation or session token to its tenant, so the tenant comes from the credential and nothing else.
CREATE TABLE user_token (
  token_hash     TEXT PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES institution(id),
  app_user_id    BIGINT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('invite','session')),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);

CREATE TABLE institution (
  id             BIGSERIAL PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{2,30}$'),
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'provisioning'
                 CHECK (status IN ('provisioning','sandbox','pilot','active','suspended','closing','closed')),
  plan           TEXT NOT NULL DEFAULT 'sandbox',
  region         TEXT NOT NULL DEFAULT 'ap-south-1',
  db_host        TEXT NOT NULL,
  db_port        INT  NOT NULL,
  db_name        TEXT NOT NULL,
  db_user        TEXT NOT NULL,
  schema_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ
);

CREATE TABLE institution_credential (
  id             BIGSERIAL PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES institution(id),
  key_hash       TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ
);

-- shortcut: tenant database passwords live here for local/dev, replace with the Secrets Manager SecretStore before any real data.
CREATE TABLE institution_secret (
  institution_id BIGINT PRIMARY KEY REFERENCES institution(id),
  db_password    TEXT NOT NULL
);

CREATE TABLE migration_run (
  id             BIGSERIAL PRIMARY KEY,
  institution_id BIGINT NOT NULL REFERENCES institution(id),
  from_version   TEXT,
  to_version     TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL,
  error          TEXT
);

CREATE TABLE platform_access_log (
  id             BIGSERIAL PRIMARY KEY,
  actor          TEXT NOT NULL,
  action         TEXT NOT NULL,
  institution_id BIGINT,
  reason         TEXT,
  at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

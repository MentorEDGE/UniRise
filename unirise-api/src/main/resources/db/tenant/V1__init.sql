-- One row describing this tenant, so a restored dump is self-describing.
CREATE TABLE institution (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name          TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'en-IN',
  currency      TEXT NOT NULL DEFAULT 'INR',
  fiscal_start  SMALLINT NOT NULL DEFAULT 4
);

CREATE TABLE researcher (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  orcid      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

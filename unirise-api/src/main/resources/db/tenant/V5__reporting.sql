ALTER TABLE researcher ADD COLUMN scopus_id TEXT, ADD COLUMN roll_no TEXT;
CREATE UNIQUE INDEX researcher_scopus_id ON researcher(scopus_id) WHERE scopus_id IS NOT NULL;
CREATE UNIQUE INDEX researcher_roll_no ON researcher(roll_no) WHERE roll_no IS NOT NULL;
CREATE UNIQUE INDEX researcher_orcid ON researcher(orcid) WHERE orcid IS NOT NULL;

CREATE TABLE period (
  id        BIGSERIAL PRIMARY KEY,
  label     TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on   DATE NOT NULL,
  closed_at TIMESTAMPTZ,
  closed_by BIGINT,
  CHECK (ends_on >= starts_on)
);

-- Frozen figures taken when a period closes, so reported numbers stop moving afterwards.
CREATE TABLE period_snapshot (
  period_id   BIGINT NOT NULL REFERENCES period(id),
  org_unit_id BIGINT NOT NULL REFERENCES org_unit(id),
  metric      TEXT NOT NULL,
  value       NUMERIC(16,2) NOT NULL,
  PRIMARY KEY (period_id, org_unit_id, metric)
);

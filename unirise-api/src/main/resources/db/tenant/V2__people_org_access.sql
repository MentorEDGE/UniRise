CREATE TABLE org_unit (
  id        BIGSERIAL PRIMARY KEY,
  parent_id BIGINT REFERENCES org_unit(id),
  type      TEXT NOT NULL CHECK (type IN ('campus','school','department','group')),
  name      TEXT NOT NULL
);
-- Closure table: one row per (ancestor, descendant) so subtree checks are a single join.
CREATE TABLE org_unit_closure (
  ancestor_id   BIGINT NOT NULL REFERENCES org_unit(id),
  descendant_id BIGINT NOT NULL REFERENCES org_unit(id),
  depth         INT NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX org_unit_closure_desc ON org_unit_closure(descendant_id);

ALTER TABLE researcher ADD COLUMN employee_id TEXT, ADD COLUMN is_scholar BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX researcher_employee_id ON researcher(employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE appointment (
  id            BIGSERIAL PRIMARY KEY,
  researcher_id BIGINT NOT NULL REFERENCES researcher(id),
  org_unit_id   BIGINT NOT NULL REFERENCES org_unit(id),
  designation   TEXT,
  fte           NUMERIC(3,2) NOT NULL DEFAULT 1,
  valid_from    DATE NOT NULL DEFAULT current_date,
  valid_to      DATE
);

-- Login identity only; what a user may do comes from role_grant.
CREATE TABLE app_user (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  researcher_id BIGINT REFERENCES researcher(id),
  active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE role_grant (
  id            BIGSERIAL PRIMARY KEY,
  app_user_id   BIGINT NOT NULL REFERENCES app_user(id),
  role          TEXT NOT NULL CHECK (role IN ('RESEARCH_ADMIN','IT_ADMIN','EXECUTIVE','DEAN','HOD','VIEWER')),
  scope_unit_id BIGINT REFERENCES org_unit(id),   -- null = whole institution
  valid_from    DATE NOT NULL DEFAULT current_date,
  valid_to      DATE,
  granted_by    BIGINT
);

CREATE TABLE relationship (
  id         BIGSERIAL PRIMARY KEY,
  mentor_id  BIGINT NOT NULL REFERENCES researcher(id),
  mentee_id  BIGINT NOT NULL REFERENCES researcher(id),
  type       TEXT NOT NULL CHECK (type IN ('primary','co','backup')),
  valid_from DATE NOT NULL DEFAULT current_date,
  valid_to   DATE,
  CHECK (mentor_id <> mentee_id)
);

-- Named drill-downs by Executive or Dean (PRD R27).
CREATE TABLE access_log (
  id                   BIGSERIAL PRIMARY KEY,
  actor_user_id        BIGINT NOT NULL,
  action               TEXT NOT NULL,
  target_researcher_id BIGINT NOT NULL,
  at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
